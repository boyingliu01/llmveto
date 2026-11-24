import { describe, expect, it } from "vitest";
import { coverageReason, coverageVerdict, presentPaths } from "../../../../src/gateway/protocols/coverage.ts";

// @test REQ-V2bA-14 / REQ-V2bA-15a
// @intent 覆盖判据必须有**独立 oracle**：present 由 CoverageSpec 在原始 body 上求得，
//         handled 由投影器上报。二者求差集，结论与文本量无关。
//
// 这条约束来自 R2 评审：若覆盖结论由投影器自己给出，"投影器忘了某个字段"永远发现不了。

describe("presentPaths：在原始 body 上求存在的已知载荷路径", () => {
  it("命中顶层键", () => {
    expect(presentPaths(["input", "instructions"], { input: "x", instructions: "y" })).toEqual(["input", "instructions"]);
  });

  it("数组元素内的键用 [] 表示，任一项命中即算存在", () => {
    const body = { input: [{ type: "message" }, { arguments: "{}" }] };
    expect(presentPaths(["input[].content", "input[].arguments"], body)).toEqual(["input[].arguments"]);
  });

  it("嵌套路径 presentation", () => {
    const body = { messages: [{ content: [{ tool_use: {} }] }], system: [{ type: "text", text: "s" }] };
    expect(presentPaths(["system", "messages[].content"], body)).toEqual(["system", "messages[].content"]);
  });

  it("非对象 body 一律为空（不抛异常）", () => {
    for (const bad of [null, undefined, 42, "s", []]) expect(presentPaths(["input"], bad)).toEqual([]);
  });
});

describe("coverageVerdict：两轴判定的轴2", () => {
  it("present 为空 → vacuous（协议已知但无载荷）", () => {
    expect(coverageVerdict([], [])).toBe("vacuous");
  });

  it("全部被处理 → full", () => {
    expect(coverageVerdict(["a", "b"], ["a", "b"])).toBe("full");
  });

  it("存在未处理 → partial", () => {
    expect(coverageVerdict(["a", "b"], ["a"])).toBe("partial");
  });

  it("与文本量无关：未处理字段存在、其他字段为空，仍是 partial", () => {
    expect(coverageVerdict(["credential"], [])).toBe("partial");
  });
});

describe("coverageReason：evidence 顶层 reason 的映射", () => {
  it("full 不写 reason", () => {
    expect(coverageReason(["a"], ["a"])).toBeNull();
  });

  it("vacuous → shape_known_empty", () => {
    expect(coverageReason([], [])).toBe("shape_known_empty");
  });

  it("partial → shape_partial_coverage", () => {
    expect(coverageReason(["a", "b"], ["a"])).toBe("shape_partial_coverage");
  });
});
