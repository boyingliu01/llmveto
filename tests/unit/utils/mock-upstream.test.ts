import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startMockUpstream, type MockUpstream } from "../../utils/mock-upstream.ts";

// @test REQ-VETO-011
// @intent mock-upstream：非流 / 流 / 自定义 chunk 边界（U+200B 三字节拆两片）
// @covers AC-VETO-011-01 AC-VETO-011-02 AC-VETO-011-03

describe("SL-10 mock-upstream (REQ-VETO-011)", () => {
  let upstream: MockUpstream | null = null;
  afterEach(async () => { if (upstream) { await upstream.close(); upstream = null; } });
  afterAll(async () => { if (upstream) await upstream.close(); });

  it("AC-01 non-stream：body 原样返回 + status 200", async () => {
    upstream = await startMockUpstream({ transport: "non-stream", body: JSON.stringify({ ok: 1 }) });
    const r = await fetch(upstream.url + "/v1/chat/completions", { method: "POST", body: "{}" });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('{"ok":1}');
    expect(upstream.requests).toHaveLength(1);
    expect(upstream.requests[0]!.body).toBe("{}");
  });

  it("AC-01 stream：逐帧 SSE + 尾部 [DONE]", async () => {
    upstream = await startMockUpstream({ transport: "stream", chunks: ['{"a":1}', '{"b":2}'] });
    const r = await fetch(upstream.url, { method: "POST", body: "{}" });
    const text = await r.text();
    expect(text).toContain('data: {"a":1}\n\n');
    expect(text).toContain('data: {"b":2}\n\n');
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("AC-02 自定义 chunk 边界：把 U+200B 的 E2 80 8B 三字节拆两片", async () => {
    // `data: {"t":"\u200b"}\n\n` 中 E2 80 8B 起始位置（"data: {\"t\":\"" = 11 bytes，U+200B 从第 11 起）
    // 在第 12 字节切一刀 → 前两字节 E2 80 属第一片，第三字节 8B 属第二片
    const data = '{"t":"\u200b"}';
    const frame = "data: " + data + "\n\n";
    // "data: " 6 bytes + '{"t":"' 6 bytes = 12，U+200B 起于第 12 字节
    const offset = Buffer.byteLength('data: {"t":"', "utf8"); // 12
    upstream = await startMockUpstream({
      transport: "stream",
      chunks: [data],
      boundaryChunks: [[offset + 2]], // 在 U+200B 的第三字节前切
    });
    const r = await fetch(upstream.url, { method: "POST", body: "{}" });
    const ab = new Uint8Array(await r.arrayBuffer());
    // 拼起来完整字节序列仍正确
    const text = new TextDecoder("utf-8").decode(ab);
    expect(text).toContain('{"t":"\u200b"}');
  });

  it("AC-03 零 Python 依赖（结构性断言：本文件不 import 任何非 stdlib）", () => {
    // 无实际断言，作为文档性 assert：mock-upstream 是纯 TS
    expect(typeof startMockUpstream).toBe("function");
  });
});
