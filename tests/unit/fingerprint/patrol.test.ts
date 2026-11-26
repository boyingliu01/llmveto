import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Patrol } from "../../../src/fingerprint/patrol.ts";
import { FingerprintStore } from "../../../src/fingerprint/store.ts";

// @test REQ-V2bC-08 / REQ-V2bC-09 / AC-08a~c / AC-09a~c / AC-20
// @intent 周期任务的生命周期是这个功能最危险的地方：它会主动向中转站发请求。
//         三条不能破的线：
//           ① 频率上限（6h/provider）——破了就是高频探测
//           ② 手动与周期共享配额（C2b）——否则 CLI 成了绕过最小暴露的侧信道
//           ③ 熔断跨重启（C7e/AC-20）——破了就是重启即绕过

let dirs: string[] = [];
function tempStore(): FingerprintStore {
  const d = mkdtempSync(join(tmpdir(), "fp-patrol-"));
  dirs.push(d);
  return new FingerprintStore(join(d, "events.jsonl"));
}
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

/** 可控时钟：不真的等 6 小时。 */
function clock(startMs = 1_700_000_000_000) {
  let now = startMs;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

const SIX_HOURS = 6 * 60 * 60 * 1000;

describe("SL-07 频率约束（AC-08a/08c）", () => {
  it("AC-08a：首次可探，6h 内再次请求被拒", () => {
    const c = clock();
    // 抖动固定为 0 → factor = 1 − 20% = 0.8；周期边界因此确定，可精确断言
    const p = new Patrol({ store: tempStore(), now: c.now, jitter: () => 0.5 });
    expect(p.shouldProbe("prov")).toBe(true);
    p.recordAttempt("prov");
    expect(p.nextEligibleAt("prov")).toBe(c.now() + SIX_HOURS); // jitter 0.5 → factor 1
    c.advance(SIX_HOURS - 1);
    expect(p.shouldProbe("prov")).toBe(false);
    c.advance(1);
    expect(p.shouldProbe("prov")).toBe(true);
  });

  it("AC-08c：手动探针与周期探针共享配额", () => {
    const c = clock();
    const p = new Patrol({ store: tempStore(), now: c.now });
    p.recordAttempt("prov"); // 周期探针用掉了配额
    // 手动探针不该因为"是手动"就多给一次
    expect(p.shouldProbe("prov", { manual: true })).toBe(false);
  });

  it("不同 provider 的配额互相独立", () => {
    const c = clock();
    const p = new Patrol({ store: tempStore(), now: c.now });
    p.recordAttempt("a");
    expect(p.shouldProbe("a")).toBe(false);
    expect(p.shouldProbe("b")).toBe(true);
  });

  it("AC-08b：抖动在 ±20% 内", () => {
    const c = clock();
    const p = new Patrol({ store: tempStore(), now: c.now, jitter: () => 0.999 });
    p.recordAttempt("prov");
    const next = p.nextEligibleAt("prov");
    expect(next).toBeGreaterThanOrEqual(c.now() + SIX_HOURS * 0.8);
    expect(next).toBeLessThanOrEqual(c.now() + SIX_HOURS * 1.2);
  });
});

describe("SL-08 熔断（AC-09a/09b/AC-20）", () => {
  it("AC-09a：连续 3 次失败进入退避", () => {
    const c = clock();
    const store = tempStore();
    const p = new Patrol({ store, now: c.now });
    for (let i = 0; i < 2; i += 1) p.recordFailure("prov", "D0", "timeout");
    expect(p.isBackingOff("prov")).toBe(false);
    p.recordFailure("prov", "D0", "timeout");
    expect(p.isBackingOff("prov")).toBe(true);
  });

  it("AC-09b：退避 6h → 12h → 24h 指数增长", () => {
    const c = clock();
    const p = new Patrol({ store: tempStore(), now: c.now });
    for (let i = 0; i < 3; i += 1) p.recordFailure("prov", "D0", "timeout");
    const first = p.backoffUntil("prov") - c.now();
    expect(first).toBe(SIX_HOURS);

    // 退避期满后再失败 3 次 → 12h
    c.advance(first + 1);
    for (let i = 0; i < 3; i += 1) p.recordFailure("prov", "D0", "timeout");
    const second = p.backoffUntil("prov") - c.now();
    expect(second).toBe(2 * SIX_HOURS);
  });

  it("AC-20：退避期间 shouldProbe 恒为 false（含手动）", () => {
    const c = clock();
    const p = new Patrol({ store: tempStore(), now: c.now });
    for (let i = 0; i < 3; i += 1) p.recordFailure("prov", "D0", "timeout");
    expect(p.shouldProbe("prov")).toBe(false);
    expect(p.shouldProbe("prov", { manual: true })).toBe(false);
  });

  it("AC-09c：退避状态跨重启保留（新 Patrol 实例仍退避）", () => {
    const c = clock();
    const store = tempStore();
    const first = new Patrol({ store, now: c.now });
    for (let i = 0; i < 3; i += 1) first.recordFailure("prov", "D0", "timeout");
    first.persistState();

    // 模拟重启：同一 store、新的 Patrol 实例
    const revived = new Patrol({ store, now: c.now });
    expect(revived.isBackingOff("prov")).toBe(true);
    expect(revived.shouldProbe("prov")).toBe(false);
  });

  it("成功探针重置连续失败计数", () => {
    const c = clock();
    const p = new Patrol({ store: tempStore(), now: c.now });
    p.recordFailure("prov", "D0", "timeout");
    p.recordFailure("prov", "D0", "timeout");
    p.recordSuccess("prov");
    p.recordFailure("prov", "D0", "timeout");
    expect(p.isBackingOff("prov")).toBe(false);
  });
});
