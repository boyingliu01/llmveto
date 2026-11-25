import { describe, expect, it } from "vitest";
import { recognize, WIRE_ROUTE_PREFIXES, formatForPrefix } from "../../../../src/gateway/protocols/registry.ts";

// @test REQ-V2bA-03 / AC-V2bA-03a~c
// @intent 识别必须**路由权威**：前缀决定线格式，内容吻合只在无权威前缀时使用。
//         历史（R2 评审 C1，实测复现）：初版让 chat 与 anthropic 用"特征键"互相竞争，
//         而下面三条真实请求在结构上**同时**满足两组特征键，全部判歧义 → 在 fail-closed
//         下会阻断目标客户端自己的全部流量。
//         根因：Claude 的"无 system + 纯文本"请求与 Chat 请求在结构上本来就相同。

const CHAT_REQ = { model: "gpt-4o", max_tokens: 100, messages: [{ role: "user", content: "hi" }] };
const CLAUDE_WITH_SYSTEM = {
  model: "claude-sonnet-4-5",
  max_tokens: 1024,
  system: [{ type: "text", text: "sys" }],
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
};
const CLAUDE_PLAIN = { model: "claude-sonnet-4-5", max_tokens: 1024, messages: [{ role: "user", content: "hi" }] };

describe("SL-01 路由权威识别（REQ-V2bA-03）", () => {
  it("已知前缀直接决定线格式，不受正文形态影响", () => {
    expect(recognize("request", CHAT_REQ, "claude")).toEqual({ kind: "known", format: "anthropic-messages" });
    expect(recognize("request", CHAT_REQ, "codex")).toEqual({ kind: "known", format: "openai-responses" });
    expect(recognize("request", { input: "x" }, "promptfoo")).toEqual({ kind: "known", format: "chat" });
  });

  it("跨格式相似性：三条结构相同的请求在权威前缀下各归各类，均不得 unknown", () => {
    for (const [body, prefix] of [[CHAT_REQ, "promptfoo"], [CLAUDE_WITH_SYSTEM, "claude"], [CLAUDE_PLAIN, "claude"]] as const) {
      expect(recognize("request", body, prefix).kind).toBe("known");
    }
  });

  it("无权威前缀：responses 判别键优先", () => {
    expect(recognize("request", { input: [{ type: "message" }] }, null)).toEqual({ kind: "known", format: "openai-responses" });
    expect(recognize("request", { instructions: "s" }, null)).toEqual({ kind: "known", format: "openai-responses" });
    expect(recognize("response", { object: "response", output: [] }, null)).toEqual({ kind: "known", format: "openai-responses" });
  });

  it("无权威前缀：块数组 system 或 tool_use/tool_result → anthropic", () => {
    expect(recognize("request", CLAUDE_WITH_SYSTEM, null)).toEqual({ kind: "known", format: "anthropic-messages" });
    expect(
      recognize("request", { messages: [{ role: "assistant", content: [{ type: "tool_use", id: "t", name: "f", input: {} }] }] }, null),
    ).toEqual({ kind: "known", format: "anthropic-messages" });
  });

  it("无权威前缀：messages + 纯文本 → chat（倾向已支持格式，不判未知）", () => {
    expect(recognize("request", CHAT_REQ, null)).toEqual({ kind: "known", format: "chat" });
    expect(recognize("request", CLAUDE_PLAIN, null)).toEqual({ kind: "known", format: "chat" });
  });

  it("响应侧按帧/体特征识别", () => {
    expect(recognize("response", { choices: [{ message: { content: "x" } }] }, null)).toEqual({ kind: "known", format: "chat" });
    expect(recognize("response", { type: "message", content: [{ type: "text", text: "x" }] }, null)).toEqual({ kind: "known", format: "anthropic-messages" });
    expect(recognize("response", { type: "response.output_text.delta", delta: "x" }, null)).toEqual({ kind: "known", format: "openai-responses" });
    expect(recognize("response", { type: "content_block_delta", delta: {} }, null)).toEqual({ kind: "known", format: "anthropic-messages" });
  });

  it("真正无法归类的 body 才是 unknown", () => {
    expect(recognize("request", { foo: "bar" }, null)).toEqual({ kind: "unknown" });
    expect(recognize("request", {}, null)).toEqual({ kind: "unknown" });
  });

  it("畸形输入不抛异常（D3a：识别是数据分类）", () => {
    for (const bad of [null, undefined, [], 42, "str", { messages: null }, { input: 3 }] as unknown[]) {
      expect(() => recognize("request", bad, undefined)).not.toThrow();
    }
  });

  it("前缀表是唯一权威来源，且不含保留段 v1/api", () => {
    expect(formatForPrefix("claude")).toBe("anthropic-messages");
    expect(formatForPrefix("codex")).toBe("openai-responses");
    expect(formatForPrefix("v1")).toBeUndefined();
    expect(formatForPrefix("api")).toBeUndefined();
    expect([...WIRE_ROUTE_PREFIXES.keys()]).not.toContain("v1");
  });
});
