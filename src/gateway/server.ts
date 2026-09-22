import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { GatewayCore, handleChatCompletions, sha256Hex } from "./core.ts";
import type { GatewayConfig } from "./core.ts";
import { redactSink } from "../evidence/redact-sink.ts";
import type { EvidenceFinding } from "../evidence/schema.ts";
import type { ActionTaken } from "../shared/types.ts";

/**
 * @test REQ-VETO-002
 * @intent HTTP server 启动层：硬绑 127.0.0.1（AC-VETO-002-01）。
 *         配置 host != 127.0.0.1 → 抛错。
 */

export interface StartOptions {
  readonly host?: string;
  readonly port?: number;
  readonly config: GatewayConfig;
}

export async function startGateway(opts: StartOptions): Promise<{ server: ReturnType<typeof createServer>; url: string; close: () => Promise<void> }> {
  const host = opts.host ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`AC-VETO-002-01: gateway MUST bind to 127.0.0.1; got '${host}'. Loopback-only is a security invariant.`);
  }
  const core = new GatewayCore(opts.config);
  const server = createServer((req, res) => { void dispatch(req, res, core, opts.config); });
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, host, () => resolve()));
  const addr = server.address() as AddressInfo;
  const url = `http://${host}:${addr.port}`;
  return {
    server,
    url,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve())),
  };
}

/** 路径路由解析结果：`/<client>/<provider>/<rest...>`；api-only 路径（/v1/...）两段为空。 */
export interface RouteInfo {
  readonly client: string | null;
  readonly providerId: string | null;
  readonly rest: string; // "" 或 "/v1/chat/completions"（供 join 到 upstream base）
}

// 保留段：不是客户端名，而是 API 版本前缀（兼容 legacy 客户端与现有测试）。
const RESERVED_SEGMENTS: ReadonlySet<string> = new Set(["v1", "api"]);

export function parseRoute(urlPath: string): RouteInfo {
  const path = urlPath.split("?")[0] ?? "/";
  const segs = path.split("/").filter((s) => s.length > 0);
  if (segs.length === 0 || RESERVED_SEGMENTS.has(segs[0]!)) {
    return { client: null, providerId: null, rest: "/" + segs.join("/") };
  }
  const client = segs[0]!;
  const provider = segs.length >= 3 ? segs[1]! : null;
  const rest = "/" + segs.slice(provider !== null ? 2 : 1).join("/");
  return { client, providerId: provider, rest: rest === "/" ? "" : rest };
}

/** upstream 候选解析（非 final URL）：头 > upstreams["c/p"] > upstreams["c/*"] > catch-all。 */
export function resolveUpstreamBase(
  route: RouteInfo,
  headers: Readonly<Record<string, string>>,
  cfg: Pick<GatewayConfig, "upstreamBaseUrl" | "upstreams">,
): string | null {
  const headerUrl = headers["x-llmveto-upstream-url"];
  if (headerUrl) return headerUrl;
  const client = route.client ?? "*";
  const provider = route.providerId ?? "*";
  const table = cfg.upstreams ?? {};
  const exact = table[`${client}/${provider}`];
  if (exact) return exact;
  const clientWide = table[`${client}/*`];
  if (clientWide) return clientWide;
  return cfg.upstreamBaseUrl || null; // 空串 = 未配置 → fail-closed
}

/** 拼接 upstream base + rest；去重双重 /v1（base 末尾带 /v1 且 rest 以 /v1 开头）。 */
export function joinUpstream(base: string, rest: string, headerOverride: boolean): string {
  if (headerOverride) return base; // TEST 契约 #1：头注入的是完整目标 URL
  if (!rest) return base;
  const trimmed = base.replace(/\/+$/, "");
  if (trimmed.endsWith("/v1") && (rest === "/v1" || rest.startsWith("/v1/"))) return trimmed + rest.slice(3);
  return trimmed + rest;
}

async function dispatch(req: IncomingMessage, res: ServerResponse, core: GatewayCore, cfg: GatewayConfig): Promise<void> {
  const t0 = Date.now();
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const route = parseRoute(req.url ?? "/");

  // P1 缓解：GET /opencode/models → 本地模型目录快照（不转发、不留面）
  if (cfg.modelsSnapshotPath && route.client === "opencode" && route.providerId === null && route.rest === "/models" && req.method === "GET") {
    try {
      const snapshot = readFileSync(cfg.modelsSnapshotPath, "utf8");
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(snapshot);
    } catch {
      res.statusCode = 502; // 快照丢失 = models URL 锁死失效，fail-closed 不回落真源
      res.end(JSON.stringify({ error: { code: "llmveto:models-snapshot-missing" } }));
    }
    return;
  }

  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const bodyBuf = Buffer.concat(chunks);
  const bodyText = bodyBuf.toString("utf8");
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers[k.toLowerCase()] = v;
    else if (Array.isArray(v) && v.length > 0) headers[k.toLowerCase()] = v[0]!;
  }
  // 身份识别：路径段优先，x-llmveto-* 头作 fallback（兼容 legacy 直连 /v1 与测试 harness）
  const client = route.client ?? headers["x-llmveto-client"] ?? "unknown";
  const providerId = route.providerId ?? headers["x-llmveto-provider"] ?? cfg.providerId ?? "unknown";
  const requestId = headers["x-llmveto-request-id"] ?? randomUUID();
  const sessionId = headers["x-llmveto-session-id"] ?? "s-" + requestId.slice(0, 8);
  const turnId = headers["x-llmveto-turn-id"] ?? "t-" + requestId.slice(0, 8);

  const baseCandidate = resolveUpstreamBase(route, headers, cfg);
  const headerOverride = headers["x-llmveto-upstream-url"] !== undefined;
  const upstreamUrl = baseCandidate ? joinUpstream(baseCandidate, route.rest, headerOverride) : null;
  const endpointHost = headers["x-llmveto-endpoint-host"] ?? (upstreamUrl ? safeHost(upstreamUrl) : "unknown");

  // fail-closed：无任何路由可解析 → 502，不转发，evidence 记录 router finding
  if (!upstreamUrl) {
    const body = JSON.stringify({ error: { code: "llmveto:no-upstream-route" } });
    res.statusCode = 502;
    res.setHeader("content-type", "application/json");
    res.end(body);
    const routerFinding: EvidenceFinding = {
      checker: "router", threat: "T0", verdict: "error", severity: "high", rule_id: "no-upstream-route",
    };
    writeEvidence(cfg, { sessionId, turnId, requestId, client, providerId, endpointHost,
      bodyText, bodyBuf, respText: body, stream: false, findings: [routerFinding],
      actionTaken: "blocked_before_forward", deliveredChunks: 0, t0 });
    return;
  }

  const stream = /"stream"\s*:\s*true/.test(bodyText) || url.searchParams.get("stream") === "1";
  const outcome = await handleChatCompletions(core, {
    body: bodyText,
    headers,
    upstreamUrl,
    requestId,
    sessionId,
    turnId,
    client,
    providerId,
    endpointHost,
  });

  const respText = outcome.body;
  res.statusCode = outcome.status;
  res.setHeader("content-type", stream ? "text/event-stream" : "application/json");
  if (stream && outcome.sse) {
    for await (const chunk of outcome.sse) res.write(chunk);
    res.end();
  } else {
    res.end(respText);
  }
  writeEvidence(cfg, { sessionId, turnId, requestId, client, providerId, endpointHost,
    bodyText, bodyBuf, respText, stream, findings: outcome.findings,
    actionTaken: outcome.actionTaken, deliveredChunks: outcome.deliveredChunks, t0 });
}

interface EvidenceWriteParams {
  readonly sessionId: string; readonly turnId: string; readonly requestId: string;
  readonly client: string; readonly providerId: string; readonly endpointHost: string;
  readonly bodyText: string; readonly bodyBuf: Buffer; readonly respText: string;
  readonly stream: boolean; readonly findings: readonly EvidenceFinding[];
  readonly actionTaken: ActionTaken;
  readonly deliveredChunks: number; readonly t0: number;
}

function writeEvidence(cfg: GatewayConfig, p: EvidenceWriteParams): void {
  const parsedReq = safeParse(p.bodyText);
  const modelReq = parsedReq && typeof parsedReq.model === "string" ? parsedReq.model : null;
  const parsedResp = safeParse(p.respText);
  const modelResp = parsedResp && typeof parsedResp.model === "string" ? parsedResp.model : null;
  const bodyCapture = cfg.bodyCapture ?? "metadata_only";
  redactSink(bodyCapture, p.bodyText); // 咽喉点：即便 metadata_only 也要过一遍
  cfg.evidenceWriter.append({
    session_id: p.sessionId, turn_id: p.turnId, request_id: p.requestId,
    client: p.client, provider_id: p.providerId, endpoint_host: p.endpointHost,
    model_requested: modelReq, model_responded: modelResp,
    transport: p.stream ? "stream" : "non-stream",
    request_bytes: p.bodyBuf.byteLength, response_bytes: Buffer.byteLength(p.respText, "utf8"),
    chunk_count: p.deliveredChunks,
    latency: Date.now() - p.t0,
    findings: p.findings,
    action_taken: p.actionTaken,
    response_delivered: { partial: p.actionTaken === "terminated_after_delivery", delivered_chunks: p.deliveredChunks },
    request_body_sha256: sha256Hex(p.bodyText),
    response_body_sha256: sha256Hex(p.respText),
    body_capture: bodyCapture,
  });
}

function safeHost(url: string): string {
  try { return new URL(url).host; } catch { return "unparseable"; }
}

function safeParse(s: string): Record<string, unknown> | null {
  try { const v = JSON.parse(s); return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null; }
  catch { return null; }
}
