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
  /** 命中来源（REQ-V2bC-06 / AC-06a~b）：主判据与辅判据并行跑，双命中时都记。 */
  readonly hit_by?: readonly ("relative" | "absolute")[];
}

/**
 * 绝对基线能认出的降级形态（设计 D-03：只覆盖登记过的少数形态）。
 *
 * 它提供的是**归因**而不是**发现**——主判据说"这一维偏离了"，
 * 辅判据说"看起来像 4-bit 量化"。对用户来说后者可行动得多。
 */
export interface AbsoluteSignatures {
  readonly [signature: string]: {
    /** 该形态的判据：观测值落在区间内即匹配。 */
    readonly min: number;
    readonly max: number;
    readonly label: string;
  };
}

/** 登记的降级形态（数值维度用；区间是宽的——归因不需要精确）。 */
export const KNOWN_DEGRADATIONS: AbsoluteSignatures = Object.freeze({
  quantized_4bit: { min: 0.5, max: 0.72, label: "疑似 4-bit 量化的 tokenizer 偏差" },
  quantized_8bit: { min: 0.72, max: 0.85, label: "疑似 8-bit 量化" },
  smaller_model: { min: 0.85, max: 1.0, label: "疑似被替换成明显更小的模型" },
});

/** 数值观测是否匹配某个已登记的降级形态（返回 label 或 undefined）。 */
function absoluteLabel(deviation: number): string | undefined {
  for (const sig of Object.values(KNOWN_DEGRADATIONS)) {
    if (deviation >= sig.min && deviation < sig.max) return sig.label;
  }
  return undefined;
}

/** 观测值是否偏离基线（各维度各自的判据）。 */
function deviates(input: VerdictInput): { deviated: boolean; deviation: number } {
  if (input.kind === "numeric") {
    const base = input.baseValue as number;
    const observed = input.observed as number;
    // base=0 时"相对偏离"没有定义（除零）。此时判退化是对的，但**不能算 deviation**
    // ——任何非零观测都会得到 1，而那会被绝对基线读成"疑似小模型"（评审 MAJOR-1）。
    // 用 -1 表示"偏离但无法量化"，绝对基线见到负值即跳过归因。
    if (base === 0) return { deviated: observed !== 0, deviation: observed === 0 ? 0 : -1 };
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

/** 退化时的结果：带上归因，并按"字段是否撒谎"分级。 */
function findingResult(input: VerdictInput, deviation: number): VerdictResult {
  // AC-06a：辅判据**每次**都跑，不做"主判据没中才跑"的兜底——
  // 兜底形式会让"字段撒谎"这种最严重情形漏在主判据的宽限期里。
  const hits: ("relative" | "absolute")[] = ["relative"];
  // deviation < 0 = 偏离但无法量化（base=0）：跳过归因，不让它落进任何区间
  if (input.kind === "numeric" && deviation >= 0 && absoluteLabel(deviation) !== undefined) hits.push("absolute");

  // 字段不变却退化 = 字段在撒谎，比版本回退更严重
  return input.modelChanged
    ? { verdict: "finding", deviation, hit_by: hits }
    : { verdict: "finding", deviation, severity: "high", hit_by: hits };
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
/**
 * `baseValue` 的类型是否与 `kind` 一致。
 *
 * 类型系统在这里保护不了我们：`VerdictInput` 的 `baseValue` 是联合类型，
 * 但真正的数据来自 JSON 反序列化，那里没有类型。一个 `kind:"numeric"` 配
 * 字符串基线会让 `deviates()` 算出 NaN，而 NaN 的所有比较都为 false——
 * 结果是**永远判 clean**，一个静默的 fail-open。
 */
const KIND_TYPEOF: Readonly<Record<VerdictInput["kind"], string>> = Object.freeze({
  numeric: "number",
  boolean: "boolean",
  text: "string",
});

function baseMatchesKind(input: VerdictInput): boolean {
  if (input.baseValue === null) return true;
  const want = KIND_TYPEOF[input.kind];
  return typeof input.baseValue === want && typeof input.observed === want;
}


export function verdictFor(input: VerdictInput): VerdictResult {
  // 基线缺失或与观测不可比 → 宽限期，不产出判定
  if (input.baseValue === null || !baseMatchesKind(input)) {
    return { verdict: "baseline_pending", deviation: 0 };
  }
  const { deviated, deviation } = deviates(input);
  return deviated ? findingResult(input, deviation) : { verdict: "clean", deviation };
}
