import { describe, expect, it } from "vitest";
import { isAuthHeader, buildRequestScanUnit, buildResponseScanUnit } from "../../../src/gateway/scan-unit.ts";
import { encodeVetoEvent, parseSseFrames, tryParseJson } from "../../../src/gateway/sse-tee.ts";

// @test REQ-VETO-002
// @intent 扫描单元组装 + SSE 帧解析 + veto-mid-stream 契约（AC-VETO-002-06 / AC-VETO-002-03）
// @covers AC-VETO-002-03 AC-VETO-002-06

describe("SL-09 gateway: scan-unit + sse-tee", () => {
  it("AC-06 认证类头名单：6 项", () => {
    expect(isAuthHeader("Authorization")).toBe(true);
    expect(isAuthHeader("X-API-Key")).toBe(true);
    expect(isAuthHeader("api-key")).toBe(true);
    expect(isAuthHeader("x-goog-api-key")).toBe(true);
    expect(isAuthHeader("Proxy-Authorization")).toBe(true);
    expect(isAuthHeader("Cookie")).toBe(true);
    expect(isAuthHeader("X-Request-Id")).toBe(false);
  });

  it("AC-06 extra_headers 里 Authorization 被排除出扫描单元 text", () => {
    const body = JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      extra_headers: { Authorization: "Bearer sk-abcdefghijklmnopqrstuvwxyz", "X-Trace": "abc" },
    });
    const unit = buildRequestScanUnit(body, JSON.parse(body), {}, "non-stream");
    expect(unit.text).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(unit.text).toContain("X-Trace: abc");
    expect(unit.meta.model_requested).toBe("gpt-4o");
  });

  it("edge: 请求 body 非 JSON → text 原样 + malformed=true", () => {
    const u = buildRequestScanUnit("not-json", null, {}, "non-stream");
    expect(u.text).toBe("not-json");
    expect(u.malformed).toBe(true);
  });

  it("AC-03 encodeVetoEvent：event:error + delivered_chunks 契约", () => {
    const s = encodeVetoEvent(7);
    expect(s).toBe('event: error\ndata: {"error":{"code":"llmveto:veto-mid-stream","delivered_chunks":7}}\n\n');
  });

  it("SSE 帧解析：多帧 + 残帧返回", () => {
    const buf = 'data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c":';
    const { frames, rest } = parseSseFrames(buf);
    expect(frames).toHaveLength(2);
    expect(frames[0]!.data).toBe('{"a":1}');
    expect(frames[1]!.data).toBe('{"b":2}');
    expect(rest).toBe('data: {"c":');
  });

  it("[DONE] 帧：data 值原样透传", () => {
    const { frames } = parseSseFrames("data: [DONE]\n\n");
    expect(frames[0]!.data).toBe("[DONE]");
  });

  it("SSE 帧：event: 行 + 多行 data 累加（\\n 分隔）", () => {
    const buf = "event: ping\ndata: line1\ndata: line2\n\ndata: x\n\n";
    const { frames } = parseSseFrames(buf);
    expect(frames).toHaveLength(2);
    expect(frames[0]!.event).toBe("ping");
    expect(frames[0]!.data).toBe("line1\nline2");
    expect(frames[1]!.data).toBe("x");
    expect(frames[1]!.event).toBeUndefined();
  });

  it("tryParseJson：非对象 JSON 返回 null（number / string / null）", () => {
    expect(tryParseJson("42")).toBeNull();
    expect(tryParseJson('"hi"')).toBeNull();
    expect(tryParseJson("null")).toBeNull();
    expect(tryParseJson("{\"a\":1}")).toEqual({ a: 1 });
    // 数组也是 object (typeof === "object")，非 null → 原样返回
    expect(tryParseJson("[1,2]")).toEqual([1, 2]);
  });

  it("buildRequestScanUnit: content 为数组 → 提取每段 .text", () => {
    const body = JSON.stringify({
      model: "m",
      messages: [{ role: "user", content: [{ type: "text", text: "seg-a" }, { type: "text", text: "seg-b" }] }],
      system: "sys-prompt",
      tools: [{ name: "t" }],
    });
    const unit = buildRequestScanUnit(body, JSON.parse(body), {}, "non-stream");
    expect(unit.text).toContain("seg-a");
    expect(unit.text).toContain("seg-b");
    expect(unit.text).toContain("sys-prompt");
    expect(unit.text).toContain("[{\"name\":\"t\"}]");
  });

  it("buildResponseScanUnit: parsed=null → malformed 分支", () => {
    const u = buildResponseScanUnit("not-json", null, "req-model", "stream");
    expect(u.malformed).toBe(true);
    expect(u.direction).toBe("response");
    expect(u.meta.model_requested).toBe("req-model");
  });

  it("buildResponseScanUnit: 流式 delta.content + finish_reason", () => {
    const text = JSON.stringify({
      model: "gpt-4o",
      usage: { total_tokens: 5 },
      choices: [{ delta: { content: "hello" }, finish_reason: "stop" }],
    });
    const u = buildResponseScanUnit(text, JSON.parse(text), "req", "stream");
    expect(u.text).toBe("hello");
    expect(u.meta.model_responded).toBe("gpt-4o");
    expect(u.meta.finish_reason).toBe("stop");
    expect(u.meta.usage).toEqual({ total_tokens: 5 });
  });

  it("buildResponseScanUnit: 非流式 message.content", () => {
    const text = JSON.stringify({
      model: "claude-x",
      choices: [{ message: { content: "world" } }],
    });
    const u = buildResponseScanUnit(text, JSON.parse(text), null, "non-stream");
    expect(u.text).toBe("world");
    expect(u.meta.model_responded).toBe("claude-x");
    expect(u.meta.model_requested).toBeUndefined();
  });

  it("buildResponseScanUnit: choices 内含非对象项 → 跳过（continue 分支）", () => {
    const text = JSON.stringify({ choices: [null, 42, { delta: { content: "ok" } }] });
    const u = buildResponseScanUnit(text, JSON.parse(text), null, "stream");
    expect(u.text).toBe("ok");
  });
});
