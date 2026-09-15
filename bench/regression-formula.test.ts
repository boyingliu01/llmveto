import { describe, expect, it } from "vitest";
import {
  classifyLatency,
  G1_TTFT_P95_MAX_MS,
  G1_TTFT_P99_MAX_MS,
  G2_THRESHOLDS,
  G3_THRESHOLDS,
  isRegression,
  percentile,
} from "./regression-formula.ts";

// @test REQ-VETO-013
// @intent 回退公式 + G1/G2/G3 阈值常量 + 交叠带判定
// @covers AC-VETO-013-01 AC-VETO-013-02 AC-VETO-013-03 AC-VETO-013-04 AC-VETO-013-05

describe("SL-13 bench: regression formula + gates (REQ-VETO-013)", () => {
  it("AC-01 G1 常量：TTFT p95<5ms / p99<12ms", () => {
    expect(G1_TTFT_P95_MAX_MS).toBe(5);
    expect(G1_TTFT_P99_MAX_MS).toBe(12);
  });

  it("AC-02 G2 三档：8KB/64KB/512KB → 3/10/40ms", () => {
    expect(G2_THRESHOLDS.map((t) => t.p95_ms)).toEqual([3, 10, 40]);
  });

  it("AC-03 G3 三档：8KB/64KB/512KB → 20/50/120ms", () => {
    expect(G3_THRESHOLDS.map((t) => t.ms)).toEqual([20, 50, 120]);
  });

  it("AC-04 回退：p95_pr > p95_base × 1.2 → regressed", () => {
    const v = isRegression({ p95_base_ms: 3, p95_pr_ms: 4 });
    expect(v.regressed).toBe(true);
    expect(v.reasons.join(" ")).toContain("1.2");
  });

  it("AC-04 回退：p95_pr − p95_base > 2ms → regressed", () => {
    const v = isRegression({ p95_base_ms: 2, p95_pr_ms: 5 });
    expect(v.regressed).toBe(true);
    expect(v.reasons.length).toBeGreaterThan(0);
  });

  it("AC-04 非回退：同速率小幅上升", () => {
    const v = isRegression({ p95_base_ms: 3, p95_pr_ms: 3.2 });
    expect(v.regressed).toBe(false);
  });

  it("AC-05 交叠带：[G2, G3) → G2 fail 但 G3 未 timeout", () => {
    const c = classifyLatency(8 * 1024, 10); // G2=3ms, G3=20ms
    expect(c.g2_pass).toBe(false);
    expect(c.g3_timeout).toBe(false);
    expect(c.in_overlap_band).toBe(true);
  });

  it("AC-05 < G2 → 两门都 pass", () => {
    const c = classifyLatency(8 * 1024, 1);
    expect(c.g2_pass).toBe(true);
    expect(c.g3_timeout).toBe(false);
    expect(c.in_overlap_band).toBe(false);
  });

  it("percentile 计算：n=200 时 p95 = 第 190 元素", () => {
    const values = Array.from({ length: 200 }, (_, i) => i + 1); // 1..200
    expect(percentile(values, 0.95)).toBe(190);
    expect(percentile(values, 0.99)).toBe(198);
    expect(percentile(values, 0.5)).toBe(100);
  });

  it("percentile 边界：空数组 → NaN", () => {
    expect(percentile([], 0.95)).toBeNaN();
  });

  it("classifyLatency 超上限：>512KB → 落到最大档兜底", () => {
    const c = classifyLatency(2 * 1024 * 1024, 200); // 2MB, 200ms
    expect(c.g2_gate).toBe(40);
    expect(c.g3_gate).toBe(120);
    expect(c.g2_pass).toBe(false);
    expect(c.g3_timeout).toBe(true);
    expect(c.in_overlap_band).toBe(false);
  });
});
