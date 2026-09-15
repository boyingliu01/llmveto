import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { EvidenceWriter } from "../../src/evidence/writer.ts";
import { startGateway } from "../../src/gateway/server.ts";
import { startMockUpstream, type MockUpstream } from "../utils/mock-upstream.ts";

// @test REQ-VETO-014
// @intent AC-VETO-014-04 流式场景 3（零缓冲命中）：首 chunk 即违规 → event:error + delivered_chunks=0。
// @covers AC-VETO-014-04

let dir: string;
let gw: Awaited<ReturnType<typeof startGateway>> | null = null;
let mock: MockUpstream | null = null;

beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "llmveto-e2e-sc3-")); });
afterEach(async () => {
  if (gw) { await gw.close(); gw = null; }
  if (mock) { await mock.close(); mock = null; }
});

describe("SL-14 e2e: stream scenario 3 (delivered=0, REQ-VETO-014)", () => {
  it("AC-04 首帧 U+200B → delivered_chunks=0 + 后续帧不出现在客户端流", async () => {
    mock = await startMockUpstream({
      transport: "stream",
      chunks: [
        '{"model":"gpt-4o","choices":[{"delta":{"content":"\u200Bevil-first-frame"}}]}',
        '{"model":"gpt-4o","choices":[{"delta":{"content":"should-never-arrive"}}]}',
        '{"model":"gpt-4o","choices":[{"delta":{"content":"nor-this"}}]}',
      ],
    });
    const writerPath = join(dir, "ev-sc3.jsonl");
    const writer = new EvidenceWriter(writerPath);
    gw = await startGateway({ config: { upstreamBaseUrl: mock.url, evidenceWriter: writer } });

    const r = await fetch(gw.url + "/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-llmveto-transport": "stream" },
      body: JSON.stringify({ model: "gpt-4o", stream: true, messages: [{ role: "user", content: "hi" }] }),
    });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toContain("llmveto:veto-mid-stream");
    expect(text).toContain('"delivered_chunks":0');
    expect(text).not.toContain("should-never-arrive");
    expect(text).not.toContain("nor-this");

    const rec = JSON.parse(readFileSync(writerPath, "utf8").split("\n")[0]!) as {
      action_taken: string;
      response_delivered: { partial: boolean; delivered_chunks: number };
    };
    expect(rec.response_delivered.delivered_chunks).toBe(0);
  });
});
