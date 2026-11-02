import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { EvidenceWriter } from "../../src/evidence/writer.ts";
import { startGateway } from "../../src/gateway/server.ts";
import { exceedsWindowOverflowLimit, STREAM_WINDOW_OVERFLOW_LIMIT } from "../../src/gateway/window-store.ts";
import type { CheckerSpec, ScanUnit, ScanWindow } from "../../src/shared/types.ts";
import { startMockUpstream, type MockUpstream } from "../utils/mock-upstream.ts";
import {
  OVERFLOW_CHUNK_BYTES,
  OVERFLOW_CHUNKS,
  buildOverflowFrames,
} from "../fixtures/stream-window-overflow.ts";

// @test REQ-V2a-15
// @intent D-07/D-08 端到端判定面：真实网关 + mock-upstream，四组 AC 的断言。
//
//   AC-V2a-25（offsets）：隐形字符在**全局流**的 UTF-16 code unit 偏移必须精确等于
//     findings[].offsets。修复前网关先推进再扫（v1 双推进镜像）：checker 收到的 cursor
//     已含本片长度，offsets 系统性偏移一个片长。每组场景的手算过程写在断言前注释里，
//     修复前运行必然红（同构造会报出片长偏移后的错误值）。
//   AC-V2a-26（窗口隔离）：tool-call-shape 以测试桩经 core 注入通道与隐形字符扫描
//     同连接共存——①桩 extra 累积跨片存活；②桩状态不污染隐形扫描的 cursor/offsets；
//     ③字节账本语义在 tests/unit/gateway/window-store.test.ts 机械钉死（integration 只
//     能行为级观测）；④本测试不改任何架构边界（checker 纯函数签名原样）。
//   AC-V2a-14（256KiB 单调用硬顶）：2049×128B arguments 流，i=2048（Σ=262144）放行交付、
//     i=2049（Σ=262272>LIMIT）→ window_overflow 阻断 + terminated_after_delivery。
//   AC-V2a-20（终止流幂等判定面）：命中后 event:error 恰一次、其后无任何片（含残尾）；
//     逐帧命中 / 归并命中 / 两者同时命中（双 veto 镜像探针）均不产生第二个 error。
//
// offset 断言读 evidence（findings[].offsets 不进 HTTP 响应面）。

let dir: string;
let mock: MockUpstream | null = null;
let gw: Awaited<ReturnType<typeof startGateway>> | null = null;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "llmveto-stream-windows-"));
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

// ── 工具帧构造 ──────────────────────────────────────────────────
// 帧一律带 model:"m"（与请求 model 一致 → model-label clean，不污染 findings 断言）；
// tool-call 帧不带 name/id：buildResponseScanUnit 经 collectToolCallParts 会把 name 拼进
// 扫描文本，会破坏「unit.text == 参数片段」的计长前提（AC-V2a-14 metering 语义）。
const contentFrame = (text: string): string =>
  JSON.stringify({ model: "m", choices: [{ delta: { content: text } }] });
const toolCallFrame = (args: string): string =>
  JSON.stringify({ model: "m", choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args } }] } }] });
const argsFragment = (i: number, len: number): string => {
  const marker = `#${i}#`;
  return marker + "a".repeat(len - marker.length);
};

function errorEvents(text: string): readonly string[] {
  return text.split("\n\n").filter((b) => b.startsWith("event: error"));
}

async function post(g: { url: string }, stream: boolean): Promise<Response> {
  return fetch(g.url + "/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", ...(stream ? { "x-llmveto-transport": "stream" } : {}) },
    body: JSON.stringify({ model: "m", ...(stream ? { stream: true } : {}), messages: [{ role: "user", content: "hi" }] }),
  });
}

// ── tool-call-shape 测试桩（SL-09 未来落位前的窗口契约扮演者） ──
// @mock-justified: tool-call-shape checker 于 SL-09 才落地；本桩以最小行为扮演其窗口
// 契约（extra.accumulated 跨片累积 + 超 LIMIT 产 window_overflow + 可选 revealAt 产出
// finding），AC-V2a-14/26 的判定必须经真实网关流式管线才能成立，桩是唯一可行载体。
interface StubHandle {
  readonly spec: CheckerSpec;
  readonly captured: number[]; // 每片后的累积值（extra.accumulated 观测）
}
function toolCallShapeStub(opts: { readonly revealAt?: number } = {}): StubHandle {
  const captured: number[] = [];
  const spec: CheckerSpec = {
    id: "tool-call-shape",
    side: "response",
    synchronous: true,
    safetyClass: true,
    threat: "T2a",
    runStream: (window: ScanWindow, chunk: ScanUnit) => {
      // 归并重投影是已消费内容的重放：不累积、不判定（否则 AC-V2a-14 的 i=2049 会被
      // 归并路径的重复计账提前触发）
      if (chunk.meta.llmveto_reprojected === true) {
        return [{ verdict: "clean", evidence: [] }, window] as const;
      }
      const prev = typeof window.extra?.accumulated === "number" ? window.extra.accumulated : 0;
      const total = prev + chunk.text.length;
      captured.push(total);
      const next: ScanWindow = {
        pendingBytes: window.pendingBytes,
        cursor: window.cursor,
        extra: { accumulated: total },
      };
      if (exceedsWindowOverflowLimit(prev, chunk.text.length)) {
        return [{ verdict: "error", evidence: [], reason: "window_overflow" }, next] as const;
      }
      if (opts.revealAt !== undefined && total >= opts.revealAt && prev < opts.revealAt) {
        return [
          {
            verdict: "finding",
            evidence: [{ checker: "tool-call-shape", threat: "T2a", verdict: "finding", rule_id: "stub-extra-alive" }],
          },
          next,
        ] as const;
      }
      return [{ verdict: "clean", evidence: [] }, next] as const;
    },
  };
  return { spec, captured };
}

// ── evidence 读取（evidence 在 res.end() 之后落盘，需轮询） ─────
interface ParsedFinding {
  readonly checker: string;
  readonly verdict: string;
  readonly rule_id?: string;
  readonly offsets?: readonly number[];
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

async function boot(...extra: readonly CheckerSpec[]): Promise<{ g: NonNullable<typeof gw>; evidencePath: string }> {
  const evidencePath = join(dir, "ev-" + Math.random().toString(36).slice(2) + ".jsonl");
  gw = await startGateway({
    config: {
      upstreamBaseUrl: mock!.url,
      evidenceWriter: new EvidenceWriter(evidencePath),
      ...(extra.length > 0 ? { extraCheckers: extra } : {}),
    },
  });
  return { g: gw, evidencePath };
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-V2a-25：offsets 精确等于全局 UTF-16 code unit 偏移（D-08）
// ─────────────────────────────────────────────────────────────────────────────
describe("SL-02 integration: AC-V2a-25 流式 offsets 全局对齐（D-07 单点推进）", () => {
  it("首片内命中：offsets=[5]，本片不交付（delivered_chunks=0）", async () => {
    // 手算：c1 = "aaaaa"(5 units) + U+200B + "bbbbb"(5)；U+200B 在 c1 内 code-unit index = 5。
    // 首片命中 → checker 收到推进前 cursor=0 → 全局 offset = 0 + 5 = 5。
    // 修复前（先推进再扫）：cursor 被预推进到 12 → 报 17（系统性偏移一个片长）。
    mock = await startMockUpstream({
      transport: "stream",
      chunks: [contentFrame("aaaaa\u200Bbbbbb"), contentFrame("never-delivered-tail")],
    });
    const { g, evidencePath } = await boot();
    const r = await post(g, true);
    expect(r.status).toBe(200);
    const text = await r.text();
    const errs = errorEvents(text);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('"delivered_chunks":0');
    expect(text).not.toContain("aaaaa"); // 命中片本身不交付
    expect(text).not.toContain("never-delivered-tail");
    const recs = await waitForEvidence(evidencePath);
    expect(recs).toHaveLength(1);
    const f = recs[0]!.findings.find((x) => x.checker === "invisible-unicode-scan");
    expect(f?.offsets).toEqual([5]);
    expect(recs[0]!.response_delivered).toEqual({ partial: true, delivered_chunks: 0 });
    expect(recs[0]!.action_taken).toBe("terminated_after_delivery");
  });

  it("末片内命中：offsets=[26]（前两片各 10 units 已消费），命中片不交付、前片已交付", async () => {
    // 手算：c1(10)+c2(10) → 命中片 c3 "uvwxyz"+U+200B，片内 index 6 → 推进前 cursor=20
    // → 全局 offset = 20 + 6 = 26。修复前：cursor 预推进 31 → 报 37。
    mock = await startMockUpstream({
      transport: "stream",
      chunks: [contentFrame("abcdefghij"), contentFrame("klmnopqrst"), contentFrame("uvwxyz\u200B")],
    });
    const { g, evidencePath } = await boot();
    const r = await post(g, true);
    const text = await r.text();
    expect(errorEvents(text)).toHaveLength(1);
    expect(text).toContain('"delivered_chunks":2');
    expect(text).toContain("abcdefghij"); // 命中前的片已交付
    expect(text).toContain("klmnopqrst");
    expect(text).not.toContain("uvwxyz"); // 命中片不交付
    const recs = await waitForEvidence(evidencePath);
    expect(recs[0]!.findings.find((x) => x.checker === "invisible-unicode-scan")?.offsets).toEqual([26]);
  });

  it("跨片边界命中：U+200B 恰在片首 → offsets=[20]（恰等于片边界位置）", async () => {
    // 手算：c3 首字符即 U+200B → 全局 offset = 10 + 10 + 0 = 20，与已交付两片的
    // 总长度严格相等（边界对齐锚点）。修复前：cursor 预推进 30 → 报 30。
    mock = await startMockUpstream({
      transport: "stream",
      chunks: [contentFrame("0123456789"), contentFrame("abcdefghij"), contentFrame("\u200Bxyz")],
    });
    const { g, evidencePath } = await boot();
    const r = await post(g, true);
    const text = await r.text();
    expect(text).toContain('"delivered_chunks":2');
    expect(text).not.toContain("xyz");
    const recs = await waitForEvidence(evidencePath);
    expect(recs[0]!.findings.find((x) => x.checker === "invisible-unicode-scan")?.offsets).toEqual([20]);
  });

  it("astral 字符在命中前（D-08 判别）：U+1F600 按 2 个 code unit 计 → offsets=[15]", async () => {
    // 手算：c1 = U+1F600（astral，2 code units）+ "0123456789"(10) = 12 units；
    // c2 "abc"+U+200B 片内 index 3 → 全局 offset = 12 + 3 = 15。
    // 码点（code point）口径误读会把 U+1F600 记 1 → 报 11+3=14。本断言钉死 code-unit 口径。
    mock = await startMockUpstream({
      transport: "stream",
      chunks: [contentFrame("\u{1F600}0123456789"), contentFrame("abc\u200B")],
    });
    const { g, evidencePath } = await boot();
    const r = await post(g, true);
    const text = await r.text();
    expect(text).toContain('"delivered_chunks":1');
    const recs = await waitForEvidence(evidencePath);
    expect(recs[0]!.findings.find((x) => x.checker === "invisible-unicode-scan")?.offsets).toEqual([15]);
  });

  it("非流式 + astral 前置：content 里 U+200B 的 code-unit index=7 → offsets=[7]，502 阻断", async () => {
    // 手算：text = U+1F600(2 units) + "hello"(5) → U+200B 在 code-unit index 7；
    // 码点口径误读 = 6。非流式路径同一口径（D-08 全局统一）。
    mock = await startMockUpstream({
      transport: "non-stream",
      body: JSON.stringify({ model: "m", choices: [{ message: { content: "\u{1F600}hello\u200Bworld" } }] }),
    });
    const { g, evidencePath } = await boot();
    const r = await post(g, false);
    expect(r.status).toBe(502);
    expect(await r.text()).toBe("");
    const recs = await waitForEvidence(evidencePath);
    expect(recs[0]!.action_taken).toBe("blocked_before_deliver");
    expect(recs[0]!.findings.find((x) => x.checker === "invisible-unicode-scan")?.offsets).toEqual([7]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-V2a-26：窗口按 checker 分持（测试桩 tool-call-shape × 隐形字符扫描同连接）
// ─────────────────────────────────────────────────────────────────────────────
describe("SL-02 integration: AC-V2a-26 per-checker 窗口隔离（注入桩）", () => {
  it("① 桩 extra 累积跨片存活：revealAt=250 恰在第 3 片（累计 300）触发 finding", async () => {
    // 逐片累积：100 → 200 → 300。若桩窗口未跨片存活，第 3 片时 prev=0、total=100，
    // 250 永不被跨过 → 无 finding。captured 同时是 stub 窗口账本的直接观测。
    const stub = toolCallShapeStub({ revealAt: 250 });
    mock = await startMockUpstream({
      transport: "stream",
      chunks: [1, 2, 3, 4, 5].map((i) => toolCallFrame(argsFragment(i, 100))),
    });
    const { g, evidencePath } = await boot(stub.spec);
    const r = await post(g, true);
    const text = await r.text();
    expect(errorEvents(text)).toHaveLength(1);
    expect(text).toContain('"delivered_chunks":2');
    expect(text).toContain("#1#");
    expect(text).toContain("#2#");
    expect(text).not.toContain("#3#"); // 命中片起不交付
    expect(stub.captured).toEqual([100, 200, 300]); // 精确 3 片后被 veto，4/5 片从未被扫
    const recs = await waitForEvidence(evidencePath);
    const f = recs[0]!.findings.find((x) => x.checker === "tool-call-shape");
    expect(f?.verdict).toBe("finding");
    expect(f?.rule_id).toBe("stub-extra-alive");
  });

  it("② 桩状态不污染隐形扫描：offsets=[190]（100+90），且桩不产 finding", async () => {
    // 手算：f1 args 100 units（桩累积 100）；f2 = "b"×90 + U+200B（片内 index 90）。
    // 隐形扫描推进前 cursor = 100 → 全局 offset = 100 + 90 = 190。
    // 若桩的累积（f2 后 191）泄漏进共享 cursor，offset 将 ≥191+90。桩全程 clean。
    const stub = toolCallShapeStub();
    mock = await startMockUpstream({
      transport: "stream",
      chunks: [toolCallFrame(argsFragment(1, 100)), toolCallFrame("b".repeat(90) + "\u200B")],
    });
    const { g, evidencePath } = await boot(stub.spec);
    const r = await post(g, true);
    const text = await r.text();
    expect(errorEvents(text)).toHaveLength(1);
    expect(text).toContain('"delivered_chunks":1');
    expect(stub.captured).toEqual([100, 191]); // 桩照常累积，但只进自己的窗口
    const recs = await waitForEvidence(evidencePath);
    expect(recs[0]!.findings.find((x) => x.checker === "invisible-unicode-scan")?.offsets).toEqual([190]);
    expect(recs[0]!.findings.find((x) => x.checker === "tool-call-shape")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-V2a-14：256KiB 单调用硬顶（metering = tool-call-shape 自身窗口累积字节）
// ─────────────────────────────────────────────────────────────────────────────
describe("SL-02 integration: AC-V2a-14 window_overflow（2049×128B fixture）", () => {
  it("i=2048（Σ=262144）放行交付；i=2049（Σ=262272>LIMIT）window_overflow 阻断 + event:error 恰一次", async () => {
    // metering 锚点：fixture 常量与 LIMIT 常量互证 —— 2048×128 == 262144 == LIMIT。
    // 恰好等于不触发（严格大于语义）；第 2049 片使 Σ 越顶 → 桩产 error(window_overflow)
    // → policy fail-closed block → 该片不交付。
    expect((OVERFLOW_CHUNKS - 1) * OVERFLOW_CHUNK_BYTES).toBe(STREAM_WINDOW_OVERFLOW_LIMIT);
    const stub = toolCallShapeStub();
    mock = await startMockUpstream({ transport: "stream", chunks: buildOverflowFrames() });
    const { g, evidencePath } = await boot(stub.spec);
    const r = await post(g, true);
    expect(r.status).toBe(200);
    const text = await r.text();
    const errs = errorEvents(text);
    const debugRecs = await waitForEvidence(evidencePath);
    expect(errs, `findings=${JSON.stringify(debugRecs[0]?.findings)}`).toHaveLength(1);
    expect(errs[0]).toContain('"delivered_chunks":2048');
    expect(text).toContain("#2048#"); // 第 2048 片已交付
    expect(text).not.toContain("#2049#"); // 越顶片不交付
    expect(text).not.toContain("[DONE]");
    expect(text.trimEnd().endsWith(errs[0]!)).toBe(true); // 其后无任何片
    // 桩窗口账本：每片恒 +128，恰在第 2049 片越顶
    expect(stub.captured).toHaveLength(OVERFLOW_CHUNKS);
    expect(stub.captured[0]).toBe(OVERFLOW_CHUNK_BYTES);
    expect(stub.captured[OVERFLOW_CHUNKS - 2]).toBe(STREAM_WINDOW_OVERFLOW_LIMIT); // 262144
    expect(stub.captured[OVERFLOW_CHUNKS - 1]).toBe(STREAM_WINDOW_OVERFLOW_LIMIT + OVERFLOW_CHUNK_BYTES);
    const recs = await waitForEvidence(evidencePath);
    expect(recs).toHaveLength(1);
    const rec = recs[0]!;
    expect(rec.chunk_count).toBe(2048);
    expect(rec.action_taken).toBe("terminated_after_delivery");
    expect(rec.response_delivered).toEqual({ partial: true, delivered_chunks: 2048 });
    const errFinding = rec.findings.find((x) => x.checker === "tool-call-shape" && x.verdict === "error");
    expect(errFinding?.rule_id).toBe("window_overflow");
  }, 120_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-V2a-20：终止流幂等判定面
// ─────────────────────────────────────────────────────────────────────────────
describe("SL-02 integration: AC-V2a-20 终止流幂等（event:error 恰一次）", () => {
  it("逐帧命中：error 恰一次、其后无片（含残尾）、无 [DONE]", async () => {
    mock = await startMockUpstream({
      transport: "stream",
      chunks: [contentFrame("hello"), contentFrame("x\u200By"), contentFrame("tail-never")],
    });
    const { g } = await boot();
    const r = await post(g, true);
    const text = await r.text();
    const errs = errorEvents(text);
    expect(errs).toHaveLength(1);
    expect(text).toContain("hello"); // 命中前的片已交付
    expect(text).not.toContain("tail-never");
    expect(text).not.toContain("[DONE]");
    expect(text.trimEnd().endsWith(errs[0]!)).toBe(true);
  });

  it("归并命中（转义跨帧切开）：error 恰一次，命中帧起不交付", async () => {
    // f1 含被切开的 \u200 转义前半，f2 补齐 → 逐帧均 clean、归并后命中（SL-01 路径）。
    // 双推进/双计数镜像缺陷会在此产生第二个 error 或提前触发——两条断言都是守卫。
    const f1 = JSON.stringify({ model: "m", choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "run_shell", arguments: '{"cmd":"echo \\u200' } }] } }] });
    const f2 = JSON.stringify({ model: "m", choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'b.png"}' } }] } }] });
    mock = await startMockUpstream({
      transport: "stream",
      chunks: [f1, f2, contentFrame("tail-never")],
    });
    const { g } = await boot();
    const r = await post(g, true);
    const text = await r.text();
    const errs = errorEvents(text);
    expect(errs).toHaveLength(1);
    expect(text).toContain("echo \\\\u200"); // f1 已交付（JSON 文本里反斜杠转义为 \\\\；转义前半逐帧无可判定内容）
    expect(text).not.toContain("b.png"); // 归并命中 → f2 起不交付
    expect(text).not.toContain("tail-never");
    expect(text).not.toContain("[DONE]");
    expect(text.trimEnd().endsWith(errs[0]!)).toBe(true);
  });

  it("逐帧与归并同时命中（双 veto 镜像探针）：仍恰一次 error", async () => {
    // 真实 U+200B 藏于 tool arguments：逐帧扫描先命中并终止 → 归并扫描（同一内容重投影）
    // 不再有第二次机会。若存在"先归并后逐帧"或双发路径，这里会出现第二个 event:error。
    mock = await startMockUpstream({
      transport: "stream",
      chunks: [toolCallFrame('{"cmd":"echo a\u200Bb"}'), contentFrame("tail-never")],
    });
    const { g } = await boot();
    const r = await post(g, true);
    const text = await r.text();
    const errs = errorEvents(text);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('"delivered_chunks":0');
    expect(text).not.toContain("tail-never");
    expect(text).not.toContain("[DONE]");
    expect(text.trimEnd().endsWith(errs[0]!)).toBe(true);
  });
});
