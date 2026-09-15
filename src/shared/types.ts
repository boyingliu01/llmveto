/**
 * 全局共享类型 —— TEST 可测试性契约 #2 冻结。
 *
 * 分层不变量：
 *   - `src/checkers/**` 仅依赖本文件 + 同层；不得 import gateway/evidence/policy。
 *   - verdict ∈ {clean, finding, error}，绝不出现 allow/warn/redact/block（那是 action 域）。
 *   - checker 是纯函数：禁止从配置/时钟/网络/环境变量取值。
 */

// ── verdict 域（checker 产出） ─────────────────────────────────
export type Verdict = "clean" | "finding" | "error";

// ── action 域（policy 产出） ────────────────────────────────────
// redact 是 v3 枚举位；v1 任何 checker / policy 不得产出。
export type Action = "allow" | "warn" | "redact" | "block";

// ── 扫描单元 ────────────────────────────────────────────────────
export type Transport = "stream" | "non-stream";
export type Direction = "request" | "response";

/**
 * 网关切分给 checker 的**文本**单元（UTF-8 解码后）。
 * - `text` 为唯一被扫描内容；字节级未决多字节由 ScanWindow.pendingBytes 承载。
 * - `meta` 由反代核解析后携带（结构性字段：model / usage / finish_reason / ...）。
 * - `malformed=true` 表示 data 字段 JSON 解析失败（SSE 事件级降级）。
 */
export interface ScanUnit {
  readonly direction: Direction;
  readonly transport: Transport;
  readonly text: string;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly malformed?: boolean;
}

/**
 * 流式滚动窗口状态。字段名 `pendingBytes` / `cursor` 由 TEST 契约 #2 冻结。
 * checker 自身不持单例 → 状态由 fixture 注入 / 回传。
 */
export interface ScanWindow {
  readonly pendingBytes: Uint8Array;
  readonly cursor: number;
  readonly extra?: Readonly<Record<string, unknown>>;
}

// ── Finding & CheckerResult ─────────────────────────────────────
export interface Finding {
  readonly checker: string;
  readonly threat: string;
  readonly verdict: Verdict;
  readonly severity?: "low" | "medium" | "high" | "critical";
  readonly offsets?: readonly number[];
  readonly rule_id?: string;
}

export interface CheckerResult {
  readonly verdict: Verdict;
  readonly evidence: readonly Finding[];
  /**
   * checker 自身执行错误（解析异常 / 超时等）。verdict=error 时必填 reason 语义，
   * 由 policy 层按 fail-closed 规则映射为 action=block（安全类 checker）。
   */
  readonly reason?: "scanner_error" | "checker_timeout" | "input_malformed";
}

// ── Checker 签名（两态） ────────────────────────────────────────
export type NonStreamChecker = (unit: ScanUnit) => CheckerResult;
export type StreamChecker = (
  window: ScanWindow,
  chunk: ScanUnit,
) => readonly [CheckerResult, ScanWindow];

/**
 * Checker 声明元数据（注册表使用）。
 * - `side`：请求侧 or 响应侧。
 * - `synchronous`：v1 三个内置 checker 全部为 true；false 是 v2+ 观测类才允许。
 * - `safetyClass`：v1 = true 者映射为 block；策略降级规则按此属性圈定。
 */
export interface CheckerSpec {
  readonly id: string;
  readonly side: Direction;
  readonly synchronous: true;
  readonly safetyClass: boolean;
  readonly runNonStream?: NonStreamChecker;
  readonly runStream?: StreamChecker;
}

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
