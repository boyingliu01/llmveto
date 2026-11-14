// @no-test-required: 纯类型声明（无运行时逻辑、无可执行分支），消费方测试即其契约验证（Gate 5a 仅识别同目录/根 tests/ 六种路径）
/**
 * 词表域与 finding 形状（从 `types.ts` 抽出，R11 many-exports 收敛；对外仍经 types.ts 转发）。
 *
 * 这三个枚举与 Finding 是跨层**词表**：checker 只产出 verdict 域，policy 只产出 action 域，
 * evidence 只消费 action_taken / body_capture 域。单列成文件后它们的边界不再与扫描契约混居。
 * 本文件不 import 任何模块 —— 保持叶子层，types.ts 反向依赖它不构成环。
 */

// ── verdict 域（checker 产出） ─────────────────────────────────
export type Verdict = "clean" | "finding" | "error";

// ── action 域（policy 产出） ────────────────────────────────────
// redact 是 v3 枚举位；v1 任何 checker / policy 不得产出。
export type Action = "allow" | "warn" | "redact" | "block";

// ── evidence.action_taken 枚举（TEST 契约 #4 冻结） ─────────────
export type ActionTaken =
  | "allowed"
  | "warned"
  | "blocked_before_forward"
  | "blocked_before_deliver"
  | "terminated_after_delivery"
  | "degraded_observational"; // @v2 起可达；v1 枚举占位，fixture 不覆盖

// ── body_capture ────────────────────────────────────────────────
export type BodyCapture = "metadata_only" | "redacted" | "full";

// ── Finding & CheckerResult ─────────────────────────────────────
export interface Finding {
  readonly checker: string;
  readonly threat: string;
  readonly verdict: Verdict;
  readonly severity?: "low" | "medium" | "high" | "critical";
  readonly offsets?: readonly number[];
  readonly rule_id?: string;
}
