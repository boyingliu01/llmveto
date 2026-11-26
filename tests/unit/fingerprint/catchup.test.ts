import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CatchUpPlanner } from "../../../src/fingerprint/catchup.ts";
import { Patrol } from "../../../src/fingerprint/patrol.ts";
import { FingerprintStore } from "../../../src/fingerprint/store.ts";

// @test REQ-V2bC-07 / REQ-V2bC-15 / AC-07a~c / AC-15a
// @intent 补齐探针是"确认"而非"发现"，而且它是最容易写成漏洞的地方：
//           ① 补齐失败不计入退避 → 对手专打补齐即可永不退避
//           ② 补齐不受配额约束 → 补齐成了高频探测的借口
//           ③ 补齐识别不出分片 → 单维退化永远只能报"某维坏了"
//
//         设计 D-04a 把这三条封口，此处逐条断言。

let dirs: string[] = [];
function store(): FingerprintStore {
  const d = mkdtempSync(join(tmpdir(), "fp-catchup-"));
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

describe("SL-09 补齐计划（AC-07a~c）", () => {
  it("D0 退化时补 2 个维度（不是 3 个）——够判断是否分片", () => {
    const plan = new CatchUpPlanner().planFor("D0");
    expect(plan).toHaveLength(2);
    expect(plan).not.toContain("D0");
  });

  it("每个维度的补齐计划都不含自身且数量为 2", () => {
    const p = new CatchUpPlanner();
    for (const dim of ["D0", "D1", "D2", "D3"] as const) {
      const plan = p.planFor(dim);
      expect(plan).toHaveLength(2);
      expect(plan).not.toContain(dim);
      expect(new Set(plan).size).toBe(2);
    }
  });

  it("AC-07b：退避中的 provider 不补齐（D-04a：别雪上加霜）", () => {
    const c = clock();
    const s = store();
    const patrol = new Patrol({ store: s, now: c.now });
    for (let i = 0; i < 3; i += 1) patrol.recordFailure("prov", "D0", "timeout");
    expect(new CatchUpPlanner().shouldCatchUp("prov", patrol)).toBe(false);
  });

  it("AC-07b：补齐失败计入同一计数器（没有独立分支）", () => {
    const c = clock();
    const s = store();
    const patrol = new Patrol({ store: s, now: c.now });
    patrol.recordFailure("prov", "D0", "timeout");
    patrol.recordFailure("prov", "D0", "timeout");
    // 补齐探针的失败走同一个 recordFailure —— 第三次即退避
    patrol.recordFailure("prov", "D1", "timeout");
    expect(patrol.isBackingOff("prov")).toBe(true);
  });

  it("AC-07c：退避期间补齐探针请求数 = 0", () => {
    const c = clock();
    const s = store();
    const patrol = new Patrol({ store: s, now: c.now });
    for (let i = 0; i < 3; i += 1) patrol.recordFailure("prov", "D0", "timeout");
    const planner = new CatchUpPlanner();
    // 退避中，任何维度的补齐都不该被批准
    for (const dim of ["D0", "D1", "D2", "D3"] as const) {
      expect(planner.shouldCatchUp("prov", patrol)).toBe(false);
      expect(patrol.shouldProbe("prov")).toBe(false);
      void dim;
    }
  });

  it("每 provider 每 24h 至多 1 次补齐（C2a 豁免不叠加）", () => {
    const c = clock();
    const s = store();
    const patrol = new Patrol({ store: s, now: c.now });
    const planner = new CatchUpPlanner({ now: c.now });
    expect(planner.shouldCatchUp("prov", patrol)).toBe(true);
    planner.recordCatchUp("prov");
    expect(planner.shouldCatchUp("prov", patrol)).toBe(false);
    c.advance(24 * 60 * 60 * 1000 + 1);
    expect(planner.shouldCatchUp("prov", patrol)).toBe(true);
  });
});

describe("SL-10 分片识别（AC-15a）", () => {
  it("单维退化 + 补齐两维都正常 → inconsistent_degradation", () => {
    const verdict = new CatchUpPlanner().interpret("D2", [
      { dimension: "D0", degraded: false },
      { dimension: "D1", degraded: false },
    ]);
    expect(verdict.kind).toBe("inconsistent_degradation");
    if (verdict.kind === "inconsistent_degradation") {
      expect(verdict.degraded_dimension).toBe("D2");
      expect(verdict.healthy_dimensions).toEqual(["D0", "D1"]);
    }
  });

  it("补齐任一再退化 → 稳定降级（不是分片）", () => {
    const verdict = new CatchUpPlanner().interpret("D2", [
      { dimension: "D0", degraded: true },
      { dimension: "D1", degraded: false },
    ]);
    expect(verdict.kind).toBe("stable_degradation");
  });

  it("补齐两维都退化 → 稳定降级", () => {
    const verdict = new CatchUpPlanner().interpret("D2", [
      { dimension: "D0", degraded: true },
      { dimension: "D1", degraded: true },
    ]);
    expect(verdict.kind).toBe("stable_degradation");
  });
});

describe("SL-09 配额跨重启（评审 C1 回归）", () => {
  it("重启后配额不清零（第一版用内存 Map，重启即绕过）", () => {
    const c = clock();
    const s = store();
    const patrol = new Patrol({ store: s, now: c.now });
    const planner = new CatchUpPlanner({ now: c.now, store: s });
    planner.recordCatchUp("prov");
    expect(new CatchUpPlanner({ now: c.now, store: s }).shouldCatchUp("prov", patrol)).toBe(false);
  });

  it("配额落盘：store 里能看到 catchup_quota 事件", () => {
    const c = clock();
    const s = store();
    new CatchUpPlanner({ now: c.now, store: s }).recordCatchUp("prov");
    expect(s.readAll().filter((e) => e.kind === "catchup_quota")).toHaveLength(1);
  });

  it("不同 provider 的配额互不影响", () => {
    const c = clock();
    const s = store();
    const patrol = new Patrol({ store: s, now: c.now });
    new CatchUpPlanner({ now: c.now, store: s }).recordCatchUp("a");
    expect(new CatchUpPlanner({ now: c.now, store: s }).shouldCatchUp("b", patrol)).toBe(true);
  });
});
