import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Patrol, patrolEnabledFromEnv } from "../../../src/fingerprint/patrol.ts";
import { ProbeScheduler } from "../../../src/fingerprint/scheduler.ts";
import { FingerprintStore } from "../../../src/fingerprint/store.ts";

// @test REQ-V2bC-08 / REQ-V2bC-13
// @intent 这是把 Patrol + sendProbe + extractFeature 真正接起来的地方。
//         在此之前的教训：三者各有测试，却**从未被生产代码调用**——
//         有测试不等于有功能。
//
//         两条必须成立：
//           ① 开关默认关闭（升级不该改变机器的对外行为）
//           ② 退避中的 provider 一个探针都不发（AC-20）

const HTTP_OK = 200;
const FAILURES_TO_BACKOFF = 3;

let dirs: string[] = [];
function tempStore(): FingerprintStore {
  const d = mkdtempSync(join(tmpdir(), "fp-sched-"));
  dirs.push(d);
  return new FingerprintStore(join(d, "e.jsonl"));
}
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function clock(start = 1_700_000_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

const okBody = { choices: [{ message: { content: "雷克雅未克" } }], usage: { prompt_tokens: 20 } };

type FakeProbe = (url: string) => Promise<{ ok: boolean; status?: number; body?: Record<string, unknown>; errorClass?: "timeout" }>;

interface Setup {
  readonly providers?: Record<string, string>;
  readonly probe?: FakeProbe;
  readonly patrol?: (store: FingerprintStore, c: { now: () => number }) => Patrol;
  readonly hits?: string[];
}

/** 统一的调度器装配：省掉每个用例重复的六行。 */
function setup(s: Setup = {}) {
  const store = tempStore();
  const c = clock();
  const patrol = s.patrol?.(store, c) ?? new Patrol({ store, now: c.now });
  const hits = s.hits ?? [];
  const probe: FakeProbe =
    s.probe ??
    (async (url) => {
      hits.push(url);
      return { ok: true, status: HTTP_OK, body: okBody };
    });
  const sched = new ProbeScheduler({
    store,
    patrol,
    providers: s.providers ?? { "p/a": "http://x" },
    probe,
    log: () => undefined,
    catchUpGapMs: 0,
  });
  return { store, clock: c, patrol, hits, sched };
}

describe("开关（默认关闭）", () => {
  it("未设置 → 关闭", () => {
    expect(patrolEnabledFromEnv({})).toBe(false);
  });

  it("设为 1 或 true → 开启（大小写不敏感）", () => {
    expect(patrolEnabledFromEnv({ LLMVETO_FINGERPRINT_PATROL: "1" })).toBe(true);
    expect(patrolEnabledFromEnv({ LLMVETO_FINGERPRINT_PATROL: "TRUE" })).toBe(true);
  });

  it("拼写错误或其它值 → 关闭（不该因为打错字就默认发送）", () => {
    for (const v of ["0", "false", "yes", "on", "2", ""]) {
      expect(patrolEnabledFromEnv({ LLMVETO_FINGERPRINT_PATROL: v })).toBe(false);
    }
  });
});

describe("调度器真实发出探针", () => {
  it("配额允许时确实调用 probe", async () => {
    const { hits, sched } = setup();
    expect(await sched.runOnce()).toBe(1);
    expect(hits).toEqual(["http://x"]);
  });

  it("探针结果落成 feature 事件", async () => {
    const { store, sched } = setup();
    await sched.runOnce();
    expect(store.readAll().filter((e) => e.kind === "probe_feature")).toHaveLength(1);
  });

  it("6h 内第二次不重复发（配额生效）", async () => {
    const { hits, sched } = setup();
    await sched.runOnce();
    await sched.runOnce();
    expect(hits).toHaveLength(1);
  });
});

describe("退避期间零请求（AC-20）", () => {
  it("连续 3 次失败后，runOnce 不再发请求", async () => {
    const { hits, sched } = setup({
      patrol: (store, c) => {
        const p = new Patrol({ store, now: c.now });
        for (let i = 0; i < FAILURES_TO_BACKOFF; i += 1) p.recordFailure("p/a", "D0", "timeout");
        return p;
      },
    });
    expect(await sched.runOnce()).toBe(0);
    expect(hits).toHaveLength(0);
  });

  it("一个 provider 退避不影响另一个", async () => {
    const { hits, sched } = setup({
      providers: { "bad/x": "http://bad", "good/y": "http://good" },
      patrol: (store, c) => {
        const p = new Patrol({ store, now: c.now });
        for (let i = 0; i < FAILURES_TO_BACKOFF; i += 1) p.recordFailure("bad/x", "D0", "timeout");
        return p;
      },
    });
    await sched.runOnce();
    expect(hits).toEqual(["http://good"]);
  });
});

describe("失败路径", () => {
  it("探针失败记 probe_failure，不写 feature", async () => {
    const { store, sched } = setup({ probe: async () => ({ ok: false, errorClass: "timeout" }) });
    await sched.runOnce();
    const all = store.readAll();
    expect(all.filter((e) => e.kind === "probe_failure")).toHaveLength(1);
    expect(all.filter((e) => e.kind === "probe_feature")).toHaveLength(0);
  });

  it("probe 抛异常时调度器不崩（周期任务不能拖挂 daemon）", async () => {
    const { sched } = setup({
      probe: async () => {
        throw new Error("boom");
      },
    });
    await expect(sched.runOnce()).resolves.toBe(0);
  });
});

describe("判定链接通（这正是第二个'加了没接入'）", () => {
  it("首次采样 → baseline_pending（宽限期，不是 finding）", async () => {
    const { store, sched } = setup();
    await sched.runOnce();
    const [e] = store.readAll().filter((x) => x.kind === "probe_feature");
    expect(e?.kind === "probe_feature" && e.verdict).toBe("baseline_pending");
  });

  it("基线建立后，行为退化 → 真的写出 finding（verdictFor 被调用）", async () => {
    const store = tempStore();
    const now = 1_700_000_000_000;
    const patrol = new Patrol({ store, now: () => now });
    // 灌 4 条 D0 → sampleCount=4 → 4%4=0 → 本轮采 D0（轮转序号是总采样数）
    for (let i = 0; i < 4; i += 1) {
      store.append({ kind: "probe_feature", provider_id: "p/a", dimension: "D0", value: 20, verdict: "baseline_pending", deviation: 0, ts: "t" });
    }
    const sched = new ProbeScheduler({
      store, patrol,
      providers: { "p/a": "http://x" },
      catchUpGapMs: 0,
      // tokenizer 数从 20 掉到 10（偏离 50% → 超过 15% 阈值）
      probe: async () => ({ ok: true, status: HTTP_OK, body: { choices: [{ message: { content: "x" } }], usage: { prompt_tokens: 10 } } }),
      log: () => undefined,
    });
    await sched.runOnce();
    const last = store.readAll().filter((x) => x.kind === "probe_feature").at(-1);
    expect(last?.kind === "probe_feature" && last.verdict).toBe("finding");
    expect(last?.kind === "probe_feature" && last.deviation).toBeGreaterThan(0.15);
  });

  it("基线建立后行为正常 → clean（不是全 baseline_pending）", async () => {
    const store = tempStore();
    const patrol = new Patrol({ store, now: () => 1_700_000_000_000 });
    for (let i = 0; i < 4; i += 1) {
      store.append({ kind: "probe_feature", provider_id: "p/a", dimension: "D0", value: 20, verdict: "baseline_pending", deviation: 0, ts: "t" });
    }
    const sched = new ProbeScheduler({
      store, patrol,
      providers: { "p/a": "http://x" },
      catchUpGapMs: 0,
      probe: async () => ({ ok: true, status: HTTP_OK, body: { choices: [{ message: { content: "x" } }], usage: { prompt_tokens: 20 } } }),
      log: () => undefined,
    });
    await sched.runOnce();
    const last = store.readAll().filter((x) => x.kind === "probe_feature").at(-1);
    expect(last?.kind === "probe_feature" && last.verdict).toBe("clean");
  });
});

describe("轮转真的在转（第三个'加了没接入'）", () => {
  it("连续 4 轮采样覆盖 D0-D3（第一版用某一维的记录数当序号，永远轮不到 D2/D3）", async () => {
    const store = tempStore();
    let now = 1_700_000_000_000;
    const patrol = new Patrol({ store, now: () => now });
    const seen: string[] = [];
    const sched = new ProbeScheduler({
      store,
      patrol,
      providers: { "p/a": "http://x" },
      catchUpGapMs: 0,
      probe: async (_url, body) => {
        const t = JSON.stringify(body);
        seen.push(t.includes("quick brown fox") ? "D0" : t.includes("JSON") ? "D1" : t.includes("冰岛") ? "D2" : "D3");
        // 始终返回"正常"形态，避免触发补齐（补齐会插入额外探针，干扰本用例的轮转断言）
        const content = t.includes("JSON") ? '{"ok":true}' : t.includes("冰岛") ? "雷克雅未克" : t.includes("系统提示词") ? "我无法提供" : "x";
        return { ok: true, status: HTTP_OK, body: { choices: [{ message: { content } }], usage: { prompt_tokens: 20 } } };
      },
      log: () => undefined,
    });
    // 每轮把时钟推过 6h 配额，才能连发 4 次
    for (let i = 0; i < 4; i += 1) {
      now += 7 * 60 * 60 * 1000;
      await sched.runOnce();
    }
    expect(seen).toEqual(["D0", "D1", "D2", "D3"]);
  });
});

describe("补齐与分片（第四个'加了没接入'）", () => {
  /** 造一个 provider：D0 基线 20，D0 观察到 10（退化），其余维正常。 */
  async function primeAndDegrade() {
    const store = tempStore();
    const patrol = new Patrol({ store, now: () => 1_700_000_000_000 });
    for (let i = 0; i < 4; i += 1) {
      store.append({ kind: "probe_feature", provider_id: "p/a", dimension: "D0", value: 20, verdict: "baseline_pending", deviation: 0, ts: "t" });
      store.append({ kind: "probe_feature", provider_id: "p/a", dimension: "D1", value: true, verdict: "baseline_pending", deviation: 0, ts: "t" });
      store.append({ kind: "probe_feature", provider_id: "p/a", dimension: "D2", value: true, verdict: "baseline_pending", deviation: 0, ts: "t" });
      store.append({ kind: "probe_feature", provider_id: "p/a", dimension: "D3", value: "我无法提供", verdict: "baseline_pending", deviation: 0, ts: "t" });
    }
    return { store, patrol };
  }

  it("退化后确实补测其它维度（CatchUpPlanner 被调用）", async () => {
    const { store, patrol } = await primeAndDegrade();
    const dims: string[] = [];
    const sched = new ProbeScheduler({
      store, patrol,
      providers: { "p/a": "http://x" },
      catchUpGapMs: 0,
      probe: async (_u, body) => {
        const t = JSON.stringify(body);
        // 主探针 D0 退化；补齐的两个维度都正常
        if (t.includes("quick brown fox")) {
          dims.push("D0");
          return { ok: true, status: HTTP_OK, body: { choices: [{ message: { content: "x" } }], usage: { prompt_tokens: 10 } } };
        }
        dims.push(t.includes("冰岛") ? "D2" : "other");
        return { ok: true, status: HTTP_OK, body: { choices: [{ message: { content: "雷克雅未克" } }], usage: { prompt_tokens: 20 } } };
      },
      log: () => undefined,
    });
    await sched.runOnce();
    // 主探针 + 2 个补齐探针
    expect(dims.length).toBeGreaterThanOrEqual(3);
  });

  it("补齐维度都正常 → 记 inconsistent_degradation", async () => {
    const { store, patrol } = await primeAndDegrade();
    const sched = new ProbeScheduler({
      store, patrol,
      providers: { "p/a": "http://x" },
      catchUpGapMs: 0,
      probe: async (_u, body) => {
        const t = JSON.stringify(body);
        if (t.includes("quick brown fox")) {
          // D0：tokenizer 从 20 掉到 10 → 退化
          return { ok: true, status: HTTP_OK, body: { choices: [{ message: { content: "x" } }], usage: { prompt_tokens: 10 } } };
        }
        // 补齐维度必须按各自形态返回**正常**结果：D1 要 JSON、D2 要答案、D3 要拒绝措辞
        const content = t.includes("JSON") ? '{"ok":true}' : t.includes("冰岛") ? "雷克雅未克" : "我无法提供";
        return { ok: true, status: HTTP_OK, body: { choices: [{ message: { content } }], usage: { prompt_tokens: 20 } } };
      },
      log: () => undefined,
    });
    await sched.runOnce();
    expect(store.readAll().filter((e) => e.kind === "inconsistent_degradation")).toHaveLength(1);
  });
});

describe("换代隔离（第五个'加了没接入'：baselineKey 被创建但从未用上）", () => {
  it("换载荷后，旧代样本不参与新代基线", () => {
    const store = tempStore();
    // 旧代（generation=99，模拟历史载荷）样本：值 20
    for (let i = 0; i < 6; i += 1) {
      store.append({
        kind: "probe_feature", provider_id: "p/a", dimension: "D0", generation: 99,
        value: 20, verdict: "baseline_pending", deviation: 0, ts: "t",
      });
    }
    // 按当前代查询：应为空（旧代不混入）
    const current = store.recentFeatures("p/a", "D0", 10, 1);
    expect(current).toHaveLength(0);
    // 不限代时能看到全部
    expect(store.recentFeatures("p/a", "D0", 10)).toHaveLength(6);
  });

  it("缺失 generation 的历史数据视为当前代（升级不制造重建窗口）", () => {
    const store = tempStore();
    for (let i = 0; i < 3; i += 1) {
      store.append({ kind: "probe_feature", provider_id: "p/a", dimension: "D0", value: 20, verdict: "baseline_pending", deviation: 0, ts: "t" });
    }
    expect(store.recentFeatures("p/a", "D0", 10, 1)).toHaveLength(3);
  });
});
