import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { EvidenceWriter } from "../../src/evidence/writer.ts";
import { startGateway } from "../../src/gateway/server.ts";
import { MANAGED_CONFIG_IDS as OPENCODE_IDS } from "../../src/adapters/opencode.ts";
import { MANAGED_CONFIG_IDS as DELPHI_IDS } from "../../src/adapters/delphi.ts";
import { startMockUpstream, type MockUpstream } from "../utils/mock-upstream.ts";

// @test REQ-VETO-014
// @intent AC-VETO-014-01 受管路径过闸：harness 遍历 MANAGED_CONFIG_IDS 每条回放 ≥1 探测，
//         evidence 中必须出现对应 client + provider_id。零缓冲 / 零旁路。
// @covers AC-VETO-014-01

let dir: string;
let gw: Awaited<ReturnType<typeof startGateway>> | null = null;
let mock: MockUpstream | null = null;
let writerPath: string;

beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "llmveto-e2e-probe-")); });
afterEach(async () => {
  if (gw) { await gw.close(); gw = null; }
  if (mock) { await mock.close(); mock = null; }
});

async function boot() {
  mock = await startMockUpstream({ transport: "non-stream", body: '{"model":"gpt-4o","choices":[{"message":{"content":"ok"}}]}' });
  writerPath = join(dir, "ev-" + Math.random().toString(36).slice(2) + ".jsonl");
  const writer = new EvidenceWriter(writerPath);
  gw = await startGateway({ config: { upstreamBaseUrl: mock.url, evidenceWriter: writer } });
  return gw;
}

function providerOf(configId: string): string {
  // "opencode.provider.openai.options.baseURL" → "openai"
  // "delphi.endpoint.chat"                     → "chat"
  const parts = configId.split(".");
  return parts[2] ?? "unknown";
}

function clientOf(configId: string): string {
  return configId.split(".")[0]!; // "opencode" | "delphi"
}

async function probeOnce(gatewayUrl: string, configId: string): Promise<void> {
  const r = await fetch(gatewayUrl + "/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-llmveto-client": clientOf(configId),
      "x-llmveto-provider": providerOf(configId),
    },
    body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: `probe ${configId}` }] }),
  });
  if (r.status !== 200) throw new Error(`probe ${configId} expected 200, got ${r.status}`);
  await r.text();
}

function readRecords(): { client: string; provider_id: string }[] {
  return readFileSync(writerPath, "utf8")
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as { client: string; provider_id: string });
}

describe("SL-14 e2e: managed-path probe (REQ-VETO-014)", () => {
  it("AC-01 OpenCode 4 条 MANAGED_CONFIG_IDS 各自探测 → evidence 出现 client+provider_id", async () => {
    const g = await boot();
    for (const id of OPENCODE_IDS) await probeOnce(g.url, id.id);
    const recs = readRecords();
    expect(recs.length).toBe(OPENCODE_IDS.length);
    for (const id of OPENCODE_IDS) {
      expect(recs.some((r) => r.client === "opencode" && r.provider_id === providerOf(id.id))).toBe(true);
    }
  });

  it("AC-01 Delphi 2 条 MANAGED_CONFIG_IDS 各自探测 → evidence 出现 client=delphi", async () => {
    const g = await boot();
    for (const id of DELPHI_IDS) await probeOnce(g.url, id.id);
    const recs = readRecords();
    expect(recs.length).toBe(DELPHI_IDS.length);
    for (const r of recs) expect(r.client).toBe("delphi");
  });
});
