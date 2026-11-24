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

  it("非受管路由：同样写 reason，但不阻断（REQ-15 的分权，CRITICAL-3 回归）", async () => {
    const g = await boot();
    // 自建前缀（不在受管判定域里）：
    const res = await post(`${g.url}/my-own-gateway/x/v1/messages`, { content: "unknown-shape", model: "m" });
    expect(res.status).toBe(200); // 不阻断
    const rec = g.records().at(-1)!;
    expect(rec.reason).toBe("shape_unrecognized"); // 但必须可查
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

// @test REQ-V2bA-15（code-walkthrough R2 CRITICAL 回归）
// @intent `CoverageSpec` 列的是**载荷**清单；凭据放进同一协议里合法但**未登记**的字段时，
//         present 非空且全部 handled → 曾判 full → 不写 reason、不阻断，凭据原样出境。
//         评审给出的构造：Anthropic 的 `metadata.user_id`、Responses 的 `metadata.x`。
describe("SL-05 未登记字段的兜底（R2 CRITICAL 回归）", () => {
  it("凭据藏在 Anthropic 未登记的 metadata 字段 → 阻断（不再静默放行）", async () => {
    const g = await boot();
    const res = await post(`${g.url}/claude/anthropic/v1/messages`, {
      model: "claude-3",
      max_tokens: 16,
      messages: [{ role: "user", content: "hi" }],
      metadata: { user_id: "sk-ant-api03-REALKEYabcdefghijklmnop" },
    });
    expect(res.status).toBe(502);
    expect(g.records().at(-1)!.reason).toBe("shape_partial_coverage");
  });

  it("凭据藏在 Responses 未登记的 metadata 字段 → 阻断", async () => {
    const g = await boot();
    const res = await post(`${g.url}/codex/openai/v1/responses`, {
      model: "gpt-5",
      instructions: "ok",
      input: "hi",
      metadata: { x: "sk-abcdefghijklmnopqrstuvwxyz1234" },
    });
    expect(res.status).toBe(502);
  });

  it("对照：正常请求（所有字符串值都被投影看过）仍然放行", async () => {
    const g = await boot();
    const res = await post(`${g.url}/claude/anthropic/v1/messages`, {
      model: "claude-3",
      max_tokens: 16,
      messages: [{ role: "user", content: [{ type: "text", text: "hello there" }] }],
    });
    expect(res.status).toBe(200);
    expect(g.records().at(-1)!.reason).toBeUndefined();
  });
});

// @test REQ-V2bA-15（code-walkthrough R3 CRITICAL C1/C2 回归）
// @intent 兜底扫描必须**先于**豁免判定；结构性豁免不能按裸键名在任意深度开洞。
describe("SL-05 兜底顺序与键名豁免（R3 回归）", () => {
  it("C1：没有任何载荷字段、凭据只在未登记的 note 里 → 阻断（豁免不能抢先）", async () => {
    const g = await boot();
    const res = await post(`${g.url}/claude/anthropic/v1/messages`, {
      model: "claude-3-5-sonnet",
      messages: [{ role: "user", note: "sk-ant-api03-REALKEYabcdefghijklmnop" }],
    });
    expect(res.status).toBe(502);
    expect(g.records().at(-1)!.reason).toBe("shape_partial_coverage");
  });

  it("C2：凭据放在结构性键名（id）下 → 阻断（键名不再豁免值）", async () => {
    const g = await boot();
    const res = await post(`${g.url}/claude/anthropic/v1/messages`, {
      model: "m",
      max_tokens: 8,
      messages: [{ role: "user", content: "hi", id: "sk-ant-api03-REALKEYabcdefghijklmnop" }],
    });
    expect(res.status).toBe(502);
  });

  it("对照：短标识符（模型名、ID）不会被当成未看过的载荷", async () => {
    const g = await boot();
    const res = await post(`${g.url}/claude/anthropic/v1/messages`, {
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 8,
      messages: [{ role: "user", content: [{ type: "text", text: "hello there friend" }] }],
      metadata: { user_id: "user-abc-123" },
    });
    expect(res.status).toBe(200);
  });
});
