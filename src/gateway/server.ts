import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { GatewayCore, handleChatCompletions, sha256Hex } from "./core.ts";
import type { GatewayConfig } from "./core.ts";
import { redactSink } from "../evidence/redact-sink.ts";
import type { EvidenceFinding } from "../evidence/schema.ts";
import type { ActionTaken, Transport } from "../shared/types.ts";
import { consumeRotateSentinel, sentinelPathFor } from "./sentinel.ts";
import type { CanarySentinelOutcome } from "./sentinel.ts";

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

// D-03 哨兵（定位 / 消费 / 删除重试）已抽到 ./sentinel.ts（R11 many-exports 收敛）；
// 此处转发保持 CLI 与测试的既有导入面不变。
export { consumeRotateSentinel, sentinelPathFor } from "./sentinel.ts";
export type { CanarySentinelOutcome, SentinelIo } from "./sentinel.ts";

export async function startGateway(opts: StartOptions): Promise<{ server: ReturnType<typeof createServer>; url: string; close: () => Promise<void>; canarySentinel?: CanarySentinelOutcome }> {
  const host = opts.host ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`AC-VETO-002-01: gateway MUST bind to 127.0.0.1; got '${host}'. Loopback-only is a security invariant.`);
  }
  const core = new GatewayCore(opts.config);
  // D-03：哨兵消费在 listen 之前（启动序内），admin/请求路径看到轮换后状态；结果经返回值 carry。
  const canarySentinel = core.canary !== null && opts.config.canaryRegistryPath !== undefined
    ? consumeRotateSentinel(core.canary, sentinelPathFor(opts.config.canaryRegistryPath))
    : undefined;
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
    ...(canarySentinel !== undefined ? { canarySentinel } : {}), // D-03：哨兵消费结果 carry（键缺席 = canary 未配置）
  };
}

/** D-03 admin 控制通道（仅回环可达）：rotate 确认（同步持久化完成）后 200；未配置 503（不误报成功）；metrics 恒可用（未配置全零，观测面不随配置降级）；未知 404。 */
function handleAdminRoute(pathname: string, method: string, res: ServerResponse, core: GatewayCore): void {
  const adminJson = (status: number, payload: Record<string, unknown>): void => {
    res.statusCode = status; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(payload));
  };
  if (pathname === "/_llmveto/canary/rotate" && method === "POST") {
    if (core.canary === null) { adminJson(503, { error: { code: "llmveto:canary-not-configured" } }); return; }
    adminJson(200, core.canary.rotate());
  } else if (pathname === "/_llmveto/metrics" && method === "GET") {
    adminJson(200, { ...core.canaryMetrics }); // D-14 live p50/p95/max 属 SL-12 handoff，本切片只接计数面
  } else {
    adminJson(404, { error: { code: "llmveto:not-found" } });
  }
}

/** 路径路由解析结果：`/<client>/<provider>/<rest...>`；api-only 路径（/v1/...）两段为空。 */
export interface RouteInfo {
  readonly client: string | null;
  readonly providerId: string | null;
  readonly rest: string; // "" 或 "/v1/chat/completions"（供 join 到 upstream base）
}

// 保留段：不是客户端名，而是 API 版本前缀（兼容 legacy 客户端与现有测试）。
const RESERVED_SEGMENTS: ReadonlySet<string> = new Set(["v1", "api"]);

import { CANARY_MANAGED_ROUTES } from "./core.ts";
import { egressSecretScan } from "../checkers/egress-secret-scan.ts";

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
  // 三层回退按**从具体到宽泛**排列：精确 > 客户端通配 > 全量兜底。
  // 写成数组而不是三个 if，是为了让顺序本身成为一个可见的常量——
  // 这层的语义就是顺序，埋进分支里容易在改动时被无意识地打乱。
  const candidates: readonly (string | undefined)[] = [
    table[`${client}/${provider}`],
    table[`${client}/*`],
    cfg.upstreamBaseUrl,
  ];
  const base = candidates.find((c) => c !== undefined && c !== "");
  // 空串 = 未配置 → fail-closed（返回 null，由调用方 502）
  return base === undefined ? null : { base, viaHeader: false };
}

/** 拼接 upstream base + rest + 查询串（`search` 含前导 `?`）；去重双重 /v1（base 末尾带 /v1 且 rest 以 /v1 开头）。 */
export function joinUpstream(base: string, rest: string, viaHeader: boolean, search = ""): string {
  if (viaHeader) return base; // TEST 契约 #1：头注入的是完整目标 URL
  if (!rest) return base + search;
  const trimmed = base.replace(/\/+$/, "");
  if (trimmed.endsWith("/v1") && (rest === "/v1" || rest.startsWith("/v1/"))) return trimmed + rest.slice(3) + search;
  return trimmed + rest + search;
}

/**
 * 请求解析后的公共上下文。
 *
 * 抽出来的理由：`dispatch` 原本把"解析→守卫→转发→落链"四段都装在一个函数里，
 * CCN 14。四段之间只通过这个结构传递，拆开之后每段各自可读、可单测。
 */
interface DispatchContext {
  readonly url: URL;
  readonly route: ReturnType<typeof parseRoute>;
  readonly bodyText: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly id: ReturnType<typeof resolveIdentity>;
  readonly upstreamUrl: string;
  readonly endpointHost: string;
  readonly t0: number;
}

/**
 * 路由前的两条旁路：admin 控制通道与 models 快照。
 *
 * 返回 null 表示响应已写、`dispatch` 应直接返回。这两条都在**解析 body 之前**
 * 决定，顺序也是契约：admin 通道必须早于路由解析，否则它会落进 catch-all
 * 502 并污染 evidence（D-03 零旁路）。
 */
function prelude(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  core: GatewayCore,
  cfg: GatewayConfig,
): ReturnType<typeof parseRoute> | null {
  if (url.pathname.startsWith("/_llmveto/")) {
    handleAdminRoute(url.pathname, req.method ?? "GET", res, core);
    return null;
  }
  const route = parseRoute(req.url ?? "/");
  if (maybeServeModelsSnapshot(route, req.method, res, cfg)) return null;
  return route;
}

/**
 * 解析请求并把"无上游可去"这一种 fail-closed 就地处理掉。
 *
 * 返回 `{responded: true}` 表示响应已写、`dispatch` 应直接返回；否则返回可转发上下文。
 * 抽出来的理由：`dispatch` 原本在这一段里有 5 个可能提前返回的分支，加上后面的守卫
 * 一起算，CCN 14。分界线选在"能不能转发"这个语义边上，而不是按行数切。
 */
async function prepareDispatch(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  route: ReturnType<typeof parseRoute>,
  cfg: GatewayConfig,
  t0: number,
): Promise<DispatchContext | { readonly responded: true }> {
  const bodyText = await readBodyText(req);
  const headers = normalizeHeaders(req.headers);
  const id = resolveIdentity(route, headers, cfg);
  const resolution = resolveUpstream(route, headers, cfg);
  // 查询串随路径一并转发（如受管 Delphi endpoint 的 `?stream=1`、Azure 风格 api-version）
  const upstreamUrl = resolution ? joinUpstream(resolution.base, route.rest, resolution.viaHeader, url.search) : null;
  const endpointHost = headers["x-llmveto-endpoint-host"] ?? (upstreamUrl ? safeHost(upstreamUrl) : "unknown");

  // fail-closed：无任何路由可解析 → 502，不转发，evidence 记录 router finding
  if (!upstreamUrl) {
    respondNoUpstreamRoute(res, cfg, id, { bodyText, endpointHost, t0 });
    return { responded: true };
  }

  return { url, route, bodyText, headers, id, upstreamUrl, endpointHost, t0 };
}

/**
 * 转发前的 fail-closed 守卫：命中即已写好响应，返回 true。
 *
 * 三条守卫按**处置成本从低到高**排列：先看 URL（不需要扫 body），再看传输编码
 * （不需要解码），最后才做需要遍历 body 的凭据扫描。顺序影响真实延迟，
 * 不只是可读性。
 */
async function blockedBeforeForwardCheck(
  res: ServerResponse,
  cfg: GatewayConfig,
  ctx: DispatchContext,
  managedRoute: boolean,
): Promise<boolean> {
  const encodingReason = managedRouteSecretGuard(ctx.route, ctx.headers["content-encoding"]);
  if (encodingReason !== null) {
    await blockedBeforeForwardUrl(res, cfg, ctx.id, { bodyText: ctx.bodyText, endpointHost: ctx.endpointHost, t0: ctx.t0 }, encodingReason);
    return true;
  }
  // GLM 席 M1/终审：URL 的 query、path、userinfo 都会被上游 percent-decode，
  // 三个部分同构，只扫 query 是半个修复。
  const urlSecret = managedRoute ? secretInUrl(ctx.url) : null;
  if (urlSecret === null) return false;
  await blockedBeforeForwardUrl(res, cfg, ctx.id, { bodyText: ctx.bodyText, endpointHost: ctx.endpointHost, t0: ctx.t0 }, urlSecret);
  return true;
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

  const route = prelude(req, res, url, core, cfg);
  if (route === null) return;

  const prepared = await prepareDispatch(req, res, url, route, cfg, t0);
  if ("responded" in prepared) return;
  const ctx = prepared;
  const managedRoute = isManagedRoute(route);
  if (await blockedBeforeForwardCheck(res, cfg, ctx, managedRoute)) return;

  const transport = resolveTransport(ctx.bodyText, ctx.url, ctx.headers);
  // 判定一出即登记进每请求状态：兜底路径的 evidence 传输字段据此写，不再由交付计数反推
  // （PWR3-B-m1：`fwd.chunks > 0` 在 headers 已出而零帧转发时会把流式请求误记为非流式）。
  fwd.transport = transport;

  const outcome = await handleChatCompletions(core, {
    body: ctx.bodyText,
    headers: ctx.headers,
    upstreamUrl: ctx.upstreamUrl,
    ...ctx.id,
    endpointHost: ctx.endpointHost,
    transport,
    routePrefix: ctx.route.client,
    managedRoute,
  });

  await deliverOutcome(res, outcome, fwd);
  recordOutcomeEvidence(cfg, ctx, outcome, transport);
}

/** 一次交互的完整 evidence 落链（D-04 上游实收体 / SL-07 顶层 reason）。 */
function recordOutcomeEvidence(cfg: GatewayConfig, ctx: DispatchContext, outcome: Awaited<ReturnType<typeof handleChatCompletions>>, transport: "stream" | "non-stream"): void {
  writeEvidence(cfg, {
    ...ctx.id,
    endpointHost: ctx.endpointHost,
    bodyText: ctx.bodyText,
    respText: outcome.body,
    stream: transport === "stream",
    findings: outcome.findings,
    actionTaken: outcome.actionTaken,
    deliveredChunks: outcome.deliveredChunks,
    forwardedBody: outcome.forwardedBody,
    ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}),
    partial: outcome.actionTaken === "terminated_after_delivery",
    t0: ctx.t0,
  });
}

/**
 * SL-06（REQ-V2bA-15）：受管路由的判定域。
 *
 * 定义（设计 D-03，R2 评审要求写死）：
 *   受管路由 = **适配器实际配置的** `<client>/<provider>` 路由键 ∪ `CANARY_MANAGED_ROUTES`。
 *
 * 为什么不是"前缀在表里就算受管"（code-walkthrough MAJOR-4）：那样 `opencode/<任意 provider>`
 * 都会被纳入，等于把 fail-closed 无声扩大到 v1 从未承诺的路径上——而 v1 的承诺域是
 * `MANAGED_CONFIG_IDS` 的封闭枚举。判定域必须与"适配器写了哪条 baseURL"同源，否则
 * "受管"这个词就不再指向任何一个可枚举的集合。
 */
function isManagedRoute(route: RouteInfo): boolean {
  const key = `${route.client ?? ""}/${route.providerId ?? ""}`;
  return MANAGED_ROUTE_KEYS.has(key) || CANARY_MANAGED_ROUTES.has(key);
}

/**
 * 适配器写入的 `<client>/<provider>` 路由键（与 src/adapters/* 的 buildPatch 同源）。
 *
 * 与 adapters 层的同源一致性由 `tests/unit/route-keys.test.ts` 以真实 adapter 产物推导钉死——
 * gateway 层不 import adapters（architecture.yaml 禁），所以这里镜像一份并让测试看守。
 */
export const MANAGED_ROUTE_KEYS: ReadonlySet<string> = Object.freeze(
  new Set([
    "opencode/openai",
    "opencode/anthropic",
    "opencode/mock",
    "delphi/default",
    "claude/anthropic",
    "codex/openai",
    "promptfoo/openai",
  ]),
);

/**
 * 受管路由上的压缩体守卫。
 *
 * 为什么是阻断而不是解压后继续：解压要引入解码器与解压炸弹防护（zip bomb），
 * 那是独立议题；而"看不懂的传输编码"对一个安全网关而言就是覆盖缺口，
 * 按 fail-closed 直接拒绝，比假装扫过安全。
 *
 * @returns 需要阻断时返回 reason，否则 null
 */
function managedRouteSecretGuard(route: RouteInfo, contentEncoding: string | undefined): string | null {
  if (!isManagedRoute(route)) return null;
  const enc = (contentEncoding ?? "").trim().toLowerCase();
  if (enc === "" || enc === "identity") return null;
  return "unsupported_content_encoding";
}

/**
 * URL 的任一部分（path / query / userinfo）里是否有凭据，percent-decode 后再扫。
 *
 * 为什么需要：body 之外的出境通道同样能带凭据，而形状判定只看 body。
 * `?api_key=%73k%2Dant%2D…` 与 `/v1/messages/%67%68%70%5F…` 解码后都是完整凭据，
 * 上游按 RFC 3986 会解码它们。**只扫 query 是半个修复**——path 与 userinfo 同构。
 */
function secretInUrl(url: URL): string | null {
  const candidates = [url.pathname, url.search, `${url.username}:${url.password}`].filter((s) => s.length > 0);
  for (const part of candidates) {
    // 常数级预判：URL 里没有任何凭据前缀或 percent 转义时，解码后也不可能有。
    // 这是逐请求路径（每个受管请求都会走），所以先做这一层再谈解码与正则。
    if (!URL_SECRET_HINT.test(part)) continue;
    const scan = egressSecretScan({ direction: "request", transport: "non-stream", text: decodeSafe(part), meta: {} });
    if (scan.verdict === "finding") return "url_secret";
  }
  return null;
}

/**
 * URL 里出现凭据的**必要条件**：要么含凭据前缀，要么含 percent 转义（`%73k-` 解码后才是 `sk-`）。
 * 两者都没有的 URL 不可能藏凭据——这是短路，不是判据；漏判只会回落到全量扫描。
 */
const URL_SECRET_HINT = /sk[-_]|ghp_|gho_|ghs_|ghu_|AKIA|ASIA|xox[abps]-|-----BEGIN|AIza|glpat-|npm_|pypi-|%/;

/** percent-decode；非法编码按原文返回（不因解析失败而放行）。 */
function decodeSafe(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** 查询串含凭据 → 502 + evidence（与请求体阻断同形）。 */
async function blockedBeforeForwardUrl(
  res: ServerResponse,
  cfg: GatewayConfig,
  id: { requestId: string; sessionId: string; turnId: string; client: string; providerId: string },
  p: { bodyText: string; endpointHost: string; t0: number },
  reason: string,
): Promise<void> {
  const body = JSON.stringify({ error: { code: "llmveto:rejected" } });
  finishFailureResponse(res, body);
  writeEvidence(cfg, { ...id, endpointHost: p.endpointHost, bodyText: p.bodyText, respText: body, stream: false, findings: [],
    actionTaken: "blocked_before_forward", deliveredChunks: 0, partial: false, reason, t0: p.t0 });
}

/** 读请求体全文（dispatch 与兜底路径的共享入口）。 */
async function readBodyText(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * 传输判定单一真相源（server 层）：body `stream:true` / Delphi 受管 endpoint 的 `?stream=1` /
 * 显式 x-llmveto-transport 头（TEST 契约：环回信任域内可强制流式分支——只影响响应形态与
 * 扫描粒度，不改变转发目标）。判定结果显式下传 core，避免两层各自重判导致响应形态分歧。
 */
function resolveTransport(bodyText: string, url: URL, headers: Readonly<Record<string, string>>): Transport {
  const stream = /"stream"\s*:\s*true/.test(bodyText)
    || url.searchParams.get("stream") === "1"
    || headers["x-llmveto-transport"] === "stream";
  return stream ? "stream" : "non-stream";
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
  p: { readonly bodyText: string; readonly endpointHost: string; readonly t0: number },
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
    bodyText: p.bodyText, respText: body, stream: false, findings: [routerFinding],
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
  readonly bodyText: string; readonly respText: string;
  /** D-04：实际转发给 upstream 的请求体（受管路径 = 注入后体）；缺席 = 与 bodyText 一致。 */
  readonly forwardedBody?: string;
  /** D-10 顶层 reason（gateway 值优先，checker error 重放为底）；无异常时缺席（键不落盘，非 null）。 */
  readonly reason?: string; readonly stream: boolean; readonly findings: readonly EvidenceFinding[];
  readonly actionTaken: ActionTaken;
  readonly deliveredChunks: number;
  /** 客户端是否已拿到**部分**响应字节。此前由 actionTaken 间接推导，兜底路径在
   *  headersSent 之后需要独立申报（PWR1-B-M3），改为显式字段，两处口径不得各推各的。 */
  readonly partial: boolean;
  readonly t0: number;
}

/**
 * 从 JSON 文本里取 `model`；解析失败或不是字符串时返回 null。
 *
 * 两个方向都出现过（请求→响应），各写一遍就是两次可解析判定，抽出来让
 * `writeEvidence` 只表达"落哪些字段"。
 */
function modelNameOf(text: string): string | null {
  const parsed = safeParse(text);
  return parsed !== null && typeof parsed.model === "string" ? parsed.model : null;
}

/** `reason` 可选位：未传时**键整体缺席**（§14.4-4），不是显式 null。 */
function optionalReason(reason: string | undefined): { readonly reason?: string } {
  return reason === undefined ? {} : { reason };
}

function writeEvidence(cfg: GatewayConfig, p: EvidenceWriteParams): void {
  // D-04/#A：request_bytes/request_body_sha256 记**实际到达 upstream 的外部事实**（受管路径 = 注入后体）；
  // bodyText 仍为客户端原文，注入成功时二者有意不同，同为离境文本面各自过喉。
  const forwarded = p.forwardedBody ?? p.bodyText;
  const bodyCapture = cfg.bodyCapture ?? "metadata_only";
  // 咽喉点（AC-VETO-002-05）：文本写盘前必须过 redactSink。v1 evidence 只落 sha256 + 模式标记
  // （见 evidence/schema.ts），无原文落盘，故返回值不参与落盘；保留调用作为文本 sink 的强制入口。
  redactSink(bodyCapture, p.bodyText);
  if (forwarded !== p.bodyText) redactSink(bodyCapture, forwarded);
  cfg.evidenceWriter.append({
    session_id: p.sessionId, turn_id: p.turnId, request_id: p.requestId,
    client: p.client, provider_id: p.providerId, endpoint_host: p.endpointHost,
    model_requested: modelNameOf(p.bodyText), model_responded: modelNameOf(p.respText),
    transport: p.stream ? "stream" : "non-stream",
    request_bytes: Buffer.byteLength(forwarded, "utf8"), response_bytes: Buffer.byteLength(p.respText, "utf8"),
    chunk_count: p.deliveredChunks,
    latency: Date.now() - p.t0,
    findings: p.findings,
    action_taken: p.actionTaken,
    ...optionalReason(p.reason), // 可选位：未传时键整体缺席（§14.4-4），v1 记录形状零扰动
    response_delivered: { partial: p.partial, delivered_chunks: p.deliveredChunks },
    request_body_sha256: sha256Hex(forwarded),
    response_body_sha256: sha256Hex(p.respText),
    body_capture: bodyCapture,
  });
}

function safeHost(url: string): string {
  try { return new URL(url).host; } catch { return "unparseable"; }
}

/** fail-closed 的响应面：headers 未出 → 502 + `llmveto:upstream-error` JSON；已出 → 只断流。
 *  返回 headers 是否已发（决定 evidence 的交付字段）。 */
function finishFailureResponse(res: ServerResponse, body: string): boolean {
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
  return forwarded;
}

/** 兜底路径的 evidence：error finding 承载成因（rule_id），交付字段取 fwd 的真实计数。 */
/**
 * 失败路径的身份四元组。
 *
 * 请求在 `resolveIdentity` 之前就失败的路径（上游连不上）没有现成的 id，
 * 只能从转发头里取；缺什么补什么，且补出来的 id 必须**同源**——用同一个
 * requestId 派生 session/turn，否则一条交互在审计面上会被拆成三条。
 */
function failureIdentity(
  headers: Readonly<Record<string, string>>,
  cfg: GatewayConfig,
): {
  sessionId: string;
  turnId: string;
  requestId: string;
  client: string;
  providerId: string;
  endpointHost: string;
} {
  const requestId = headers["x-llmveto-request-id"] ?? randomUUID();
  const short = requestId.slice(0, 8);
  // 兜底值集中在表里，逐个 `??` 会让这个函数的分支数等于字段数（实测 8）。
  // `""` 表示"该字段没有独立兜底，用派生值"。
  const fallback: Readonly<Record<string, string>> = {
    "x-llmveto-session-id": `s-${short}`,
    "x-llmveto-turn-id": `t-${short}`,
    "x-llmveto-client": "unknown",
    "x-llmveto-provider": cfg.providerId ?? "unknown",
    "x-llmveto-endpoint-host": "unknown",
  };
  const pick = (key: string): string => headers[key] ?? fallback[key] ?? "unknown";
  return {
    sessionId: pick("x-llmveto-session-id"),
    turnId: pick("x-llmveto-turn-id"),
    requestId,
    client: pick("x-llmveto-client"),
    providerId: pick("x-llmveto-provider"),
    endpointHost: pick("x-llmveto-endpoint-host"),
  };
}

/** 上游不可达的成因 finding。`rule_id` 是 error 类 finding 唯一的成因落点。 */
function upstreamFailureFinding(err: unknown): EvidenceFinding {
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return {
    checker: "gateway",
    threat: "T0",
    verdict: "error",
    severity: "high",
    // 截断到 160 字符：evidence 是 append-only 审计面，不因超长错误串膨胀。
    rule_id: `upstream-unreachable: ${detail}`.slice(0, 160),
  };
}

function writeDispatchFailureEvidence(
  cfg: GatewayConfig,
  req: IncomingMessage,
  err: unknown,
  state: { readonly forwarded: boolean; readonly body: string; readonly fwd: DeliveryState },
): void {
  const { forwarded, body, fwd } = state;
  const t0 = Date.now();
  const headers = normalizeHeaders(req.headers);
  const ids = failureIdentity(headers, cfg);
  const failureFinding = upstreamFailureFinding(err);
  writeEvidence(cfg, {
    ...ids,
    bodyText: "",
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
  const forwarded = finishFailureResponse(res, body);
  try {
    writeDispatchFailureEvidence(cfg, req, err, { forwarded, body, fwd });
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
