import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EvidenceWriter } from "../../src/evidence/writer.ts";
import { startGateway } from "../../src/gateway/server.ts";
import { parseRoute } from "../../src/gateway/server.ts";
import { WIRE_ROUTE_PREFIXES, formatForPrefix } from "../../src/gateway/protocols/registry.ts";
import { startMockUpstream, type MockUpstream } from "../utils/mock-upstream.ts";
import { gzipSync } from "node:zlib";

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

// @test REQ-V2bA-15（code-walkthrough R6 / GLM 席 M1 回归）
// @intent 查询串是**另一条**出境通道：`?api_key=%73k%2Dant%2D…` 在 body 里没有任何字面凭据字符，
//         而 HTTP 语义下资源端会 percent-decode 它。形状判定只看 body，因此必须在 server 层单独处理。
describe("SL-06 查询串里的编码凭据（R6 M1 回归）", () => {
  it("percent-encoded 凭据放在 query → 阻断且上游 0 请求", async () => {
    const url = await boot();
    const token = /ghp_[A-Za-z0-9]{36}/.exec(
      readFileSync(join(import.meta.dirname, "..", "fixtures", "threats", "T1b", "secrets.yaml"), "utf8"),
    )![0];
    const r = await fetch(`${url}/claude/anthropic/v1/messages?api_key=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "c", max_tokens: 8, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }),
    });
    await r.text();
    expect(r.status).toBe(502);
    expect(mock!.requests).toHaveLength(0);
  });

  it("path 段里的 percent-encoded 凭据 → 同样阻断（与 query 同构，GLM 终审指出）", async () => {
    const url = await boot();
    const token = /ghp_[A-Za-z0-9]{36}/.exec(
      readFileSync(join(import.meta.dirname, "..", "fixtures", "threats", "T1b", "secrets.yaml"), "utf8"),
    )![0];
    const r = await fetch(`${url}/claude/anthropic/v1/messages/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "c", max_tokens: 8, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }),
    });
    await r.text();
    expect(r.status).toBe(502);
    expect(mock!.requests).toHaveLength(0);
  });

  it("对照：普通查询串（如 ?beta=true）照常透传", async () => {
    const url = await boot();
    const r = await fetch(`${url}/claude/anthropic/v1/messages?beta=true`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "c", max_tokens: 8, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }),
    });
    await r.text();
    expect(r.status).toBe(200);
  });
});

// @test REQ-V2bA-15（code-walkthrough 终审 / GLM 席 C-1 回归）
// @intent 传输层压缩体是**第三条**出境通道：gzip 字节对任何文本域变换都是乱码，
//         而上游栈会自动解压。网关不还原就等于"扫了空气"——实测曾放行并到达上游。
//         受管路由上无法还原的传输编码一律 fail-closed。
describe("SL-06 传输层压缩体（终审 C-1 回归）", () => {
  it("gzip 压缩体带凭据 → 阻断且上游 0 请求", async () => {
    const url = await boot();
    const token = /ghp_[A-Za-z0-9]{36}/.exec(
      readFileSync(join(import.meta.dirname, "..", "fixtures", "threats", "T1b", "secrets.yaml"), "utf8"),
    )![0];
    const body = JSON.stringify({ model: "c", max_tokens: 8, messages: [{ role: "user", content: [{ type: "text", text: `hi ${token}` }] }] });
    const r = await fetch(`${url}/claude/anthropic/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "content-encoding": "gzip" },
      body: new Uint8Array(gzipSync(body)),
    });
    await r.text();
    expect(r.status).toBe(502);
    expect(mock!.requests).toHaveLength(0);
  });

  it("对照：identity 与无编码照常透传", async () => {
    const url = await boot();
    const r = await fetch(`${url}/claude/anthropic/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "content-encoding": "identity" },
      body: JSON.stringify({ model: "c", max_tokens: 8, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }),
    });
    await r.text();
    expect(r.status).toBe(200);
  });
});
