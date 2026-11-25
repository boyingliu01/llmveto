import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EvidenceWriter } from "../../src/evidence/writer.ts";
import { startGateway } from "../../src/gateway/server.ts";
import { claudeCodeAdapter } from "../../src/adapters/claude-code.ts";
import { startMockUpstream, type MockUpstream } from "../utils/mock-upstream.ts";

// @test REQ-V2bA-13 / AC-V2bA-13a~c
// @intent 金丝雀注入只对 Chat 线格式生效（D4，三席一致）。两种新协议上**显式不注入**，
//         且必须可观测：evidence 顶层出现 inject_skipped。
//
// 为什么不做全形态注入：那是第二次 canary 改造（注入点、轮换、尾部追加语义全部要重定），
// 与"砍范围不砍深度"的纪律冲突。代价必须诚实登记（KNOWN-ISSUES + 能力清单），
// 见 docs/protocol-capability-matrix.md 与 docs/KNOWN-ISSUES.md。

let gw: Awaited<ReturnType<typeof startGateway>> | null = null;
let mock: MockUpstream | null = null;
const dir = mkdtempSync(join(tmpdir(), "llmveto-canary-b-"));

afterEach(async () => {
  if (gw) await gw.close();
  if (mock) await mock.close();
  gw = null;
  mock = null;
});

async function boot(): Promise<{ url: string; evidence: () => Record<string, unknown>[] }> {
  mock = await startMockUpstream({
    transport: "non-stream",
    body: JSON.stringify({ model: "gpt-4o", choices: [{ message: { content: "ok" } }] }),
  });
  const upstream = mock;
  const writerPath = join(dir, `ev-${Math.random().toString(36).slice(2)}.jsonl`);
  const registryPath = join(dir, `reg-${Math.random().toString(36).slice(2)}.json`);
  gw = await startGateway({
    config: {
      upstreamBaseUrl: upstream.url,
      evidenceWriter: new EvidenceWriter(writerPath),
      canaryRegistryPath: registryPath,
      upstreams: { "claude/anthropic": upstream.url, "codex/openai": upstream.url, "opencode/openai": upstream.url },
    },
  });
  const fs = require("node:fs") as typeof import("node:fs");
  return {
    url: gw.url,
    evidence: () => {
      if (!fs.existsSync(writerPath)) return [];
      return fs.readFileSync(writerPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    },
  };
}

async function post(url: string, body: unknown): Promise<number> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  await r.text();
  return r.status;
}

describe("SL-12 金丝雀边界（REQ-V2bA-13）", () => {
  it("Anthropic 形态：不注入，且 evidence 顶层出现 inject_skipped（AC-V2bA-13a）", async () => {
    const g = await boot();
    claudeCodeAdapter.applyManagedConfig({ LLMVETO_CLAUDE_SETTINGS: join(dir, "c.json") }, g.url);
    const base = (JSON.parse(require("node:fs").readFileSync(join(dir, "c.json"), "utf8")) as { env: { ANTHROPIC_BASE_URL: string } }).env.ANTHROPIC_BASE_URL;
    const body = { model: "claude-x", max_tokens: 8, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] };
    expect(await post(`${base}/v1/messages`, body)).toBe(200);
    // 请求体原样转发：没有任何 canary 被追加
    expect(mock!.requests[0]!.body).toBe(JSON.stringify(body));
    expect(g.evidence().at(-1)!.reason).toBe("inject_skipped");
  });

  it("Responses 形态：同样不注入且记为 inject_skipped", async () => {
    const g = await boot();
    const body = { model: "gpt-5", input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }] };
    expect(await post(`${g.url}/codex/openai/v1/responses`, body)).toBe(200);
    expect(mock!.requests[0]!.body).toBe(JSON.stringify(body));
    expect(g.evidence().at(-1)!.reason).toBe("inject_skipped");
  });

  it("Chat 形态对照：仍然注入（行为未变）", async () => {
    const g = await boot();
    const body = { model: "gpt-4o", messages: [{ role: "user", content: "hello" }] };
    expect(await post(`${g.url}/opencode/openai/v1/chat/completions`, body)).toBe(200);
    const forwarded = mock!.requests[0]!.body;
    expect(forwarded.length).toBeGreaterThan(JSON.stringify(body).length); // 追加了 canary
    expect(forwarded.startsWith('{"model":"gpt-4o","messages":[{"role":"user","content":"hello')).toBe(true);
  });
});
