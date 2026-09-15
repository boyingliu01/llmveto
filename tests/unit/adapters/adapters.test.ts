import { describe, expect, it } from "vitest";
import { delphiAdapter, MANAGED_CONFIG_IDS as DELPHI_IDS } from "../../../src/adapters/delphi.ts";
import { opencodeAdapter, MANAGED_CONFIG_IDS as OPENCODE_IDS } from "../../../src/adapters/opencode.ts";
import type { ConfigId } from "../../../src/adapters/index.ts";

// @test REQ-VETO-009
// @intent OpenCode + Delphi 适配器：MANAGED_CONFIG_IDS 封闭枚举 + 漂移检测
// @covers AC-VETO-009-01 AC-VETO-009-02 AC-VETO-009-03

describe("SL-08 adapters (REQ-VETO-009)", () => {
  it("AC-01 两适配器各 export MANAGED_CONFIG_IDS: readonly ConfigId[]", () => {
    expect(Array.isArray(OPENCODE_IDS)).toBe(true);
    expect(Array.isArray(DELPHI_IDS)).toBe(true);
    expect(OPENCODE_IDS.length).toBeGreaterThan(0);
    expect(DELPHI_IDS.length).toBeGreaterThan(0);
    for (const id of [...OPENCODE_IDS, ...DELPHI_IDS]) {
      expect(typeof id.id).toBe("string");
      expect(typeof id.description).toBe("string");
    }
  });

  it("AC-01 枚举唯一：无重复 id", () => {
    const all = [...OPENCODE_IDS.map((x) => x.id), ...DELPHI_IDS.map((x) => x.id)];
    expect(new Set(all).size).toBe(all.length);
  });

  it("AC-02 buildPatch 生成网关 baseURL 覆写", () => {
    const patch = opencodeAdapter.buildPatch("http://127.0.0.1:8787");
    const p = patch.provider as Record<string, { options: { baseURL: string } }>;
    expect(p.openai?.options.baseURL).toBe("http://127.0.0.1:8787/opencode");
    expect(p.anthropic?.options.baseURL).toBe("http://127.0.0.1:8787/opencode");
    const dp = delphiAdapter.buildPatch("http://127.0.0.1:8787");
    expect((dp.endpoint as Record<string, string>).chat).toContain("/delphi/v1/chat/completions");
  });

  it("AC-03 detectDrift 无漂移 → 空数组", () => {
    const base = "http://127.0.0.1:8787";
    const cfg = opencodeAdapter.buildPatch(base) as Record<string, unknown>;
    expect(opencodeAdapter.detectDrift(cfg, base)).toEqual([]);
  });

  it("AC-03 detectDrift 有漂移 → 返回对应 ConfigId", () => {
    const base = "http://127.0.0.1:8787";
    const cfg = opencodeAdapter.buildPatch(base) as Record<string, unknown>;
    const provider = cfg.provider as Record<string, { options: { baseURL: string } }>;
    provider.openai!.options.baseURL = "https://evil.example.com";
    const drift: readonly ConfigId[] = opencodeAdapter.detectDrift(cfg, base);
    expect(drift.map((d) => d.id)).toContain("opencode.provider.openai.options.baseURL");
    expect(drift.map((d) => d.id)).not.toContain("opencode.provider.anthropic.options.baseURL");
  });

  it("AC-03 完全空配置 → 所有受管项都算漂移", () => {
    const drift = opencodeAdapter.detectDrift({}, "http://127.0.0.1:8787");
    expect(drift.length).toBe(OPENCODE_IDS.length);
  });

  it("Delphi 漂移检测", () => {
    const base = "http://127.0.0.1:8787";
    const cfg = delphiAdapter.buildPatch(base);
    expect(delphiAdapter.detectDrift(cfg, base)).toEqual([]);
    const tampered = structuredClone(cfg) as Record<string, unknown>;
    (tampered.endpoint as Record<string, string>).chat = "https://evil";
    const drift = delphiAdapter.detectDrift(tampered, base);
    expect(drift.map((d) => d.id)).toContain("delphi.endpoint.chat");
  });
});
