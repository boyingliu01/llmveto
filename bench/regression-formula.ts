/**
 * @test REQ-VETO-013
 * @intent 回退公式（AC-VETO-013-04）：
 *   p95_pr > p95_base × 1.2  OR  p95_pr − p95_base > 2ms → 判回退。
 *
 * 本文件是纯函数，可在 CI 中直接消费。基准 runner（bench/*.ts）把两次采样结果传进来判定。
 */

export interface RegressionInput {
  readonly p95_base_ms: number;
  readonly p95_pr_ms: number;
}

export interface RegressionVerdict {
  readonly regressed: boolean;
  readonly reasons: readonly string[];
}

export function isRegression(input: RegressionInput): RegressionVerdict {
  const { p95_base_ms: base, p95_pr_ms: pr } = input;
  const reasons: string[] = [];
  if (pr > base * 1.2) reasons.push(`p95_pr (${pr}ms) > p95_base × 1.2 (${(base * 1.2).toFixed(2)}ms)`);
  if (pr - base > 2) reasons.push(`p95_pr - p95_base (${(pr - base).toFixed(2)}ms) > 2ms`);
  return { regressed: reasons.length > 0, reasons };
}

/** 分位数：p ∈ [0, 1]，输入未排序 → 内部排序。 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx]!;
}

/**
 * G1 / G2 / G3 阈值常量（AC-VETO-013-01/02/03）。v1 冻结值。
 */
export const G1_TTFT_P95_MAX_MS = 5;
export const G1_TTFT_P99_MAX_MS = 12;
export const G2_THRESHOLDS: Readonly<{ body_bytes: number; p95_ms: number }[]> = Object.freeze([
  { body_bytes: 8 * 1024,   p95_ms: 3 },
  { body_bytes: 64 * 1024,  p95_ms: 10 },
  { body_bytes: 512 * 1024, p95_ms: 40 },
]);
export const G3_THRESHOLDS: Readonly<{ body_bytes: number; ms: number }[]> = Object.freeze([
  { body_bytes: 8 * 1024,   ms: 20 },
  { body_bytes: 64 * 1024,  ms: 50 },
  { body_bytes: 512 * 1024, ms: 120 },
]);

/** AC-VETO-013-05 G2 vs G3 交叠：落在 [G2 p95, G3) → G2 回退信号但不 G3 超时。 */
export function classifyLatency(bodyBytes: number, ms: number): {
  g2_gate: number;
  g3_gate: number;
  g2_pass: boolean;
  g3_timeout: boolean;
  in_overlap_band: boolean;
} {
  const g2 = G2_THRESHOLDS.find((t) => bodyBytes <= t.body_bytes) ?? G2_THRESHOLDS[G2_THRESHOLDS.length - 1]!;
  const g3 = G3_THRESHOLDS.find((t) => bodyBytes <= t.body_bytes) ?? G3_THRESHOLDS[G3_THRESHOLDS.length - 1]!;
  return {
    g2_gate: g2.p95_ms,
    g3_gate: g3.ms,
    g2_pass: ms < g2.p95_ms,
    g3_timeout: ms >= g3.ms,
    in_overlap_band: ms >= g2.p95_ms && ms < g3.ms,
  };
}
