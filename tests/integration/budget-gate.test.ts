import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { verifyEvidenceFile } from "../../src/evidence/verify.ts";
import { EvidenceWriter } from "../../src/evidence/writer.ts";
import { startGateway } from "../../src/gateway/server.ts";
import {
  G1_PER_CHUNK,
  G3_TIER_8KB,
  G3_TIER_64KB,
  G3_TIER_512KB,
  g3BudgetForBodyBytes,
} from "../../src/gateway/budget.ts";
import type { CheckerSpec, ScanUnit, ScanWindow } from "../../src/shared/types.ts";
import { startMockUpstream, type MockUpstream } from "../utils/mock-upstream.ts";

// @test REQ-V2a-12 / AC-V2a-27（+AC-V2a-22 bench 义务的边界注记：本切片不改 bench/）
// @intent SL-04 集成判定面：真实网关 + mock-upstream（复用 SL-02 stream-windows 夹具模式）。
//   ① 默认配置三路径接线：benign 流量三路径全放行、checker_timeout 不出现（档位常量
//      import budget.ts 引用非复抄）——接线本身的"存在性"由 ② 的注入改写可观测地证明；
//   ② 点名 checker 注入不可满足预算（0.0001ms）→ 三路径各自 error→checker_timeout→
//      block/终止流（裁决面语义，无抢占假设）；
//   ③ 未点名 checker 同趟不受影响：同 loop 内未被点名者照常 clean（②内嵌 + ③独立例证）；
//   ④ 预算耗尽不改其它状态：窗口仍按片推进（推进前 cursor 语义）、回传 extra 跨片存活、
//      evidence 记录仍落、action_taken 按既有矩阵取值不新增格。

let dir: string;
let mock: MockUpstream | null = null;
let gw: Awaited<ReturnType<typeof startGateway>> | null = null;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "llmveto-budget-gate-"));
});
afterEach(async () => {
  if (gw) {
    await gw.close();
    gw = null;
  }
  if (mock) {
    await mock.close();
    mock = null;
  }
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function busy(ms: number): void {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // 真实时钟自旋（无 fake timer）；量级几十 ms 以内，不拖全量时长
  }
}

// ── 工具帧构造（与 stream-windows.test.ts 同族；model "m" 与请求一致 → model-label clean） ──
const contentFrame = (text: string): string =>
  JSON.stringify({ model: "m", choices: [{ delta: { content: text } }] });
const benignReqBody = (content: string): string =>
  JSON.stringify({ model: "m", messages: [{ role: "user", content }] });

function errorEvents(text: string): readonly string[] {
  return text.split("\n\n").filter((b) => b.startsWith("event: error"));
}

async function post(g: { url: string }, stream: boolean): Promise<Response> {
  return fetch(g.url + "/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", ...(stream ? { "x-llmveto-transport": "stream" } : {}) },
    body: benignReqBody("hi"),
  });
}

// ── evidence 读取（evidence 在 res.end() 之后落盘，需轮询） ─────
interface ParsedFinding {
  readonly checker: string;
  readonly verdict: string;
  readonly rule_id?: string;
}
interface ParsedRecord {
  readonly findings: readonly ParsedFinding[];
  readonly action_taken: string;
  readonly chunk_count: number;
  readonly response_delivered: { readonly partial: boolean; readonly delivered_chunks: number };
}
function readEvidenceLines(path: string): readonly ParsedRecord[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as unknown as ParsedRecord);
}
async function waitForEvidence(path: string): Promise<readonly ParsedRecord[]> {
  for (let i = 0; i < 250; i++) {
    const lines = readEvidenceLines(path);
    if (lines.length > 0) return lines;
    await new Promise((r) => setTimeout(r, 20));
  }
  return readEvidenceLines(path);
}

async function boot(
  opts: { budget?: ReadonlyMap<string, number>; extra?: readonly CheckerSpec[] } = {},
): Promise<{ g: NonNullable<typeof gw>; evidencePath: string }> {
  const evidencePath = join(dir, "ev-" + Math.random().toString(36).slice(2) + ".jsonl");
  gw = await startGateway({
    config: {
      upstreamBaseUrl: mock!.url,
      evidenceWriter: new EvidenceWriter(evidencePath),
      ...(opts.budget !== undefined ? { checkerBudgetMs: opts.budget } : {}),
      ...(opts.extra !== undefined && opts.extra.length > 0 ? { extraCheckers: opts.extra } : {}),
    },
  });
  return { g: gw, evidencePath };
}

// ── 观测类窗口桩：每次调用都超预算，但如实回传窗口（改写发生在网关，桩只观测） ──
// @mock-justified: 窗口推进/extra 存活只能从"checker 回传窗口"一侧观测——真实 checker
// 的窗口内部状态不可外见（SL-02 stream-windows.test.ts 同款载体）。本桩扮演"每次调用
// 都超预算的观测类 checker"：超时改写是网关侧被测行为，桩只记录收到的窗口并回传累计态。
// id 取 "usage-reconcile"（T4a 观测类）：§4.5 威胁表已登记但 REGISTRY 尚未注册（SL-11
// 落位）——D-10 flattenFindings 对 error 条目查 threat 表 fail-closed，未登记 id 会显式
// 抛错；用表内未注册 id 既满足落链又不与真实 checker 双重分派（SL-02 桩取 tool-call-shape
// 的同一理由）。
interface StubHandle {
  readonly spec: CheckerSpec;
  readonly received: readonly { cursor: number; accumulated: number }[];
}
function budgetWindowStub(spinMs: number): StubHandle {
  const received: { cursor: number; accumulated: number }[] = [];
  const spec: CheckerSpec = {
    id: "budget-window-stub",
    side: "response",
    synchronous: true,
    safetyClass: false, // 观测类：error 不阻断 → 流可走完，多片窗口行为可观测
    runStream: (window: ScanWindow, chunk: ScanUnit) => {
      // 归并重投影是已消费内容的重放：不累积、不判定（SL-02 标记语义，包裹不改变它）
      if (chunk.meta.llmveto_reprojected === true) {
        return [{ verdict: "clean", evidence: [] }, window] as const;
      }
      const prev = typeof window.extra?.accumulated === "number" ? window.extra.accumulated : 0;
      received.push({ cursor: window.cursor, accumulated: prev });
      const next: ScanWindow = {
        pendingBytes: window.pendingBytes,
        cursor: window.cursor,
        extra: { accumulated: prev + chunk.text.length },
      };
      busy(spinMs); // 真实慢函数：超过 0.0001ms 预算
      return [{ verdict: "clean", evidence: [] }, next] as const;
    },
  };
  return { spec, received };
}

// ─────────────────────────────────────────────────────────────────────────────
// ① 默认配置三路径接线（档位常量 import 引用非复抄）
// ─────────────────────────────────────────────────────────────────────────────
describe("SL-04 integration ①: 默认配置三路径接线（AC-V2a-27①⑤，无超时误阻）", () => {
  it("档位常量引用：g3 归档与 G1 门读 budget.ts 单一真相源（非复抄数值）", () => {
    expect(g3BudgetForBodyBytes(8192)).toBe(G3_TIER_8KB);
    expect(g3BudgetForBodyBytes(65536)).toBe(G3_TIER_64KB);
    expect(g3BudgetForBodyBytes(65537)).toBe(G3_TIER_512KB);
    expect(G1_PER_CHUNK).toBeGreaterThan(0);
  });

  it("请求体路径：默认 G3 档内 benign 放行、无 checker_timeout", async () => {
    mock = await startMockUpstream({ transport: "non-stream", body: '{"model":"m","ok":true}' });
    const { g, evidencePath } = await boot();
    const r = await post(g, false);
    expect(r.status).toBe(200);
    const recs = await waitForEvidence(evidencePath);
    expect(recs).toHaveLength(1);
    expect(recs[0]!.findings.some((f) => f.rule_id === "checker_timeout")).toBe(false);
    expect(recs[0]!.action_taken).toBe("allowed");
  });

  it("请求体路径：9KB benign 体（第二档 64KB 档位）同样放行（默认档位不误阻）", async () => {
    mock = await startMockUpstream({ transport: "non-stream", body: '{"model":"m","ok":true}' });
    const { g, evidencePath } = await boot();
    const r = await fetch(g.url + "/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: benignReqBody("a".repeat(9 * 1024)),
    });
    expect(r.status).toBe(200);
    const recs = await waitForEvidence(evidencePath);
    expect(recs[0]!.findings.some((f) => f.rule_id === "checker_timeout")).toBe(false);
  });

  it("非流式响应体路径：默认档内放行、响应体照常交付", async () => {
    mock = await startMockUpstream({
      transport: "non-stream",
      body: JSON.stringify({ model: "m", choices: [{ message: { role: "assistant", content: "plain text" } }] }),
    });
    const { g, evidencePath } = await boot();
    const r = await post(g, false);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("plain text");
    const recs = await waitForEvidence(evidencePath);
    expect(recs[0]!.findings.some((f) => f.rule_id === "checker_timeout")).toBe(false);
  });

  it("流式路径：默认 G1 每 chunk 门内 benign 全片交付至 [DONE]", async () => {
    mock = await startMockUpstream({
      transport: "stream",
      chunks: [contentFrame("hello"), contentFrame("world")],
    });
    const { g, evidencePath } = await boot();
    const r = await post(g, true);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(errorEvents(text)).toHaveLength(0);
    expect(text).toContain("[DONE]");
    const recs = await waitForEvidence(evidencePath);
    expect(recs[0]!.findings.some((f) => f.rule_id === "checker_timeout")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② 点名 checker 注入不可满足预算 → error→checker_timeout→block/终止流
// ─────────────────────────────────────────────────────────────────────────────
describe("SL-04 integration ②: 注入不可满足预算（AC-V2a-27② 裁决面语义）", () => {
  it("请求体路径：egress 点名 0.0001ms → 502 + blocked_before_forward + checker_timeout 双层痕迹 + 未转发", async () => {
    mock = await startMockUpstream({ transport: "non-stream", body: '{"ok":true}' });
    const { g, evidencePath } = await boot({ budget: new Map([["egress-secret-scan", 0.0001]]) });
    const r = await fetch(g.url + "/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: benignReqBody("x".repeat(1024)), // 实扫文本非空，扫描耗时远超 0.0001ms
    });
    expect(r.status).toBe(502);
    expect(JSON.parse(await r.text())).toEqual({ error: { code: "llmveto:rejected" } });
    expect(mock.requests).toHaveLength(0); // 判定在前，未转发
    const recs = await waitForEvidence(evidencePath);
    expect(recs[0]!.action_taken).toBe("blocked_before_forward");
    const errs = recs[0]!.findings.filter((f) => f.verdict === "error");
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({ checker: "egress-secret-scan", rule_id: "checker_timeout" });
    expect(verifyEvidenceFile(evidencePath).ok).toBe(true);
  });

  it("非流式响应体路径：invisible 点名 → 502 + blocked_before_deliver；同趟未点名 model-label 不产 error（③内嵌）", async () => {
    mock = await startMockUpstream({
      transport: "non-stream",
      body: JSON.stringify({ model: "m", choices: [{ message: { role: "assistant", content: "plain response" } }] }),
    });
    const { g, evidencePath } = await boot({ budget: new Map([["invisible-unicode-scan", 0.0001]]) });
    const r = await post(g, false);
    expect(r.status).toBe(502);
    expect(await r.text()).toBe("");
    const recs = await waitForEvidence(evidencePath);
    expect(recs[0]!.action_taken).toBe("blocked_before_deliver");
    const errs = recs[0]!.findings.filter((f) => f.verdict === "error");
    expect(errs).toHaveLength(1); // 只有被点名者：若预算 map 泄漏给全部 checker，此处会出现第二条
    expect(errs[0]).toMatchObject({ checker: "invisible-unicode-scan", rule_id: "checker_timeout" });
    expect(recs[0]!.findings.some((f) => f.checker === "model-label-consistency")).toBe(false);
  });

  it("流式路径：invisible 点名 → 首 chunk 超时即终止流（event:error + delivered_chunks=0）", async () => {
    mock = await startMockUpstream({
      transport: "stream",
      chunks: [contentFrame("first-never-delivered"), contentFrame("tail-never")],
    });
    const { g, evidencePath } = await boot({ budget: new Map([["invisible-unicode-scan", 0.0001]]) });
    const r = await post(g, true);
    expect(r.status).toBe(200);
    const text = await r.text();
    const errs = errorEvents(text);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('"delivered_chunks":0');
    expect(text).not.toContain("tail-never");
    expect(text).not.toContain("[DONE]");
    const recs = await waitForEvidence(evidencePath);
    expect(recs[0]!.action_taken).toBe("terminated_after_delivery");
    const errFindings = recs[0]!.findings.filter((f) => f.verdict === "error");
    expect(errFindings).toHaveLength(1);
    expect(errFindings[0]).toMatchObject({ checker: "invisible-unicode-scan", rule_id: "checker_timeout" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ 未点名 checker 同趟不受影响（独立例证：点名观测类 → 降级不阻断）
// ─────────────────────────────────────────────────────────────────────────────
describe("SL-04 integration ③: 未点名 checker 同趟不受影响（AC-V2a-27③④）", () => {
  it("仅点名 model-label-consistency：其超时降级（degraded_observational），未点名的隐形扫描照常判定，响应照常交付", async () => {
    mock = await startMockUpstream({
      transport: "non-stream",
      body: JSON.stringify({ model: "m", choices: [{ message: { role: "assistant", content: "plain response" } }] }),
    });
    const { g, evidencePath } = await boot({ budget: new Map([["model-label-consistency", 0.0001]]) });
    const r = await post(g, false);
    expect(r.status).toBe(200); // 观测类 error 不阻断
    expect(await r.text()).toContain("plain response");
    const recs = await waitForEvidence(evidencePath);
    const rec = recs[0]!;
    expect(rec.action_taken).toBe("degraded_observational"); // 既有矩阵值，无新增格
    const errs = rec.findings.filter((f) => f.verdict === "error");
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({ checker: "model-label-consistency", rule_id: "checker_timeout" });
    expect(rec.findings.some((f) => f.checker === "invisible-unicode-scan")).toBe(false); // 未点名者零痕迹
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ④ 预算耗尽不改其它状态（AC-V2a-27④：窗口仍推进、evidence 仍落、action_taken 既有格）
// ─────────────────────────────────────────────────────────────────────────────
describe("SL-04 integration ④: 预算耗尽不改其它状态（窗口推进 / extra 存活 / evidence 落链）", () => {
  it("流式观测类逐 chunk 超时：cursor 按推进前值逐片推进 + 回传 extra 跨片存活 + 全片照常交付", async () => {
    const stub = budgetWindowStub(1);
    mock = await startMockUpstream({
      transport: "stream",
      chunks: [contentFrame("hello"), contentFrame("world")],
    });
    const { g, evidencePath } = await boot({
      budget: new Map([["budget-window-stub", 0.0001]]),
      extra: [stub.spec],
    });
    const r = await post(g, true);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(errorEvents(text)).toHaveLength(0); // 观测类：不终止流
    expect(text).toContain("hello");
    expect(text).toContain("world");
    expect(text).toContain("[DONE]");
    // AC-V2a-27④：改写未吞窗口 —— cursor 收到的是推进前值且逐片推进（0 → 5），
    // extra 累积跨片存活（0+5=5 进下一片的回传窗口）。若改写吞了回传窗口，
    // 第二片 accumulated 会是 0、cursor 语义会被破坏。
    expect(stub.received).toEqual([
      { cursor: 0, accumulated: 0 },
      { cursor: 5, accumulated: 5 },
    ]);
    const recs = await waitForEvidence(evidencePath);
    const rec = recs[0]!;
    expect(rec.action_taken).toBe("degraded_observational");
    expect(rec.response_delivered).toEqual({ partial: false, delivered_chunks: 2 });
    expect(rec.chunk_count).toBe(2);
    const errEntries = rec.findings.filter((f) => f.checker === "budget-window-stub" && f.verdict === "error");
    expect(errEntries).toHaveLength(2); // 每 chunk 一条超时条目（evidence 记录仍落）
    expect(errEntries.every((f) => f.rule_id === "checker_timeout")).toBe(true);
    expect(verifyEvidenceFile(evidencePath).ok).toBe(true);
  });

  it("默认 G1 门不误阻真实慢 checker：未点名慢桩（~1ms < G1 12ms）照常 clean 全片交付", async () => {
    const stub = budgetWindowStub(1);
    mock = await startMockUpstream({
      transport: "stream",
      chunks: [contentFrame("slow-but-fine")],
    });
    const { g, evidencePath } = await boot({ extra: [stub.spec] }); // 无注入：默认 G1_PER_CHUNK
    const r = await post(g, true);
    const text = await r.text();
    expect(errorEvents(text)).toHaveLength(0);
    expect(text).toContain("[DONE]");
    const recs = await waitForEvidence(evidencePath);
    expect(recs[0]!.findings.some((f) => f.rule_id === "checker_timeout")).toBe(false);
    expect(stub.received).toEqual([{ cursor: 0, accumulated: 0 }]);
  });

  it("默认 G1 门是有限硬门：未点名慢桩（~13ms > G1 12ms）被改写为 checker_timeout（接线存在性反证）", async () => {
    const stub = budgetWindowStub(13);
    mock = await startMockUpstream({
      transport: "stream",
      chunks: [contentFrame("too-slow")],
    });
    const { g, evidencePath } = await boot({ extra: [stub.spec] });
    const r = await post(g, true);
    const text = await r.text();
    expect(errorEvents(text)).toHaveLength(0); // 观测类：改写降级不终止
    const recs = await waitForEvidence(evidencePath);
    const errEntries = recs[0]!.findings.filter((f) => f.checker === "budget-window-stub" && f.verdict === "error");
    expect(errEntries).toHaveLength(1);
    expect(errEntries[0]).toMatchObject({ rule_id: "checker_timeout" });
    expect(recs[0]!.action_taken).toBe("degraded_observational");
  });
});
