import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { verifyEvidenceFile } from "../../src/evidence/verify.ts";
import { EvidenceWriter } from "../../src/evidence/writer.ts";
import { startGateway } from "../../src/gateway/server.ts";
import { CANARY_MANAGED_ROUTES, sha256Hex } from "../../src/gateway/core.ts";
import { MANAGED_CONFIG_IDS as OPENCODE_IDS } from "../../src/adapters/opencode.ts";
import { delphiAdapter } from "../../src/adapters/delphi.ts";
import type { CheckerSpec, ScanUnit } from "../../src/shared/types.ts";
import { startMockUpstream, type MockUpstream } from "../utils/mock-upstream.ts";

// @test REQ-V2a-11 / AC-V2a-07（经网关）· AC-V2a-18⑥ · AC-V2a-21
// @intent SL-07 集成判定面：真实网关 + mock-upstream + 临时 stateDir（registry 在其中）。
//
//   AC-V2a-07（经网关）：受管路径请求注入后体上链——request_body_sha256/request_bytes 记
//     **注入后**体（D-04/#A = 上游实收的外部事实）、上游实收体含 canary、响应照常转发。
//   AC-V2a-18⑥：语义孪生对照（B_ok 注入 / B_skip 跳过）——findings/action_taken 逐字段
//     相等 + 顶层 reason 有/无对照 + inject_skipped 计数（排除集落 TWIN_EXCLUDED_FIELDS
//     常量表，本文件导出供跨 AC 复用；file budget 4 内不另建 fixture 助手文件）。
//   AC-V2a-21（接线级）：跨客户端共享匹配域快照——客户端 A 分配的 canary 出现在客户端 B
//     （delphi 受管路径）的 canary_candidates 里；快照排除请求方自身（D-05）。
//   六分支抽样裁量：SL-06 已在纯函数面全参数化钉死六分支；经网关只覆盖 1/2/4/6
//     （3/5 同一 inject() 入口，网关层再抽样无增量信息）。
//   非受管路径与 inject_skipped 严格区分：判定域外 = 无 canary 字段、无 reason、无计数。

let dir: string;
let mock: MockUpstream | null = null;
let gw: Awaited<ReturnType<typeof startGateway>> | null = null;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "llmveto-canary-inject-"));
});
afterEach(async () => {
  if (gw) { await gw.close(); gw = null; }
  if (mock) { await mock.close(); mock = null; }
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const SESSION_HEADER = "x-llmveto-session-id";

// ── AC-V2a-18⑥ 排除集常量表（导出：供其它 AC/切片复用，不散落在单个测试内） ──
// 前五项 = AC 冻结的 volatile 排除集；prev_hash/record_hash = append-only 审计链连接与封印位
// （逐记录必异——record_hash 覆盖整记录含 request_body_sha256，与 event_id/ts 同类 volatile，
// 非行为字段）；后两项 = D-04/#A mandated——request_bytes/
// request_body_sha256 记**注入后**体，孪生两趟（注入/跳过）结构必异，是对照主题
// 本身而非行为差异。新增条目须同批改 AC 文字。
export const TWIN_EXCLUDED_FIELDS: readonly string[] = Object.freeze([
  "ts", "event_id", "request_id", "seq", "latency",
  "prev_hash", "record_hash",
  "request_bytes", "request_body_sha256",
]);

// ── 受管路由镜像同源断言的素材（真实 adapter 产物推导，managed-path-probe 同纪律） ──
function adapterDerivedManagedRoutes(): ReadonlySet<string> {
  const expected = new Set<string>();
  for (const id of OPENCODE_IDS) {
    const seg = id.id.split(".");
    if (seg[1] === "provider") expected.add(`opencode/${seg[2]}`);
  }
  const patch = delphiAdapter.buildPatch("http://gw") as { endpoint: Record<string, string> };
  const segs = new URL(patch.endpoint.chat!).pathname.split("/").filter(Boolean);
  expected.add(`${segs[0]}/${segs[1]}`);
  return expected;
}

// ── evidence 读取（evidence 在 res.end() 之后落盘，需轮询；budget-gate 同款） ──
interface ParsedRecord {
  readonly reason?: string;
  readonly findings: readonly { checker: string; verdict: string; rule_id?: string }[];
  readonly action_taken: string;
  readonly session_id: string;
  readonly canary: null;
  readonly [key: string]: unknown;
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

interface RegistryFileView {
  readonly version: number;
  readonly rotation_count: number;
  readonly last_rotated_at: string | null;
  readonly entries: Readonly<Record<string, { readonly canary: string; readonly last_seen: number }>>;
}
function registryRead(path: string): RegistryFileView {
  return JSON.parse(readFileSync(path, "utf8")) as RegistryFileView;
}

// @mock-justified: meta.canary_* 是 ScanUnit.meta 的进程内通道，链上无落点（evidence canary
// 字段冻结 null、body_capture=metadata_only）——唯一观测面 = 响应侧扫描单元 meta，探测桩经
// GatewayConfig.extraCheckers 通道读取（budget-gate/stream-windows 同款载体），零生产改动。
function metaProbe(): { spec: CheckerSpec; seen: { injectedKey: boolean; injected: unknown; candidates: unknown }[] } {
  const seen: { injectedKey: boolean; injected: unknown; candidates: unknown }[] = [];
  const spec: CheckerSpec = {
    id: "canary-meta-probe",
    side: "response",
    synchronous: true,
    safetyClass: false,
    threat: "T0",
    runNonStream: (unit: ScanUnit) => {
      seen.push({
        injectedKey: "canary_injected" in unit.meta,
        injected: unit.meta.canary_injected,
        candidates: unit.meta.canary_candidates,
      });
      return { verdict: "clean", evidence: [] };
    },
  };
  return { spec, seen };
}

async function boot(opts: { extra?: readonly CheckerSpec[] } = {}): Promise<{ g: NonNullable<typeof gw>; evidencePath: string; registryPath: string }> {
  const registryPath = join(dir, "registry-" + Math.random().toString(36).slice(2) + ".json");
  const evidencePath = join(dir, "ev-" + Math.random().toString(36).slice(2) + ".jsonl");
  gw = await startGateway({
    config: {
      upstreamBaseUrl: mock!.url,
      evidenceWriter: new EvidenceWriter(evidencePath),
      canaryRegistryPath: registryPath,
      ...(opts.extra !== undefined && opts.extra.length > 0 ? { extraCheckers: opts.extra } : {}),
    },
  });
  return { g: gw, evidencePath, registryPath };
}

const chatBody = (content: string): string =>
  JSON.stringify({ model: "m", messages: [{ role: "user", content }] });

async function postManaged(g: { url: string }, body: string, session: string, turnId?: string): Promise<Response> {
  return fetch(`${g.url}/opencode/mock/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [SESSION_HEADER]: session,
      ...(turnId !== undefined ? { "x-llmveto-turn-id": turnId } : {}),
    },
    body,
  });
}

const okResponse = (): string =>
  JSON.stringify({ model: "m", choices: [{ message: { role: "assistant", content: "pong" } }] });

// ─────────────────────────────────────────────────────────────────────────────
// 判定域镜像同源 + AC-V2a-07 经网关（分支 1）
// ─────────────────────────────────────────────────────────────────────────────
describe("SL-07 integration ①: 判定域与 AC-V2a-07 经网关（D-04 sha 语义）", () => {
  it("CANARY_MANAGED_ROUTES 与 adapters 层 MANAGED_CONFIG_IDS 同源（镜像常量防漂移）", () => {
    expect(CANARY_MANAGED_ROUTES).toEqual(adapterDerivedManagedRoutes());
  });

  it("AC-V2a-07 经网关（分支 1）：注入后体上链且上游实收；sha/bytes=注入后体；B'=B[0..k]+canary+B[k..]", async () => {
    mock = await startMockUpstream({ transport: "non-stream", body: okResponse() });
    const probe = metaProbe();
    const { g, evidencePath, registryPath } = await boot({ extra: [probe.spec] });
    const original = chatBody("hello");
    const r = await postManaged(g, original, "sess-07");
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("pong"); // 转发正常：响应照常回传客户端

    const canary = registryRead(registryPath).entries["sess-07"]!.canary;
    expect(canary).toHaveLength(27); // AC-V2a-07：canary 串固定 27 字符
    const expectedForwarded = JSON.stringify({ model: "m", messages: [{ role: "user", content: "hello" + canary }] });
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]!.body).toBe(expectedForwarded); // 上游实收 = 注入后体

    const recs = await waitForEvidence(evidencePath);
    expect(recs[0]!.request_body_sha256).toBe(sha256Hex(expectedForwarded)); // D-04：链上 = 上游实收
    expect(recs[0]!.request_body_sha256).not.toBe(sha256Hex(original)); // 确非原体
    expect(recs[0]!.request_bytes).toBe(Buffer.byteLength(expectedForwarded, "utf8"));
    expect(recs[0]!.canary).toBe(null); // v1 冻结字段不回归（DR-013）
    expect("reason" in recs[0]!).toBe(false); // 注入成功：无异常 → reason 整键缺席
    expect(probe.seen[0]!.injectedKey).toBe(true);
    expect(probe.seen[0]!.injected).toBe(true); // meta.canary_injected=true
    expect(probe.seen[0]!.candidates).toEqual([]); // 首请求：快照排除自身 → 空
    const m = (await (await fetch(g.url + "/_llmveto/metrics")).json()) as Record<string, number>;
    expect(m.canary_injected).toBe(1); // metrics 计数面
    expect(verifyEvidenceFile(evidencePath).ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 六分支经网关抽样（分支 1 见 ①；2/4/6 见下；3/5 纯函数面 SL-06 已钉）
// ─────────────────────────────────────────────────────────────────────────────
describe("SL-07 integration ②: 六分支经网关抽样（1/2/4/6）", () => {
  it("分支 4 经网关：content 缺失 → 置为只含 canary 的文本（content' 恰等于 canary）", async () => {
    mock = await startMockUpstream({ transport: "non-stream", body: okResponse() });
    const { g, registryPath } = await boot();
    const body = JSON.stringify({ model: "m", messages: [{ role: "user" }] });
    const r = await postManaged(g, body, "sess-b4");
    expect(r.status).toBe(200);
    const canary = registryRead(registryPath).entries["sess-b4"]!.canary;
    expect(mock.requests[0]!.body).toBe(JSON.stringify({ model: "m", messages: [{ role: "user", content: canary }] }));
  });

  it("分支 2 经网关（抽样）：parts 数组 → 追加到最后一个 text part 尾部，其余逐 index 不变", async () => {
    mock = await startMockUpstream({ transport: "non-stream", body: okResponse() });
    const { g, registryPath } = await boot();
    const img = { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } };
    const body = JSON.stringify({ model: "m", messages: [{ role: "user", content: [{ type: "text", text: "describe" }, img] }] });
    const r = await postManaged(g, body, "sess-b2");
    expect(r.status).toBe(200);
    const canary = registryRead(registryPath).entries["sess-b2"]!.canary;
    const forwarded = JSON.parse(mock.requests[0]!.body) as { messages: { content: { type: string; text?: string }[] }[] };
    expect(forwarded.messages[0]!.content).toHaveLength(2); // 等长（分支 2 非分支 3）
    expect(forwarded.messages[0]!.content[0]!.text).toBe("describe" + canary); // 最后一个 text part 尾部
    expect(forwarded.messages[0]!.content[1]).toEqual(img); // 其余逐 index 相等
  });

  it("流式路径：注入只改请求体（SL-02 债边界），流式响应照常透传至 [DONE]", async () => {
    mock = await startMockUpstream({
      transport: "stream",
      chunks: [JSON.stringify({ model: "m", choices: [{ delta: { content: "hi" } }] })],
    });
    const { g, registryPath, evidencePath } = await boot();
    const body = JSON.stringify({ model: "m", stream: true, messages: [{ role: "user", content: "go" }] });
    const r = await postManaged(g, body, "sess-stream");
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toContain("[DONE]"); // 流式转发不受注入影响
    const canary = registryRead(registryPath).entries["sess-stream"]!.canary;
    expect(mock.requests[0]!.body).toBe(JSON.stringify({ model: "m", stream: true, messages: [{ role: "user", content: "go" + canary }] }));
    const recs = await waitForEvidence(evidencePath);
    expect(recs[0]!.request_body_sha256).toBe(sha256Hex(mock.requests[0]!.body)); // 注入后体上链（流式同语义）
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-V2a-18⑥ 语义孪生 + 分支 6
// ─────────────────────────────────────────────────────────────────────────────
describe("SL-07 integration ③: AC-V2a-18⑥ 语义孪生对照（分支 6 经网关）", () => {
  it("B_skip（缺 messages）跳过注入：reason=inject_skipped + 计数；与 B_ok 逐字段相等（排除集落常量表）", async () => {
    mock = await startMockUpstream({ transport: "non-stream", body: okResponse() });
    const { g, evidencePath, registryPath } = await boot();
    const okBody = JSON.stringify({ model: "m", messages: [{ role: "user", content: "twin" }] });
    const skipBody = JSON.stringify({ model: "m" }); // 逐字段相同、缺 messages（AC twin 形态）
    const rOk = await postManaged(g, okBody, "sess-twin", "turn-twin");
    const rSkip = await postManaged(g, skipBody, "sess-twin", "turn-twin"); // 同 turn 头：turn_id 不入 AC 排除集，孪生两趟须显式同值
    expect(rOk.status).toBe(200);
    expect(rSkip.status).toBe(200); // 跳过注入不阻断：请求仍正常过闸

    const canary = registryRead(registryPath).entries["sess-twin"]!.canary;
    const okForwarded = JSON.stringify({ model: "m", messages: [{ role: "user", content: "twin" + canary }] });
    const recs = await waitForEvidence(evidencePath, 2);
    expect(recs).toHaveLength(2);
    const okRec = recs.find((x) => x.request_body_sha256 === sha256Hex(okForwarded));
    const skipRec = recs.find((x) => x.request_body_sha256 === sha256Hex(skipBody));
    expect(okRec, "B_ok 趟 = 注入后体").toBeDefined();
    expect(skipRec, "B_skip 趟 = 原体").toBeDefined();

    // 逐字段对照：okRec 的键集减去排除集后与 skipRec 全等（findings/action_taken 含于其中）
    const keys = Object.keys(okRec!).filter((k) => !TWIN_EXCLUDED_FIELDS.includes(k));
    for (const k of keys) expect(skipRec![k], `twin field ${k}`).toEqual(okRec![k]);
    expect(okRec!.findings).toEqual(skipRec!.findings); // findings 集合逐字段相等（均无注入条目）
    expect(okRec!.findings.some((f) => (f.rule_id ?? "").includes("canary"))).toBe(false);
    expect(okRec!.action_taken).toBe(skipRec!.action_taken);

    // reason 有/无对照（key-absent 语义，非 null）
    expect("reason" in okRec!).toBe(false);
    expect("reason" in skipRec!).toBe(true);
    expect(skipRec!.reason).toBe("inject_skipped");

    // 上游实收：B_ok 注入体 / B_skip 原体
    expect(mock.requests[0]!.body).toBe(okForwarded);
    expect(mock.requests[1]!.body).toBe(skipBody);
    // status 计数落点（本切片 = metrics 面；durable 聚合属 SL-12）
    const m = (await (await fetch(g.url + "/_llmveto/metrics")).json()) as Record<string, number>;
    expect(m.inject_skipped).toBe(1);
    expect(m.canary_injected).toBe(1); // B_ok 趟注入成功各计各的
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-V2a-21 跨客户端共享匹配域（接线级）
// ─────────────────────────────────────────────────────────────────────────────
describe("SL-07 integration ④: AC-V2a-21 匹配域不区分客户端（D-05 快照接线）", () => {
  it("客户端 A（opencode）分配的 canary 出现在客户端 B（delphi 受管路径）的 canary_candidates；自身被排除", async () => {
    mock = await startMockUpstream({ transport: "non-stream", body: okResponse() });
    const probe = metaProbe();
    const { g, registryPath } = await boot({ extra: [probe.spec] });
    const rA = await postManaged(g, chatBody("from-a"), "sess-a");
    expect(rA.status).toBe(200);
    const rB = await fetch(`${g.url}/delphi/default/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", [SESSION_HEADER]: "sess-b" },
      body: chatBody("from-b"),
    });
    expect(rB.status).toBe(200);
    await rB.text();

    const entries = registryRead(registryPath).entries;
    expect(entries["sess-a"]).toBeDefined();
    expect(entries["sess-b"]).toBeDefined();
    expect(probe.seen[1]!.injected).toBe(true);
    expect(probe.seen[1]!.candidates).toContain(entries["sess-a"]!.canary); // 跨客户端共享匹配域
    expect(probe.seen[1]!.candidates).not.toContain(entries["sess-b"]!.canary); // D-05：排除请求方自身
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 非受管路径 / block 路径（判定域外的严格区分）
// ─────────────────────────────────────────────────────────────────────────────
describe("SL-07 integration ⑤: 判定域外（非受管 / block）与 inject_skipped 严格区分", () => {
  it("非受管路径（/v1 直连）：编排整体跳过——meta 无 canary 字段、无 reason、无计数、原体直转", async () => {
    mock = await startMockUpstream({ transport: "non-stream", body: okResponse() });
    const probe = metaProbe();
    const { g, evidencePath } = await boot({ extra: [probe.spec] });
    const original = chatBody("legacy");
    const r = await fetch(`${g.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" }, // 无路径身份 → client=unknown → 判定域外
      body: original,
    });
    expect(r.status).toBe(200);
    expect(mock.requests[0]!.body).toBe(original); // 原体直转（无注入）
    const recs = await waitForEvidence(evidencePath);
    expect("reason" in recs[0]!).toBe(false); // 判定域外 ≠ inject_skipped：无 reason
    expect(recs[0]!.canary).toBe(null);
    expect(probe.seen[0]!.injectedKey).toBe(false); // meta 无 canary 字段（非 false 值）
    expect(probe.seen[0]!.candidates).toBeUndefined(); // 无快照
    const m = (await (await fetch(g.url + "/_llmveto/metrics")).json()) as Record<string, number>;
    expect(m.canary_injected).toBe(0); // 无计数（判定域外不计）
    expect(m.inject_skipped).toBe(0);
    expect(m.registry_unavailable).toBe(0);
  });

  it("block 判定后不进入注入编排：未转发、原体 sha、registry 未分配（§4.4 已过闸前置）", async () => {
    // @mock-justified: 请求侧阻断桩——未注册 id + safetyClass=true → mapBySpec 兜底 finding=block；
    // 真实阻断路径（invisible-unicode-scan）已在 v1 e2e 覆盖，此处只需"请求侧 block"这一状态。
    const blockStub: CheckerSpec = {
      id: "block-probe",
      side: "request",
      synchronous: true,
      safetyClass: true,
      threat: "T0",
      runNonStream: () => ({ verdict: "finding", evidence: [{ checker: "block-probe", threat: "T0", verdict: "finding" }] }),
    };
    mock = await startMockUpstream({ transport: "non-stream", body: okResponse() });
    const { g, evidencePath, registryPath } = await boot({ extra: [blockStub] });
    const original = chatBody("blocked");
    const r = await postManaged(g, original, "sess-block");
    expect(r.status).toBe(502);
    expect(mock.requests).toHaveLength(0); // 未转发
    const recs = await waitForEvidence(evidencePath);
    expect(recs[0]!.request_body_sha256).toBe(sha256Hex(original)); // 原体（无注入、无编排）
    expect("reason" in recs[0]!).toBe(false);
    expect(existsSync(registryPath)).toBe(false); // 未过闸 → 不分配（分配点 = 过闸时）
  });
});
