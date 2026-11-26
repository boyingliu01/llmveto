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
