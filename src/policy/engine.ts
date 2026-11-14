import type { Action, CheckerResult } from "../shared/types.ts";
import { mapBySpec } from "./mapping.ts";

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
  /** §4.5 威胁归属：由调用方从 CheckerSpec.threat 下传（error 落链唯一来源）。 */
  readonly threat?: string;
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

// D-10 顶层 reason 选择（词表序 + 重放）已抽到 ./reason.ts：该项是独立的"单值裁决"逻辑，
// 与 action 聚合无共享状态。此处转发以保持 core/测试的既有导入面不变。
export {
  CHECKER_ERROR_REASON_ORDER,
  GATEWAY_REASON_PRIORITY,
  pickTopReasonFromErrorFindings,
  pickTopReasonWinner,
  type PickTopReasonParams,
  type ReasonCandidate,
  type ReasonWinner,
} from "./reason.ts";
