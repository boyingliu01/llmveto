import { describe, expect, it } from "vitest";
import { anthropicMessagesProtocol, ANTHROPIC_COVERAGE } from "../../../../src/gateway/protocols/anthropic.ts";
import { buildRequestScanUnit, buildResponseScanUnit } from "../../../../src/gateway/scan-unit.ts";
import type { WireFormat } from "../../../../src/gateway/protocols/types.ts";

// @test REQ-V2bA-02 / AC-V2bA-02a~c / REQ-V2bA-05 / AC-V2bA-05a
// @intent Claude Code 说 Anthropic Messages 协议。实测（var/probes/scan-unit-probe.mjs）：
//         system 块数组 / tool_use.input（对象）/ tool_result.content / **整个响应 content[]**
//         在改动前都不进扫描单元，响应投影为空串。本切片补齐非流式路径。
//
// 派生标记：`tool_use.input` 原文是 JSON **对象**，投影时被 JSON.stringify 成文本，
// 这段文本在原始 body 里没有对应字节 → derived，其 offsets 不得当原文位置用（REQ-05）。

const ANTH_REQUEST = JSON.stringify({
  model: "claude-sonnet-4-5",
  max_tokens: 1024,
  stream: true,
  system: [{ type: "text", text: "SYS-BLOCK-PROBE", cache_control: { type: "ephemeral" } }],
  messages: [
    { role: "user", content: [{ type: "text", text: "USER-PROBE" }, { type: "image", source: {} }] },
    {
      role: "assistant",
      content: [
        { type: "text", text: "ASSIST-PROBE" },
        { type: "tool_use", id: "tu1", name: "shell", input: { cmd: "TOOLINPUT-PROBE" } },
      ],
    },
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tu1", content: "TOOLRESULT-PROBE" }],
    },
  ],
  tools: [{ name: "shell", input_schema: { type: "object" } }],
});

const ANTHROPIC_TEXT_FRAME = { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ANTH-TOKEN-PROBE" } };
const ANTHROPIC_JSON_FRAME = {
  type: "content_block_delta",
  index: 1,
  delta: { type: "input_json_delta", partial_json: '{"cmd":"ANTH-JSON-PROBE"}' },
};
const ANTH_RESPONSE = JSON.stringify({
  id: "msg_1",
  type: "message",
  model: "claude-sonnet-4-5",
  role: "assistant",
  content: [
    { type: "text", text: "ASSIST-RESP-PROBE" },
    { type: "tool_use", id: "tu2", name: "shell", input: { cmd: "ASSIST-TOOL-PROBE" } },
  ],
  usage: { input_tokens: 9, output_tokens: 3 },
});

function frameText(proto: { readonly format: WireFormat }, frame: Record<string, unknown>): string {
  const u = buildResponseScanUnit(JSON.stringify(frame), frame, null, "stream", {}, { format: proto.format });
  return u.text;
}

describe("SL-02 Anthropic Messages 非流式投影（REQ-V2bA-02）", () => {
  it("请求侧：块数组 system 的 text 进入投影（改动前为空）", () => {
    const p = anthropicMessagesProtocol.projectRequest(JSON.parse(ANTH_REQUEST) as Record<string, unknown>);
    expect(p.parts.join("\n")).toContain("SYS-BLOCK-PROBE");
  });

  it("请求侧：用户文本 / tool_use.input / tool_result.content 全部进入投影", () => {
    const p = anthropicMessagesProtocol.projectRequest(JSON.parse(ANTH_REQUEST) as Record<string, unknown>);
    const text = p.parts.join("\n");
    expect(text).toContain("USER-PROBE");
    expect(text).toContain("TOOLINPUT-PROBE");
    expect(text).toContain("TOOLRESULT-PROBE");
  });

  it("tool_use.input 是对象 → 投影为派生文本（REQ-05）", () => {
    const p = anthropicMessagesProtocol.projectRequest(JSON.parse(ANTH_REQUEST) as Record<string, unknown>);
    expect(p.derived).toBe(true);
  });

  it("响应侧：content[] 的 text 与 tool_use.input 进入投影（改动前整段为空）", () => {
    const p = anthropicMessagesProtocol.projectResponse(JSON.parse(ANTH_RESPONSE) as Record<string, unknown>, "claude-sonnet-4-5");
    const text = p.parts.join("\n");
    expect(text).toContain("ASSIST-RESP-PROBE");
    expect(text).toContain("ASSIST-TOOL-PROBE");
  });

  it("覆盖上报：present 求得出、handled 覆盖它（full）", () => {
    const body = JSON.parse(ANTH_REQUEST) as Record<string, unknown>;
    expect(ANTHROPIC_COVERAGE.requestPayloadPaths.length).toBeGreaterThan(0);
    const p = anthropicMessagesProtocol.projectRequest(body);
    expect(p.handled.length).toBeGreaterThan(0);
  });

  it("接入 scan-unit：Anthropic 请求体与响应体都命中探针（端到端口径）", () => {
    const req = buildRequestScanUnit(ANTH_REQUEST, JSON.parse(ANTH_REQUEST) as Record<string, unknown>, {}, "stream", {
      format: "anthropic-messages",
    });
    for (const probe of ["SYS-BLOCK-PROBE", "USER-PROBE", "TOOLINPUT-PROBE", "TOOLRESULT-PROBE"]) {
      expect(req.text, `request must include ${probe}`).toContain(probe);
    }
    const res = buildResponseScanUnit(
      ANTH_RESPONSE,
      JSON.parse(ANTH_RESPONSE) as Record<string, unknown>,
      "claude-sonnet-4-5",
      "non-stream",
      {},
      { format: "anthropic-messages" },
    );
    expect(res.text).toContain("ASSIST-RESP-PROBE");
    expect(res.text).toContain("ASSIST-TOOL-PROBE");
  });
});

describe("SL-04 Anthropic 流式帧投影（AC-V2bA-02d）", () => {
  it("text_delta 帧可见（改动前为空串）", () => {
    expect(frameText(anthropicMessagesProtocol, ANTHROPIC_TEXT_FRAME)).toContain("ANTH-TOKEN-PROBE");
  });

  it("input_json_delta 帧可见（改动前为空串）", () => {
    expect(frameText(anthropicMessagesProtocol, ANTHROPIC_JSON_FRAME)).toContain("ANTH-JSON-PROBE");
  });
});

