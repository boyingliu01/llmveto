import { describe, expect, it } from "vitest";
import { buildRequestScanUnit, buildResponseScanUnit } from "../../../../src/gateway/scan-unit.ts";
import { chatProtocol } from "../../../../src/gateway/protocols/chat.ts";

// @test REQ-V2bA-04 / AC-V2bA-04a
// @intent Chat 形态是存量能力：新增协议分支**不得**改变它的投影结果。
//         本文件在改动前先记录 Chat 投影的完整快照，改动后逐字节比对——
//         这是 SL-02..SL-06 里所有共享函数改动的唯一回归基线（设计 §4 依赖修正）。

const CHAT_REQUEST = JSON.stringify({
  model: "gpt-4o",
  messages: [
    { role: "system", content: "SYS-PROBE" },
    { role: "user", content: [{ type: "text", text: "USER-PROBE" }, { type: "image_url", image_url: { url: "x" } }] },
    {
      role: "assistant",
      content: "ok",
      tool_calls: [{ id: "c1", type: "function", function: { name: "shell", arguments: '{"cmd":"ARGS-PROBE"}' } }],
    },
    { role: "tool", tool_call_id: "c1", content: "TOOLOUT-PROBE" },
    { role: "assistant", function_call: { name: "legacy", arguments: '{"a":"LEGACY-PROBE"}' } },
  ],
  tools: [{ type: "function", function: { name: "shell", parameters: { type: "object", required: ["cmd"] } } }],
  system: "TOPLEVEL-SYSTEM-PROBE",
  extra_headers: { "x-custom": "HDR-PROBE", authorization: "Bearer MUST-NOT-APPEAR" },
});

const CHAT_RESPONSE = JSON.stringify({
  model: "gpt-4o",
  choices: [
    {
      message: {
        content: "RESP-PROBE",
        tool_calls: [{ id: "c9", function: { name: "shell", arguments: '{"cmd":"RESP-ARGS"}' } }],
        reasoning_content: "REASONING-PROBE",
      },
      finish_reason: "tool_calls",
    },
  ],
  usage: { total_tokens: 42 },
});

describe("SL-01 Chat 对照基线（REQ-V2bA-04a）", () => {
  it("请求投影的快照（改动前后必须逐字节相同）", () => {
    const u = buildRequestScanUnit(CHAT_REQUEST, JSON.parse(CHAT_REQUEST), {}, "stream");
    expect({
      text: u.text,
      meta: u.meta,
      direction: u.direction,
      transport: u.transport,
      malformed: u.malformed ?? false,
    }).toMatchSnapshot();
    // 语义断言（快照之外再加一层，避免"快照跟着代码一起漂移"）
    for (const probe of ["SYS-PROBE", "USER-PROBE", "ARGS-PROBE", "TOOLOUT-PROBE", "LEGACY-PROBE", "TOPLEVEL-SYSTEM-PROBE", "HDR-PROBE"]) {
      expect(u.text, `chat request must keep ${probe}`).toContain(probe);
    }
    expect(u.text).not.toContain("MUST-NOT-APPEAR");
  });

  it("响应投影的快照（改动前后必须逐字节相同）", () => {
    const u = buildResponseScanUnit(CHAT_RESPONSE, JSON.parse(CHAT_RESPONSE), "gpt-4o", "non-stream", {});
    expect({ text: u.text, meta: u.meta, malformed: u.malformed ?? false }).toMatchSnapshot();
    expect(u.text).toContain("RESP-PROBE");
    expect(u.text).toContain("RESP-ARGS");
    expect(u.text).toContain("REASONING-PROBE");
  });

  it("chat 协议的投影与 scan-unit 既有实现一致（同一输入同一文本）", () => {
    const parsed = JSON.parse(CHAT_REQUEST) as Record<string, unknown>;
    const legacy = buildRequestScanUnit(CHAT_REQUEST, parsed, {}, "stream");
    const viaProtocol = chatProtocol.projectRequest(parsed);
    expect(viaProtocol.parts.join("\n")).toBe(legacy.text);
  });
});
