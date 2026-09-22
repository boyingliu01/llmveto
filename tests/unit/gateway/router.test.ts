import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { EvidenceWriter } from "../../../src/evidence/writer.ts";
import { startGateway, parseRoute, resolveUpstreamBase, joinUpstream } from "../../../src/gateway/server.ts";
import type { GatewayConfig } from "../../../src/gateway/core.ts";
import { startMockUpstream, type MockUpstream } from "../../utils/mock-upstream.ts";

// @test REQ-VETO-009
// @intent M1.3 路径路由：/<client>/<provider>/<rest> 解析、upstream 优先级
//         （header > upstreams["c/p"] > upstreams["c/*"] > catch-all > fail-closed 502）、
//         /opencode/models 本地快照伺服。

let dir: string;
let gw: Awaited<ReturnType<typeof startGateway>> | null = null;
let mock: MockUpstream | null = null;

beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "llmveto-router-")); });
afterEach(async () => {
  if (gw) { await gw.close(); gw = null; }
  if (mock) { await mock.close(); mock = null; }
});

describe("parseRoute", () => {
  it("/opencode/openai/v1/chat/completions → client/provider/rest", () => {
    expect(parseRoute("/opencode/openai/v1/chat/completions")).toEqual({
      client: "opencode", providerId: "openai", rest: "/v1/chat/completions",
    });
  });
  it("/delphi/default/v1/chat/completions?stream=1 → query 剥离", () => {
    expect(parseRoute("/delphi/default/v1/chat/completions?stream=1")).toEqual({
      client: "delphi", providerId: "default", rest: "/v1/chat/completions",
    });
  });
  it("/v1/chat/completions → 保留段不作 client（legacy 路径）", () => {
    expect(parseRoute("/v1/chat/completions")).toEqual({
      client: null, providerId: null, rest: "/v1/chat/completions",
    });
  });
  it("/opencode/models → provider 段缺失，rest=/models", () => {
    expect(parseRoute("/opencode/models")).toEqual({
      client: "opencode", providerId: null, rest: "/models",
    });
  });
});

describe("resolveUpstreamBase 优先级", () => {
  const cfg: Pick<GatewayConfig, "upstreamBaseUrl" | "upstreams"> = {
    upstreamBaseUrl: "http://catch-all:1",
    upstreams: { "opencode/openai": "http://exact:1", "delphi/*": "http://client-wide:1" },
  };
  it("header 优先（TEST 契约 #1）", () => {
    const route = parseRoute("/opencode/openai/v1/chat/completions");
    expect(resolveUpstreamBase(route, { "x-llmveto-upstream-url": "http://header:1" }, cfg)).toBe("http://header:1");
  });
  it("upstreams[\"c/p\"] > upstreams[\"c/*\"] > catch-all", () => {
    expect(resolveUpstreamBase(parseRoute("/opencode/openai/v1/x"), {}, cfg)).toBe("http://exact:1");
    expect(resolveUpstreamBase(parseRoute("/delphi/default/v1/x"), {}, cfg)).toBe("http://client-wide:1");
    expect(resolveUpstreamBase(parseRoute("/other/prov/v1/x"), {}, cfg)).toBe("http://catch-all:1");
  });
  it("无 catch-all（空串）且表未命中 → null（fail-closed 前提）", () => {
    const noCatch: Pick<GatewayConfig, "upstreamBaseUrl" | "upstreams"> = { upstreamBaseUrl: "", upstreams: { "opencode/openai": "http://exact:1" } };
    expect(resolveUpstreamBase(parseRoute("/other/prov/v1/x"), {}, noCatch)).toBeNull();
    expect(resolveUpstreamBase(parseRoute("/v1/chat/completions"), {}, noCatch)).toBeNull();
  });
});

describe("joinUpstream", () => {
  it("base 末尾 /v1 与 rest /v1/... 去重", () => {
    expect(joinUpstream("https://api.openai.com/v1", "/v1/chat/completions", false)).toBe("https://api.openai.com/v1/chat/completions");
    expect(joinUpstream("https://api.anthropic.com", "/v1/chat/completions", false)).toBe("https://api.anthropic.com/v1/chat/completions");
  });
  it("rest 为空 → 原样 base；header 注入 → 完整 URL 不拼接", () => {
    expect(joinUpstream("http://h:1", "", false)).toBe("http://h:1");
    expect(joinUpstream("http://h:1/full", "/v1/chat/completions", true)).toBe("http://h:1/full");
  });
});

describe("gateway 路由端到端", () => {
  const OK_BODY = '{"model":"gpt-4o","choices":[{"message":{"content":"ok"}}]}';

  function evidence(writerPath: string): Record<string, unknown>[] {
    return readFileSync(writerPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  }

  it("upstreams 表命中：请求到达对应 mock，evidence 记录路径推导身份 + endpoint_host", async () => {
    mock = await startMockUpstream({ transport: "non-stream", body: OK_BODY });
    const writerPath = join(dir, "ev-route.jsonl");
    const writer = new EvidenceWriter(writerPath);
    gw = await startGateway({
      config: {
        upstreamBaseUrl: "",
        upstreams: { "opencode/openai": mock.url + "/v1" },
        evidenceWriter: writer,
      },
    });
    const r = await fetch(gw.url + "/opencode/openai/v1/chat/completions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe(OK_BODY);
    expect(mock.requests.length).toBe(1);
    const rec = evidence(writerPath)[0]!;
    expect(rec.client).toBe("opencode");
    expect(rec.provider_id).toBe("openai");
    expect(rec.endpoint_host).toBe(new URL(mock.url).host);
  });

  it("表未命中且无 catch-all → 502 llmveto:no-upstream-route，evidence blocked_before_forward + router finding", async () => {
    const writerPath = join(dir, "ev-noroute.jsonl");
    const writer = new EvidenceWriter(writerPath);
    gw = await startGateway({ config: { upstreamBaseUrl: "", evidenceWriter: writer } });
    const r = await fetch(gw.url + "/ghost/prov/v1/chat/completions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ error: { code: "llmveto:no-upstream-route" } });
    const rec = evidence(writerPath)[0]!;
    expect(rec.action_taken).toBe("blocked_before_forward");
    const findings = rec.findings as { checker: string; verdict: string; rule_id?: string }[];
    expect(findings.some((f) => f.checker === "router" && f.verdict === "error" && f.rule_id === "no-upstream-route")).toBe(true);
  });

  it("GET /opencode/models → 本地快照伺服；快照缺失 → 502 fail-closed", async () => {
    const snapshotPath = join(dir, "models.json");
    writeFileSync(snapshotPath, '[{"id":"gpt-4o"}]', "utf8");
    const writer = new EvidenceWriter(join(dir, "ev-models.jsonl"));
    gw = await startGateway({ config: { upstreamBaseUrl: "", evidenceWriter: writer, modelsSnapshotPath: snapshotPath } });
    const ok = await fetch(gw.url + "/opencode/models");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual([{ id: "gpt-4o" }]);
    await gw.close();
    gw = await startGateway({ config: { upstreamBaseUrl: "", evidenceWriter: writer, modelsSnapshotPath: join(dir, "missing.json") } });
    const missing = await fetch(gw.url + "/opencode/models");
    expect(missing.status).toBe(502);
    expect(await missing.json()).toEqual({ error: { code: "llmveto:models-snapshot-missing" } });
  });

  it("legacy /v1/chat/completions + catch-all 仍通（向后兼容）", async () => {
    mock = await startMockUpstream({ transport: "non-stream", body: OK_BODY });
    const writerPath = join(dir, "ev-legacy.jsonl");
    const writer = new EvidenceWriter(writerPath);
    gw = await startGateway({ config: { upstreamBaseUrl: mock.url, evidenceWriter: writer } });
    const r = await fetch(gw.url + "/v1/chat/completions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(r.status).toBe(200);
    await r.text();
    const rec = evidence(writerPath)[0]!;
    expect(rec.client).toBe("unknown");
    expect(mock.requests.length).toBe(1);
  });
});
