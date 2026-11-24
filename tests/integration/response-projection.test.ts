import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EvidenceWriter } from "../../src/evidence/writer.ts";
import { startGateway } from "../../src/gateway/server.ts";
import { startMockUpstream, type MockUpstream } from "../utils/mock-upstream.ts";

// @test REQ-V2bA-01 / REQ-V2bA-02 / AC-V2bA-16a（响应侧）
// @intent **响应侧**投影必须真的接上线。
//
// 这是 code-walkthrough 抓到的最严重缺陷：`buildResponseScanUnit` 的 proto 形参加了，
// 但三个调用点一个都没传——请求侧全链测试全绿，响应侧却依然走既有 Chat 投影，
// Anthropic 的 `content[]` 与 Responses 的 `output[]` 仍然不可见。
// 一个加了却没被调用的参数，比没加更危险：它让代码看起来已经修好了。

let gw: Awaited<ReturnType<typeof startGateway>> | null = null;
let mock: MockUpstream | null = null;
const dir = mkdtempSync(join(tmpdir(), "llmveto-resp-"));

afterEach(async () => {
  if (gw) await gw.close();
  if (mock) await mock.close();
  gw = null;
  mock = null;
});

/** 上游返回 Anthropic 形态的响应（正文在 content[]，不在 choices[]）。 */
async function boot(body: string): Promise<{ url: string; evidence: () => Record<string, unknown>[] }> {
  mock = await startMockUpstream({ transport: "non-stream", body });
  const upstream = mock;
  const writerPath = join(dir, `ev-${Math.random().toString(36).slice(2)}.jsonl`);
  gw = await startGateway({
    config: {
      upstreamBaseUrl: upstream.url,
      evidenceWriter: new EvidenceWriter(writerPath),
      upstreams: { "claude/anthropic": upstream.url, "codex/openai": upstream.url },
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

describe("SL-02/03 响应侧投影真的接线（REQ-V2bA-01/02）", () => {
  it("Anthropic 响应 content[] 里的隐形字符被检测到（改动前整段不可见）", async () => {
    // 用 invisible-unicode-scan 验证：它是 side:"response" 的**阻断类** checker。
    // （egress-secret-scan 是 side:"request"，本就不在响应侧运行——用它验证响应投影是选错了工具。）
    const g = await boot(
      JSON.stringify({ id: "m1", type: "message", model: "claude-x", content: [{ type: "text", text: "watermark\u200bprobe" }] }),
    );
    const r = await fetch(`${g.url}/claude/anthropic/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-x", max_tokens: 8, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }),
    });
    await r.text();
    const rec = g.evidence().at(-1)!;
    // 响应侧命中 → 不得是 allowed
    expect(rec.action_taken).not.toBe("allowed");
    const findings = (rec.findings ?? []) as { rule_id?: string }[];
    expect(findings.length).toBeGreaterThan(0);
  });

  it("Responses 响应 output[] 里的隐形字符被检测到（改动前投影为空串）", async () => {
    const g = await boot(
      JSON.stringify({ object: "response", model: "gpt-5", output: [{ type: "message", content: [{ type: "output_text", text: "watermark\u200bprobe" }] }] }),
    );
    const r = await fetch(`${g.url}/codex/openai/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-5", input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }] }),
    });
    await r.text();
    const rec = g.evidence().at(-1)!;
    expect(rec.action_taken).not.toBe("allowed");
    const findings = (rec.findings ?? []) as { rule_id?: string }[];
    expect(findings.length).toBeGreaterThan(0);
  });

  it("Chat 响应对照：行为未变", async () => {
    const g = await boot(JSON.stringify({ model: "gpt-4o", choices: [{ message: { content: "clean answer" } }] }));
    const r = await fetch(`${g.url}/claude/anthropic/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-x", max_tokens: 8, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }),
    });
    await r.text();
    expect(["allowed", "warned"]).toContain(g.evidence().at(-1)!.action_taken);
  });
});
