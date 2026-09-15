import { describe, expect, it } from "vitest";
import { isAuthHeader, buildRequestScanUnit } from "../../../src/gateway/scan-unit.ts";
import { encodeVetoEvent, parseSseFrames } from "../../../src/gateway/sse-tee.ts";

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
});
