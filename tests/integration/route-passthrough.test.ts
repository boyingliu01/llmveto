import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EvidenceWriter } from "../../src/evidence/writer.ts";
import { startGateway } from "../../src/gateway/server.ts";
import { parseRoute } from "../../src/gateway/server.ts";
import { WIRE_ROUTE_PREFIXES, formatForPrefix } from "../../src/gateway/protocols/registry.ts";
import { startMockUpstream, type MockUpstream } from "../utils/mock-upstream.ts";

// @test REQ-V2bA-04b / AC-V2bA-04b1~2
// @intent 路由前缀是识别权威，同时必须把 rest 与查询串**原样**送到上游。
//         Claude Code 的推理请求是 `POST /v1/messages?beta=true`——查询串丢了就等于请求变形。

let gw: Awaited<ReturnType<typeof startGateway>> | null = null;
let mock: MockUpstream | null = null;
const dir = mkdtempSync(join(tmpdir(), "llmveto-route-"));

afterEach(async () => {
  if (gw) await gw.close();
  if (mock) await mock.close();
  gw = null;
  mock = null;
});

async function boot(): Promise<string> {
  mock = await startMockUpstream({
    transport: "non-stream",
    body: JSON.stringify({ model: "gpt-4o", choices: [{ message: { content: "ok" } }] }),
  });
  const upstream = mock;
  gw = await startGateway({
    config: {
      upstreamBaseUrl: upstream.url,
      evidenceWriter: new EvidenceWriter(join(dir, `ev-${Math.random().toString(36).slice(2)}.jsonl`)),
      upstreams: { "claude/anthropic": upstream.url, "codex/openai": upstream.url },
    },
  });
  return gw.url;
}

describe("SL-06 路由与查询串透传（REQ-V2bA-04b）", () => {
  it("/v1/messages?beta=true 到达上游时路径与查询串完整（AC-V2bA-04b1）", async () => {
    const url = await boot();
    const body = JSON.stringify({ model: "c", max_tokens: 8, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] });
    const r = await fetch(`${url}/claude/anthropic/v1/messages?beta=true`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    await r.text();
    expect(r.status).toBe(200);
    // mock-upstream 记录的 url 必须带完整路径与查询串
    expect(mock!.requests[0]!.url).toContain("/v1/messages");
    expect(mock!.requests[0]!.url).toContain("beta=true");
  });

  it("/v1/responses 路径完整", async () => {
    const url = await boot();
    const body = JSON.stringify({ model: "gpt-5", input: [{ type: "message", content: [{ type: "input_text", text: "hi" }] }] });
    const r = await fetch(`${url}/codex/openai/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    await r.text();
    expect(r.status).toBe(200);
    expect(mock!.requests[0]!.url).toContain("/v1/responses");
  });

  it("新前缀不与保留段 v1/api 或既有客户端名冲突（AC-V2bA-04b2）", () => {
    for (const prefix of WIRE_ROUTE_PREFIXES.keys()) {
      expect(["v1", "api"], `前缀 ${prefix} 撞上了保留段`).not.toContain(prefix);
    }
    // 保留段不作为客户端被解析
    expect(parseRoute("/v1/messages").client).toBeNull();
    // 新前缀各自解析成一个客户端名
    for (const prefix of ["claude", "codex", "promptfoo"]) {
      expect(parseRoute(`/${prefix}/openai/v1/x`).client).toBe(prefix);
      expect(formatForPrefix(prefix)).toBeDefined();
    }
  });
});
