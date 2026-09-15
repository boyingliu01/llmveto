import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { EvidenceWriter } from "../evidence/writer.ts";
import { GatewayCore, handleChatCompletions, sha256Hex } from "./core.ts";
import type { GatewayConfig } from "./core.ts";
import { redactSink } from "../evidence/redact-sink.ts";

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

async function dispatch(req: IncomingMessage, res: ServerResponse, core: GatewayCore, cfg: GatewayConfig): Promise<void> {
  const t0 = Date.now();
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const bodyBuf = Buffer.concat(chunks);
  const bodyText = bodyBuf.toString("utf8");
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers[k.toLowerCase()] = v;
    else if (Array.isArray(v) && v.length > 0) headers[k.toLowerCase()] = v[0]!;
  }
  const client = headers["x-llmveto-client"] ?? "unknown";
  const providerId = headers["x-llmveto-provider"] ?? cfg.providerId ?? "unknown";
  const requestId = headers["x-llmveto-request-id"] ?? randomUUID();
  const sessionId = headers["x-llmveto-session-id"] ?? "s-" + requestId.slice(0, 8);
  const turnId = headers["x-llmveto-turn-id"] ?? "t-" + requestId.slice(0, 8);
  const endpointHost = headers["x-llmveto-endpoint-host"] ?? "unknown";
  // upstream URL 由 headers 或 cfg 决定（TEST 契约 #1）
  const upstreamUrl = headers["x-llmveto-upstream-url"] ?? cfg.upstreamBaseUrl;

  const stream = /"stream"\s*:\s*true/.test(bodyText);
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

  const reqHash = sha256Hex(bodyText);
  const respText = outcome.body;
  const respHash = sha256Hex(respText);

  res.statusCode = outcome.status;
  res.setHeader("content-type", stream ? "text/event-stream" : "application/json");
  if (stream && outcome.sse) {
    for await (const chunk of outcome.sse) res.write(chunk);
    res.end();
  } else {
    res.end(respText);
  }
  const parsedReq = safeParse(bodyText);
  const modelReq = parsedReq && typeof parsedReq.model === "string" ? parsedReq.model : null;
  const parsedResp = safeParse(respText);
  const modelResp = parsedResp && typeof parsedResp.model === "string" ? parsedResp.model : null;
  const bodyCapture = cfg.bodyCapture ?? "metadata_only";
  redactSink(bodyCapture, bodyText); // 咽喉点：即便 metadata_only 也要过一遍
  cfg.evidenceWriter.append({
    session_id: sessionId, turn_id: turnId, request_id: requestId,
    client, provider_id: providerId, endpoint_host: endpointHost,
    model_requested: modelReq, model_responded: modelResp,
    transport: stream ? "stream" : "non-stream",
    request_bytes: bodyBuf.byteLength, response_bytes: Buffer.byteLength(respText, "utf8"),
    chunk_count: outcome.deliveredChunks,
    latency: Date.now() - t0,
    findings: outcome.findings,
    action_taken: outcome.actionTaken,
    response_delivered: { partial: outcome.actionTaken === "terminated_after_delivery", delivered_chunks: outcome.deliveredChunks },
    request_body_sha256: reqHash,
    response_body_sha256: respHash,
    body_capture: bodyCapture,
  });
}

function safeParse(s: string): Record<string, unknown> | null {
  try { const v = JSON.parse(s); return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null; }
  catch { return null; }
}
