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
  const reasons: PolicyDecision["reasons"] = [];
  for (const { checkerId, safetyClass, result } of inputs) {
    const action = mapBySpec({ id: checkerId, safetyClass }, result.verdict);
    reasons.push({ checker: checkerId, verdict: result.verdict, action });
    if (SEVERITY[action] > SEVERITY[worst]) worst = action;
  }
  return { action: worst, reasons };
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
