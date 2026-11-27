import type { Action, CheckerResult } from "../shared/types.ts";
import { mapBySpec, mapBySpecWithRules } from "./mapping.ts";
import type { Finding } from "../shared/vocab.ts";
import { BLOCKING_RULE_IDS } from "../checkers/dangerous-command-scan.ts";

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

/** 需要按规则分级（而非 checker 粒度）判定的 checker（0.6.0）。 */
const RULE_GRADED_CHECKERS: ReadonlySet<string> = Object.freeze(new Set(["dangerous-command-scan"]));

/**
 * 单个 checker 结果 → action。规则级分级只对声明该能力的 checker 生效（当前唯一：
 * dangerous-command-scan 的 credential-file-read）；其余 checker 的 evidence 不参与判定，
 * 映射逐字不变。
 */
function actionFor({ checkerId, safetyClass, result }: PolicyInput, acceptedRules: ReadonlySet<string>): Action {
  if (!RULE_GRADED_CHECKERS.has(checkerId)) return mapBySpec({ id: checkerId, safetyClass }, result.verdict);
  const mapped = mapBySpecWithRules({ id: checkerId, safetyClass }, result.verdict, result.evidence, BLOCKING_RULE_IDS);
  return applyRiskAcceptance(mapped, result.evidence, acceptedRules);
}

/**
 * 用户已声明承担该规则的风险 → 从 block 降为 warn。
 *
 * **只降 block，不降到 allow**：降级是"我看见了但选择承担"，不是"假装没发生"。
 * warn 仍写 evidence、仍在 doctor 里可见——这正是"风险接受"与"关掉检测"的区别。
 */
function applyRiskAcceptance(mapped: Action, evidence: readonly Finding[] | undefined, acceptedRules: ReadonlySet<string>): Action {
  if (mapped !== "block") return mapped;
  return hitAcceptedRule(evidence, acceptedRules) ? "warn" : mapped;
}

/**
 * 这条 finding 的规则是否在用户的"已接受风险"里。
 *
 * **只降 block 不降 allow**：降级是"我看见了但选择承担"，不是"假装没发生"。
 * warn 仍写 evidence、仍在 doctor 里可见——这正是"风险接受"与"关掉检测"的区别。
 */
function hitAcceptedRule(evidence: readonly Finding[] | undefined, acceptedRules: ReadonlySet<string>): boolean {
  if (evidence === undefined || acceptedRules.size === 0) return false;
  return evidence.some((e) => e.rule_id !== undefined && acceptedRules.has(e.rule_id));
}

/** 从选项取查找集；未配置时给空集（避免每次调用构造新对象）。 */
function acceptedSetOf(opts: DecideOptions | undefined): ReadonlySet<string> {
  const rules = opts?.acceptedRules;
  return rules === undefined || rules.length === 0 ? EMPTY_SET : new Set(rules);
}

const EMPTY_SET: ReadonlySet<string> = new Set();

/** `decide` 的选项：目前只有"用户已接受的风险"。 */
export interface DecideOptions {
  readonly acceptedRules?: readonly string[];
}

/** D-11：观测类 checker 的 scanner_error 等于本交互观测面降级（safetyClass 走 fail-closed block，不在此列）。 */
function isObservationalError({ safetyClass, result }: PolicyInput): boolean {
  return !safetyClass && result.verdict === "error";
}

export function decide(inputs: readonly PolicyInput[], opts?: DecideOptions): PolicyDecision {
  let worst: Action = "allow";
  let degraded = false;
  const accepted = acceptedSetOf(opts);
  const reasons: { checker: string; verdict: CheckerResult["verdict"]; action: Action }[] = [];
  for (const input of inputs) {
    const action = actionFor(input, accepted);
    reasons.push({ checker: input.checkerId, verdict: input.result.verdict, action });
    if (SEVERITY[action] > SEVERITY[worst]) worst = action;
    degraded = degraded || isObservationalError(input);
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
