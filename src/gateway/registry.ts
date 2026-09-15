import type { CheckerSpec } from "../shared/types.ts";
import { EGRESS_SECRET_SCAN_SPEC } from "../checkers/egress-secret-scan.ts";
import { INVISIBLE_UNICODE_SCAN_SPEC } from "../checkers/invisible-unicode-scan.ts";
import { MODEL_LABEL_CONSISTENCY_SPEC } from "../checkers/model-label-consistency.ts";

/**
 * @test REQ-VETO-002
 * @intent v1 内置 checker 注册表（AC-VETO-002-06 + AC-VETO-006-01 联动）。
 *         网关按 side 分派：request → [egress-secret-scan]；response → [invisible-unicode-scan, model-label-consistency]。
 */

export const REGISTRY: readonly CheckerSpec[] = Object.freeze([
  EGRESS_SECRET_SCAN_SPEC,
  INVISIBLE_UNICODE_SCAN_SPEC,
  MODEL_LABEL_CONSISTENCY_SPEC,
]);

export function checkersFor(side: "request" | "response"): readonly CheckerSpec[] {
  return REGISTRY.filter((c) => c.side === side);
}
