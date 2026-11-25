import { describe, expect, it } from "vitest";
import { CHAT_COVERAGE, chatProtocol } from "../../src/gateway/protocols/chat.ts";
import { ANTHROPIC_COVERAGE, anthropicMessagesProtocol } from "../../src/gateway/protocols/anthropic.ts";
import { RESPONSES_COVERAGE, responsesProtocol } from "../../src/gateway/protocols/responses.ts";
import { presentPaths } from "../../src/gateway/protocols/coverage.ts";
import type { CoverageSpec, WireProtocol } from "../../src/gateway/protocols/types.ts";
import { readManifest, readText } from "../utils/docs.ts";

// @test REQ-V2bA-15a / REQ-V2bA-11
// @intent `shape_partial_coverage` 应当**永远是 0**。这个测试就是它的持续守卫：
//         对每条协议线的**全部已知载荷路径**，构造一个"该路径存在"的 body，
//         断言投影器把它报告为 handled。只要清单声明了某字段而投影器漏了它，这里就红。
//
// 守卫在每次 CI 运行，而不是只在 BUILD 末统计一次——R2 评审明确要求"持续守卫"。

interface Case {
  readonly path: string;
  readonly body: Record<string, unknown>;
}

/** 为 Anthropic 的每条载荷路径构造一个"该路径存在"的 body。 */
const ANTHROPIC_CASES: readonly Case[] = [
  { path: "system", body: { system: [{ type: "text", text: "s" }] } },
  { path: "messages[].content", body: { messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] } },
  {
    path: "messages[].content[].tool_use.input",
    body: { messages: [{ role: "assistant", content: [{ type: "tool_use", id: "t", name: "f", input: { a: 1 } }] }] },
  },
  {
    path: "messages[].content[].tool_use.name",
    body: { messages: [{ role: "assistant", content: [{ type: "tool_use", id: "t", name: "f", input: {} }] }] },
  },
  {
    path: "messages[].content[].tool_result.content",
    body: { messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "out" }] }] },
  },
  { path: "tools", body: { tools: [{ name: "f" }] } },
];

const RESPONSES_CASES: readonly Case[] = [
  { path: "instructions", body: { instructions: "i" } },
  { path: "input", body: { input: "plain string input" } },
  { path: "input[].content", body: { input: [{ type: "message", content: [{ type: "input_text", text: "x" }] }] } },
  { path: "input[].arguments", body: { input: [{ type: "function_call", arguments: "{}" }] } },
  { path: "input[].output", body: { input: [{ type: "function_call_output", output: "o" }] } },
  { path: "tools", body: { tools: [{ type: "function", name: "f" }] } },
];

const CHAT_CASES: readonly Case[] = [
  { path: "messages[].content", body: { messages: [{ role: "user", content: "hi" }] } },
  {
    path: "messages[].tool_calls[].function.arguments",
    body: { messages: [{ role: "assistant", tool_calls: [{ function: { arguments: "{}" } }] }] },
  },
  { path: "messages[].function_call.arguments", body: { messages: [{ role: "assistant", function_call: { arguments: "{}" } }] } },
  { path: "system", body: { system: "s" } },
  { path: "tools", body: { tools: [{ type: "function" }] } },
];

function assertNoPartial(proto: WireProtocol, spec: CoverageSpec, cases: readonly Case[], label: string): void {
  const projection = proto.projectRequest;
  for (const c of cases) {
    const present = presentPaths(spec.requestPayloadPaths, c.body);
    // 该 case 构造出的 body 必须真的命中了它声称的路径，否则这个 case 什么也没测
    expect(present, `${label}: case ${c.path} 未命中任何载荷路径`).toContain(c.path);
    const handled = projection(c.body).handled;
    expect(handled, `${label}: 声明了 ${c.path} 却没有被投影 → shape_partial_coverage`).toContain(c.path);
  }
}

describe("SL-14 shape_partial_coverage 持续守卫（REQ-V2bA-15a）", () => {
  it("Anthropic：每条声明的请求载荷路径都被投影", () => {
    assertNoPartial(anthropicMessagesProtocol, ANTHROPIC_COVERAGE, ANTHROPIC_CASES, "anthropic");
  });

  it("Responses：每条声明的请求载荷路径都被投影", () => {
    assertNoPartial(responsesProtocol, RESPONSES_COVERAGE, RESPONSES_CASES, "responses");
  });

  it("Chat：每条声明的请求载荷路径都被投影（对照）", () => {
    assertNoPartial(chatProtocol, CHAT_COVERAGE, CHAT_CASES, "chat");
  });
});

describe("SL-14 存量审计表（REQ-V2bA-11）", () => {
  it("审计表列出每条受管路由的线格式与覆盖结论", () => {
    const audit = readText("docs/protocol-coverage-audit.md");
    for (const route of [
      "opencode/openai",
      "opencode/anthropic",
      "opencode/mock",
      "delphi/default",
      "dsh/cliproxy",
      "claude/anthropic",
      "codex/openai",
      "promptfoo/openai",
    ]) {
      expect(audit, `审计表缺路由 ${route}`).toContain(route);
    }
  });

  it("审计表写清了 opencode/anthropic 的命名歧义（不掩盖）", () => {
    const audit = readText("docs/protocol-coverage-audit.md");
    expect(audit).toContain("命名歧义");
    expect(audit).toContain("路由名里的 `anthropic` 指的是 provider 名，不是线格式");
  });

  it("manifest 里每个切片声明的 REQ 都出现在 specification.yaml", () => {
    const manifest = readManifest();
    const spec = readText("specification.yaml");
    for (const s of manifest.slices) {
      for (const req of s.requirements) expect(spec, `${s.id} 引用了不存在的 ${req}`).toContain(req);
    }
  });
});
