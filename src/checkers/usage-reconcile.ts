// @no-test-required: 测试在 tests/unit/checkers/usage-reconcile.test.ts（Gate 5a 仅识别同目录/根 tests/ 六种路径）
import type { CheckerResult, NonStreamChecker, ScanUnit } from "../shared/types.ts";

/**
 * @test REQ-V2a-04 / AC-V2a-05
 * @intent T4a usage-reconcile（观测类）：三段本地估算 vs 上游自报 usage。
 *         过报：报值 > 估算×1.5 且差值>64 → finding；虚低<0.7× → clean；严格不等边界。
 *         错误降级：malformed → error + degraded_observational（D-10/D-11）。
 */

export const CHECKER_ID = "usage-reconcile";

// DESIGN §4.2 定值
const ASCII_CHARS_PER_TOKEN = 4.1;
const CJK_CHARS_PER_TOKEN = 1.0;
const OVER_REPORT_MULTIPLIER = 1.5;
const OVER_REPORT_ABSOLUTE_DIFF = 64;
const UNDER_REPORT_MULTIPLIER = 0.7;

function isCJK(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3400 && code <= 0x4DBF);
}

function estimateTokens(text: string): number {
  let asciiCount = 0;
  let cjkCount = 0;
  for (const char of text) {
    if (isCJK(char)) cjkCount += 1;
    else asciiCount += 1;
  }
  return Math.round(asciiCount / ASCII_CHARS_PER_TOKEN + cjkCount / CJK_CHARS_PER_TOKEN);
}

type UsageExtract =
  | { kind: "missing" }
  | { kind: "malformed" }
  | { kind: "valid"; value: number };

function extractUpstreamUsage(meta: Readonly<Record<string, unknown>>): UsageExtract {
  if (!("usage" in meta)) return { kind: "missing" };
  const usage = meta.usage;
  if (typeof usage !== "object" || usage === null) return { kind: "malformed" };
  const totalTokens = (usage as Record<string, unknown>).total_tokens;
  if (totalTokens === undefined) return { kind: "missing" };
  if (typeof totalTokens !== "number" || !Number.isFinite(totalTokens)) return { kind: "malformed" };
  return { kind: "valid", value: totalTokens };
}

export const checkUsageReconcile: NonStreamChecker = (unit: ScanUnit): CheckerResult => {
  try {
    const extractResult = extractUpstreamUsage(unit.meta);
    if (extractResult.kind === "missing") return { verdict: "clean", evidence: [] };
    if (extractResult.kind === "malformed") {
      return {
        verdict: "error",
        reason: "scanner_error",
        evidence: [{ checker: CHECKER_ID, threat: "T4a", verdict: "error", severity: "medium", rule_id: "usage-reconcile-error" }],
      };
    }

    const upstreamReported = extractResult.value;
    const localEstimate = estimateTokens(unit.text);
    if (localEstimate === 0) return { verdict: "clean", evidence: [] };

    const absoluteDiff = upstreamReported - localEstimate;
    if (upstreamReported > OVER_REPORT_MULTIPLIER * localEstimate && absoluteDiff > OVER_REPORT_ABSOLUTE_DIFF) {
      return {
        verdict: "finding",
        evidence: [{ checker: CHECKER_ID, threat: "T4a", verdict: "finding", severity: "medium", rule_id: "usage-over-reporting" }],
      };
    }

    return { verdict: "clean", evidence: [] };
  } catch (_error) {
    return {
      verdict: "error",
      reason: "scanner_error",
      evidence: [{ checker: CHECKER_ID, threat: "T4a", verdict: "error", severity: "medium", rule_id: "usage-reconcile-error" }],
    };
  }
};

export const USAGE_RECONCILE_SPEC = {
  id: CHECKER_ID,
  side: "response",
  synchronous: true,
  safetyClass: false,
  runNonStream: checkUsageReconcile,
} as const;
