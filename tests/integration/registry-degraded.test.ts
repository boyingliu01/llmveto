import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { EvidenceWriter } from "../../src/evidence/writer.ts";
import { consumeRotateSentinel, startGateway } from "../../src/gateway/server.ts";
import { CanaryStore } from "../../src/canary/store.ts";
import type { CheckerSpec, ScanUnit } from "../../src/shared/types.ts";
import { startMockUpstream, type MockUpstream } from "../utils/mock-upstream.ts";

// @test REQ-V2a-11 / AC-V2a-19①③ · D-03 控制通道与哨兵消费
// @intent SL-07 集成判定面（第二文件）：
//
//   AC-V2a-19①：registry 文件三类损坏（非法 JSON / 未知 version / 结构不符）各 ≥1 →
//     顶层 reason=registry_unavailable + metrics 同名计数非零 + findings 无注入条目 +
//     上游仍收到**未注入**原体（fail-open 可观测：覆盖降级不是阻断，也不是静默）。
//   AC-V2a-19③（运行时侧本切片前置）：注入 70 会话（≥30）后 registry 读回恒为合法 JSON
//     且 session ≤64（LRU 截断）；**完整 8×30s 压力矩阵属 SL-08/SL-12 的 19③ 收尾（handoff）**。
//   POST /_llmveto/canary/rotate：响应含 rotation_count/last_rotated_at；rotate 后新分配
//     用新串（旧串整体退出匹配域）。
//   admin 控制通道不产 evidence：/_llmveto/* 请求后链上无新记录（非受管路径零旁路）。
//   哨兵启动消费（D-03）：零字节 → rotate+删除 / 非零 → 忽略+删除（不轮换）/
//     无文件 → 不动 / 删除失败 → 序内重试 3 次后放弃 + stderr（DI 注入观测）。

let dir: string;
let mock: MockUpstream | null = null;
let gw: Awaited<ReturnType<typeof startGateway>> | null = null;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "llmveto-registry-degraded-"));
});
afterEach(async () => {
  if (gw) { await gw.close(); gw = null; }
  if (mock) { await mock.close(); mock = null; }
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const SESSION_HEADER = "x-llmveto-session-id";

// ── AC-V2a-19① 三类损坏 fixture（参数化表） ─────────────────────────────────
const CORRUPT_REGISTRY_FIXTURES: readonly { readonly label: string; readonly content: string }[] = Object.freeze([
  { label: "invalid_json（非法 JSON）", content: '{"version": 1, "entries": { // truncated' },
  { label: "unknown_version（版本不识别）", content: JSON.stringify({ version: 999, rotation_count: 0, last_rotated_at: null, entries: {} }) },
  { label: "malformed_structure（结构不符）", content: JSON.stringify({ version: 1, rotation_count: 0, last_rotated_at: null, entries: { broken: { canary: 42, last_seen: "not-a-number" } } }) },
]);

// ── evidence / registry 读取 ────────────────────────────────────────────────
interface ParsedRecord {
  readonly reason?: string;
  readonly findings: readonly { checker: string; verdict: string; rule_id?: string }[];
  readonly action_taken: string;
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
async function waitForEvidence(path: string): Promise<readonly ParsedRecord[]> {
  for (let i = 0; i < 250; i++) {
    const lines = readEvidenceLines(path);
    if (lines.length > 0) return lines;
    await new Promise((r) => setTimeout(r, 20));
  }
  return readEvidenceLines(path);
}
interface RegistryFileView {
  readonly rotation_count: number;
  readonly last_rotated_at: string | null;
  readonly entries: Readonly<Record<string, { readonly canary: string; readonly last_seen: number }>>;
}
function registryRead(path: string): RegistryFileView {
  return JSON.parse(readFileSync(path, "utf8")) as RegistryFileView;
}

// @mock-justified: meta.canary_* 无链上落点（canary 冻结 null）——19① 的"不得申报已注入"
// 断言需要响应侧扫描单元 meta 观测面，探测桩经 extraCheckers 通道读取（canary-inject 同款）。
function metaProbe(): { spec: CheckerSpec; seen: { injectedKey: boolean; injected: unknown; candidates: unknown }[] } {
  const seen: { injectedKey: boolean; injected: unknown; candidates: unknown }[] = [];
  const spec: CheckerSpec = {
    id: "canary-meta-probe",
    side: "response",
    synchronous: true,
    safetyClass: false,
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

type GatewayHandle = Awaited<ReturnType<typeof startGateway>>;

async function boot(opts: { registryContent?: string; extra?: readonly CheckerSpec[] } = {}): Promise<{ g: GatewayHandle; evidencePath: string; registryPath: string }> {
  const registryPath = join(dir, "registry-" + Math.random().toString(36).slice(2) + ".json");
  if (opts.registryContent !== undefined) writeFileSync(registryPath, opts.registryContent, "utf8");
  const evidencePath = join(dir, "ev-" + Math.random().toString(36).slice(2) + ".jsonl");
  const handle = await startGateway({
    config: {
      upstreamBaseUrl: mock !== null ? mock.url : "",
      evidenceWriter: new EvidenceWriter(evidencePath),
      canaryRegistryPath: registryPath,
      ...(opts.extra !== undefined && opts.extra.length > 0 ? { extraCheckers: opts.extra } : {}),
    },
  });
  gw = handle;
  return { g: handle, evidencePath, registryPath };
}

const chatBody = (content: string): string =>
  JSON.stringify({ model: "m", messages: [{ role: "user", content }] });
const okResponse = (): string =>
  JSON.stringify({ model: "m", choices: [{ message: { role: "assistant", content: "pong" } }] });

async function postManaged(g: { url: string }, body: string, session: string): Promise<Response> {
  return fetch(`${g.url}/opencode/mock/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", [SESSION_HEADER]: session },
    body,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-V2a-19①：三类损坏 → registry_unavailable（fail-open 可观测）
// ─────────────────────────────────────────────────────────────────────────────
describe("SL-07 integration ①: registry 损坏三类 → 不注入不匹配 + 顶层 reason + 计数（AC-V2a-19①）", () => {
  it.each(CORRUPT_REGISTRY_FIXTURES)("$label → reason=registry_unavailable、metrics 非零、findings 无注入条目、上游收到未注入体", async (fixture) => {
    mock = await startMockUpstream({ transport: "non-stream", body: okResponse() });
    const probe = metaProbe();
    const { g, evidencePath, registryPath } = await boot({ registryContent: fixture.content, extra: [probe.spec] });
    const original = chatBody("degraded");
    const r = await postManaged(g, original, "sess-degraded");
    expect(r.status).toBe(200); // fail-open：流量照常过闸（覆盖降级不是阻断）

    expect(mock.requests[0]!.body).toBe(original); // 上游仍收到**未注入**原体
    const recs = await waitForEvidence(evidencePath);
    expect("reason" in recs[0]!).toBe(true);
    expect(recs[0]!.reason).toBe("registry_unavailable"); // 顶层 reason 无条件成立（D-10 网关值优先）
    expect(recs[0]!.findings).toEqual([]); // benign 场景强断言：findings 无注入条目（描述位不进裁决位）
    expect(recs[0]!.canary).toBe(null); // 不得申报"已注入"（链上 canary 恒 null）
    expect(probe.seen[0]!.injectedKey).toBe(true);
    expect(probe.seen[0]!.injected).toBe(false); // meta.canary_injected=false
    expect(probe.seen[0]!.candidates).toBeUndefined(); // 无 canary_candidates 快照（D-05 不可用即无快照）

    const m = (await (await fetch(g.url + "/_llmveto/metrics")).json()) as Record<string, number>;
    expect(m.registry_unavailable).toBe(1); // 同名计数非零
    expect(m.canary_injected).toBe(0);
    expect(m.inject_skipped).toBe(0);
    expect(readFileSync(registryPath, "utf8")).toBe(fixture.content); // 损坏态不被静默重写（本请求不落盘）
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-V2a-19③ 运行时侧前置：原子读回 + LRU 上界
// ─────────────────────────────────────────────────────────────────────────────
describe("SL-07 integration ②: AC-V2a-19③ 运行时侧前置（70 会话注入，registry 读回恒合法 JSON 且 ≤64）", () => {
  it("70 个会话逐请求注入，每请求后读回 registry：JSON.parse 恒成功、session 数 ≤64（终值=64）", async () => {
    mock = await startMockUpstream({ transport: "non-stream", body: okResponse() });
    const { g, registryPath } = await boot();
    for (let i = 0; i < 70; i++) {
      const r = await postManaged(g, chatBody("stress-" + i), "stress-" + i);
      expect(r.status).toBe(200);
      await r.text();
      // 单写者原子写（tmp+renameSync）间读回：不允许半行/非法 JSON
      const parsed = JSON.parse(readFileSync(registryPath, "utf8")) as { entries: Record<string, unknown> };
      expect(Object.keys(parsed.entries).length).toBeLessThanOrEqual(64); // §4.2 LRU 定值
    }
    const final = registryRead(registryPath);
    expect(Object.keys(final.entries)).toHaveLength(64); // 70 > 64 → LRU 截断生效
    // 完整 8×30s 交叠压力矩阵（barrier 时序注入）不在本切片：handoff → SL-08/SL-12 收尾
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /_llmveto/canary/rotate（D-03 控制通道）
// ─────────────────────────────────────────────────────────────────────────────
describe("SL-07 integration ③: POST rotate 端点 + admin 零 evidence + 未配置 503", () => {
  it("rotate：响应含 rotation_count/last_rotated_at；rotate 后新分配用新串、旧串整体退出匹配域", async () => {
    mock = await startMockUpstream({ transport: "non-stream", body: okResponse() });
    const { g, registryPath } = await boot();
    await postManaged(g, chatBody("pre"), "rot-sess");
    const oldCanary = registryRead(registryPath).entries["rot-sess"]!.canary;

    const resp = await fetch(`${g.url}/_llmveto/canary/rotate`, { method: "POST" });
    expect(resp.status).toBe(200); // 等待确认后返回
    const body = (await resp.json()) as { rotation_count: number; last_rotated_at: string };
    expect(body.rotation_count).toBe(1);
    expect(Number.isNaN(Date.parse(body.last_rotated_at))).toBe(false);

    const after = registryRead(registryPath);
    expect(after.rotation_count).toBe(1);
    expect(after.entries["rot-sess"]!.canary).not.toBe(oldCanary); // 旧串即刻退出匹配域
    await postManaged(g, chatBody("post"), "rot-new");
    const post = registryRead(registryPath);
    expect(post.entries["rot-new"]!.canary).not.toBe(oldCanary); // 新分配用新串
    expect(Object.values(post.entries).map((e) => e.canary)).not.toContain(oldCanary);
  });

  it("admin 路由不产 evidence：/_llmveto/* 请求后链上无新记录；未知 admin 路由 404", async () => {
    mock = await startMockUpstream({ transport: "non-stream", body: okResponse() });
    const { g, evidencePath } = await boot();
    await fetch(`${g.url}/_llmveto/canary/rotate`, { method: "POST" });
    await fetch(`${g.url}/_llmveto/metrics`);
    const unknown = await fetch(`${g.url}/_llmveto/whatever`, { method: "POST" });
    expect(unknown.status).toBe(404);
    expect(existsSync(evidencePath)).toBe(false); // 零旁路：非受管路径不落链
    await postManaged(g, chatBody("after-admin"), "sess-admin"); // sanity：受管请求照常落一条
    expect(await waitForEvidence(evidencePath)).toHaveLength(1);
  });

  it("未配置 canaryRegistryPath 时 admin rotate → 503（不误报轮换成功）", async () => {
    mock = await startMockUpstream({ transport: "non-stream", body: okResponse() });
    const evidencePath = join(dir, "ev-nocanary-" + Math.random().toString(36).slice(2) + ".jsonl");
    gw = await startGateway({ config: { upstreamBaseUrl: mock.url, evidenceWriter: new EvidenceWriter(evidencePath) } });
    const resp = await fetch(`${gw.url}/_llmveto/canary/rotate`, { method: "POST" });
    expect(resp.status).toBe(503);
    const m = (await (await fetch(gw.url + "/_llmveto/metrics")).json()) as Record<string, number>;
    expect(m.canary_injected).toBe(0); // 计数面恒可用（全 0）
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 哨兵启动消费（D-03：零字节哨兵 = CLI 离线轮换标记，#B）
// ─────────────────────────────────────────────────────────────────────────────
describe("SL-07 integration ④: 哨兵启动消费（rotate.request 生命周期，D-03/#B）", () => {
  // 哨兵定位 = registry 同目录固定名（stateDir 语义：canary-registry.json 旁的 canary-rotate.request）。
  // 每测试独占子目录：哨兵消费发生在 startGateway 内（listen 前），目录隔离避免用例间串扰。
  function seed(sub: string, canary?: string): { registryPath: string; sentinel: string } {
    const subDir = join(dir, sub);
    mkdirSync(subDir, { recursive: true });
    const registryPath = join(subDir, "canary-registry.json");
    if (canary !== undefined) {
      writeFileSync(registryPath, JSON.stringify({ version: 1, rotation_count: 0, last_rotated_at: null, entries: { "seed-sess": { canary, last_seen: Date.now() } } }), "utf8");
    }
    return { registryPath, sentinel: join(subDir, "canary-rotate.request") };
  }
  async function bootAt(registryPath: string): Promise<GatewayHandle> {
    const evidencePath = join(dir, "ev-" + Math.random().toString(36).slice(2) + ".jsonl");
    const handle = await startGateway({
      config: { upstreamBaseUrl: mock !== null ? mock.url : "", evidenceWriter: new EvidenceWriter(evidencePath), canaryRegistryPath: registryPath },
    });
    gw = handle;
    return handle;
  }
  const SEED_A = "llmveto-canary-" + "a".repeat(12); // 27 字符种子串（AC-V2a-07 定长）

  it("① 零字节哨兵 → 启动即轮换 + 成功后删除（canarySentinel=rotated）", async () => {
    mock = await startMockUpstream({ transport: "non-stream", body: okResponse() });
    const { registryPath, sentinel } = seed("s1", SEED_A);
    writeFileSync(sentinel, "", "utf8"); // CLI 离线轮换标记形态：零字节（#B 拍板收窄）
    const g = await bootAt(registryPath);
    expect(g.canarySentinel).toBe("rotated");
    expect(existsSync(sentinel)).toBe(false); // 成功即删：重放锚消失
    const after = registryRead(registryPath);
    expect(after.rotation_count).toBe(1);
    expect(after.last_rotated_at).not.toBeNull();
    const newCanary = after.entries["seed-sess"]!.canary;
    expect(newCanary).not.toBe(SEED_A);
    expect(newCanary).toHaveLength(27); // 轮换后仍 27 字符
  });

  it("② 非零字节哨兵（损坏）→ 忽略 + 删除、不轮换（canarySentinel=corrupt_ignored）", async () => {
    mock = await startMockUpstream({ transport: "non-stream", body: okResponse() });
    const { registryPath, sentinel } = seed("s2", SEED_A);
    writeFileSync(sentinel, "garbage", "utf8"); // 哨兵只承认零字节形态
    const g = await bootAt(registryPath);
    expect(g.canarySentinel).toBe("corrupt_ignored");
    expect(existsSync(sentinel)).toBe(false); // 仍删除：损坏标记不迁移到下次启动再误判
    const after = registryRead(registryPath);
    expect(after.rotation_count).toBe(0); // 未轮换
    expect(after.entries["seed-sess"]!.canary).toBe(SEED_A); // 串不变
  });

  it("③ 无哨兵 → 不动（canarySentinel=absent；registry 缺失时启动不落盘）", async () => {
    mock = await startMockUpstream({ transport: "non-stream", body: okResponse() });
    const { registryPath, sentinel } = seed("s3");
    const g = await bootAt(registryPath);
    expect(g.canarySentinel).toBe("absent");
    expect(existsSync(sentinel)).toBe(false);
    expect(existsSync(registryPath)).toBe(false); // 首启空态：分配点在过闸请求，不在启动
  });

  it("④ 删除失败：序内重试 3 次（共 4 次 unlink）后放弃 + stderr（DI 观测；轮换已发生、幂等重放）", () => {
    const { registryPath, sentinel } = seed("s4", SEED_A);
    writeFileSync(sentinel, "", "utf8");
    const store = new CanaryStore(registryPath);
    let unlinkCalls = 0;
    const logs: string[] = [];
    const outcome = consumeRotateSentinel(store, sentinel, {
      unlink: () => { unlinkCalls += 1; throw new Error("EPERM: simulated"); },
      log: (line) => logs.push(line),
    });
    expect(outcome).toBe("rotated_delete_failed");
    expect(unlinkCalls).toBe(4); // 初次 + 3 次重试，同启动序内
    expect(logs[0]).toContain("delete failed");
    expect(existsSync(sentinel)).toBe(true); // 放弃后哨兵留存 → 下次启动重放（轮换幂等，不丢标记）
    expect(store.rotationCount).toBe(1); // 轮换已发生：删除失败不回滚
    // 重放安全（D-03 幂等契约）：第二次消费再轮换一次，旧串整体失效、rotation_count 只增
    const firstCanary = registryRead(registryPath).entries["seed-sess"]!.canary;
    const replay = consumeRotateSentinel(store, sentinel, {
      unlink: () => { throw new Error("EPERM: simulated"); },
      log: (line) => logs.push(line),
    });
    expect(replay).toBe("rotated_delete_failed");
    expect(store.rotationCount).toBe(2);
    expect(registryRead(registryPath).entries["seed-sess"]!.canary).not.toBe(firstCanary);
  });

  it("⑤ 损坏哨兵 + 删除失败：忽略不轮换（canarySentinel=corrupt_delete_failed）", () => {
    const { registryPath, sentinel } = seed("s5", SEED_A);
    writeFileSync(sentinel, "junk", "utf8");
    const store = new CanaryStore(registryPath);
    let unlinkCalls = 0;
    const logs: string[] = [];
    const outcome = consumeRotateSentinel(store, sentinel, {
      unlink: () => { unlinkCalls += 1; throw new Error("EBUSY: simulated"); },
      log: (line) => logs.push(line),
    });
    expect(outcome).toBe("corrupt_delete_failed");
    expect(store.rotationCount).toBe(0); // 损坏 → 不轮换
    expect(logs.some((l) => l.includes("corrupt"))).toBe(true); // stderr 携带成因
    expect(unlinkCalls).toBe(4); // 删除侧同样重试后放弃
  });

  it("⑥ registry 不可用：零字节哨兵不消费（不轮换、不删除、损坏文件字节不变）", () => {
    const subDir = join(dir, "s6");
    mkdirSync(subDir, { recursive: true });
    const registryPath = join(subDir, "canary-registry.json");
    const corrupt = '{"version": 1, "entries": { // truncated';
    writeFileSync(registryPath, corrupt, "utf8");
    const sentinel = join(subDir, "canary-rotate.request");
    writeFileSync(sentinel, "", "utf8");
    const store = new CanaryStore(registryPath);
    expect(store.loadStatus.status).toBe("registry_unavailable");
    const logs: string[] = [];
    const outcome = consumeRotateSentinel(store, sentinel, {
      unlink: () => { throw new Error("must not unlink"); },
      log: (line) => logs.push(line),
    });
    expect(outcome).toBe("skipped_registry_unavailable");
    expect(store.rotationCount).toBe(0); // 不得「空内存态轮换」覆盖损坏文件
    expect(readFileSync(registryPath, "utf8")).toBe(corrupt); // 取证现场保留
    expect(existsSync(sentinel)).toBe(true); // 修复 registry 后下次启动重放
    expect(logs[0]).toContain("registry unavailable");
  });
});
