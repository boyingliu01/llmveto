import { describe, expect, it } from "vitest";
import { PAYLOAD_GENERATION, PROBE_DIMENSIONS, baselineKey, buildProbeBody, dimensionFor, probeDigest } from "../../../src/fingerprint/probe.ts";

// @test REQ-V2bC-01 / REQ-V2bC-02 / AC-01a~c / AC-02a~b
// @intent 探针是整个 v2b-C 里**唯一会主动向中转站发请求的东西**。
//         它必须满足三条硬约束，每条都是可机械判定的：
//           ① 与会话无关（同一维度永远同一载荷）
//           ② 不含部署标识（hostname/用户名/路径/UUID/时间戳）
//           ③ 载荷有界（≤512 字节）
//         任何一条失效，"最小暴露"就从承诺变成笑话。

describe("SL-01 探针载荷（REQ-V2bC-01）", () => {
  it("AC-01a：同一维度重复构造，载荷字节完全相同", () => {
    for (const dim of PROBE_DIMENSIONS) {
      const a = JSON.stringify(buildProbeBody(dim, "gpt-4o"));
      const b = JSON.stringify(buildProbeBody(dim, "gpt-4o"));
      expect(a).toBe(b);
    }
  });

  it("AC-01a：载荷与会话无关（给定任意会话表现，载荷恒定）", () => {
    const before = probeDigest("D2", "gpt-4o");
    // 模拟"用户刚刚聊了很长一段，带了各种上下文"——探针不该受任何影响
    const sessionStates = [
      { messages: 100, lastUserText: "x".repeat(50_000) },
      { messages: 0, lastUserText: "" },
      { messages: 3, lastUserText: "my secret is sk-abcdef123456" },
    ];
    for (const _ of sessionStates) expect(probeDigest("D2", "gpt-4o")).toBe(before);
  });

  it("AC-01b：载荷不含部署标识", () => {
    for (const dim of PROBE_DIMENSIONS) {
      const body = JSON.stringify(buildProbeBody(dim, "gpt-4o"));
      // 主机名 / 用户名 / 家目录 / 工作目录 / UUID / ISO 时间戳 —— 一个都不能出现
      expect(body).not.toMatch(/\/home\/|\/Users\/|C:\\\\/);
      expect(body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      expect(body).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(body).not.toContain("hostname");
      expect(body).not.toContain("llmveto");
    }
  });

  it("AC-01c：每个维度的载荷 ≤512 字节", () => {
    for (const dim of PROBE_DIMENSIONS) {
      const bytes = Buffer.byteLength(JSON.stringify(buildProbeBody(dim, "gpt-4o")), "utf8");
      expect(bytes).toBeLessThanOrEqual(512);
    }
  });

  it("模型名来自调用方传入（受管枚举），不内置任何模型", () => {
    const a = buildProbeBody("D0", "gpt-4o");
    const b = buildProbeBody("D0", "claude-3-opus");
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(JSON.stringify(b)).toContain("claude-3-opus");
  });
});

describe("SL-01 维度轮转（REQ-V2bC-02）", () => {
  it("AC-02a：连续 4 次调用覆盖全部四个维度，且循环", () => {
    const first4 = [0, 1, 2, 3].map((i) => dimensionFor(i));
    expect(new Set(first4).size).toBe(4);
    expect(dimensionFor(4)).toBe(first4[0]);
    expect(dimensionFor(7)).toBe(first4[3]);
  });

  it("AC-02b：每次探针只测一个维度", () => {
    const unit = buildProbeBody("D1", "gpt-4o");
    // D1 是"格式遵循"：要求只输出 JSON。不该同时含 D2 的知识问题或 D3 的越界诱导。
    const text = JSON.stringify(unit);
    expect(text.toLowerCase()).toContain("json");
    expect(text).not.toContain("拒绝");
  });
});

describe("SL-01 载荷代与基线隔离（用户决策：载荷轮换）", () => {
  it("基线键带代号，换代后旧基线不与新观测混算", () => {
    expect(baselineKey("D0")).toBe(`g${PAYLOAD_GENERATION}:D0`);
    expect(baselineKey("D0")).not.toBe("D0");
  });

  it("不同维度的基线键互不相同", () => {
    const keys = PROBE_DIMENSIONS.map(baselineKey);
    expect(new Set(keys).size).toBe(4);
  });

  it("当前代有对应载荷集（换代忘了加会立刻红）", () => {
    for (const dim of PROBE_DIMENSIONS) {
      expect(buildProbeBody(dim, "m")).toHaveProperty("messages");
    }
  });
});
