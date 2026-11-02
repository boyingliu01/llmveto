import type { Action, ActionTaken, CheckerSpec, Verdict } from "../shared/types.ts";

/**
 * @test REQ-VETO-006
 * @intent v1 内置固定 verdict → action 映射表（**不可配置**，AC-VETO-006-01）
 *
 * 表结构：
 *   - 按 checker id 分派
 *   - 每个 checker 提供三种 verdict 的映射：clean / finding / error
 *   - safety-class checker（v1 = {egress-secret-scan, invisible-unicode-scan}）：
 *       finding → block；error → block（AC-VETO-006-02 fail-closed）
 *   - 非安全类（v1 = {model-label-consistency}）：
 *       finding → warn；error → warn（v1 无观测类降级路径，error 保持 warn 语义）
 *
 * 禁止：v1 映射表内不出现 action=redact（AC-VETO-006-03；由 grep 断言把守）。
 */

interface Mapping {
  readonly clean: Action;
  readonly finding: Action;
  readonly error: Action;
}

export const V1_MAPPING: Readonly<Record<string, Mapping>> = Object.freeze({
  "canary-return-scan":           Object.freeze({ clean: "allow", finding: "block", error: "block" }), // T1a 安全类
  "egress-secret-scan":           Object.freeze({ clean: "allow", finding: "block", error: "block" }),
  "invisible-unicode-scan":       Object.freeze({ clean: "allow", finding: "block", error: "block" }),
  "model-label-consistency":      Object.freeze({ clean: "allow", finding: "warn",  error: "warn"  }),
  "thinking-signature-presence":  Object.freeze({ clean: "allow", finding: "warn",  error: "warn"  }),
  "tool-call-shape":              Object.freeze({ clean: "allow", finding: "block", error: "block" }), // T2a 安全类
  "usage-reconcile":              Object.freeze({ clean: "allow", finding: "warn",  error: "warn"  }),
} as const);

/**
 * 单一 checker 结果 → action。
 * 未注册的 checker id → block（fail-closed：未知 checker 视为潜在危险）。
 */
export function mapVerdictToAction(checkerId: string, verdict: Verdict): Action {
  const m = V1_MAPPING[checkerId];
  if (!m) return "block";
  return m[verdict];
}

/**
 * 由 CheckerSpec 提供 safetyClass 兜底：v1 内置表已含三个 checker，
 * 若未登记但 spec 声明 safetyClass=true 者 → finding=block, error=block。
 * safetyClass=false 者 → finding=warn, error=warn。
 */
export function mapBySpec(spec: Pick<CheckerSpec, "id" | "safetyClass">, verdict: Verdict): Action {
  if (V1_MAPPING[spec.id]) return mapVerdictToAction(spec.id, verdict);
  if (verdict === "clean") return "allow";
  return spec.safetyClass ? "block" : "warn";
}

// ── D-11（SL-03/REQ-V2a-13）：action_taken 优先序 ─────────────────────────────
// action_taken 是"本交互实际发生什么"的单值字段；多条候选并存时按本序取最前者。
// 档位语义：blocked_* / terminated（顶层裁决）> degraded_observational（观测类 error
// 如实降级）> warned > allowed（基线）。resolveActionTaken 的既有值结果与 v1 行为逐字
// 一致（v1 各调用点只传单候选或 {allowed, warned}）。

export const ACTION_TAKEN_PRIORITY: readonly ActionTaken[] = Object.freeze([
  "blocked_before_forward",
  "blocked_before_deliver",
  "terminated_after_delivery",
  "degraded_observational",
  "warned",
  "allowed",
]);

/** 候选集 → 按 ACTION_TAKEN_PRIORITY 取最前；空集回退 allowed（基线值）。 */
export function resolveActionTaken(candidates: readonly ActionTaken[]): ActionTaken {
  let best: ActionTaken | undefined;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const rank = ACTION_TAKEN_PRIORITY.indexOf(c);
    if (rank >= 0 && rank < bestRank) {
      best = c;
      bestRank = rank;
    }
  }
  return best ?? "allowed";
}

// ── D-10（SL-03/REQ-V2a-13）：checker → threat 归属由 CheckerSpec.threat 单一声明 ──
// （gateway/registry.ts 派生 CHECKER_THREAT_BY_ID；policy 侧不再维护字面表，避免双源。）
