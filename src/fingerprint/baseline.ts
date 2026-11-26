// @no-test-required: 测试在 tests/unit/fingerprint/baseline.test.ts（Gate 5a 仅识别同目录/根 tests/ 六种路径）
import type { FeatureResult } from "./features.ts";

/**
 * 相对漂移基线。
 *
 * 三条不变量（设计 D-03/D-03c）：
 *   ① 中位数，不是均值 —— 单次异常不该改变基线（AC-03b）
 *   ② 每维独立 —— 不做"拼接基线向量再算距离"，那会造出从未真实出现过的基线点
 *   ③ 判定看方向，不看"变没变" —— 需求评审 R2 找出的矛盾就在这一条
 */

/** 特征窗口大小（K）。信任分与基线共用。 */
export const BASELINE_WINDOW = 10 as const;

/** D0 的数值偏离阈值（设计 D-03a；由 AC4 的 benign fixture 校准）。 */
export const NUMERIC_DEVIATION = 0.15 as const;

/** D3 的 Jaccard 相似度下限（低于此判退化）。 */
export const TEXT_SIMILARITY_FLOOR = 0.5 as const;

export type Sample = FeatureResult;

/** 布尔/文本维度：出现次数最多的值（并列取先见，保持稳定）。 */
function modeOf(values: readonly unknown[]): unknown {
  const counts = new Map<unknown, number>();
  let best: unknown;
  let bestCount = 0;
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (n > bestCount) {
      best = v;
      bestCount = n;
    }
  }
  return best;
}

/**
 * 一份样本的中位/众数值；空样本返回 null。
 *
 * 返回 `null` 而不是 0：0 是一个合法基线值，把它当"没有基线"会让所有
 * 采样失败悄悄退化成"基线为 0"。这个区分是 AC-05 的 baseline_pending 依据。
 */
export function median(samples: readonly Sample[]): number | boolean | string | null {
  const usable = samples.filter((s) => s.kind !== "missing");
  if (usable.length === 0) return null;

  const numerics = usable.filter((s): s is { kind: "numeric"; value: number } => s.kind === "numeric");
  if (numerics.length > 0) {
    const sorted = numerics.map((s) => s.value).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  }

  const booleans = usable.filter((s): s is { kind: "boolean"; value: boolean } => s.kind === "boolean");
  if (booleans.length > 0) return modeOf(booleans.map((s) => s.value)) as boolean;

  const texts = usable.filter((s): s is { kind: "text"; value: string } => s.kind === "text");
  return modeOf(texts.map((s) => s.value)) as string;
}

/** 字符集 Jaccard 相似度。空串 → 0（不是 NaN，NaN 会污染所有比较）。 */
export function jaccard(a: string, b: string): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  for (const c of sa) if (sb.has(c)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

/** 判定输入。`modelChanged` 来自响应的 model 字段与上次是否不同。 */
export interface VerdictInput {
  readonly kind: "numeric" | "boolean" | "text";
  readonly baseValue: number | boolean | string | null;
  readonly observed: number | boolean | string;
  readonly modelChanged: boolean;
}

export type FingerprintVerdict = "clean" | "finding" | "baseline_pending";

export interface VerdictResult {
  readonly verdict: FingerprintVerdict;
  /** 相对基线的偏离度；数值维度是比例，文本是 1−相似度。 */
  readonly deviation: number;
  readonly severity?: "high";
}

/** 观测值是否偏离基线（各维度各自的判据）。 */
function deviates(input: VerdictInput): { deviated: boolean; deviation: number } {
  if (input.kind === "numeric") {
    const base = input.baseValue as number;
    const observed = input.observed as number;
    if (base === 0) return { deviated: observed !== 0, deviation: observed === 0 ? 0 : 1 };
    const ratio = Math.abs(observed - base) / base;
    return { deviated: ratio > NUMERIC_DEVIATION, deviation: ratio };
  }
  if (input.kind === "boolean") {
    const deviated = input.baseValue !== input.observed;
    return { deviated, deviation: deviated ? 1 : 0 };
  }
  const sim = jaccard(String(input.baseValue), String(input.observed));
  return { deviated: sim < TEXT_SIMILARITY_FLOOR, deviation: 1 - sim };
}

/**
 * 单次判定。
 *
 * **看方向，不看"变没变"**（AC-05a~c）：
 *   - 字段变 + 行为未退化 → clean（provider 有权升级版本）
 *   - 字段变 + 行为退化   → finding（版本回退）
 *   - 字段不变 + 行为退化 → finding，severity=high（字段撒谎，最严重）
 *
 * 需求评审 R2 指出原稿"字段变→clean"会让版本回退永远检不出——那条规则在此推翻。
 */
export function verdictFor(input: VerdictInput): VerdictResult {
  if (input.baseValue === null) return { verdict: "baseline_pending", deviation: 0 };

  const { deviated, deviation } = deviates(input);
  if (!deviated) return { verdict: "clean", deviation };

  // 字段不变却退化 = 字段在撒谎，比版本回退更严重
  return input.modelChanged
    ? { verdict: "finding", deviation }
    : { verdict: "finding", deviation, severity: "high" };
}
