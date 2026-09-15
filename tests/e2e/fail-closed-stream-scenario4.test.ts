import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { EvidenceWriter } from "../../src/evidence/writer.ts";
import { startGateway } from "../../src/gateway/server.ts";
import { startMockUpstream, type MockUpstream } from "../utils/mock-upstream.ts";

// @test REQ-VETO-014
// @intent AC-VETO-014-05 流式场景 4（终止流）：前 N-1 帧已 delivered → event:error + terminated_after_delivery。
// @covers AC-VETO-014-05

let dir: string;
let gw: Awaited<ReturnType<typeof startGateway>> | null = null;
let mock: MockUpstream | null = null;

beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "llmveto-e2e-sc4-")); });
afterEach(async () => {
  if (gw) { await gw.close(); gw = null; }
  if (mock) { await mock.close(); mock = null; }
});

describe("SL-14 e2e: stream scenario 4 (terminated after delivery, REQ-VETO-014)", () => {
  it("AC-05 前 2 帧 benign + 第 3 帧 U+200B → delivered_chunks=2 + event:error + action_taken=terminated_after_delivery", async () => {
    mock = await startMockUpstream({
      transport: "stream",
      chunks: [
        '{"model":"gpt-4o","choices":[{"delta":{"content":"a1"}}]}',
        '{"model":"gpt-4o","choices":[{"delta":{"content":"a2"}}]}',
        '{"model":"gpt-4o","choices":[{"delta":{"content":"\u200Ba3-poison"}}]}',
        '{"model":"gpt-4o","choices":[{"delta":{"content":"a4-should-not-arrive"}}]}',
      ],
    });
    const writerPath = join(dir, "ev-sc4.jsonl");
    const writer = new EvidenceWriter(writerPath);
    gw = await startGateway({ config: { upstreamBaseUrl: mock.url, evidenceWriter: writer } });

    const r = await fetch(gw.url + "/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-llmveto-transport": "stream" },
      body: JSON.stringify({ model: "gpt-4o", stream: true, messages: [{ role: "user", content: "hi" }] }),
    });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toContain('"content":"a1"');
    expect(text).toContain('"content":"a2"');
    expect(text).toContain("llmveto:veto-mid-stream");
    expect(text).toContain('"delivered_chunks":2');
    expect(text).not.toContain("a4-should-not-arrive");

    const rec = JSON.parse(readFileSync(writerPath, "utf8").split("\n")[0]!) as {
      action_taken: string;
      response_delivered: { partial: boolean; delivered_chunks: number };
    };
    expect(rec.action_taken).toBe("terminated_after_delivery");
    expect(rec.response_delivered.partial).toBe(true);
    expect(rec.response_delivered.delivered_chunks).toBe(2);
  });
});
