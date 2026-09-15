import { describe, expect, it } from "vitest";
import {
  assertNoRedactInV1Table,
  decide,
  pickScenario,
  type PolicyInput,
} from "../../../src/policy/engine.ts";
import { mapBySpec, mapVerdictToAction, V1_MAPPING } from "../../../src/policy/mapping.ts";
import type { CheckerResult } from "../../../src/shared/types.ts";

// @test REQ-VETO-006
// @intent v1 内置固定 verdict→action 映射表 + 严者胜 + 行为矩阵
// @covers AC-VETO-006-01 AC-VETO-006-02 AC-VETO-006-03 AC-VETO-006-04

const cr = (v: CheckerResult["verdict"]): CheckerResult => ({ verdict: v, evidence: [] });

describe("SL-05 policy engine (REQ-VETO-006)", () => {
  it("AC-01 内置固定映射表覆盖三个 v1 checker", () => {
    expect(V1_MAPPING["egress-secret-scan"]).toEqual({ clean: "allow", finding: "block", error: "block" });
    expect(V1_MAPPING["invisible-unicode-scan"]).toEqual({ clean: "allow", finding: "block", error: "block" });
    expect(V1_MAPPING["model-label-consistency"]).toEqual({ clean: "allow", finding: "warn", error: "warn" });
  });

  it("AC-01 不可配置：模块级 freeze + 无 setter 导出", () => {
    expect(Object.isFrozen(V1_MAPPING)).toBe(true);
    expect(Object.isFrozen(V1_MAPPING["egress-secret-scan"])).toBe(true);
  });

  it("AC-02 safety-class checker 的 error → block（fail-closed）", () => {
    expect(mapVerdictToAction("egress-secret-scan", "error")).toBe("block");
    expect(mapVerdictToAction("invisible-unicode-scan", "error")).toBe("block");
  });

  it("AC-03 表内不出现 redact", () => {
    expect(() => assertNoRedactInV1Table()).not.toThrow();
    // 显式断言
    for (const m of Object.values(V1_MAPPING)) {
      expect(Object.values(m)).not.toContain("redact");
    }
  });

  it("未注册 checker 默认 block（fail-closed）", () => {
    expect(mapVerdictToAction("unknown-checker", "finding")).toBe("block");
    expect(mapVerdictToAction("unknown-checker", "clean")).toBe("block");
  });

  it("mapBySpec safetyClass 兜底：未注册 checker 走 spec 声明", () => {
    expect(mapBySpec({ id: "new-safety", safetyClass: true }, "finding")).toBe("block");
    expect(mapBySpec({ id: "new-obs", safetyClass: false }, "finding")).toBe("warn");
    expect(mapBySpec({ id: "new-obs", safetyClass: false }, "clean")).toBe("allow");
  });

  it("多 checker 严者胜：block > warn > allow", () => {
    const inputs: PolicyInput[] = [
      { checkerId: "model-label-consistency", safetyClass: false, result: cr("finding") },
      { checkerId: "egress-secret-scan", safetyClass: true, result: cr("finding") },
    ];
    const d = decide(inputs);
    expect(d.action).toBe("block");
    expect(d.reasons).toHaveLength(2);
  });

  it("decide 空集合 → allow", () => {
    expect(decide([]).action).toBe("allow");
  });

  it("AC-04 行为矩阵：请求侧 block → 场景 1", () => {
    expect(pickScenario({ side: "request", transport: "non-stream", deliveredChunks: 0 })).toBe("1");
    expect(pickScenario({ side: "request", transport: "stream", deliveredChunks: 0 })).toBe("1");
  });

  it("AC-04 行为矩阵：响应非流式 block → 场景 2", () => {
    expect(pickScenario({ side: "response", transport: "non-stream", deliveredChunks: 0 })).toBe("2");
  });

  it("AC-04 行为矩阵：响应流式 + delivered=0 → 场景 3；delivered>0 → 场景 4", () => {
    expect(pickScenario({ side: "response", transport: "stream", deliveredChunks: 0 })).toBe("3");
    expect(pickScenario({ side: "response", transport: "stream", deliveredChunks: 1 })).toBe("4");
    expect(pickScenario({ side: "response", transport: "stream", deliveredChunks: 41 })).toBe("4");
  });
});
