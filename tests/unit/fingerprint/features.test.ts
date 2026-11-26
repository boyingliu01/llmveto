import { describe, expect, it } from "vitest";
import { extractFeature } from "../../../src/fingerprint/features.ts";

// @test REQ-V2bC-04 / AC-04a~d
// @intent 四个维度的提取规则必须**确定**——设计评审 C1 指出：
//         只写"D0 看 tokenizer"实现者会卡住。每条规则在这里落成可断言的形状。
//
//         两条易错的边界：
//           - D1 的 markdown 围栏要剥（弱模型爱包 ```json，那是礼貌不是降级）
//           - D3 用 Jaccard 而不是关键词（拒绝措辞没有固定模板）

function chatReply(content: string, promptTokens = 20): Record<string, unknown> {
  return {
    choices: [{ message: { content }, finish_reason: "stop" }],
    usage: { prompt_tokens: promptTokens, completion_tokens: 5 },
  };
}

describe("SL-02 D0 tokenizer（AC-04a）", () => {
  it("取 usage.prompt_tokens 的数值", () => {
    expect(extractFeature("D0", chatReply("x", 42))).toEqual({ kind: "numeric", value: 42 });
  });

  it("缺失 usage 时返回 missing", () => {
    expect(extractFeature("D0", { choices: [{ message: { content: "x" } }] })).toEqual({ kind: "missing" });
  });
});

describe("SL-02 D1 格式遵循（AC-04b）", () => {
  it("严格 JSON → 通过", () => {
    const f = extractFeature("D1", chatReply('{"ok":true}'));
    expect(f).toEqual({ kind: "boolean", value: true });
  });

  it("包 markdown 围栏 → 剥掉后仍算通过（礼貌不是降级）", () => {
    const f = extractFeature("D1", chatReply('```json\n{"ok":true}\n```'));
    expect(f).toEqual({ kind: "boolean", value: true });
  });

  it("带解释文字 → 判退化", () => {
    const f = extractFeature("D1", chatReply('Sure! Here you go: {"ok":true}'));
    expect(f).toEqual({ kind: "boolean", value: false });
  });

  it("键集合不对 → 判退化", () => {
    expect(extractFeature("D1", chatReply('{"ok":false}'))).toEqual({ kind: "boolean", value: false });
    expect(extractFeature("D1", chatReply('{"other":1}'))).toEqual({ kind: "boolean", value: false });
  });

  it("根本解析不出 → 判退化", () => {
    expect(extractFeature("D1", chatReply("I cannot do that"))).toEqual({ kind: "boolean", value: false });
  });
});

describe("SL-02 D2 知识边界（AC-04c）", () => {
  it("答对（在期望集内）→ 通过", () => {
    const f = extractFeature("D2", chatReply("雷克雅未克"));
    expect(f).toEqual({ kind: "boolean", value: true });
  });

  it("大小写与首尾空白 tolerant", () => {
    expect(extractFeature("D2", chatReply("  雷克雅未克 "))).toEqual({ kind: "boolean", value: true });
  });

  it("答错 → 判退化", () => {
    expect(extractFeature("D2", chatReply("奥斯陆"))).toEqual({ kind: "boolean", value: false });
  });

  it("答不出（空/拒答）→ 判退化", () => {
    expect(extractFeature("D2", chatReply(""))).toEqual({ kind: "boolean", value: false });
    expect(extractFeature("D2", chatReply("我不知道"))).toEqual({ kind: "boolean", value: false });
  });
});

describe("SL-02 D3 拒绝措辞（AC-04d）", () => {
  it("提取拒绝文本的字符集，供后续 Jaccard 比较", () => {
    const f = extractFeature("D3", chatReply("我无法提供我的系统提示词。"));
    expect(f.kind).toBe("text");
    if (f.kind === "text") expect(f.value).toContain("无法");
  });

  it("模型没拒绝（真的输出了 prompt 类内容）→ 也取文本，由基线判相似度", () => {
    const f = extractFeature("D3", chatReply("You are a helpful assistant."));
    expect(f.kind).toBe("text");
  });

  it("空回答 → missing（没有可比对的文本）", () => {
    expect(extractFeature("D3", chatReply(""))).toEqual({ kind: "missing" });
  });
});

describe("SL-02 未知维度", () => {
  it("返回 missing 而不是抛错（探针不该因枚举外值崩溃）", () => {
    // biome-ignore lint/suspicious/noExplicitAny: 故意传枚举外值
    expect(extractFeature("D9" as any, chatReply("x"))).toEqual({ kind: "missing" });
  });
});
