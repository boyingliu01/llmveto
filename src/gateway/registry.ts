import type { CheckerSpec } from "../shared/types.ts";
import { CANARY_RETURN_SCAN_SPEC } from "../checkers/canary-return-scan.ts";
import { EGRESS_SECRET_SCAN_SPEC } from "../checkers/egress-secret-scan.ts";
import { INVISIBLE_UNICODE_SCAN_SPEC } from "../checkers/invisible-unicode-scan.ts";
import { MODEL_LABEL_CONSISTENCY_SPEC } from "../checkers/model-label-consistency.ts";
import { THINKING_SIGNATURE_PRESENCE_SPEC } from "../checkers/thinking-signature-presence.ts";
import { TOOL_CALL_SHAPE_SPEC } from "../checkers/tool-call-shape.ts";
import { USAGE_RECONCILE_SPEC } from "../checkers/usage-reconcile.ts";

/**
 * @test REQ-VETO-002
 * @intent v1 内置 checker 注册表（AC-VETO-002-06 + AC-VETO-006-01 联动）。
 *         网关按 side 分派：request → [egress-secret-scan]；response → [canary-return-scan, invisible-unicode-scan, model-label-consistency, thinking-signature-presence, tool-call-shape, usage-reconcile]。
 */

export const REGISTRY: readonly CheckerSpec[] = Object.freeze([
  CANARY_RETURN_SCAN_SPEC,
  EGRESS_SECRET_SCAN_SPEC,
  INVISIBLE_UNICODE_SCAN_SPEC,
  MODEL_LABEL_CONSISTENCY_SPEC,
  THINKING_SIGNATURE_PRESENCE_SPEC,
  TOOL_CALL_SHAPE_SPEC,
  USAGE_RECONCILE_SPEC,
]);

export function checkersFor(side: "request" | "response"): readonly CheckerSpec[] {
  return REGISTRY.filter((c) => c.side === side);
}

/** §4.5 威胁表：单一来源 = 各 CheckerSpec.threat（不得在 policy/evidence 侧另设字面表）。 */
export const CHECKER_THREAT_BY_ID: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(REGISTRY.map((c) => [c.id, c.threat])),
);
