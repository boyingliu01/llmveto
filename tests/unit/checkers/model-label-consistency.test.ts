import { describe, expect, it } from "vitest";
import {
  modelLabelConsistency,
  MODEL_LABEL_CONSISTENCY_SPEC,
} from "../../../src/checkers/model-label-consistency.ts";
import type { ScanUnit } from "../../../src/shared/types.ts";

// @test REQ-VETO-005
// @intent T3a 模型字段一致性：meta.model_responded != meta.model_requested → finding
// @covers AC-VETO-005-01 AC-VETO-005-02 AC-VETO-005-03

const unit = (meta: Record<string, unknown>): ScanUnit => ({
  direction: "response",
  transport: "non-stream",
  text: "",
  meta,
});

describe("SL-04 model-label-consistency (REQ-VETO-005)", () => {
  it("AC-01 一致 → clean", () => {
    const r = modelLabelConsistency(unit({ model_requested: "gpt-4o", model_responded: "gpt-4o" }));
    expect(r.verdict).toBe("clean");
  });

  it("AC-01 不一致 → finding + rule_id=model-label-mismatch", () => {
    const r = modelLabelConsistency(unit({ model_requested: "gpt-4o", model_responded: "gpt-3.5-turbo" }));
    expect(r.verdict).toBe("finding");
    expect(r.evidence[0]?.rule_id).toBe("model-label-mismatch");
    expect(r.evidence[0]?.threat).toBe("T3a");
    expect(r.evidence[0]?.checker).toBe("model-label-consistency");
  });

  it("edge: 响应 model 缺失 → finding（REQ-VETO-005 edge_case）", () => {
    const r = modelLabelConsistency(unit({ model_requested: "gpt-4o" }));
    expect(r.verdict).toBe("finding");
  });

  it("edge: 双侧缺失 → clean（无从判定不产生噪声）", () => {
    expect(modelLabelConsistency(unit({})).verdict).toBe("clean");
  });

  it("AC-02 checker 从 meta 读取，不解析 text（text 空仍能工作）", () => {
    const r = modelLabelConsistency({
      direction: "response",
      transport: "non-stream",
      text: "irrelevant body",
      meta: { model_requested: "a", model_responded: "b" },
    });
    expect(r.verdict).toBe("finding");
  });

  it("AC-04 纯函数性 + spec 声明", () => {
    const u = unit({ model_requested: "a", model_responded: "b" });
    expect(modelLabelConsistency(u)).toEqual(modelLabelConsistency(u));
    expect(MODEL_LABEL_CONSISTENCY_SPEC.safetyClass).toBe(false);
    expect(MODEL_LABEL_CONSISTENCY_SPEC.side).toBe("response");
  });
});
