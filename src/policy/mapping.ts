import type { Action, CheckerSpec, Verdict } from "../shared/types.ts";

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
  "egress-secret-scan":      Object.freeze({ clean: "allow", finding: "block", error: "block" }),
  "invisible-unicode-scan":  Object.freeze({ clean: "allow", finding: "block", error: "block" }),
  "model-label-consistency": Object.freeze({ clean: "allow", finding: "warn",  error: "warn"  }),
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
