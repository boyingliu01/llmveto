import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { EvidenceWriter } from "../../../src/evidence/writer.ts";
import { startGateway, parseRoute, resolveUpstream, joinUpstream } from "../../../src/gateway/server.ts";
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

describe("resolveUpstream 优先级", () => {
  const cfg: Pick<GatewayConfig, "upstreamBaseUrl" | "upstreams" | "allowUpstreamHeaderOverride"> = {
    upstreamBaseUrl: "http://catch-all:1",
    upstreams: { "opencode/openai": "http://exact:1", "delphi/*": "http://client-wide:1" },
  };
  it("头覆盖默认关闭：x-llmveto-upstream-url 被忽略（转发目标只由受管路由表决定）", () => {
    const route = parseRoute("/opencode/openai/v1/chat/completions");
    expect(resolveUpstream(route, { "x-llmveto-upstream-url": "http://header:1" }, cfg)).toEqual({
      base: "http://exact:1", viaHeader: false,
    });
  });
  it("头覆盖显式开启（TEST 契约 #1）→ 头优先，viaHeader=true", () => {
    const route = parseRoute("/opencode/openai/v1/chat/completions");
    expect(resolveUpstream(route, { "x-llmveto-upstream-url": "http://header:1" }, { ...cfg, allowUpstreamHeaderOverride: true })).toEqual({
      base: "http://header:1", viaHeader: true,
    });
  });
  it("upstreams[\"c/p\"] > upstreams[\"c/*\"] > catch-all", () => {
    expect(resolveUpstream(parseRoute("/opencode/openai/v1/x"), {}, cfg)).toEqual({ base: "http://exact:1", viaHeader: false });
    expect(resolveUpstream(parseRoute("/delphi/default/v1/x"), {}, cfg)).toEqual({ base: "http://client-wide:1", viaHeader: false });
    expect(resolveUpstream(parseRoute("/other/prov/v1/x"), {}, cfg)).toEqual({ base: "http://catch-all:1", viaHeader: false });
  });
  it("无 catch-all（空串）且表未命中 → null（fail-closed 前提）", () => {
    const noCatch: Pick<GatewayConfig, "upstreamBaseUrl" | "upstreams"> = { upstreamBaseUrl: "", upstreams: { "opencode/openai": "http://exact:1" } };
    expect(resolveUpstream(parseRoute("/other/prov/v1/x"), {}, noCatch)).toBeNull();
    expect(resolveUpstream(parseRoute("/v1/chat/completions"), {}, noCatch)).toBeNull();
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
  it("查询串随路径转发（客户端语义不丢弃）；header 注入目标不受影响", () => {
    expect(joinUpstream("http://h:1", "/v1/chat/completions", false, "?stream=1")).toBe("http://h:1/v1/chat/completions?stream=1");
    expect(joinUpstream("https://x/v1", "/v1/chat/completions", false, "?api-version=2024-06-01")).toBe("https://x/v1/chat/completions?api-version=2024-06-01");
    expect(joinUpstream("http://h:1", "", false, "?a=1")).toBe("http://h:1?a=1");
    expect(joinUpstream("http://h:1/full", "/v1/x", true, "?stream=1")).toBe("http://h:1/full");
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

  it("查询串端到端转发：非 stream 语义的 query（如 api-version）原样到达 upstream", async () => {
    mock = await startMockUpstream({ transport: "non-stream", body: OK_BODY });
    const writer = new EvidenceWriter(join(dir, "ev-query.jsonl"));
    gw = await startGateway({ config: { upstreamBaseUrl: mock.url + "/v1", evidenceWriter: writer } });
    const r = await fetch(gw.url + "/v1/chat/completions?api-version=2024-06-01", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe(OK_BODY);
    expect(mock.requests[0]!.url).toBe("/v1/chat/completions?api-version=2024-06-01");
  });

  it("x-llmveto-upstream-url 默认不生效：请求落到受管路由表，而非头指向的目标", async () => {
    mock = await startMockUpstream({ transport: "non-stream", body: OK_BODY });
    const headerTarget = await startMockUpstream({ transport: "non-stream", body: OK_BODY });
    try {
      const writer = new EvidenceWriter(join(dir, "ev-hdr.jsonl"));
      gw = await startGateway({ config: { upstreamBaseUrl: mock.url, evidenceWriter: writer } });
      const r = await fetch(gw.url + "/some/prov/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-llmveto-upstream-url": headerTarget.url },
        body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
      });
      expect(r.status).toBe(200);
      await r.text();
      expect(mock.requests.length).toBe(1);
      expect(headerTarget.requests.length).toBe(0);
    } finally {
      await headerTarget.close();
    }
  });
});
