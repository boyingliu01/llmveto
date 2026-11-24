import { describe, expect, it } from "vitest";
import { responsesProtocol, RESPONSES_COVERAGE } from "../../../../src/gateway/protocols/responses.ts";
import { buildRequestScanUnit, buildResponseScanUnit } from "../../../../src/gateway/scan-unit.ts";
import type { WireFormat } from "../../../../src/gateway/protocols/types.ts";

// @test REQ-V2bA-01 / AC-V2bA-01a~b / REQ-V2bA-05
// @intent Codex 只说 OpenAI Responses 协议（`wire_api="responses"` 是唯一支持值）。
//         实测（var/probes/scan-unit-probe.mjs）：响应投影为**空字符串**，
//         请求侧只有 tools 进入扫描单元。本切片补齐非流式路径。

const RESPONSES_REQUEST = JSON.stringify({
  model: "gpt-5-codex",
  stream: true,
  store: false,
  instructions: "INSTRUCTIONS-PROBE",
  input: [
    { type: "message", role: "user", content: [{ type: "input_text", text: "USER-PROBE" }] },
    { type: "function_call", role: "assistant", name: "shell", arguments: '{"cmd":"ARGS-PROBE"}', call_id: "c1" },
    { type: "function_call_output", call_id: "c1", output: "TOOLOUT-PROBE" },
  ],
  tools: [{ type: "function", name: "shell", parameters: { type: "object" } }],
});

const RESPONSES_DELTA_FRAMES = [
  { type: "response.output_text.delta", delta: "RESP-TOKEN-PROBE" },
  { type: "response.function_call_arguments.delta", delta: '{"cmd":"RESP-ARGS-PROBE"}' },
];
const RESPONSES_DONE_FRAME = {
  type: "response.function_call_arguments.done",
  name: "shell",
  arguments: '{"cmd":"RESP-DONE-PROBE"}',
};
const RESPONSES_RESPONSE = JSON.stringify({
  object: "response",
  model: "gpt-5-codex",
  output: [
    { type: "reasoning", summary: [{ type: "summary_text", text: "REASONING-PROBE" }] },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "OUTPUT-PROBE" }] },
    { type: "function_call", name: "shell", arguments: '{"cmd":"RESP-ARGS-PROBE"}' },
  ],
  usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
});

const CHAT_FRAME = { choices: [{ delta: { content: "CHAT-TOKEN-PROBE" } }] };
const HEARTBEATS = [{ type: "message_start", message: {} }, { type: "response.created", response: {} }, { type: "ping" }];

function frameText(proto: { readonly format: WireFormat }, frame: Record<string, unknown>): string {
  const u = buildResponseScanUnit(JSON.stringify(frame), frame, null, "stream", {}, { format: proto.format });
  return u.text;
}

describe("SL-03 Responses 非流式投影（REQ-V2bA-01）", () => {
  it("请求侧：instructions / input[] 的用户文本 / function_call.arguments / function_call_output.output 全部进入投影", () => {
    const p = responsesProtocol.projectRequest(JSON.parse(RESPONSES_REQUEST) as Record<string, unknown>);
    const text = p.parts.join("\n");
    for (const probe of ["INSTRUCTIONS-PROBE", "USER-PROBE", "ARGS-PROBE", "TOOLOUT-PROBE"]) {
      expect(text, `must include ${probe}`).toContain(probe);
    }
  });

  it("input 为字符串时也能投影", () => {
    const p = responsesProtocol.projectRequest({ input: "STRING-INPUT-PROBE" });
    expect(p.parts.join("\n")).toContain("STRING-INPUT-PROBE");
  });

  it("响应侧：output[] 的 output_text / function_call.arguments / reasoning summary（改动前整段为空）", () => {
    const p = responsesProtocol.projectResponse(JSON.parse(RESPONSES_RESPONSE) as Record<string, unknown>, "gpt-5-codex");
    const text = p.parts.join("\n");
    for (const probe of ["OUTPUT-PROBE", "RESP-ARGS-PROBE", "REASONING-PROBE"]) {
      expect(text, `must include ${probe}`).toContain(probe);
    }
  });

  it("接入 scan-unit：Responses 请求体与响应体都命中探针", () => {
    const req = buildRequestScanUnit(
      RESPONSES_REQUEST,
      JSON.parse(RESPONSES_REQUEST) as Record<string, unknown>,
      {},
      "stream",
      { format: "openai-responses" },
    );
    for (const probe of ["INSTRUCTIONS-PROBE", "USER-PROBE", "ARGS-PROBE", "TOOLOUT-PROBE"]) {
      expect(req.text, `request must include ${probe}`).toContain(probe);
    }
    const res = buildResponseScanUnit(
      RESPONSES_RESPONSE,
      JSON.parse(RESPONSES_RESPONSE) as Record<string, unknown>,
      "gpt-5-codex",
      "non-stream",
      {},
      { format: "openai-responses" },
    );
    expect(res.text).toContain("OUTPUT-PROBE");
    expect(res.text).toContain("RESP-ARGS-PROBE");
  });

  it("覆盖清单覆盖了 input/output 两个载荷面", () => {
    expect(RESPONSES_COVERAGE.requestPayloadPaths).toContain("input");
    expect(RESPONSES_COVERAGE.responsePayloadPaths.length).toBeGreaterThan(0);
  });
});

describe("SL-04 Responses 流式帧投影（AC-V2bA-01c）", () => {
  it("output_text.delta 帧可见（改动前为空串）", () => {
    expect(frameText(responsesProtocol, RESPONSES_DELTA_FRAMES[0]!)).toContain("RESP-TOKEN-PROBE");
  });

  it("function_call_arguments.delta 帧可见（改动前为空串）", () => {
    expect(frameText(responsesProtocol, RESPONSES_DELTA_FRAMES[1]!)).toContain("RESP-ARGS-PROBE");
  });

  it("…done 汇总帧的完整 arguments 也可见（不能只靠 delta 拼接）", () => {
    expect(frameText(responsesProtocol, RESPONSES_DONE_FRAME)).toContain("RESP-DONE-PROBE");
  });
});

describe("SL-04 心跳帧与对照", () => {
  it("心跳/元数据帧投影为空是合法常态（不触发覆盖降级）", () => {
    for (const frame of HEARTBEATS) {
      const u = buildResponseScanUnit(JSON.stringify(frame), frame, null, "stream", {}, { format: "openai-responses" });
      expect(u.text).toBe("");
      expect(u.meta.derived_text).toBeUndefined();
    }
  });

  it("Chat 流式帧对照：行为未变", () => {
    const u = buildResponseScanUnit(JSON.stringify(CHAT_FRAME), CHAT_FRAME, null, "stream", {});
    expect(u.text).toContain("CHAT-TOKEN-PROBE");
  });

  it("反向探针：把 delta 帧喂给 chat 协议拿不到探针（证明新分支是必需的）", () => {
    const frame0 = RESPONSES_DELTA_FRAMES[0] as Record<string, unknown>;
    const u = buildResponseScanUnit(JSON.stringify(frame0), frame0, null, "stream", {});
    expect(u.text).not.toContain("RESP-TOKEN-PROBE");
  });
});
