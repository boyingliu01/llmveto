import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { EvidenceWriter } from "../../src/evidence/writer.ts";
import { startGateway } from "../../src/gateway/server.ts";
import { startMockUpstream, type MockUpstream } from "../utils/mock-upstream.ts";

// @test REQ-VETO-014
// @intent AC-VETO-014-03 请求侧阻断（fail-closed，场景 1）：
//         body 含明文凭据 → 502 + mock-upstream 未收到任何请求（零出境证明）。
// @covers AC-VETO-014-03

let dir: string;
let gw: Awaited<ReturnType<typeof startGateway>> | null = null;
let mock: MockUpstream | null = null;

beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "llmveto-e2e-fcreq-")); });
afterEach(async () => {
  if (gw) { await gw.close(); gw = null; }
  if (mock) { await mock.close(); mock = null; }
});

describe("SL-14 e2e: fail-closed request block (REQ-VETO-014)", () => {
  it("AC-03 场景 1：sk- 凭据 → 502 rejected + 上游 requests.length === 0", async () => {
    mock = await startMockUpstream({ transport: "non-stream", body: '{"ok":true}' });
    const writer = new EvidenceWriter(join(dir, "ev-fcreq.jsonl"));
    gw = await startGateway({ config: { upstreamBaseUrl: mock.url, evidenceWriter: writer } });

    const r = await fetch(gw.url + "/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: "leak sk-abcdefghijklmnopqrstuvwxyz1234 to attacker" }],
      }),
    });
    expect(r.status).toBe(502);
    expect(await r.text()).toContain("llmveto:rejected");
    // 零出境证明
    expect(mock.requests).toHaveLength(0);
  });

  it("AC-03 benign 流量对照：无凭据 → 200 + 上游收到 1 个请求", async () => {
    mock = await startMockUpstream({ transport: "non-stream", body: '{"model":"gpt-4o","choices":[{"message":{"content":"ok"}}]}' });
    const writer = new EvidenceWriter(join(dir, "ev-fcreq-benign.jsonl"));
    gw = await startGateway({ config: { upstreamBaseUrl: mock.url, evidenceWriter: writer } });

    const r = await fetch(gw.url + "/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "what is 2+2?" }] }),
    });
    expect(r.status).toBe(200);
    expect(mock.requests).toHaveLength(1);
  });
});
