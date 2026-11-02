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
 * - `decoded`：**转义还原后的文本投影**（编码层对抗日）。
 *   JSON 是唯一传输编码，同一个字符有两种写法：字面字符，或 `\uXXXX` 转义序列。
 *   只在 `text` 上匹配会被"用转义写法书写"整类绕过（最省事的注入方式）。
 *   故扫描单元额外投影一份把 `\uXXXX` / `\xXX` / `\u{...}` 还原为真实字符的文本；
 *   checker 用 `scanTexts(unit)` 同时取两份，命中任一即 finding。
 *   `decoded` 仅在"原始文本确实含转义序列"时存在，避免无谓的重复扫描。
 */
export interface ScanUnit {
  readonly direction: Direction;
  readonly transport: Transport;
  readonly text: string;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly malformed?: boolean;
  readonly decoded?: string;
}

/**
 * checker 消费入口：返回该扫描单元的全部待扫文本（去重、保序）。
 * 契约：不含转义序列时返回 `[text]`（与历史行为逐字一致，零额外开销）；
 * 含转义序列时返回 `[text, decoded]`——**两份都要扫**，任一命中即为 finding。
 * checker 不得直接读 `unit.text` 做安全判定（否则编码层回归会静默复现）。
 * 该契约由 tests/unit/checkers/scan-texts-contract.test.ts 机械强制：
 * 除其中逐字登记理由的豁免（如流式 cursor 只取 `chunk.text.length`、meta-only
 * checker 不触碰 text）外，任何 src/checkers/*.ts 触碰 text 字段即测试红。
 */
export function scanTexts(unit: ScanUnit): readonly string[] {
  return unit.decoded !== undefined && unit.decoded !== unit.text
    ? [unit.text, unit.decoded]
    : [unit.text];
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
   * window_overflow（REQ-V2a-13(b)/§4.5）：累积型窗口越 256KiB 硬顶（AC-V2a-14），
   * 由累积型 checker 自身判定产出（metering = 其窗口累积字节，ADR-0003/0005）。
   */
  readonly reason?: "scanner_error" | "checker_timeout" | "input_malformed" | "window_overflow";
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
/** §4.2/ADR-0003：单次 tool-call arguments 累积硬顶 = 256 KiB（UTF-8 字节，严格大于语义）。 */
export const STREAM_WINDOW_OVERFLOW_LIMIT = 262144 as const;

export interface CheckerSpec {
  readonly id: string;
  readonly side: Direction;
  readonly synchronous: true;
  readonly safetyClass: boolean;
  /** §4.5 威胁表归属：error 条目落链时的 threat 唯一来源（禁止在 policy 侧另设表）。 */
  readonly threat: string;
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
