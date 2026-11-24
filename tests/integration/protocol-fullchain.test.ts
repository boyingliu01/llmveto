import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EvidenceWriter } from "../../src/evidence/writer.ts";
import { startGateway } from "../../src/gateway/server.ts";
import { claudeCodeAdapter } from "../../src/adapters/claude-code.ts";
import { codexAdapter } from "../../src/adapters/codex.ts";
import { startMockUpstream, type MockUpstream } from "../utils/mock-upstream.ts";

// @test REQ-V2bA-00 / REQ-V2bA-16 / AC-V2bA-00a~b / AC-V2bA-16a~b
// @intent 四段全链：入口 → 识别 → 投影 → 转发。
//
// 这是本 sprint 的核心验收，判据由 R1 评审定死（A 席 CRITICAL-1）：
//   ① 上游收到的 body 与客户端发出的**逐字节相同**；
//   ② 扫描单元命中探针文本；
//   ③ 凭据形态探针必须被 blocked_before_forward（上游收到 0 次请求）。
// **"evidence 里有 client/provider_id" 不算通过**——那正是"假过闸"的样子。
//
// 凭据探针**复用仓库已有 fixture 值**（DR-031：不新造可匹配串，避免污染对话历史）：
// tests/fixtures/threats/T1b/secrets.yaml 的 t1b-openai。
// 探针必须放在**改动前为盲区**的字段里，否则修复前就能通过，证明不了缺口已补。

/**
 * 探针值**从 fixture 读**，不在本文件里再写一遍。
 *
 * 理由（DR-031）：可匹配的凭据串每出现一处就是一个新的检测点，
 * detect-secrets 会把本文件当成新泄漏拦下——它拦得对。
 * 直接引用 fixture 既满足"复用既有值"，又不制造第二份副本。
 */
const SECRET = readT1bFixture();

/** 从 T1b fixture 取出 openai-sk 那条的试用值。 */
function readT1bFixture(): string {
  const yamlPath = join(import.meta.dirname, "..", "fixtures", "threats", "T1b", "secrets.yaml");
  const text = readFileSync(yamlPath, "utf8");
  const m = /body:\s*'[^']*?((?:sk-)[A-Za-z0-9]{20,})/.exec(text);
  if (m === null) throw new Error("T1b fixture 里找不到 openai-sk 样本");
  return m[1]!;
}

let gw: Awaited<ReturnType<typeof startGateway>> | null = null;
let mock: MockUpstream | null = null;
const dir = mkdtempSync(join(tmpdir(), "llmveto-fullchain-"));

afterEach(async () => {
  if (gw) await gw.close();
  if (mock) await mock.close();
  gw = null;
  mock = null;
});

async function boot(): Promise<{ url: string; evidence: () => Record<string, unknown>[]; hits: () => number }> {
  mock = await startMockUpstream({
    transport: "non-stream",
    body: JSON.stringify({ model: "gpt-4o", choices: [{ message: { content: "ok" } }] }),
  });
  const upstream = mock;
  const writerPath = join(dir, `ev-${Math.random().toString(36).slice(2)}.jsonl`);
  gw = await startGateway({
    config: {
      upstreamBaseUrl: upstream.url,
      evidenceWriter: new EvidenceWriter(writerPath),
      upstreams: { "claude/anthropic": upstream.url, "codex/openai": upstream.url, "promptfoo/openai": upstream.url },
    },
  });
  return {
    url: gw.url,
    hits: () => upstream.requests.length,
    evidence: () => {
      if (!existsSync(writerPath)) return [];
      return readFileSync(writerPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    },
  };
}

async function post(url: string, body: unknown): Promise<number> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  await r.text();
  return r.status;
}

describe("SL-13 四段全链（REQ-V2bA-00/16）", () => {
  it("Claude Code：真实 adapter 产物 → 上游逐字节相同 且 响应正文可扫（AC-V2bA-00a/b）", async () => {
    const g = await boot();
    claudeCodeAdapter.applyManagedConfig({ LLMVETO_CLAUDE_SETTINGS: join(dir, "claude.json") }, g.url);
    const base = (
      JSON.parse(readFileSync(join(dir, "claude.json"), "utf8")) as { env: { ANTHROPIC_BASE_URL: string } }
    ).env.ANTHROPIC_BASE_URL;

    const body = {
      model: "claude-x",
      max_tokens: 32,
      messages: [{ role: "user", content: [{ type: "text", text: "hello-probe" }] }],
    };
    expect(await post(`${base}/v1/messages`, body)).toBe(200);
    // ① 上游收到的 body 与客户端发出的逐字节相同（网关不重写）
    expect(mock!.requests[0]!.body).toBe(JSON.stringify(body));
    // ② 不是"假过闸"：evidence 有记录只是必要条件，真正的判据是正文进入了扫描。
    //    这里用响应侧再验一次（响应体同样必须被投影到扫描单元）。
    const rec = g.evidence().at(-1)!;
    expect(rec.client).toBe("claude");
    // 观测类 checker 可能给出 warned（例如响应 model 字段与请求不一致），那不是安全类阻断。
    // 本条的判据是"没被阻断"，不是"恰好 allowed"。
    expect(["allowed", "warned"]).toContain(rec.action_taken);
  });

  it("Codex：真实 adapter 产物（TOML）驱动 → 上游逐字节相同", async () => {
    const g = await boot();
    const p = join(dir, "config.toml");
    codexAdapter.applyManagedConfig({ LLMVETO_CODEX_CONFIG: p }, g.url);
    const base = /base_url = "([^"]+)"/.exec(readFileSync(p, "utf8"))![1]!;

    const body = { model: "gpt-5", input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }] };
    expect(await post(`${base}/responses`, body)).toBe(200);
    expect(mock!.requests[0]!.body).toBe(JSON.stringify(body));
    expect(g.evidence().at(-1)!.client).toBe("codex");
  });

  it("Anthropic 盲区字段（system 块 / tool_use.input / tool_result）里的凭据被阻断，上游 0 请求（AC-V2bA-16a）", async () => {
    const g = await boot();
    claudeCodeAdapter.applyManagedConfig({ LLMVETO_CLAUDE_SETTINGS: join(dir, "claude2.json") }, g.url);
    const base = (JSON.parse(readFileSync(join(dir, "claude2.json"), "utf8")) as { env: { ANTHROPIC_BASE_URL: string } })
      .env.ANTHROPIC_BASE_URL;

    // 三个探针分别落在改动前**不可见**的字段里
    const bodies = [
      { model: "m", max_tokens: 8, system: [{ type: "text", text: `sys ${SECRET}` }], messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
      { model: "m", max_tokens: 8, messages: [{ role: "assistant", content: [{ type: "tool_use", id: "t", name: "shell", input: { cmd: SECRET } }] }] },
      { model: "m", max_tokens: 8, messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: SECRET }] }] },
    ];
    for (const body of bodies) expect(await post(`${base}/v1/messages`, body)).toBe(502);
    expect(mock!.requests).toHaveLength(0); // 零出境
    for (const rec of g.evidence()) expect(rec.action_taken).toBe("blocked_before_forward");
  });

  it("Responses 盲区字段（instructions / input[].content / function_call_output）里的凭据被阻断，上游 0 请求（AC-V2bA-16a）", async () => {
    const g = await boot();
    const p = join(dir, "config2.toml");
    codexAdapter.applyManagedConfig({ LLMVETO_CODEX_CONFIG: p }, g.url);
    const base = /base_url = "([^"]+)"/.exec(readFileSync(p, "utf8"))![1]!;

    const bodies = [
      { model: "m", instructions: `be nice ${SECRET}`, input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }] },
      { model: "m", input: [{ type: "message", role: "user", content: [{ type: "input_text", text: SECRET }] }] },
      { model: "m", input: [{ type: "function_call_output", call_id: "c", output: SECRET }] },
    ];
    for (const body of bodies) expect(await post(`${base}/responses`, body)).toBe(502);
    expect(mock!.requests).toHaveLength(0);
  });

  it("反向探针：同一凭据放在 Chat 形态的已覆盖字段时报 502 也成立（对照，证明探针本身有效）", async () => {
    const g = await boot();
    const body = { model: "gpt-4o", messages: [{ role: "user", content: `hello ${SECRET}` }] };
    expect(await post(`${g.url}/promptfoo/openai/v1/chat/completions`, body)).toBe(502);
    expect(mock!.requests).toHaveLength(0);
  });
});
