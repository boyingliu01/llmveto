import type { Action, CheckerResult } from "../shared/types.ts";
import { mapBySpec, V1_MAPPING } from "./mapping.ts";

/**
 * @test REQ-VETO-006
 * @intent 策略引擎：多 checker 结果的聚合 + 行为矩阵选择（场景 1/2/3/4）。
 *
 * 聚合规则（AC-VETO-006 edge_case）：action 取最严（block > warn > allow）。
 * 术语分离（DD-VETO-001）：本层输出 action ∈ {allow, warn, block}；v1 无 redact 路径。
 */

export interface PolicyDecision {
  readonly action: Action;
  /**
   * D-11（REQ-V2a-13）：观测类（safetyClass=false）输入出现 verdict=error → true。
   * 语义：本交互的观测面处于降级（部分盲区），落链 action_taken 相应取
   * degraded_observational（除非 blocked_* / terminated 顶层档压过）；安全类 error
   * 走 fail-closed block，不触发本标志（落链无分类豁免——两层痕迹对两类 error 一视同仁）。
   * 本标志只由 checker verdict 驱动，**不读**顶层 reason（reason 是落链位的派生值）。
   */
  readonly degraded: boolean;
  readonly reasons: readonly { checker: string; verdict: CheckerResult["verdict"]; action: Action }[];
}

export interface PolicyInput {
  readonly checkerId: string;
  readonly safetyClass: boolean;
  readonly result: CheckerResult;
}

const SEVERITY: Record<Action, number> = { allow: 0, warn: 1, redact: 1, block: 2 };

export function decide(inputs: readonly PolicyInput[]): PolicyDecision {
  let worst: Action = "allow";
  let degraded = false;
  const reasons: { checker: string; verdict: CheckerResult["verdict"]; action: Action }[] = [];
  for (const { checkerId, safetyClass, result } of inputs) {
    const action = mapBySpec({ id: checkerId, safetyClass }, result.verdict);
    reasons.push({ checker: checkerId, verdict: result.verdict, action });
    if (SEVERITY[action] > SEVERITY[worst]) worst = action;
    if (!safetyClass && result.verdict === "error") degraded = true;
  }
  return { action: worst, degraded, reasons };
}

/**
 * 行为矩阵（REQ §裁决与动作语义 + AC-VETO-006-04）：
 *   场景 1: 请求侧 block → HTTP 502 llmveto:rejected，action_taken=blocked_before_forward
 *   场景 2: 响应侧 block + 非流式 → 502 无响应体，action_taken=blocked_before_deliver
 *   场景 3: 响应侧 block + 流式 + 首 chunk 命中（delivered_chunks=0） → event:error + delivered_chunks=0，action_taken=blocked_before_deliver
 *   场景 4: 响应侧 block + 流式 + 后续 chunk 命中（delivered_chunks=N-1） → event:error + delivered_chunks=N-1，action_taken=terminated_after_delivery
 */
export type BehaviorScenario = "1" | "2" | "3" | "4";

export function pickScenario(params: {
  readonly side: "request" | "response";
  readonly transport: "stream" | "non-stream";
  readonly deliveredChunks: number;
}): BehaviorScenario {
  if (params.side === "request") return "1";
  if (params.transport === "non-stream") return "2";
  return params.deliveredChunks === 0 ? "3" : "4";
}

/** 断言 v1 映射表内不出现 redact（AC-VETO-006-03）。 */
export function assertNoRedactInV1Table(): void {
  for (const [id, m] of Object.entries(V1_MAPPING)) {
    for (const [verdict, action] of Object.entries(m)) {
      if (action === "redact") {
        throw new Error(`AC-VETO-006-03 violation: ${id}.${verdict} = redact is not reachable in v1`);
      }
    }
  }
}

// ── D-10（SL-03/REQ-V2a-13）：顶层 reason 单值选择 ───────────────────────────
// 优先级（R2 修正后）：gateway 描述符（registry_unavailable > inject_skipped，无对应
// checker，findings[] 不产生条目）> checker error 固定序（window_overflow >
// checker_timeout > scanner_error > input_malformed）；同级并列按 checker 注册表声明序
// 取最前，全同（同 reason 同声明位）取先见（稳定）。词表外的 reason 仍可被选出
// （不得静默丢弃），但排位低于一切词表内值。policy 层不得 import evidence 层，故本处
// 常量独立声明，与 evidence/schema.ts 的 REASON_VOCAB 的同源一致性由测试钉死。

export const GATEWAY_REASON_PRIORITY: readonly string[] = Object.freeze([
  "registry_unavailable",
  "inject_skipped",
]);

export const CHECKER_ERROR_REASON_ORDER: readonly string[] = Object.freeze([
  "window_overflow",
  "checker_timeout",
  "scanner_error",
  "input_malformed",
]);

/** 一个 checker error 成因候选（R3 T-M1 重放链路的最小输入形状）。 */
export interface ReasonCandidate {
  readonly checker: string;
  readonly reason: string;
}

/** 顶层 reason 胜者：gateway 来源无 checker 归属（键缺席）；checker 来源带归属（可追溯到条目）。 */
export interface ReasonWinner {
  readonly source: "gateway" | "checker";
  readonly reason: string;
  readonly checker?: string | undefined;
}

export interface PickTopReasonParams {
  /** gateway 侧描述符值（如注册表不可达）；按 GATEWAY_REASON_PRIORITY 内部排序。 */
  readonly gatewayReasons?: readonly string[] | undefined;
  /** checker error 成因候选集（来自 findings[] error 条目的重放，R3 T-M1）。 */
  readonly checkerErrors: readonly ReasonCandidate[];
  /** checker 注册表声明序（同级并列的 tie-break 单一真相源）。 */
  readonly checkerDeclarationOrder: readonly string[];
}

/** checker error 候选的比较键：词表内按固定序排位，词表外排位垫底（仍可选出）。 */
function checkerReasonRank(reason: string): number {
  const idx = CHECKER_ERROR_REASON_ORDER.indexOf(reason);
  return idx >= 0 ? idx : CHECKER_ERROR_REASON_ORDER.length;
}

export function pickTopReasonWinner(params: PickTopReasonParams): ReasonWinner | undefined {
  const gateway = params.gatewayReasons ?? [];
  if (gateway.length > 0) {
    // gateway 值无条件胜出（R2 修正：gateway 描述符比任何 checker error 都更"上游"）；
    // 多值并存按 GATEWAY_REASON_PRIORITY 内部排序取最前，词表外值垫底、词表外并列取先见。
    let bestIdx = gateway[0]!;
    let bestRank = GATEWAY_REASON_PRIORITY.indexOf(bestIdx);
    for (const g of gateway.slice(1)) {
      const r = GATEWAY_REASON_PRIORITY.indexOf(g);
      if (bestRank < 0 || (r >= 0 && r < bestRank)) {
        bestIdx = g;
        bestRank = r;
      }
    }
    return { source: "gateway", reason: bestIdx, checker: undefined };
  }
  if (params.checkerErrors.length === 0) return undefined;
  let best: ReasonCandidate = params.checkerErrors[0]!;
  let bestRank = checkerReasonRank(best.reason);
  let bestDecl = declarationRank(best.checker, params.checkerDeclarationOrder);
  for (const c of params.checkerErrors.slice(1)) {
    const r = checkerReasonRank(c.reason);
    const d = declarationRank(c.checker, params.checkerDeclarationOrder);
    if (r < bestRank || (r === bestRank && d < bestDecl)) {
      best = c;
      bestRank = r;
      bestDecl = d;
    }
    // r === bestRank && d === bestDecl → 保持先见（稳定）
  }
  return { source: "checker", reason: best.reason, checker: best.checker };
}

/** 未登记 checker 的声明位 = 声明序长度（垫底；同级仍按先见稳定）。 */
function declarationRank(checker: string, order: readonly string[]): number {
  const idx = order.indexOf(checker);
  return idx >= 0 ? idx : order.length;
}

/**
 * R3 T-M1：顶层 checker reason 不在写入点另行裁决，而是对 findings[] 的 verdict=error
 * 条目做重放（条目 rule_id 即成因），委托 pickTopReasonWinner 选择。非 error 条目与
 * 缺 rule_id 的 error 条目不参与。
 */
export function pickTopReasonFromErrorFindings(params: {
  readonly gatewayReasons?: readonly string[] | undefined;
  readonly findings: readonly { checker: string; verdict: string; threat?: string; rule_id?: string }[];
  readonly checkerDeclarationOrder: readonly string[];
}): ReasonWinner | undefined {
  const candidates: ReasonCandidate[] = [];
  for (const f of params.findings) {
    if (f.verdict === "error" && typeof f.rule_id === "string") {
      candidates.push({ checker: f.checker, reason: f.rule_id });
    }
  }
  return pickTopReasonWinner({
    gatewayReasons: params.gatewayReasons,
    checkerErrors: candidates,
    checkerDeclarationOrder: params.checkerDeclarationOrder,
  });
}
