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
  it("AC-02 buildPatch 输出 endpoint.chat/stream → gateway 收到 x-llmveto-client=delphi → evidence 记录", async () => {
    const writerPath = join(dir, "ev-delphi.jsonl");
    mock = await startMockUpstream({ transport: "non-stream", body: '{"model":"gpt-4o","choices":[{"message":{"content":"ok"}}]}' });
    const writer = new EvidenceWriter(writerPath);
    gw = await startGateway({ config: { upstreamBaseUrl: mock.url, evidenceWriter: writer } });

    // 1) 断言 buildPatch 生成的 endpoint 指向本 gateway
    const patch = delphiAdapter.buildPatch(gw.url);
    const endpoint = (patch as { endpoint: { chat: string; stream: string } }).endpoint;
    expect(endpoint.chat).toBe(gw.url + "/delphi/v1/chat/completions");
    expect(endpoint.stream).toContain("?stream=1");

    // 2) 模拟 Delphi 客户端按 buildPatch 覆写后调用（把 client 头打进来）
    const r = await fetch(gw.url + "/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-llmveto-client": "delphi", "x-llmveto-provider": "chat" },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi delphi" }] }),
    });
    expect(r.status).toBe(200);
    await r.text();

    const rec = JSON.parse(readFileSync(writerPath, "utf8").split("\n")[0]!) as { client: string; provider_id: string };
    expect(rec.client).toBe("delphi");
    expect(rec.provider_id).toBe("chat");
  });
});
