import { describe, expect, it } from "vitest";
import {
  decide,
  pickScenario,
  type PolicyInput,
} from "../../../src/policy/engine.ts";
import { mapBySpec, mapBySpecWithRules, mapVerdictToAction, V1_MAPPING } from "../../../src/policy/mapping.ts";
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


// ─────────────────────────────────────────────────────────────────────────────
// 0.6.0：dangerous-command-scan 规则级分级
// ─────────────────────────────────────────────────────────────────────────────
describe("0.6.0 规则级分级：只有语义封闭的规则能升级为 block", () => {
  const findingInput = (rules: readonly string[]): PolicyInput => ({
    checkerId: "dangerous-command-scan",
    safetyClass: false,
    threat: "T2a",
    result: {
      verdict: "finding",
      evidence: rules.map((r) => ({ checker: "dangerous-command-scan", threat: "T2a", verdict: "finding" as const, rule_id: r })),
    },
  });

  it("教程/测试里会合法出现的规则 → 仍只告警（不得阻断正常开发会话）", () => {
    for (const rule of ["remote-pipe-exec", "raw-ip-download", "powershell-download-exec", "reverse-shell"]) {
      expect(decide([findingInput([rule])]).action, rule).toBe("warn");
    }
  });

  it("凭据文件读取（语义封闭）→ block", () => {
    expect(decide([findingInput(["credential-file-read"])]).action).toBe("block");
  });

  it("混合命中：只要含可阻断规则即 block（不被同批观测命中稀释）", () => {
    expect(decide([findingInput(["remote-pipe-exec", "credential-file-read", "raw-ip-download"])]).action).toBe("block");
  });

  it("无命中 → allow；checker 级映射未被改写（V1_MAPPING 仍是 warn）", () => {
    expect(decide([{ checkerId: "dangerous-command-scan", safetyClass: false, threat: "T2a", result: cr("clean") }]).action).toBe("allow");
    expect(V1_MAPPING["dangerous-command-scan"]!.finding).toBe("warn");
  });

  it("mapBySpecWithRules：非 finding / 已是 block 的输入不受 evidence 影响", () => {
    const spec = { id: "dangerous-command-scan", safetyClass: false };
    expect(mapBySpecWithRules(spec, "clean", [{ rule_id: "credential-file-read" }], new Set(["credential-file-read"]))).toBe("allow");
    const egress = { id: "egress-secret-scan", safetyClass: true };
    expect(mapBySpecWithRules(egress, "finding", [], new Set(["credential-file-read"]))).toBe("block");
  });
});
