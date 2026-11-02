import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { GatewayCore, handleChatCompletions, sha256Hex } from "./core.ts";
import type { GatewayConfig } from "./core.ts";
import { redactSink } from "../evidence/redact-sink.ts";
import type { EvidenceFinding } from "../evidence/schema.ts";
import type { ActionTaken, Transport } from "../shared/types.ts";

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
  // fail-closed 的边界（REQ-VETO-002）：dispatch 是 async，而其内部会 await 上游 fetch。
  // 上游失败（ECONNRESET / 超时 / DNS）会抛出——若不在**这里**兜住，异常会冒泡成
  // unhandledRejection 并杀死整个 daemon 进程：客户端拿不到任何响应、该次交互不落 evidence、
  // 且此后全部流量失去网关保护。故每个请求的失败必须被收敛成"这一个请求的 502 + 留痕"。
  const server = createServer((req, res) => {
    // 每请求转发计数：兜底路径据此如实写 evidence 的 delivered_chunks（PWR1-B-M3）。
    const fwd: DeliveryState = { chunks: 0 };
    dispatch(req, res, core, opts.config, fwd).catch((err: unknown) => {
      handleDispatchFailure(req, res, opts.config, err, fwd);
    });
  });
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

/** upstream 解析结果：viaHeader=true 表示 base 是头注入的完整目标 URL（不拼接 rest）。 */
export interface UpstreamResolution {
  readonly base: string;
  readonly viaHeader: boolean;
}

/**
 * 每请求交付状态，由 dispatch 写、由兜底路径读，两处共用同一份事实（PWR1-B-M3 / PWR3-B-m1）。
 * 两字段**各自表述一件事、不得互推**：`chunks` 是实际转发帧数（交付面），`transport` 是 dispatch
 * 对响应形态的判定（请求面）；判定前就抛错时 `transport` 保持未设，兜底路径按非流式记。
 */
interface DeliveryState {
  chunks: number;
  transport?: Transport;
}

/**
 * upstream 解析（单一真相源）：头 > upstreams["c/p"] > upstreams["c/*"] > catch-all。
 * 头覆盖默认关闭（allowUpstreamHeaderOverride），仅可测试性契约 #1 的注入场景显式开启；
 * 生产 daemon 不开启 → 转发目标只由受管路由表决定。
 */
export function resolveUpstream(
  route: RouteInfo,
  headers: Readonly<Record<string, string>>,
  cfg: Pick<GatewayConfig, "upstreamBaseUrl" | "upstreams" | "allowUpstreamHeaderOverride">,
): UpstreamResolution | null {
  const headerUrl = headers["x-llmveto-upstream-url"];
  if (cfg.allowUpstreamHeaderOverride === true && headerUrl) return { base: headerUrl, viaHeader: true };
  const client = route.client ?? "*";
  const provider = route.providerId ?? "*";
  const table = cfg.upstreams ?? {};
  const exact = table[`${client}/${provider}`];
  if (exact) return { base: exact, viaHeader: false };
  const clientWide = table[`${client}/*`];
  if (clientWide) return { base: clientWide, viaHeader: false };
  const catchAll = cfg.upstreamBaseUrl;
  return catchAll ? { base: catchAll, viaHeader: false } : null; // 空串 = 未配置 → fail-closed
}

/** 拼接 upstream base + rest + 查询串（`search` 含前导 `?`）；去重双重 /v1（base 末尾带 /v1 且 rest 以 /v1 开头）。 */
export function joinUpstream(base: string, rest: string, viaHeader: boolean, search = ""): string {
  if (viaHeader) return base; // TEST 契约 #1：头注入的是完整目标 URL
  if (!rest) return base + search;
  const trimmed = base.replace(/\/+$/, "");
  if (trimmed.endsWith("/v1") && (rest === "/v1" || rest.startsWith("/v1/"))) return trimmed + rest.slice(3) + search;
  return trimmed + rest + search;
}

async function dispatch(
  req: IncomingMessage,
  res: ServerResponse,
  core: GatewayCore,
  cfg: GatewayConfig,
  fwd: DeliveryState,
): Promise<void> {
  const t0 = Date.now();
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const route = parseRoute(req.url ?? "/");

  if (maybeServeModelsSnapshot(route, req.method, res, cfg)) return;

  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const bodyBuf = Buffer.concat(chunks);
  const bodyText = bodyBuf.toString("utf8");
  const headers = normalizeHeaders(req.headers);
  const id = resolveIdentity(route, headers, cfg);

  const resolution = resolveUpstream(route, headers, cfg);
  // 查询串随路径一并转发（如受管 Delphi endpoint 的 `?stream=1`、Azure 风格 api-version）
  const upstreamUrl = resolution ? joinUpstream(resolution.base, route.rest, resolution.viaHeader, url.search) : null;
  const endpointHost = headers["x-llmveto-endpoint-host"] ?? (upstreamUrl ? safeHost(upstreamUrl) : "unknown");

  // fail-closed：无任何路由可解析 → 502，不转发，evidence 记录 router finding
  if (!upstreamUrl) {
    respondNoUpstreamRoute(res, cfg, id, { bodyText, bodyBuf, endpointHost, t0 });
    return;
  }

  // 传输判定单一真相源（server 层）：body `stream:true` / Delphi 受管 endpoint 的 `?stream=1` /
  // 显式 x-llmveto-transport 头（TEST 契约：环回信任域内可强制流式分支——只影响响应形态与
  // 扫描粒度，不改变转发目标）。判定结果显式下传 core，避免两层各自重判导致响应形态分歧。
  const stream = /"stream"\s*:\s*true/.test(bodyText)
    || url.searchParams.get("stream") === "1"
    || headers["x-llmveto-transport"] === "stream";
  const transport: Transport = stream ? "stream" : "non-stream";
  // 判定一出即登记进每请求状态：兜底路径的 evidence 传输字段据此写，不再由交付计数反推
  // （PWR3-B-m1：`fwd.chunks > 0` 在 headers 已出而零帧转发时会把流式请求误记为非流式）。
  fwd.transport = transport;
  const outcome = await handleChatCompletions(core, {
    body: bodyText,
    headers,
    upstreamUrl,
    requestId: id.requestId,
    sessionId: id.sessionId,
    turnId: id.turnId,
    client: id.client,
    providerId: id.providerId,
    endpointHost,
    transport,
  });

  await deliverOutcome(res, outcome, fwd);
  writeEvidence(cfg, { sessionId: id.sessionId, turnId: id.turnId, requestId: id.requestId,
    client: id.client, providerId: id.providerId, endpointHost,
    bodyText, bodyBuf, respText: outcome.body, stream, findings: outcome.findings,
    actionTaken: outcome.actionTaken, deliveredChunks: outcome.deliveredChunks,
    partial: outcome.actionTaken === "terminated_after_delivery", t0 });
}

/** P1 缓解：GET /opencode/models → 本地模型目录快照（不转发、不留面）。返回 true = 已响应。 */
function maybeServeModelsSnapshot(
  route: RouteInfo,
  method: string | undefined,
  res: ServerResponse,
  cfg: GatewayConfig,
): boolean {
  if (method !== "GET" || route.client !== "opencode" || route.providerId !== null || route.rest !== "/models") return false;
  if (!cfg.modelsSnapshotPath) return false;
  try {
    const snapshot = readFileSync(cfg.modelsSnapshotPath, "utf8");
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(snapshot);
  } catch {
    res.statusCode = 502; // 快照丢失 = models URL 锁死失效，fail-closed 不回落真源
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: { code: "llmveto:models-snapshot-missing" } }));
  }
  return true;
}

/** 请求身份五元组：路径段优先，x-llmveto-* 头 fallback（兼容 legacy 直连 /v1 与测试 harness）。
 *  信任边界：网关硬绑 127.0.0.1，本机客户端视为同一信任域，故身份头不做认证——它们只影响
 *  evidence 归属与（catch-all 路径下的）路由条目选择，不改变转发目标；唯一能改变目标的是
 *  x-llmveto-upstream-url，由 allowUpstreamHeaderOverride 门控（默认关闭，生产不开启）。 */
interface RequestIdentity {
  readonly client: string;
  readonly providerId: string;
  readonly requestId: string;
  readonly sessionId: string;
  readonly turnId: string;
}

/** 取第一个非 null/undefined 的候选值；命中即返回，保持 `a ?? b ?? c` 的短路语义。 */
function firstDefined(...candidates: readonly (string | undefined | null)[]): string | undefined {
  for (const c of candidates) if (c !== undefined && c !== null) return c;
  return undefined;
}

function resolveIdentity(route: RouteInfo, headers: Readonly<Record<string, string>>, cfg: GatewayConfig): RequestIdentity {
  const requestId = headers["x-llmveto-request-id"] ?? randomUUID();
  return {
    client: firstDefined(route.client, headers["x-llmveto-client"]) ?? "unknown",
    providerId: firstDefined(route.providerId, headers["x-llmveto-provider"], cfg.providerId) ?? "unknown",
    requestId,
    sessionId: firstDefined(headers["x-llmveto-session-id"]) ?? "s-" + requestId.slice(0, 8),
    turnId: firstDefined(headers["x-llmveto-turn-id"]) ?? "t-" + requestId.slice(0, 8),
  };
}

/** fail-closed：无任何路由可解析 → 502，不转发，evidence 记录 router finding。 */
function respondNoUpstreamRoute(
  res: ServerResponse,
  cfg: GatewayConfig,
  id: RequestIdentity,
  p: { readonly bodyText: string; readonly bodyBuf: Buffer; readonly endpointHost: string; readonly t0: number },
): void {
  const body = JSON.stringify({ error: { code: "llmveto:no-upstream-route" } });
  res.statusCode = 502;
  res.setHeader("content-type", "application/json");
  res.end(body);
  const routerFinding: EvidenceFinding = {
    checker: "router", threat: "T0", verdict: "error", severity: "high", rule_id: "no-upstream-route",
  };
  writeEvidence(cfg, { sessionId: id.sessionId, turnId: id.turnId, requestId: id.requestId,
    client: id.client, providerId: id.providerId, endpointHost: p.endpointHost,
    bodyText: p.bodyText, bodyBuf: p.bodyBuf, respText: body, stream: false, findings: [routerFinding],
    actionTaken: "blocked_before_forward", deliveredChunks: 0, partial: false, t0: p.t0 });
}

/** 响应交付：content-type 以实际响应形态为准（stream 判定为真但无 sse——如上游非 2xx 走错误
 *  分支——交付的是 JSON 体，若仍标 text/event-stream 会令流式客户端解析失败，R2 评审 A-N-1）；
 *  SSE 逐帧写并计数进 fwd，兜底路径据此如实记 delivered_chunks（PWR1-B-M3）。 */
async function deliverOutcome(
  res: ServerResponse,
  outcome: Awaited<ReturnType<typeof handleChatCompletions>>,
  fwd: DeliveryState,
): Promise<void> {
  res.statusCode = outcome.status;
  res.setHeader("content-type", outcome.sse ? "text/event-stream" : "application/json");
  if (!outcome.sse) {
    res.end(outcome.body);
    return;
  }
  for await (const chunk of outcome.sse) {
    res.write(chunk);
    fwd.chunks++;
  }
  res.end();
}

interface EvidenceWriteParams {
  readonly sessionId: string; readonly turnId: string; readonly requestId: string;
  readonly client: string; readonly providerId: string; readonly endpointHost: string;
  readonly bodyText: string; readonly bodyBuf: Buffer; readonly respText: string;
  readonly stream: boolean; readonly findings: readonly EvidenceFinding[];
  readonly actionTaken: ActionTaken;
  readonly deliveredChunks: number;
  /** 客户端是否已拿到**部分**响应字节。此前由 actionTaken 间接推导，兜底路径在
   *  headersSent 之后需要独立申报（PWR1-B-M3），改为显式字段，两处口径不得各推各的。 */
  readonly partial: boolean;
  readonly t0: number;
}

function writeEvidence(cfg: GatewayConfig, p: EvidenceWriteParams): void {
  const parsedReq = safeParse(p.bodyText);
  const modelReq = parsedReq && typeof parsedReq.model === "string" ? parsedReq.model : null;
  const parsedResp = safeParse(p.respText);
  const modelResp = parsedResp && typeof parsedResp.model === "string" ? parsedResp.model : null;
  const bodyCapture = cfg.bodyCapture ?? "metadata_only";
  // 咽喉点（AC-VETO-002-05）：文本写盘前必须过 redactSink。v1 evidence 只落 sha256 + 模式标记
  // （见 evidence/schema.ts），无原文落盘，故返回值不参与落盘；保留调用作为文本 sink 的强制入口。
  redactSink(bodyCapture, p.bodyText);
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
    response_delivered: { partial: p.partial, delivered_chunks: p.deliveredChunks },
    request_body_sha256: sha256Hex(p.bodyText),
    response_body_sha256: sha256Hex(p.respText),
    body_capture: bodyCapture,
  });
}

function safeHost(url: string): string {
  try { return new URL(url).host; } catch { return "unparseable"; }
}

/**
 * dispatch 未捕获异常的兜底（fail-closed）。此路径覆盖"上游不可达 / 连接被重置 / DNS 失败 /
 * 响应体读取中途出错"等**网络层**故障，以及任何非预期的内部异常。
 *
 * 契约：
 *   ① 客户端必须收到确定的失败响应，绝不静默挂起：headers 未出 → 502 + `llmveto:upstream-error`
 *      JSON；headers 已出（SSE 转发已开始）→ **只断流、不追加 JSON**——往 event-stream 里塞
 *      JSON 体是对客户端解析的二次破坏，流的非正常终止本身就是失败信号（PWR1-B-M3）。
 *   ② 该次交互必须落 evidence（否则审计链出现无法解释的缺口）：delivered_chunks 用 dispatch
 *      的真实转发计数，headers 已出时 partial=true、action_taken=terminated_after_delivery；
 *      headers 未出时 0 / false / blocked_before_forward。
 *   ③ 本函数自身**绝不抛出** —— 它是进程存活性的最后一道防线，否则又回到"一次上游抖动杀掉 daemon"。
 */
function handleDispatchFailure(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: GatewayConfig,
  err: unknown,
  fwd: DeliveryState,
): void {
  const body = JSON.stringify({ error: { code: "llmveto:upstream-error" } });
  const forwarded = res.headersSent;
  try {
    if (!forwarded) {
      res.statusCode = 502;
      res.setHeader("content-type", "application/json");
      res.end(body);
    } else {
      // 只收尾不追加 body；已转发的 SSE chunk 保持原样，客户端以流中断感知失败
      res.end();
    }
  } catch { /* 客户端已断开：留痕优先 */ }

  try {
    const t0 = Date.now();
    const headers = normalizeHeaders(req.headers);
    const requestId = headers["x-llmveto-request-id"] ?? randomUUID();
    const failureFinding: EvidenceFinding = {
      checker: "gateway",
      threat: "T0",
      verdict: "error",
      severity: "high",
      // rule_id 承载可读成因摘要：error 类 finding 无 offsets，此处是唯一的成因落点。
      // 截断到 160 字符：evidence 是 append-only 审计面，不因超长错误串膨胀。
      rule_id: ("upstream-unreachable: " + (err instanceof Error ? `${err.name}: ${err.message}` : String(err))).slice(0, 160),
    };
    writeEvidence(cfg, {
      sessionId: headers["x-llmveto-session-id"] ?? "s-" + requestId.slice(0, 8),
      turnId: headers["x-llmveto-turn-id"] ?? "t-" + requestId.slice(0, 8),
      requestId,
      client: headers["x-llmveto-client"] ?? "unknown",
      providerId: headers["x-llmveto-provider"] ?? cfg.providerId ?? "unknown",
      endpointHost: headers["x-llmveto-endpoint-host"] ?? "unknown",
      bodyText: "",
      bodyBuf: Buffer.alloc(0),
      // headers 已出时并未把 JSON body 交付给客户端——evidence 不虚报交付内容（respText 与
      // response_body_sha256 描述"实际交付面"），失败原因由 findings 承载。
      respText: forwarded ? "" : body,
      // 传输形态取 dispatch 的判定值；判定前就抛错时 fwd.transport 为 undefined ⇒ 非流式
      // （那条路径必然一帧未转，与交付面一致）。交付事实仍由 fwd.chunks 独立申报，两者不互推。
      stream: fwd.transport === "stream",
      findings: [failureFinding],
      actionTaken: fwd.chunks > 0 ? "terminated_after_delivery" : "blocked_before_forward",
      deliveredChunks: fwd.chunks,
      partial: fwd.chunks > 0,
      t0,
    });
  } catch { /* evidence 写入失败不改变"已向客户端 fail-closed"这一事实，但不得再抛出 */ }
}

/** 请求头归一化（小写键 + 多值取首）：dispatch 与本文件兜底路径共用，避免两处口径漂移。 */
function normalizeHeaders(raw: IncomingMessage["headers"]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") headers[k.toLowerCase()] = v;
    else if (Array.isArray(v) && v.length > 0) headers[k.toLowerCase()] = v[0]!;
  }
  return headers;
}

function safeParse(s: string): Record<string, unknown> | null {
  try { const v = JSON.parse(s); return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null; }
  catch { return null; }
}
