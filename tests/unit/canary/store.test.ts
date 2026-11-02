import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CANARY_LRU_CAPACITY,
  CANARY_TTL_MS,
  type RegistryLoadStatus,
  CanaryStore,
} from "../../../src/canary/store.ts";
import { REGISTRY_VERSION } from "../../../src/shared/registry-file-schema.ts";

// @test REQ-V2a-07
// @intent canary registry 存储四族（分配 / 轮换 / 淘汰 / 损坏）+ 快照族（D-05）。
//         固定熵表驱动：熵源与时钟为依赖注入（非 mock），断言精确值；全部真实临时目录落盘。
//         原子写（tmp+renameSync）、三类损坏收敛 registry_unavailable、TTL 24h / LRU 64 先到为准。
// @covers AC-V2a-19①（canary 语义源）

const T0 = 1_760_000_000_000; // 固定 epoch ms 基准

/** 表驱动固定熵：按序发放；耗尽即抛（测试失败显式化，不静默绕回）。 */
function fixedEntropy(values: readonly string[]): () => string {
  let i = 0;
  return () => {
    const v = values[i];
    i += 1;
    if (v === undefined) throw new Error("entropy table exhausted");
    return v;
  };
}

/** 表驱动固定时钟：可推进。 */
function fixedClock(start: number): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const ENTROPY: readonly string[] = Array.from({ length: 96 }, (_, i) => `can-${String(i).padStart(3, "0")}`);

interface RawRegistryFile {
  version: number;
  rotation_count: number;
  last_rotated_at: string | null;
  entries: Record<string, { canary: string; last_seen: number }>;
}

describe("SL-05 canary registry store (REQ-V2a-07 / D-01+D-02+D-05)", () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "llmveto-canary-"));
    path = join(dir, "canary-registry.json");
  });
  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows 句柄释放抖动容错 */
    }
  });

  function newStore(opts: { entropy?: () => string; clock?: ReturnType<typeof fixedClock> } = {}): CanaryStore {
    return new CanaryStore(path, {
      ...(opts.entropy !== undefined ? { entropy: opts.entropy } : {}),
      ...(opts.clock !== undefined ? { now: opts.clock.now } : {}),
    });
  }

  function fileJson(): RawRegistryFile {
    return JSON.parse(readFileSync(path, "utf8")) as RawRegistryFile;
  }

  // ── 分配族 ──────────────────────────────────────────────────────────────

  describe("分配族", () => {
    it("新会话分配：canary = 固定熵表精确值 + created + 落盘（schema 自带 version）", () => {
      const store = newStore({ entropy: fixedEntropy(ENTROPY), clock: fixedClock(T0) });
      expect(store.assign("s1")).toEqual({ canary: "can-000", created: true });
      const f = fileJson();
      expect(f.version).toBe(REGISTRY_VERSION);
      expect(f.entries["s1"]).toEqual({ canary: "can-000", last_seen: T0 });
    });

    it("重复分配同 key 幂等：同 canary、created=false、熵不重复消耗", () => {
      const store = newStore({ entropy: fixedEntropy(ENTROPY), clock: fixedClock(T0) });
      expect(store.assign("s1")).toEqual({ canary: "can-000", created: true });
      expect(store.assign("s1")).toEqual({ canary: "can-000", created: false });
      expect(store.assign("s2")).toEqual({ canary: "can-001", created: true });
    });

    it("lastSeen 刷新：重分配后落盘 last_seen = 新时钟值", () => {
      const clock = fixedClock(T0);
      const store = newStore({ entropy: fixedEntropy(ENTROPY), clock });
      store.assign("s1");
      clock.advance(3_600_000);
      store.assign("s1");
      expect(fileJson().entries["s1"]?.last_seen).toBe(T0 + 3_600_000);
    });

    it("持久化回读：新实例同 key 同 canary（跨实例幂等）", () => {
      const store = newStore({ entropy: fixedEntropy(ENTROPY), clock: fixedClock(T0) });
      store.assign("s1");
      const again = newStore({ entropy: fixedEntropy(ENTROPY), clock: fixedClock(T0) });
      expect(again.assign("s1")).toEqual({ canary: "can-000", created: false });
    });
  });

  // ── 快照族（D-05）────────────────────────────────────────────────────────

  describe("快照族（D-05：排除请求方自身 + 只读）", () => {
    it("排除请求方自身、含他人 canary", () => {
      const store = newStore({ entropy: fixedEntropy(ENTROPY), clock: fixedClock(T0) });
      store.assign("s1");
      store.assign("s2");
      expect(store.snapshot("s1")).toEqual(["can-001"]);
      expect(store.snapshot("s2")).toEqual(["can-000"]);
    });

    it("请求方尚无 canary 时快照 = 全集", () => {
      const store = newStore({ entropy: fixedEntropy(ENTROPY), clock: fixedClock(T0) });
      store.assign("s1");
      store.assign("s2");
      expect(store.snapshot("unknown")).toEqual(["can-000", "can-001"]);
    });

    it("快照只读：frozen + 修改副本不影响 store + 后续写入不影响已取快照", () => {
      const store = newStore({ entropy: fixedEntropy(ENTROPY), clock: fixedClock(T0) });
      store.assign("s1");
      store.assign("s2");
      const snap = store.snapshot("s1");
      expect(Object.isFrozen(snap)).toBe(true);
      const mutated = [...snap];
      mutated.push("garbage");
      expect(store.snapshot("s1")).toEqual(snap);
      store.assign("s3");
      expect(snap).toEqual(["can-001"]);
    });
  });

  // ── 轮换族 ──────────────────────────────────────────────────────────────

  describe("轮换族", () => {
    it("轮换：全部旧值替换为表中新熵 + rotation_count/last_rotated_at 精确更新", () => {
      const clock = fixedClock(T0);
      const store = newStore({ entropy: fixedEntropy(ENTROPY), clock });
      store.assign("s1");
      store.assign("s2");
      clock.advance(5_000);
      expect(store.rotate()).toEqual({
        rotation_count: 1,
        last_rotated_at: new Date(T0 + 5_000).toISOString(),
      });
      expect(store.snapshot("s3")).toEqual(["can-002", "can-003"]);
      expect(store.snapshot("s1")).toEqual(["can-003"]);
    });

    it("二次轮换：rotation_count 递增 + 值再替换", () => {
      const clock = fixedClock(T0);
      const store = newStore({ entropy: fixedEntropy(ENTROPY), clock });
      store.assign("s1");
      store.assign("s2");
      store.rotate();
      clock.advance(1_000);
      store.rotate();
      expect(store.rotationCount).toBe(2);
      expect(store.snapshot("s9")).toEqual(["can-004", "can-005"]);
    });

    it("轮换持久化回读一致（rotation_count / last_rotated_at / canary 值）", () => {
      const clock = fixedClock(T0);
      const store = newStore({ entropy: fixedEntropy(ENTROPY), clock });
      store.assign("s1");
      store.assign("s2");
      clock.advance(5_000);
      store.rotate();
      const f = fileJson();
      expect(f.rotation_count).toBe(1);
      expect(f.last_rotated_at).toBe(new Date(T0 + 5_000).toISOString());
      expect(f.entries["s1"]).toEqual({ canary: "can-002", last_seen: T0 });
      const again = newStore({ entropy: fixedEntropy(ENTROPY), clock });
      expect(again.rotationCount).toBe(1);
      expect(again.lastRotatedAt).toBe(new Date(T0 + 5_000).toISOString());
      expect(again.snapshot("s1")).toEqual(["can-003"]);
    });

    it("轮换不改 lastSeen（LRU 簿记属请求侧，不因轮换复活 TTL）", () => {
      const clock = fixedClock(T0);
      const store = newStore({ entropy: fixedEntropy(ENTROPY), clock });
      store.assign("s1");
      clock.advance(5_000);
      store.rotate();
      expect(fileJson().entries["s1"]?.last_seen).toBe(T0);
    });
  });

  // ── 淘汰族（TTL 24h + LRU 64，先到为准）──────────────────────────────────

  describe("淘汰族", () => {
    it("TTL 到期淘汰（写入时触发；容量未满即 TTL 先到）", () => {
      const clock = fixedClock(T0);
      const store = newStore({ entropy: fixedEntropy(ENTROPY), clock });
      store.assign("s1");
      clock.advance(CANARY_TTL_MS + 60_000);
      store.assign("s2");
      expect(store.size).toBe(1);
      expect(store.snapshot("s2")).toEqual([]);
      expect(Object.keys(fileJson().entries)).toEqual(["s2"]);
    });

    it("TTL 未到不淘汰（24h 边界内仍活跃）", () => {
      const clock = fixedClock(T0);
      const store = newStore({ entropy: fixedEntropy(ENTROPY), clock });
      store.assign("s1");
      clock.advance(CANARY_TTL_MS - 60_000);
      store.assign("s2");
      expect(store.size).toBe(2);
      expect(store.snapshot("s2")).toEqual(["can-000"]);
    });

    it("LRU 64 容量淘汰：lastSeen 最旧的先走（TTL 未到即容量先到）", () => {
      const clock = fixedClock(T0);
      const store = newStore({ entropy: fixedEntropy(ENTROPY), clock });
      for (let i = 0; i < CANARY_LRU_CAPACITY; i += 1) {
        clock.advance(1);
        store.assign(`s${String(i).padStart(2, "0")}`);
      }
      expect(store.size).toBe(CANARY_LRU_CAPACITY);
      clock.advance(1);
      store.assign("s64");
      expect(store.size).toBe(CANARY_LRU_CAPACITY);
      const snap = store.snapshot("s64");
      expect(snap).not.toContain("can-000");
      expect(snap).toContain("can-001");
      expect(snap).not.toContain("can-064");
      expect(snap).toHaveLength(CANARY_LRU_CAPACITY - 1);
    });

    it("加载时 TTL 淘汰（惰性：load 只清内存不回写）", () => {
      writeFileSync(
        path,
        JSON.stringify({
          version: 1,
          rotation_count: 0,
          last_rotated_at: null,
          entries: {
            expired: { canary: "can-old", last_seen: T0 - CANARY_TTL_MS - 1 },
            fresh: { canary: "can-new", last_seen: T0 },
          },
        }),
        "utf8",
      );
      const store = newStore({ clock: fixedClock(T0) });
      expect(store.size).toBe(1);
      expect(store.snapshot("fresh")).toEqual([]);
      expect(store.snapshot("x")).toEqual(["can-new"]);
      expect(Object.keys(fileJson().entries)).toHaveLength(2);
    });

    it("加载时 LRU 截断：70 条 → 64（按 lastSeen 保留最新）", () => {
      const entries: Record<string, { canary: string; last_seen: number }> = {};
      for (let i = 0; i < 70; i += 1) {
        entries[`s${String(i).padStart(2, "0")}`] = { canary: `can-${String(i).padStart(3, "0")}`, last_seen: T0 + i };
      }
      writeFileSync(
        path,
        JSON.stringify({ version: 1, rotation_count: 0, last_rotated_at: null, entries }),
        "utf8",
      );
      const store = newStore({ clock: fixedClock(T0 + 10_000) });
      expect(store.size).toBe(CANARY_LRU_CAPACITY);
      const snap = store.snapshot("zz");
      expect(snap).toContain("can-069");
      expect(snap).not.toContain("can-000");
      expect(snap).not.toContain("can-005");
      expect(Object.keys(fileJson().entries)).toHaveLength(70);
    });
  });

  // ── 损坏族（三类收敛 registry_unavailable，§4.3 不得静默）────────────────

  describe("损坏族", () => {
    const CORRUPT_CASES: ReadonlyArray<{
      name: string;
      body: string;
      cause: "invalid_json" | "unknown_version" | "malformed_structure";
    }> = [
      { name: "非法 JSON", body: '{"version":1,"entries":', cause: "invalid_json" },
      {
        name: "version 不识别（2）",
        body: JSON.stringify({ version: 2, rotation_count: 0, last_rotated_at: null, entries: {} }),
        cause: "unknown_version",
      },
      {
        name: "version 缺失",
        body: JSON.stringify({ rotation_count: 0, last_rotated_at: null, entries: {} }),
        cause: "unknown_version",
      },
      {
        name: "version 类型不符",
        body: JSON.stringify({ version: "1", rotation_count: 0, last_rotated_at: null, entries: {} }),
        cause: "unknown_version",
      },
      {
        name: "entries 非对象（数组）",
        body: JSON.stringify({ version: 1, rotation_count: 0, last_rotated_at: null, entries: [] }),
        cause: "malformed_structure",
      },
      { name: "根非对象（数组）", body: "[]", cause: "malformed_structure" },
      {
        name: "条目 canary 类型不符",
        body: JSON.stringify({ version: 1, rotation_count: 0, last_rotated_at: null, entries: { s1: { canary: 9, last_seen: 1 } } }),
        cause: "malformed_structure",
      },
      {
        name: "条目 last_seen 缺失",
        body: JSON.stringify({ version: 1, rotation_count: 0, last_rotated_at: null, entries: { s1: { canary: "x" } } }),
        cause: "malformed_structure",
      },
      {
        name: "rotation_count 缺失",
        body: JSON.stringify({ version: 1, last_rotated_at: null, entries: {} }),
        cause: "malformed_structure",
      },
      {
        name: "last_rotated_at 类型不符",
        body: JSON.stringify({ version: 1, rotation_count: 0, last_rotated_at: 5, entries: {} }),
        cause: "malformed_structure",
      },
      {
        name: "last_rotated_at 不可解析日期",
        body: JSON.stringify({ version: 1, rotation_count: 0, last_rotated_at: "not-a-date", entries: {} }),
        cause: "malformed_structure",
      },
      {
        name: "条目值非对象（字符串）",
        body: JSON.stringify({ version: 1, rotation_count: 0, last_rotated_at: null, entries: { s1: "junk" } }),
        cause: "malformed_structure",
      },
    ];

    for (const c of CORRUPT_CASES) {
      it(`损坏收敛不可用：${c.name}`, () => {
        writeFileSync(path, c.body, "utf8");
        const store = newStore({ entropy: fixedEntropy(ENTROPY), clock: fixedClock(T0) });
        const expected: RegistryLoadStatus = { status: "registry_unavailable", cause: c.cause };
        expect(store.loadStatus).toEqual(expected);
        expect(store.snapshot("any")).toEqual([]);
      });
    }

    it("恢复路径：损坏后下一笔合法写入重建完整文件", () => {
      writeFileSync(path, "{broken", "utf8");
      const store = newStore({ entropy: fixedEntropy(ENTROPY), clock: fixedClock(T0) });
      expect(store.loadStatus.status).toBe("registry_unavailable");
      store.assign("s1");
      const f = fileJson();
      expect(f.version).toBe(REGISTRY_VERSION);
      expect(f.entries["s1"]).toEqual({ canary: "can-000", last_seen: T0 });
      const again = newStore({ entropy: fixedEntropy(ENTROPY), clock: fixedClock(T0) });
      expect(again.loadStatus).toEqual({ status: "ok" });
    });

    it("崩溃残留：tmp 半成品 + 旧完整正式文件 → 读到旧完整数据（tmp 不替代正式文件）", () => {
      writeFileSync(
        path,
        JSON.stringify({
          version: 1,
          rotation_count: 0,
          last_rotated_at: null,
          entries: { s1: { canary: "can-old-A", last_seen: T0 } },
        }),
        "utf8",
      );
      writeFileSync(`${path}.tmp`, '{"version":1,"rotation_count":0,"entries":{"s1":{"canary":"HALF', "utf8");
      const store = newStore({ entropy: fixedEntropy(ENTROPY), clock: fixedClock(T0) });
      expect(store.loadStatus).toEqual({ status: "ok" });
      expect(store.assign("s1")).toEqual({ canary: "can-old-A", created: false });
    });

    it("原子写成功：tmp 被 rename 消费、正式文件完整 JSON", () => {
      const store = newStore({ entropy: fixedEntropy(ENTROPY), clock: fixedClock(T0) });
      store.assign("s1");
      expect(existsSync(`${path}.tmp`)).toBe(false);
      const f = fileJson();
      expect(f.version).toBe(REGISTRY_VERSION);
      expect(Object.keys(f.entries)).toEqual(["s1"]);
    });

    it("默认熵源（未注入）：27 字符 canary token（AC-V2a-07 定值，随机值只断言格式）", () => {
      const store = new CanaryStore(path); // 默认熵源 + 默认时钟
      const { canary } = store.assign("s1");
      expect(canary).toMatch(/^llmveto-canary-[0-9a-f]{12}$/);
      expect(canary).toHaveLength(27);
      const again = new CanaryStore(path);
      expect(again.assign("s1").canary).toBe(canary); // 落盘回读一致
    });
  });
});
