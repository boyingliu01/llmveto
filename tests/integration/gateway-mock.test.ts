import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { EvidenceWriter } from "../../src/evidence/writer.ts";
import { startGateway } from "../../src/gateway/server.ts";
import { startMockUpstream, type MockUpstream } from "../utils/mock-upstream.ts";

// @test REQ-VETO-002
// @intent 反代核 + mock-upstream 集成：请求侧阻断 / 响应侧阻断 / 流式终止 / 认证头排除
// @covers AC-VETO-002-02 AC-VETO-002-03 AC-VETO-002-04 AC-VETO-002-05 AC-VETO-002-06

let dir: string;
let mock: MockUpstream | null = null;
let gw: Awaited<ReturnType<typeof startGateway>> | null = null;

beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "llmveto-integration-")); });
afterEach(async () => {
  if (gw) { await gw.close(); gw = null; }
  if (mock) { await mock.close(); mock = null; }
});
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

async function boot(opts: { upstream: MockUpstream }) {
  const writer = new EvidenceWriter(join(dir, "ev-" + Math.random().toString(36).slice(2) + ".jsonl"));
  gw = await startGateway({
    config: { upstreamBaseUrl: opts.upstream.url, evidenceWriter: writer },
  });
  return gw;
}

describe("SL-09+SL-10 integration: gateway ⇄ mock-upstream", () => {
  it("AC-06 请求侧阻断：body 含凭据 → 502 llmveto:rejected；mock-upstream 未收到", async () => {
    mock = await startMockUpstream({ transport: "non-stream", body: '{"ok":true}' });
    const g = await boot({ upstream: mock });
    const r = await fetch(g.url + "/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: "leak sk-abcdefghijklmnopqrstuvwxyz" }],
      }),
    });
    expect(r.status).toBe(502);
    const body = await r.text();
    expect(body).toContain("llmveto:rejected");
    expect(mock.requests).toHaveLength(0);
  });

  it("AC-06 认证头 benign：Authorization 头里的 sk- 不进扫描单元 → 200", async () => {
    mock = await startMockUpstream({ transport: "non-stream", body: '{"model":"gpt-4o","choices":[{"message":{"content":"hi"}}]}' });
    const g = await boot({ upstream: mock });
    const r = await fetch(g.url + "/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer sk-abcdefghijklmnopqrstuvwxyz",
      },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hello" }] }),
    });
    expect(r.status).toBe(200);
    expect(mock.requests).toHaveLength(1);
  });

  it("AC-04 流式响应含 U+200B → 终止流：event:error + delivered_chunks", async () => {
    mock = await startMockUpstream({
      transport: "stream",
      chunks: [
        '{"model":"gpt-4o","choices":[{"delta":{"content":"hello"}}]}',
        '{"model":"gpt-4o","choices":[{"delta":{"content":"\u200Bsecret"}}]}',
        '{"model":"gpt-4o","choices":[{"delta":{"content":"never"}}]}',
      ],
    });
    const g = await boot({ upstream: mock });
    const r = await fetch(g.url + "/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-llmveto-transport": "stream" },
      body: JSON.stringify({ model: "gpt-4o", stream: true, messages: [{ role: "user", content: "hi" }] }),
    });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toContain("llmveto:veto-mid-stream");
    expect(text).not.toContain("never");
  });

  it("AC-04 流式场景 3：首 chunk 命中 → delivered_chunks=0", async () => {
    mock = await startMockUpstream({
      transport: "stream",
      chunks: [
        '{"model":"gpt-4o","choices":[{"delta":{"content":"\u200B"}}]}',
        '{"model":"gpt-4o","choices":[{"delta":{"content":"never"}}]}',
      ],
    });
    const g = await boot({ upstream: mock });
    const r = await fetch(g.url + "/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-llmveto-transport": "stream" },
      body: JSON.stringify({ model: "gpt-4o", stream: true, messages: [{ role: "user", content: "hi" }] }),
    });
    const text = await r.text();
    expect(text).toContain('"delivered_chunks":0');
    expect(text).not.toContain("hello");
  });

  it("AC-04 benign 流式：无违规 → 全部帧透传 + [DONE]", async () => {
    mock = await startMockUpstream({
      transport: "stream",
      chunks: [
        '{"model":"gpt-4o","choices":[{"delta":{"content":"a"}}]}',
        '{"model":"gpt-4o","choices":[{"delta":{"content":"b"}}]}',
      ],
    });
    const g = await boot({ upstream: mock });
    const r = await fetch(g.url + "/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-llmveto-transport": "stream" },
      body: JSON.stringify({ model: "gpt-4o", stream: true, messages: [{ role: "user", content: "hi" }] }),
    });
    const text = await r.text();
    expect(text).toContain('"content":"a"');
    expect(text).toContain('"content":"b"');
    expect(text).toContain("[DONE]");
    expect(text).not.toContain("veto-mid-stream");
  });

  it("AC-04 body stream:true 但上游回非 SSE JSON → 响应仍被扫描：恶意内容不透传（R2-N1 变体）", async () => {
    mock = await startMockUpstream({
      transport: "non-stream",
      body: '{"model":"gpt-4o","choices":[{"message":{"content":"ok\u200Bleak-marker"}}]}',
    });
    const g = await boot({ upstream: mock });
    const r = await fetch(g.url + "/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", stream: true, messages: [{ role: "user", content: "hi" }] }),
    });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain("leak-marker");
    expect(text).toContain("llmveto:veto-mid-stream");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SL-01（AC-V2a-01）：tool-call arguments 扫描路径经网关验证。
// v1 缺陷：流式管线逐帧扫描——OpenAI 协议把 arguments 按任意切点分片进不同 SSE 帧
// （delta.tool_calls[*].function.arguments 增量拼接），隐形字符的字面转义被帧边界
// 切开时任一单帧均无完整命中（漏检面本体）。修法：网关按 tool_call index 跨帧
// 归并片段，归并完成后再进扫描域（不能逐 chunk 扫碎片）。
// ─────────────────────────────────────────────────────────────────────────────
describe("SL-01 integration: tool-call arguments 扫描路径（AC-V2a-01）", () => {
  it("U+200B 转义序列跨帧切开藏于 delta.tool_calls arguments → 归并后检出并终止流（命中帧起不交付）", async () => {
    // 帧内 arguments 各自是合法 JSON（转义序列 6 字符被 5/1 切开），逐帧扫描均 clean；
    // 重组后才含完整 \u200b 字面转义 → decoded 投影命中
    const f1 = JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "run_shell", arguments: '{"cmd":"echo \\u200' } }] } }] });
    const f2 = JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'b.png"}' } }] } }] });
    mock = await startMockUpstream({
      transport: "stream",
      chunks: [f1, f2, '{"choices":[{"delta":{"content":"tail-marker"}}]}'],
    });
    const g = await boot({ upstream: mock });
    const r = await fetch(g.url + "/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-llmveto-transport": "stream" },
      body: JSON.stringify({ model: "gpt-4o", stream: true, messages: [{ role: "user", content: "hi" }] }),
    });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toContain("llmveto:veto-mid-stream");
    expect(text).not.toContain("tail-marker"); // f2 归并命中 → f2 及其后帧不交付
    expect(text).not.toContain("b.png");
    expect(text).not.toContain("[DONE]");
  });

  it("非流式 message.tool_calls arguments 藏真实 U+200B → 502 空体阻断", async () => {
    mock = await startMockUpstream({
      transport: "non-stream",
      body: JSON.stringify({
        model: "gpt-4o",
        choices: [{
          message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "run_shell", arguments: '{"cmd":"echo a\u200Bb"}' } }] },
          finish_reason: "tool_calls",
        }],
      }),
    });
    const g = await boot({ upstream: mock });
    const r = await fetch(g.url + "/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(r.status).toBe(502);
    expect(await r.text()).toBe("");
  });

  it("benign 流式工具调用（arguments 跨帧分片）→ 全帧透传 + [DONE]（归并零误报）", async () => {
    mock = await startMockUpstream({
      transport: "stream",
      chunks: [
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "run_shell", arguments: '{"cmd":"ls -' } }] } }] }),
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'la /tmp"}' } }] } }] }),
      ],
    });
    const g = await boot({ upstream: mock });
    const r = await fetch(g.url + "/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-llmveto-transport": "stream" },
      body: JSON.stringify({ model: "gpt-4o", stream: true, messages: [{ role: "user", content: "hi" }] }),
    });
    const text = await r.text();
    expect(text).toContain("la /tmp");
    expect(text).toContain("[DONE]");
    expect(text).not.toContain("veto-mid-stream");
  });
});
