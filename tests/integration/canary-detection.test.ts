import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { EvidenceWriter } from "../../src/evidence/writer.ts";
import { startGateway } from "../../src/gateway/server.ts";
import { startMockUpstream, type MockUpstream } from "../utils/mock-upstream.ts";

// @test REQ-V2a-05 / SL-08
// @intent AC-V2a-06 跨会话串流检出端到端：客户端 A 的 canary 被模型回显给客户端 B → block。
//         单请求内复述自身 canary 不命中（负样本，FP=0 保证）。

let dir: string;
let mock: MockUpstream | null = null;
let gw: Awaited<ReturnType<typeof startGateway>> | null = null;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "llmveto-canary-detect-"));
});
afterEach(async () => {
  if (gw) { await gw.close(); gw = null; }
  if (mock) { await mock.close(); mock = null; }
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const SESSION_HEADER = "x-llmveto-session-id";

interface ParsedRecord {
  readonly findings: readonly { checker: string; verdict: string; rule_id?: string }[];
  readonly action_taken: string;
}
function readEvidenceLines(path: string): readonly ParsedRecord[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as unknown as ParsedRecord);
}
async function waitForEvidence(path: string, count = 1): Promise<readonly ParsedRecord[]> {
  for (let i = 0; i < 250; i++) {
    const lines = readEvidenceLines(path);
    if (lines.length >= count) return lines;
    await new Promise((r) => setTimeout(r, 20));
  }
  return readEvidenceLines(path);
}

const chatBody = (content: string): string =>
  JSON.stringify({ model: "m", messages: [{ role: "user", content }] });

async function postManaged(g: { url: string }, body: string, session: string): Promise<Response> {
  return fetch(`${g.url}/opencode/mock/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [SESSION_HEADER]: session,
    },
    body,
  });
}

describe("SL-08 integration: AC-V2a-06 跨会话串流检出端到端", () => {
  it("客户端 A 的 canary 被模型回显给客户端 B → block（T1a 安全类）", async () => {
    // 步骤 1：客户端 A 正常请求，分配 canary_A
    mock = await startMockUpstream({ transport: "non-stream", body: JSON.stringify({ model: "m", choices: [{ message: { role: "assistant", content: "ok" } }] }) });
    const evidencePath = join(dir, "ev.jsonl");
    gw = await startGateway({
      config: {
        upstreamBaseUrl: mock!.url,
        evidenceWriter: new EvidenceWriter(evidencePath),
        canaryRegistryPath: join(dir, "registry.json"),
      },
    });

    const rA = await postManaged(gw, chatBody("hello from A"), "sess-A");
    expect(rA.status).toBe(200);
    await rA.text();

    // 步骤 2：读取 registry，获取 canary_A
    const registry = JSON.parse(readFileSync(join(dir, "registry.json"), "utf8")) as {
      entries: Record<string, { canary: string }>;
    };
    const canaryA = registry.entries["sess-A"]!.canary;
    expect(canaryA).toBeDefined();
    expect(canaryA).toHaveLength(27);

    // 步骤 3：客户端 B 请求，模型响应中包含 canary_A（跨会话泄漏场景）
    const responseWithLeak = JSON.stringify({
      model: "m",
      choices: [{ message: { role: "assistant", content: `leaked: ${canaryA}` } }],
    });
    await mock!.close();
    mock = await startMockUpstream({ transport: "non-stream", body: responseWithLeak });
    await gw!.close();
    gw = await startGateway({
      config: {
        upstreamBaseUrl: mock!.url,
        evidenceWriter: new EvidenceWriter(evidencePath),
        canaryRegistryPath: join(dir, "registry.json"),
      },
    });

    const rB = await postManaged(gw, chatBody("hello from B"), "sess-B");
    expect(rB.status).toBe(502); // T1a finding → block

    // 验证 evidence：finding + action_taken=blocked_before_deliver
    const recs = await waitForEvidence(evidencePath, 2);
    const recB = recs.find((r) => r.action_taken === "blocked_before_deliver");
    expect(recB).toBeDefined();
    expect(recB!.findings.some((f) => f.checker === "canary-return-scan" && f.verdict === "finding")).toBe(true);
    expect(recB!.findings.some((f) => f.rule_id === "canary-detected-in-response")).toBe(true);
  });

  it("负样本：单请求内复述自身 canary → 不命中（自排除保证 FP=0）", async () => {
    mock = await startMockUpstream({ transport: "non-stream", body: JSON.stringify({ model: "m", choices: [{ message: { role: "assistant", content: "ok" } }] }) });
    const evidencePath = join(dir, "ev-fp.jsonl");
    gw = await startGateway({
      config: {
        upstreamBaseUrl: mock!.url,
        evidenceWriter: new EvidenceWriter(evidencePath),
        canaryRegistryPath: join(dir, "registry-fp.json"),
      },
    });

    // sess-C 的请求，响应中回显自身的 canary（正常行为，不应触发）
    const rC = await postManaged(gw, chatBody("echo my canary"), "sess-C");
    expect(rC.status).toBe(200); // 不被阻断
    await rC.text();

    // 读取 registry 获取 canary_C
    const registry = JSON.parse(readFileSync(join(dir, "registry-fp.json"), "utf8")) as {
      entries: Record<string, { canary: string }>;
    };
    const canaryC = registry.entries["sess-C"]!.canary;

    // 模拟模型回显 canary_C
    const responseWithOwnCanary = JSON.stringify({
      model: "m",
      choices: [{ message: { role: "assistant", content: `your canary is ${canaryC}` } }],
    });
    await mock!.close();
    mock = await startMockUpstream({ transport: "non-stream", body: responseWithOwnCanary });
    await gw!.close();
    gw = await startGateway({
      config: {
        upstreamBaseUrl: mock!.url,
        evidenceWriter: new EvidenceWriter(evidencePath),
        canaryRegistryPath: join(dir, "registry-fp.json"),
      },
    });

    const rC2 = await postManaged(gw, chatBody("show my canary"), "sess-C");
    expect(rC2.status).toBe(200); // 不被阻断（自排除）
    await rC2.text();

    const recs = await waitForEvidence(evidencePath, 2);
    const recC2 = recs[recs.length - 1];
    expect(recC2!.action_taken).toBe("allowed"); // 无 finding
    expect(recC2!.findings.some((f) => f.checker === "canary-return-scan")).toBe(false);
  });
});
