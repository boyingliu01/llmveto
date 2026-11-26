import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FingerprintStore } from "../../../src/fingerprint/store.ts";
import { TRUST_MAX, TRUST_MIN, doctorFingerprintCheck, doctorVerdictFor, trustFor, trustReport } from "../../../src/fingerprint/trust.ts";

// @test REQ-V2bC-10 / AC-10a~b
// @intent 信任分是**展示层**指标。两条不能破的线：
//           ① 能从 evidence 聚合（AC-10a）
//           ② 不流入策略引擎（AC-10b）—— 这条不是"实现上没接"，而是设计上禁止
//
//         算法刻意简单（clean 占比），因为"73 分怎么算的"必须能被人回答。

let dirs: string[] = [];
function store(): FingerprintStore {
  const d = mkdtempSync(join(tmpdir(), "fp-trust-"));
  dirs.push(d);
  return new FingerprintStore(join(d, "e.jsonl"));
}
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function feature(s: FingerprintStore, provider: string, verdict: "clean" | "finding" | "baseline_pending"): void {
  s.append({
    kind: "probe_feature",
    provider_id: provider,
    dimension: "D0",
    value: 1,
    verdict,
    deviation: 0,
    ts: "t",
  });
}

describe("SL-13 信任分聚合（AC-10a）", () => {
  it("全 clean → 满分", () => {
    const s = store();
    for (let i = 0; i < 10; i += 1) feature(s, "p", "clean");
    const t = trustFor(s, "p");
    expect(t.score).toBe(TRUST_MAX);
    expect(t.findings).toBe(0);
  });

  it("一半 finding → 50 分", () => {
    const s = store();
    for (let i = 0; i < 10; i += 1) feature(s, "p", i < 5 ? "clean" : "finding");
    expect(trustFor(s, "p").score).toBe(50);
  });

  it("全 finding → 0 分", () => {
    const s = store();
    for (let i = 0; i < 10; i += 1) feature(s, "p", "finding");
    expect(trustFor(s, "p").score).toBe(TRUST_MIN);
  });

  it("无样本 → 满分但 provisional（0 会被读成'很可疑'，事实是'还没测'）", () => {
    const s = store();
    const t = trustFor(s, "p");
    expect(t.score).toBe(TRUST_MAX);
    expect(t.samples).toBe(0);
    expect(t.provisional).toBe(true);
  });

  it("样本不足 K → provisional", () => {
    const s = store();
    for (let i = 0; i < 3; i += 1) feature(s, "p", "clean");
    expect(trustFor(s, "p").provisional).toBe(true);
  });

  it("baseline_pending 不计入分母（宽限期不该拉低分数）", () => {
    const s = store();
    for (let i = 0; i < 5; i += 1) feature(s, "p", "clean");
    for (let i = 0; i < 5; i += 1) feature(s, "p", "baseline_pending");
    const t = trustFor(s, "p");
    expect(t.score).toBe(TRUST_MAX);
    expect(t.samples).toBe(5);
  });

  it("探针失败不计入分母（没测到 ≠ 测到了不好）", () => {
    const s = store();
    for (let i = 0; i < 5; i += 1) feature(s, "p", "clean");
    for (let i = 0; i < 5; i += 1) {
      s.append({ kind: "probe_failure", provider_id: "p", target_dimension: "D0", error_class: "timeout", ts: "t" });
    }
    const t = trustFor(s, "p");
    expect(t.score).toBe(TRUST_MAX);
    expect(t.failures).toBe(5);
  });

  it("窗口只取最近 K 条（早期数据在 provider 升级后是噪声）", () => {
    const s = store();
    for (let i = 0; i < 10; i += 1) feature(s, "p", "finding");
    for (let i = 0; i < 10; i += 1) feature(s, "p", "clean");
    // 最近 10 条全 clean → 满分
    expect(trustFor(s, "p").score).toBe(TRUST_MAX);
  });
});

describe("SL-13 报告（多 provider）", () => {
  it("按 provider id 排序", () => {
    const s = store();
    feature(s, "zebra", "clean");
    feature(s, "alpha", "clean");
    expect(trustReport(s).map((t) => t.provider_id)).toEqual(["alpha", "zebra"]);
  });
});

describe("SL-13 doctor 判定（用户决策：升级 doctor 而非阻断）", () => {
  it("无数据 → PASS（'还没测'不等于'测出问题'）", () => {
    const v = doctorFingerprintCheck(store());
    expect(v.ok).toBe(true);
    expect(v.message).toContain("no fingerprint data");
  });

  it("样本不足 → PASS 且标注 provisional（不误判为故障）", () => {
    const s = store();
    for (let i = 0; i < 3; i += 1) feature(s, "p", "finding");
    const v = doctorFingerprintCheck(s);
    expect(v.ok).toBe(true);
    expect(v.message).toContain("provisional");
  });

  it("样本足够且分数低于阈值 → FAIL", () => {
    const s = store();
    for (let i = 0; i < 10; i += 1) feature(s, "p", "finding");
    const v = doctorFingerprintCheck(s);
    expect(v.ok).toBe(false);
    expect(v.message).toContain("疑似模型被偷换或降级");
  });

  it("样本足够且分数达标 → PASS", () => {
    const s = store();
    for (let i = 0; i < 10; i += 1) feature(s, "p", "clean");
    expect(doctorFingerprintCheck(s).ok).toBe(true);
  });

  it("阈值边界：60 分 PASS，59 分 FAIL", () => {
    const s = store();
    // 10 条中 4 条 finding → 6 clean → 60 分
    for (let i = 0; i < 10; i += 1) feature(s, "p", i < 4 ? "finding" : "clean");
    expect(doctorVerdictFor(trustFor(s, "p")).ok).toBe(true);

    const s2 = store();
    for (let i = 0; i < 10; i += 1) feature(s2, "p", i < 5 ? "finding" : "clean");
    expect(doctorVerdictFor(trustFor(s2, "p")).ok).toBe(false);
  });
});
