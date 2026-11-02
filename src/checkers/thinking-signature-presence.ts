// @no-test-required: 测试在 tests/unit/checkers/thinking-signature-presence.test.ts（Gate 5a 仅识别同目录/根 tests/ 六种路径）
import type {
  CheckerResult,
  Finding,
  NonStreamChecker,
  ScanUnit,
} from "../shared/types.ts";
import { scanTexts } from "../shared/types.ts";

/**
 * @test REQ-V2a-03
 * @intent thinking-signature-presence（T3a 观测类）：
 *         请求侧 thinking 开关 × 响应侧 thinking 块存在性 → 双向自洽判定。
 *         观测类（safetyClass=false）：verdict ∈ {clean, finding}，永不 block。
 *         错误降级 → verdict=error, reason=scanner_error, action=degraded_observational。
 *
 * 能力边界：
 *   检测 `<think>...</think>` 标签对（含跨行）。不覆盖 ````thinking` 代码块、
 *   中文【思考】标记等非标格式（v2a 后续迭代可扩展 pattern 集）。
 */

export const CHECKER_ID = "thinking-signature-presence";

// Matches `<think>...</think>` tag pairs (dotAll for cross-line content)
const THINKING_BLOCK = /<think>[\s\S]*?<\/think>/;

function hasThinkingBlock(text: string): boolean {
  return THINKING_BLOCK.test(text);
}

function readBoolean(meta: Readonly<Record<string, unknown>>, key: string): boolean | undefined {
  const v = meta[key];
  if (typeof v === "boolean") return v;
  // Non-boolean truthy values (string "true", number 1, etc.) → treat as truthy
  if (v !== undefined && v !== null && v !== false && v !== 0 && v !== "") return true;
  return undefined;
}

export const checkThinkingSignaturePresence: NonStreamChecker = (unit: ScanUnit): CheckerResult => {
  try {
    const thinkingEnabled = readBoolean(unit.meta, "thinking_enabled");
    // No basis for judgment → clean (no noise)
    if (thinkingEnabled === undefined) {
      return { verdict: "clean", evidence: [] };
    }

    const responseHasBlock = scanTexts(unit).some((t) => hasThinkingBlock(t));
    const consistent = thinkingEnabled === responseHasBlock;

    if (consistent) {
      return { verdict: "clean", evidence: [] };
    }

    const finding: Finding = {
      checker: CHECKER_ID,
      threat: "T3a",
      verdict: "finding",
      severity: "low",
      ...(thinkingEnabled
        ? { rule_id: "thinking-missing-in-response" }
        : { rule_id: "thinking-unexpected-in-response" }),
    };

    return { verdict: "finding", evidence: [finding] };
  } catch {
    return { verdict: "error", reason: "scanner_error", evidence: [] };
  }
};

export const THINKING_SIGNATURE_PRESENCE_SPEC = {
  id: CHECKER_ID,
  side: "response",
  synchronous: true,
  safetyClass: false,
  runNonStream: checkThinkingSignaturePresence,
} as const;
