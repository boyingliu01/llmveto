import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { EvidenceWriter } from "../../src/evidence/writer.ts";
import { startGateway } from "../../src/gateway/server.ts";
import { opencodeAdapter, MANAGED_CONFIG_IDS as OPENCODE_IDS } from "../../src/adapters/opencode.ts";
import { delphiAdapter, MANAGED_CONFIG_IDS as DELPHI_IDS } from "../../src/adapters/delphi.ts";
import type { Env } from "../../src/adapters/index.ts";
import { startMockUpstream, type MockUpstream } from "../utils/mock-upstream.ts";

// @test REQ-VETO-014
// @intent AC-VETO-014-01 受管路径过闸（M2.6）：探测必须经"真实 adapter 产物"发起——
//         先 applyManagedConfig 把网关 baseURL/endpoint 落盘，再 readCurrentConfig 读回，
//         请求 URL 取自读回的产物值（而非测试侧从 configId 反解路径段）。
//         这样 E2E 真正闭合 adapter→gateway 路由契约：adapter 写出的 URL 若与网关路由约定漂移，
//         探测即失败/证据身份不符，测试可捕获。
// @covers AC-VETO-014-01

let dir: string;
let gw: Awaited<ReturnType<typeof startGateway>> | null = null;
let mock: MockUpstream | null = null;
let writerPath: string;

beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "llmveto-e2e-probe-")); });
afterEach(async () => {
  if (gw) { await gw.close(); gw = null; }
  if (mock) { await mock.close(); mock = null; }
});

async function boot() {
  mock = await startMockUpstream({ transport: "non-stream", body: '{"model":"gpt-4o","choices":[{"message":{"content":"ok"}}]}' });
  writerPath = join(dir, "ev-" + Math.random().toString(36).slice(2) + ".jsonl");
  const writer = new EvidenceWriter(writerPath);
  const snapshot = join(dir, "models-" + Math.random().toString(36).slice(2) + ".json");
  writeFileSync(snapshot, JSON.stringify({ object: "list", data: [{ id: "gpt-4o", owned_by: "llmveto-snapshot" }] }), "utf8");
  // catch-all upstream=mock；bench/opencode/delphi 未命中路由表 → 回落 catch-all；models 快照本地伺服
  gw = await startGateway({ config: { upstreamBaseUrl: mock.url, evidenceWriter: writer, modelsSnapshotPath: snapshot } });
  return gw;
}

function readRecords(): { client: string; provider_id: string; transport: string }[] {
  if (!existsSync(writerPath)) return []; // evidence 懒建：无 append 则文件不存在
  return readFileSync(writerPath, "utf8")
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as { client: string; provider_id: string; transport: string });
}

async function postChat(url: string): Promise<void> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "probe " + url }] }),
  });
  if (r.status !== 200) throw new Error(`probe ${url} expected 200, got ${r.status}`);
  await r.text();
}

describe("SL-14 e2e: managed-path probe via REAL adapter artifacts (REQ-VETO-014)", () => {
  it("AC-01 OpenCode provider baseURL：applyManagedConfig 产物读回后过闸 → evidence client+provider_id", async () => {
    const g = await boot();
    const env: Env = { LLMVETO_OPENCODE_CONFIG: join(dir, "oc-" + Math.random().toString(36).slice(2) + ".json") };
    opencodeAdapter.applyManagedConfig(env, g.url);
    const cfg = opencodeAdapter.readCurrentConfig(env);
    const provider = (cfg.provider ?? {}) as Record<string, { options?: { baseURL?: string } }>;

    const chatIds = OPENCODE_IDS.filter((x) => x.id.includes(".options.baseURL"));
    expect(chatIds.length).toBeGreaterThan(0);
    for (const id of chatIds) {
      const key = id.id.split(".")[2]!;
      const baseURL = provider[key]?.options?.baseURL;
      // 请求 URL 来自 adapter 真实产物；缺字段 = adapter 漂移，直接失败
      expect(baseURL, `adapter artifact missing baseURL for ${key}`).toBeTruthy();
      await postChat(`${baseURL}/v1/chat/completions`);
    }

    const recs = readRecords();
    expect(recs.length).toBe(chatIds.length);
    for (const id of chatIds) {
      const key = id.id.split(".")[2]!;
      expect(recs.some((r) => r.client === "opencode" && r.provider_id === key)).toBe(true);
    }
  });

  it("AC-01 OpenCode models URL：产物里的 OPENCODE_MODELS_URL GET → 本地快照 200，不产 chat evidence", async () => {
    const g = await boot();
    const env: Env = { LLMVETO_OPENCODE_CONFIG: join(dir, "oc-" + Math.random().toString(36).slice(2) + ".json") };
    opencodeAdapter.applyManagedConfig(env, g.url);
    const cfg = opencodeAdapter.readCurrentConfig(env);
    const modelsURL = ((cfg.env ?? {}) as Record<string, string>).OPENCODE_MODELS_URL;
    expect(modelsURL, "adapter artifact missing OPENCODE_MODELS_URL").toBeTruthy();

    const r = await fetch(modelsURL!);
    expect(r.status).toBe(200);
    const body = JSON.parse(await r.text()) as { data?: { owned_by?: string }[] };
    expect(body.data?.[0]?.owned_by).toBe("llmveto-snapshot"); // 命中本地快照而非真源
    // models GET 是本地伺服：不落 chat evidence（零旁路 = 不产生伪造 provider_id 记录）
    expect(readRecords().length).toBe(0);
  });

  it("AC-01 Delphi endpoint 产物过闸 → evidence client=delphi", async () => {
    const g = await boot();
    const env: Env = { LLMVETO_DELPHI_CONFIG: join(dir, "dp-" + Math.random().toString(36).slice(2) + ".json") };
    delphiAdapter.applyManagedConfig(env, g.url);
    const cfg = delphiAdapter.readCurrentConfig(env);
    const ep = (cfg.endpoint ?? {}) as Record<string, string>;

    for (const id of DELPHI_IDS) {
      const key = id.id.split(".")[2]!;
      const url = ep[key];
      expect(url, `adapter artifact missing endpoint for ${key}`).toBeTruthy();
      await postChat(url!); // Delphi 产物是完整 endpoint URL（含 /v1/chat/completions）
    }

    const recs = readRecords();
    expect(recs.length).toBe(DELPHI_IDS.length);
    for (const r of recs) expect(r.client).toBe("delphi");
  });
});
