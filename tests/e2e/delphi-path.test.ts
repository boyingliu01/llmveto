import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { EvidenceWriter } from "../../src/evidence/writer.ts";
import { startGateway } from "../../src/gateway/server.ts";
import { delphiAdapter } from "../../src/adapters/delphi.ts";
import { startMockUpstream, type MockUpstream } from "../utils/mock-upstream.ts";

// @test REQ-VETO-014
// @intent AC-VETO-014-02 Delphi 覆写路径：Delphi 客户端配置指向网关 → client='delphi' 在 evidence 可观测。
// @covers AC-VETO-014-02

let dir: string;
let gw: Awaited<ReturnType<typeof startGateway>> | null = null;
let mock: MockUpstream | null = null;

beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "llmveto-e2e-delphi-")); });
afterEach(async () => {
  if (gw) { await gw.close(); gw = null; }
  if (mock) { await mock.close(); mock = null; }
});

describe("SL-14 e2e: delphi managed path (REQ-VETO-014)", () => {
  it("AC-02 buildPatch 输出 endpoint.chat/stream → 按产物 URL 发起 → 路径推导 client=delphi 入 evidence", async () => {
    const writerPath = join(dir, "ev-delphi.jsonl");
    mock = await startMockUpstream({ transport: "non-stream", body: '{"model":"gpt-4o","choices":[{"message":{"content":"ok"}}]}' });
    const writer = new EvidenceWriter(writerPath);
    gw = await startGateway({ config: { upstreamBaseUrl: mock.url, evidenceWriter: writer } });

    // 1) 断言 buildPatch 生成的 endpoint 指向本 gateway（路径路由约定：带 provider 段）
    const patch = delphiAdapter.buildPatch(gw.url);
    const endpoint = (patch as { endpoint: { chat: string; stream: string } }).endpoint;
    expect(endpoint.chat).toBe(gw.url + "/delphi/default/v1/chat/completions");
    expect(endpoint.stream).toContain("?stream=1");

    // 2) 真实客户端不会打 x-llmveto-* 头：直接按 buildPatch 产物 URL 发起，身份由路径推导
    const r = await fetch(endpoint.chat, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi delphi" }] }),
    });
    expect(r.status).toBe(200);
    await r.text();

    const rec = JSON.parse(readFileSync(writerPath, "utf8").split("\n")[0]!) as { client: string; provider_id: string; endpoint_host: string };
    expect(rec.client).toBe("delphi");
    expect(rec.provider_id).toBe("default");
    // endpoint_host 从解析后的 upstream URL 提取（M1.3：不再恒为 unknown）
    expect(rec.endpoint_host).toBe(new URL(mock.url).host);
  });

  it("AC-02 endpoint.stream（?stream=1，body 无 stream:true）→ 流式扫描生效：中段命中终止流（R1-A2 回归）", async () => {
    // 真实 Delphi 客户端靠 endpoint URL 的 ?stream=1 选流式，body 不含 `"stream":true`；
    // 修复前 core 层自行从 body 重判 → 误判 non-stream → 缓冲整段 + 502 blocked_before_deliver。
    const writerPath = join(dir, "ev-delphi-stream.jsonl");
    mock = await startMockUpstream({
      transport: "stream",
      chunks: [
        '{"model":"gpt-4o","choices":[{"delta":{"content":"clean-1"}}]}',
        '{"model":"gpt-4o","choices":[{"delta":{"content":"\u200Bevil-mid"}}]}',
        '{"model":"gpt-4o","choices":[{"delta":{"content":"never-arrives"}}]}',
      ],
    });
    const writer = new EvidenceWriter(writerPath);
    gw = await startGateway({ config: { upstreamBaseUrl: mock.url, evidenceWriter: writer } });

    const patch = delphiAdapter.buildPatch(gw.url);
    const endpoint = (patch as { endpoint: { chat: string; stream: string } }).endpoint;
    const r = await fetch(endpoint.stream, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi delphi stream" }] }),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/event-stream");
    const text = await r.text();
    expect(text).toContain('"content":"clean-1"'); // 已交付字节保留（v1 流式阻断 = 终止流，不撤回）
    expect(text).toContain("llmveto:veto-mid-stream");
    expect(text).toContain('"delivered_chunks":1');
    expect(text).not.toContain("evil-mid"); // 命中帧本身不转发
    expect(text).not.toContain("never-arrives");

    const rec = JSON.parse(readFileSync(writerPath, "utf8").split("\n")[0]!) as {
      transport: string;
      action_taken: string;
      response_delivered: { partial: boolean; delivered_chunks: number };
    };
    expect(rec.transport).toBe("stream");
    expect(rec.action_taken).toBe("terminated_after_delivery");
    expect(rec.response_delivered.delivered_chunks).toBe(1);
    // 查询串随路径转发到 upstream（R2-N1 根因①：`?stream=1` 不再被剥离）
    expect(mock.requests[0]!.url).toBe("/v1/chat/completions?stream=1");
  });

  it("AC-02 endpoint.stream + 上游按 body 判模态回 JSON（非 SSE）→ 响应仍被扫描：恶意内容不透传（R2-N1 回归）", async () => {
    // 修复前：transport=stream 且上游回非 SSE JSON 时，内容经 EOF 残尾/非 data: 帧直通，
    // 响应侧 checker 全部落空 → U+200B 免检到达客户端且 evidence 记 allowed（假清洁）。
    const writerPath = join(dir, "ev-delphi-nonmod.jsonl");
    mock = await startMockUpstream({
      transport: "non-stream",
      body: JSON.stringify({ model: "gpt-4o", choices: [{ message: { content: "ok\u200Bhidden-secret" }, finish_reason: "stop" }] }),
    });
    const writer = new EvidenceWriter(writerPath);
    gw = await startGateway({ config: { upstreamBaseUrl: mock.url, evidenceWriter: writer } });

    const patch = delphiAdapter.buildPatch(gw.url);
    const endpoint = (patch as { endpoint: { chat: string; stream: string } }).endpoint;
    const r = await fetch(endpoint.stream, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi delphi" }] }),
    });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain("hidden-secret"); // 命中内容不得透传
    expect(text).toContain("llmveto:veto-mid-stream");
    expect(mock.requests).toHaveLength(1); // 请求侧本就放行，已到达上游

    const rec = JSON.parse(readFileSync(writerPath, "utf8").split("\n")[0]!) as {
      transport: string;
      action_taken: string;
      response_delivered: { partial: boolean; delivered_chunks: number };
      findings: { checker: string }[];
    };
    expect(rec.transport).toBe("stream");
    expect(rec.action_taken).toBe("terminated_after_delivery");
    expect(rec.response_delivered.delivered_chunks).toBe(0);
    expect(rec.findings.some((f) => f.checker === "invisible-unicode-scan")).toBe(true); // 非假清洁审计
  });

  it("AC-02 endpoint.stream + 上游 JSON 体含空行（拆成非 data: 帧）→ 逐帧扫描，命中帧不转发", async () => {
    const writerPath = join(dir, "ev-delphi-nonmod2.jsonl");
    mock = await startMockUpstream({
      transport: "non-stream",
      body: '{"model":"gpt-4o","choices":[{"message":{"content":"ok-1"}}]}\n\n{"model":"gpt-4o","choices":[{"message":{"content":"\u200Bevil-2"}}]}\n\n',
    });
    const writer = new EvidenceWriter(writerPath);
    gw = await startGateway({ config: { upstreamBaseUrl: mock.url, evidenceWriter: writer } });

    const patch = delphiAdapter.buildPatch(gw.url);
    const endpoint = (patch as { endpoint: { chat: string; stream: string } }).endpoint;
    const r = await fetch(endpoint.stream, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi delphi" }] }),
    });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toContain("ok-1"); // 首个 benign 非 data: 帧正常交付
    expect(text).not.toContain("evil-2");
    expect(text).toContain("llmveto:veto-mid-stream");
  });

  it("AC-02 endpoint.stream + 上游 4xx → content-type=application/json（R2 评审 A-N-1 回归）", async () => {
    mock = await startMockUpstream({ transport: "non-stream", body: '{"error":"unauthorized"}', status: 401 });
    const writer = new EvidenceWriter(join(dir, "ev-delphi-401.jsonl"));
    gw = await startGateway({ config: { upstreamBaseUrl: mock.url, evidenceWriter: writer } });

    const patch = delphiAdapter.buildPatch(gw.url);
    const endpoint = (patch as { endpoint: { chat: string; stream: string } }).endpoint;
    const r = await fetch(endpoint.stream, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi delphi" }] }),
    });
    expect(r.status).toBe(401);
    expect(r.headers.get("content-type")).toBe("application/json"); // 无 sse → 不得标 SSE
    expect(await r.text()).toBe('{"error":"unauthorized"}');
  });
});
