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
  /**
   * 命中来源的归属标识（P1-2）：目前仅 canary-return-scan 使用，记录**串入的会话键**
   * （canary 所属会话），使证据从「检测到串流」升级为「谁串进了谁」。
   *
   * 为什么是可选位而非新增 evidence_version：它只增加信息、不改变既有字段语义，
   * `validateEvidence` 的必需字段 + 字段验证器模型不会拒绝它，故 v1 链的 verify 语义不变。
   * 值为会话键（sha256 前 16 位或 DSH sessionId），**不是 canary 明文**，不违反 D-05。
   */
  readonly origin?: string;
}
