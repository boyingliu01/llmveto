import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EvidenceWriter } from "../../src/evidence/writer.ts";
import { startGateway } from "../../src/gateway/server.ts";
import { startMockUpstream, type MockUpstream } from "../utils/mock-upstream.ts";

// @test REQ-V2bA-14 / REQ-V2bA-15 / REQ-V2bA-15a
// @intent 两轴处置：轴1 识别（known/unknown）+ 轴2 覆盖（full/partial/vacuous），
//         受管路由上 unknown / vacuous / partial 一律 fail-closed（DR-031）。
//
// 判据是"投影器有没有覆盖已知载荷字段"，**不是**"文本是不是空的"——
// 这条区分是 R1-R2 第三席抓出的矛盾点：豁免"纯工具调用"与阻断"零文本"曾同时成立。

let gw: Awaited<ReturnType<typeof startGateway>> | null = null;
let mock: MockUpstream | null = null;
const dir = mkdtempSync(join(tmpdir(), "llmveto-outcome-"));

afterEach(async () => {
  if (gw) await gw.close();
  if (mock) await mock.close();
  gw = null;
  mock = null;
});

async function boot(): Promise<{ url: string; records: () => Record<string, unknown>[]; hits: () => number }> {
  mock = await startMockUpstream({
    transport: "non-stream",
    body: JSON.stringify({ model: "gpt-4o", choices: [{ message: { content: "ok" } }] }),
  });
  let hits = 0;
  const upstream = mock;
  const origUrl = upstream.url;
  void origUrl;
  const writerPath = join(dir, `ev-${Math.random().toString(36).slice(2)}.jsonl`);
  gw = await startGateway({
    config: {
      upstreamBaseUrl: mock.url,
      evidenceWriter: new EvidenceWriter(writerPath),
      upstreams: { "claude/anthropic": mock.url, "codex/openai": mock.url },
    },
  });
  return {
    url: gw.url,
    hits: () => hits,
    records: () => {
      const fs = require("node:fs") as typeof import("node:fs");
      if (!fs.existsSync(writerPath)) return [];
      return fs.readFileSync(writerPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    },
  };
}

async function post(url: string, body: unknown): Promise<{ status: number; text: string }> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, text: await r.text() };
}

describe("SL-05 两轴处置（REQ-V2bA-14/15/15a）", () => {
  it("受管路由 + 无法归类的 body → block + reason=shape_unrecognized（不许静默放行）", async () => {
    const g = await boot();
    // 带一个协议特征键（content）但整体无法归类 —— 真正的"认不出"。
    // （只有 model 的 body 属合法空请求，按注入语义放行，不在此列。）
    const res = await post(`${g.url}/claude/anthropic/v1/messages`, { content: "unknown-shape", model: "m" });
    expect(res.status).toBe(502);
    const rec = g.records().at(-1)!;
    expect(rec.action_taken).toBe("blocked_before_forward");
    expect(rec.reason).toBe("shape_unrecognized");
  });

  it("合法空请求（messages: []）按原语义放行，不写 reason", async () => {
    // 健康探针与空会话续写都长这样；把它们判成"认不出"会把正常运维流量打死。
    const g = await boot();
    const res = await post(`${g.url}/claude/anthropic/v1/messages`, { model: "claude-x", messages: [] });
    expect(res.status).toBe(200);
    expect(g.records().at(-1)!.reason).toBeUndefined();
  });

  it("受管路由 + 正常 anthropic 请求 → 放行（不写 reason）", async () => {
    const g = await boot();
    const res = await post(`${g.url}/claude/anthropic/v1/messages`, {
      model: "claude-x",
      max_tokens: 16,
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    });
    expect(res.status).toBe(200);
    expect(g.records().at(-1)!.reason).toBeUndefined();
  });

  it("纯工具调用（tool_result 载荷）不算空请求：正常放行且不写 reason", async () => {
    const g = await boot();
    const res = await post(`${g.url}/claude/anthropic/v1/messages`, {
      model: "claude-x",
      max_tokens: 16,
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "t", name: "shell", input: { cmd: "ls" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "file.txt" }] },
      ],
    });
    expect(res.status).toBe(200);
    expect(g.records().at(-1)!.reason).toBeUndefined();
  });
});
