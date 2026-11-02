import { createHash } from "node:crypto";
import { checkersFor, REGISTRY } from "./registry.ts";
import { G1_PER_CHUNK, g3BudgetForBodyBytes, runStreamWithBudget, runWithBudget } from "./budget.ts";
import {
  createWindowStore,
  initialWindow,
  isWindowStore,
  recombineWindow,
  type WindowStore,
} from "./window-store.ts";
import {
  buildMergedToolCallScanUnit,
  buildRequestScanUnit,
  buildResponseScanUnit,
  createToolCallArgsMerger,
  declaredToolsMeta,
} from "./scan-unit.ts";
import { encodeVetoEvent, parseSseFrames, tryParseJson } from "./sse-tee.ts";
import { decide, pickScenario, pickTopReasonFromErrorFindings, type BehaviorScenario } from "../policy/engine.ts";
import type { PolicyInput } from "../policy/engine.ts";
import { resolveActionTaken, CHECKER_THREAT_BY_ID } from "../policy/mapping.ts";
import type {
  CheckerResult,
  CheckerSpec,
  Direction,
  ScanUnit,
  ScanWindow,
  NonStreamChecker,
  BodyCapture,
} from "../shared/types.ts";
import { EvidenceWriter } from "../evidence/writer.ts";
import type { EvidenceFinding } from "../evidence/schema.ts";
import type { ActionTaken } from "../shared/types.ts";
import { CanaryStore } from "../canary/store.ts";
import { deriveSessionKey } from "../canary/session-key.ts";
import { inject } from "../canary/inject.ts";

/**
 * @test REQ-VETO-002
 * @intent 反代核：per-chunk 先扫描后转发（零缓冲 + 终止流契约）+ fail-closed。
 *
 * 关键契约：
 *   - AC-VETO-002-01 硬绑 127.0.0.1（server 启动层校验，见 server.ts）
 *   - AC-VETO-002-02 事件循环 tick 内完成扫描 + 转发，不缓冲整段
 *   - AC-VETO-002-03 命中 → event:error + delivered_chunks + 关闭连接
 *   - AC-VETO-002-04 upstream 可注入（配置）
 *   - AC-VETO-002-05 所有 sink 走 redactSink()
 *   - AC-VETO-002-06 认证类头排除出扫描单元
 */

export interface GatewayConfig {
  readonly upstreamBaseUrl: string; // TEST 契约 #1：可注入 mock-upstream；亦作路径路由未命中时的 catch-all
  readonly evidenceWriter: EvidenceWriter;
  readonly bodyCapture?: BodyCapture;
  readonly clientHeaderName?: string; // 客户端身份头，默认 x-llmveto-client
  readonly providerId?: string;
  /**
   * 路径路由表（REQ-VETO-009/014）：键 `"client/provider"` 或 `"client/*"`，值为该 provider 的 upstream base URL。
   * 解析优先级：upstreams["client/provider"] > upstreams["client/*"] > upstreamBaseUrl(catch-all) > fail-closed；
   * 若显式开启 allowUpstreamHeaderOverride，则 x-llmveto-upstream-url 头置于最前。
   */
  readonly upstreams?: Readonly<Record<string, string>>;
  /**
   * 可测试性契约 #1 的注入开关：开启后 `x-llmveto-upstream-url` 头可覆盖转发目标（完整 URL）。
   * 默认 false —— 生产 daemon 不开启，转发目标只由受管路由表决定；在网关进程内（in-process）
   * 测试通过显式配置开启，命令行/网络客户端无法自行开启。
   */
  readonly allowUpstreamHeaderOverride?: boolean;
  /** OpenCode 模型目录快照文件路径；设置后 GET /opencode/models 本地伺服（P1 缓解：锁定 models URL）。 */
  readonly modelsSnapshotPath?: string;
  /**
   * 测试注入通道（TEST 契约 #1 精神）：额外的 checker（按 side 过滤后并入分派序列，
   * 与 REGISTRY checkers 并存）。生产 daemon 不配置；SL-02 的 AC-V2a-26 判定
   * （tool-call-shape 桩 × 隐形字符扫描同连接隔离）经此通道成立。
   */
  readonly extraCheckers?: readonly CheckerSpec[];
  /**
   * D-09（REQ-V2a-12 / AC-V2a-27）：按 checkerId 注入预算覆盖（ms）。
   * 注入只影响被点名的 checker（③），其余保持默认档位——请求体/非流式响应体路径
   * 按 G3 body 字节数分档、流式每 chunk 按 G1 门（budget.ts 单一常量源）。
   * 值为裁决面预算：超时改写为 checker_timeout（事后判定，见 budget.ts）。
   */
  readonly checkerBudgetMs?: ReadonlyMap<string, number>;
  /** canary registry 路径（D-02 单写者：常驻网关唯一实例）；缺省 = canary 关闭（判定域外：不注入不匹配、rotate 503、计数全零）。 */
  readonly canaryRegistryPath?: string;
}

/** SL-01/D-07：归并重投影单元的 meta 标记（advance:false 时由 core 统一打标，单一真相源）。 */
export const REPROJECTION_META_KEY = "llmveto_reprojected" as const;

/** REQ-V2a-11/D-05 注入判定域（路由键 client/provider）：gateway 层镜像常量——architecture.yaml 禁 import adapters，与 adapters 层 MANAGED_CONFIG_IDS 的同源一致性由集成测试以真实 adapter 产物推导钉死（canary-inject 防漂移断言）。 */
export const CANARY_MANAGED_ROUTES: ReadonlySet<string> = Object.freeze(new Set(["opencode/openai", "opencode/anthropic", "opencode/mock", "delphi/default"]));

/** D-03 计数面：GET /_llmveto/metrics 的 canary 观测（D-14 live p50/p95/max 属 SL-12 handoff）。 */
export type CanaryMetrics = { inject_skipped: number; registry_unavailable: number; canary_injected: number };

/** 响应侧扫描单元 meta 的 canary 形状（SL-08 return-scan 判定面）：快照不可用时 canary_candidates 键缺席。 */
export interface CanaryRequestMeta { readonly canary_injected: boolean; readonly canary_candidates?: readonly string[]; }

export class GatewayCore {
  /** canary：D-02 单写者 store（null = 未配置，判定域外）；计数面恒在（进程内，durable 聚合属 SL-12），未配置全零。 */
  readonly canary: CanaryStore | null;
  readonly canaryMetrics: CanaryMetrics = { inject_skipped: 0, registry_unavailable: 0, canary_injected: 0 };

  constructor(private readonly cfg: GatewayConfig) {
    this.canary = cfg.canaryRegistryPath !== undefined ? new CanaryStore(cfg.canaryRegistryPath) : null;
  }

  /** 分派序列：REGISTRY + 配置注入的额外 checker（按 side 过滤）。 */
  private checkersIncludingInjected(side: Direction): readonly CheckerSpec[] {
    const extra = this.cfg.extraCheckers;
    if (extra === undefined || extra.length === 0) return checkersFor(side);
    return [...checkersFor(side), ...extra.filter((c) => c.side === side)];
  }

  /**
   * D-09：checkerId 的本次预算（ms）。注入 override 只影响被点名 checker（AC-V2a-27③），
   * 其余走 defaultMs（调用点按路径传入 G3 档位值或 G1_PER_CHUNK）。
   */
  private budgetFor(checkerId: string, defaultMs: number): number {
    const override = this.cfg.checkerBudgetMs?.get(checkerId);
    return override !== undefined ? override : defaultMs;
  }

  /** 请求侧扫描 + policy → action；返回 action 与 evidence findings。 */
  scanRequest(bodyText: string, headers: Readonly<Record<string, string>>, transport: "stream" | "non-stream"): {
    inputs: PolicyInput[];
    scanUnit: ScanUnit;
  } {
    const parsed = tryParseJson(bodyText);
    const scanUnit = buildRequestScanUnit(bodyText, parsed, headers, transport);
    // D-09 默认接线（AC-V2a-27①）：请求体路径按 body 字节数走 G3 分档。
    const defaultBudget = g3BudgetForBodyBytes(Buffer.byteLength(bodyText, "utf8"));
    const inputs: PolicyInput[] = [];
    for (const spec of this.checkersIncludingInjected("request")) {
      const fn = spec.runNonStream as NonStreamChecker | undefined;
      if (!fn) continue;
      const r = safeRun(fn, scanUnit, this.budgetFor(spec.id, defaultBudget));
      inputs.push({ checkerId: spec.id, safetyClass: spec.safetyClass, result: r });
    }
    return { inputs, scanUnit };
  }

  /** 响应侧非流式扫描 + policy。 */
  scanResponseNonStream(bodyText: string, requestedModel: string | null, declaredMeta?: Readonly<Record<string, unknown>>): PolicyInput[] {
    const parsed = tryParseJson(bodyText);
    const unit = buildResponseScanUnit(bodyText, parsed, requestedModel, "non-stream", declaredMeta);
    // D-09 默认接线（AC-V2a-27①）：非流式响应体路径按 body 字节数走 G3 分档。
    const defaultBudget = g3BudgetForBodyBytes(Buffer.byteLength(bodyText, "utf8"));
    const inputs: PolicyInput[] = [];
    for (const spec of this.checkersIncludingInjected("response")) {
      const fn = spec.runNonStream as NonStreamChecker | undefined;
      if (!fn) continue;
      const r = safeRun(fn, unit, this.budgetFor(spec.id, defaultBudget));
      inputs.push({ checkerId: spec.id, safetyClass: spec.safetyClass, result: r });
    }
    return inputs;
  }

  /**
   * 响应侧流式 checker 分派（逐帧与 SL-01 归并单元共用）—— D-07/ADR-0005 窗口归属：
   *
   *   - 窗口按 checkerId 分持（`windows` map，逐帧路径传 WindowStore，账本随分派自记）。
   *     注意：ledger 在场时 `windows` 本身被就地推进（账本即状态），返回的 nextWindows 是
   *     同内容的视图；调用方可继续用原 store，也可换用返回值，两者不得各推一份。
   *   - R2 A-M1（最高优先）：checker 收到的是**推进前**窗口（AC-VETO-004-02 冻结语义：
   *     cursor = 本片之前已消费的 UTF-16 code unit 数）；网关在 checker 返回后的重组点
   *     单点推进（旧值 + unit.text.length），回传 cursor 一律忽略、回传 extra 原样保留。
   *     推进恰好一次、绝不提前——"先推进后扫"即 v1 双推进镜像，AC-V2a-25 系统性失败。
   *   - 归并重投影（advance:false，SL-01）：归并文本是已消费内容的重放，meta 打
   *     REPROJECTION_META_KEY 标记（累积型 checker 据此跳过再累积/再判定），窗口零推进。
   */
  scanResponseStreamUnit(
    windows: ReadonlyMap<string, ScanWindow>,
    unit: ScanUnit,
    opts?: { readonly advance?: boolean },
  ): { inputs: PolicyInput[]; nextWindows: ReadonlyMap<string, ScanWindow> } {
    const advance = opts?.advance !== false;
    const ledger: WindowStore | undefined = advance && isWindowStore(windows) ? windows : undefined;
    const effectiveUnit = advance
      ? unit
      : { ...unit, meta: { ...unit.meta, [REPROJECTION_META_KEY]: true } };
    // D-09 默认接线（AC-V2a-27①）：流式路径每次 checker 调用走 G1 每 chunk 门。
    // advance:false 的归并重投影再扫描（归并文本 = 已消费内容的重放）按"每次调用"
    // 字面同样包裹与裁决（含注入 override）；超时只改写 result，窗口推进语义不变。
    const defaultBudget = G1_PER_CHUNK;
    const inputs: PolicyInput[] = [];
    const nextWindows = new Map<string, ScanWindow>();
    for (const spec of this.checkersIncludingInjected("response")) {
      if (spec.runStream) {
        const prev = windows.get(spec.id) ?? initialWindow();
        const [result, returned] = runStreamWithBudget(
          spec.runStream,
          prev,
          effectiveUnit,
          this.budgetFor(spec.id, defaultBudget),
        );
        inputs.push({ checkerId: spec.id, safetyClass: spec.safetyClass, result });
        if (advance) {
          // 重组点 = 网关唯一推进点；ledger 在场时落账（AC-V2a-26③ 字节账本）随行。
          nextWindows.set(
            spec.id,
            ledger ? ledger.recordChunk(spec.id, returned, unit.text) : recombineWindow(prev, returned, unit.text.length),
          );
        } else {
          nextWindows.set(spec.id, prev); // 重投影零推进：消费计数只认逐帧口径
        }
      } else if (spec.runNonStream) {
        const r = safeRun(spec.runNonStream as NonStreamChecker, effectiveUnit, this.budgetFor(spec.id, defaultBudget));
        inputs.push({ checkerId: spec.id, safetyClass: spec.safetyClass, result: r });
      }
    }
    return { inputs, nextWindows };
  }

  /** 响应侧流式扫描：per-chunk → policy；返回 action + evidence。 */
  scanResponseStreamChunk(
    windows: ReadonlyMap<string, ScanWindow>,
    chunkData: string,
    requestedModel: string | null,
    declaredMeta?: Readonly<Record<string, unknown>>,
    opts?: { readonly advance?: boolean },
  ): {
    inputs: PolicyInput[];
    nextWindows: ReadonlyMap<string, ScanWindow>;
    parsed: Record<string, unknown> | null;
  } {
    const parsed = tryParseJson(chunkData);
    const unit = buildResponseScanUnit(chunkData, parsed, requestedModel, "stream", declaredMeta);
    const { inputs, nextWindows } = this.scanResponseStreamUnit(windows, unit, opts);
    return { inputs, nextWindows, parsed };
  }
}

/**
 * D-09 与 safeRun 的关系（key decision）：safeRun 在外层——checker 抛异常时，异常在
 * runWithBudget 的事后判定之前穿出（抛出先于改写），在此翻译为 scanner_error 优先；
 * 超时改写仅对正常返回生效（具体错误比超时判定信息量大）。默认预算由调用点按路径
 * 传入（请求体/非流式响应体 = G3 分档，流式每 chunk = G1 门），已三路径全接线。
 */
function safeRun(fn: NonStreamChecker, unit: ScanUnit, budgetMs: number): CheckerResult {
  try {
    return runWithBudget(fn, unit, budgetMs);
  } catch {
    return { verdict: "error", evidence: [], reason: "scanner_error" };
  }
}

/**
 * D-10 tie-break 单一真相源：checker 注册表声明序。同级（同固定序排位）error 并列时
 * 由它决定顶层 reason 归属；findings 重放（pickTopReasonFromErrorFindings）共用。
 */
const CHECKER_DECLARATION_ORDER: readonly string[] = REGISTRY.map((c) => c.id);

/** R3 T-M1 + D-10：reason = findings error 条目重放；gatewayReasons 非空时无条件胜过 checker error（registry_unavailable > inject_skipped）。SL-07 还债：gateway 值经此统一产出落链；无异常 → undefined（键整体缺席）。 */
function reasonOf(findings: readonly EvidenceFinding[], gatewayReasons?: readonly string[]): string | undefined {
  return pickTopReasonFromErrorFindings({ findings, checkerDeclarationOrder: CHECKER_DECLARATION_ORDER, ...(gatewayReasons !== undefined && gatewayReasons.length > 0 ? { gatewayReasons } : {}) })?.reason;
}

/** canary 编排单步（D-04）：meta=null = 判定域外（非受管/未配置/block），不携带任何 canary 字段。 */
interface CanaryStep { readonly forwardedBody: string; readonly meta: CanaryRequestMeta | null; readonly gatewayReason?: "registry_unavailable" | "inject_skipped"; }

/** canary 注入编排（D-04，§4.4 时序 deriveSessionKey → assign → snapshot → inject）：前置 = 受管路径且未 block（调用点保证）。registry 不可用 → 不注入不匹配 + reason + 计数（fail-open 可观测，§4.3 不得静默）。 */
function orchestrateCanary(core: GatewayCore, req: { body: string; headers: Record<string, string>; client: string; providerId: string }): CanaryStep {
  const store = core.canary;
  if (store === null || !CANARY_MANAGED_ROUTES.has(`${req.client}/${req.providerId}`)) {
    return { forwardedBody: req.body, meta: null }; // 判定域外：未配置或非受管路径（≠ inject_skipped，零计数零字段）
  }
  if (store.loadStatus.status !== "ok") {
    core.canaryMetrics.registry_unavailable += 1;
    return { forwardedBody: req.body, meta: { canary_injected: false }, gatewayReason: "registry_unavailable" };
  }
  const sessionKey = deriveSessionKey(req.headers, req.body);
  const { canary } = store.assign(sessionKey); // 分配点 = 过闸时
  const candidates = store.snapshot(sessionKey); // 冻结只读快照（跨客户端共享；在途请求不受后续轮换影响）
  const result = inject(req.body, canary);
  if (!result.injected) {
    core.canaryMetrics.inject_skipped += 1;
    return { forwardedBody: result.body, meta: { canary_injected: false, canary_candidates: candidates }, gatewayReason: "inject_skipped" };
  }
  core.canaryMetrics.canary_injected += 1;
  return { forwardedBody: result.body, meta: { canary_injected: true, canary_candidates: candidates } };
}

/** handler 的统一返回形状：流式路径用 getter，交付完成时才读终止真值。 */
export interface ChatOutcome {
  readonly status: number;
  readonly body: string;
  readonly sse?: AsyncIterable<string>;
  readonly actionTaken: ActionTaken;
  readonly findings: EvidenceFinding[];
  readonly deliveredChunks: number;
  readonly scenario: BehaviorScenario;
  readonly reason?: string | undefined;
  readonly forwardedBody: string;
  readonly canaryMeta: CanaryRequestMeta | null;
}

/**
 * 端到端 handler：接收 req（HTTP），向 upstream 转发 + 扫描 + 落 evidence。
 * 该函数是 gateway 层的"骨架"，测试通过 mock-upstream 集成。
 */
export async function handleChatCompletions(
  core: GatewayCore,
  req: { body: string; headers: Record<string, string>; upstreamUrl: string; requestId: string; sessionId: string; turnId: string; client: string; providerId: string; endpointHost: string; transport: "stream" | "non-stream" },
): Promise<ChatOutcome> {
  // transport 由 server 层判定后下传（单一真相源）：本层不再自行从 headers/body 重判。
  const stream = req.transport === "stream";
  const transport = req.transport;
  const reqScan = core.scanRequest(req.body, req.headers, transport);
  // SL-01/D-12：请求体 tools 声明面（declared_tools/declared_required）提取自请求扫描
  // 单元 meta，下传给响应侧全部扫描单元（非流式 / 流式逐帧 / 归并单元）。
  const declaredMeta = declaredToolsMeta(reqScan.scanUnit.meta);
  const reqDecision = decide(reqScan.inputs);
  const reqFindings = flattenFindings(reqScan.inputs);

  if (reqDecision.action === "block") {
    return {
      status: 502,
      body: JSON.stringify({ error: { code: "llmveto:rejected" } }),
      actionTaken: resolveActionTaken([
        "blocked_before_forward",
        ...(reqDecision.degraded ? (["degraded_observational"] as const) : []),
      ]),
      findings: reqFindings,
      reason: reasonOf(reqFindings),
      forwardedBody: req.body, canaryMeta: null, // block 前置：编排不进入，链上 sha = 客户端原体
      deliveredChunks: 0,
      scenario: "1",
    };
  }
  // canary 注入编排（D-04）：先于 fetch，注入后体作为转发体；请求侧扫描仍以客户端原体为准。
  const canaryStep = orchestrateCanary(core, req);
  const gwReasons = canaryStep.gatewayReason !== undefined ? [canaryStep.gatewayReason] : undefined;
  // canary meta 随声明面并入全部响应侧扫描单元（SL-08 return-scan 判定面）；判定域外保持 declaredMeta 原样。
  const responseMeta: Record<string, unknown> = canaryStep.meta === null ? declaredMeta : {
    ...declaredMeta,
    canary_injected: canaryStep.meta.canary_injected,
    ...(canaryStep.meta.canary_candidates !== undefined ? { canary_candidates: canaryStep.meta.canary_candidates } : {}),
  };
  // 转发到 upstream（体 = 注入编排产出：受管路径为注入后体，其余为原体）
  const upstream = await fetch(req.upstreamUrl, {
    method: "POST",
    headers: { "content-type": "application/json", ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}) },
    body: canaryStep.forwardedBody,
  });
  if (!upstream.ok) {
    return {
      status: upstream.status,
      body: await upstream.text(),
      actionTaken: resolveActionTaken([
        "allowed",
        ...(reqDecision.degraded ? (["degraded_observational"] as const) : []),
      ]),
      findings: reqFindings,
      reason: reasonOf(reqFindings, gwReasons),
      forwardedBody: canaryStep.forwardedBody, canaryMeta: canaryStep.meta,
      deliveredChunks: 0,
      scenario: transport === "stream" ? "3" : "2",
    };
  }
  if (!stream) {
    const text = await upstream.text();
    const respInputs = core.scanResponseNonStream(text, (reqScan.scanUnit.meta.model_requested as string | undefined) ?? null, responseMeta);
    const respDecision = decide([...reqScan.inputs, ...respInputs]);
    const allFindings = [...reqFindings, ...flattenFindings(respInputs)];
    if (respDecision.action === "block") {
      return {
        status: 502,
        body: "",
        actionTaken: resolveActionTaken([
          "blocked_before_deliver",
          ...(respDecision.degraded ? (["degraded_observational"] as const) : []),
        ]),
        findings: allFindings,
        reason: reasonOf(allFindings, gwReasons),
        forwardedBody: canaryStep.forwardedBody, canaryMeta: canaryStep.meta,
        deliveredChunks: 0,
        scenario: "2",
      };
    }
    const actionTaken = resolveActionTaken([
      "allowed",
      ...(respDecision.action === "warn" ? (["warned"] as const) : []),
      ...(respDecision.degraded ? (["degraded_observational"] as const) : []),
    ]);
    return { status: 200, body: text, actionTaken, findings: allFindings, reason: reasonOf(allFindings, gwReasons), forwardedBody: canaryStep.forwardedBody, canaryMeta: canaryStep.meta, deliveredChunks: 1, scenario: "2" };
  }
  // 流式：tee（逐帧交付逻辑独立成 handleStreaming，主 handler 只保留分支骨架）
  const requested = (reqScan.scanUnit.meta.model_requested as string | undefined) ?? null;
  return handleStreaming({
    core,
    body: upstream.body,
    requested,
    responseMeta,
    requestInputs: reqScan.inputs,
    degraded: reqDecision.degraded,
    reqFindings,
    forwardedBody: canaryStep.forwardedBody,
    canaryMeta: canaryStep.meta,
    gwReasons,
  });
}

/** 流式交付：逐帧扫描 + veto 截断 + tool_call arguments 归并；上游无 body 时按空交付收束。 */
function handleStreaming(p: {
  readonly core: GatewayCore;
  readonly body: ReadableStream<Uint8Array> | null;
  readonly requested: string | null;
  readonly responseMeta: Record<string, unknown>;
  readonly requestInputs: readonly PolicyInput[];
  readonly degraded: boolean;
  readonly reqFindings: readonly EvidenceFinding[];
  readonly forwardedBody: string;
  readonly canaryMeta: CanaryRequestMeta | null;
  readonly gwReasons: readonly string[] | undefined;
}): ChatOutcome {
  const { core, body, requested, responseMeta, requestInputs, reqFindings } = p;
  if (!body) {
    return {
      status: 200,
      body: "",
      actionTaken: resolveActionTaken([
        "allowed",
        ...(p.degraded ? (["degraded_observational"] as const) : []),
      ]),
      findings: [...reqFindings],
      reason: reasonOf(reqFindings, p.gwReasons),
      forwardedBody: p.forwardedBody, canaryMeta: p.canaryMeta,
      deliveredChunks: 0,
      scenario: "3",
    };
  }
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  // D-07：窗口按 checkerId 分持的 store（含 per-checker 字节账本）；推进/落账在
  // scanResponseStreamUnit 重组点单点发生，本层不再持有任何单一窗口变量。
  const windows = createWindowStore();
  let pending = "";
  let deliveredChunks = 0;
  const allFindings: EvidenceFinding[] = [...reqFindings];
  let terminated = false;
  // D-11：流式路径的观测类降级累积——任一帧扫描出现观测类 error 即置位；
  // 收束时（即便无 veto）action_taken 如实降级为 degraded_observational。
  let degradedSeen = p.degraded;
  // SL-01/AC-V2a-01：流式 delta.tool_calls arguments 跨帧归并桶（按 tool_call index 累积）。
  const argsMerger = createToolCallArgsMerger();
  /** 交付前扫描（含非 SSE 内容）：命中 block → true，调用方改发 veto 终止流。 */
  function scanDelivered(text: string): boolean {
    const scan = core.scanResponseStreamChunk(windows, text, requested, responseMeta);
    argsMerger.feed(scan.parsed); // 帧内 delta 片段进归并桶（归并后统一扫描，不逐 chunk 扫碎片）
    allFindings.push(...flattenFindings(scan.inputs));
    const d = decide([...requestInputs, ...scan.inputs]);
    if (d.degraded) degradedSeen = true;
    return d.action === "block";
  }
  /**
   * SL-01 归并增量扫描：把归并文本作为**整体**进扫描域（交付当前帧之前），命中则
   * 当前帧起不交付。归并文本是已消费内容的重投影：findings 收编，但窗口零推进
   * （advance:false + REPROJECTION_META_KEY 标记；消费计数只认逐帧口径，
   * 窗口归属/offsets 语义由 D-07/D-08 接管）。
   */
  function scanMergedArgs(): boolean {
    const merged = argsMerger.mergedText();
    if (merged === "") return false;
    const scan = core.scanResponseStreamUnit(windows, buildMergedToolCallScanUnit(merged, responseMeta), { advance: false });
    allFindings.push(...flattenFindings(scan.inputs));
    const d = decide([...requestInputs, ...scan.inputs]);
    if (d.degraded) degradedSeen = true;
    return d.action === "block";
  }
  async function* sse(): AsyncIterable<string> {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const { frames, rest } = parseSseFrames(pending);
      pending = rest;
      for (const f of frames) {
        // 非 `data:` 帧（上游按 body 判模态而回整段 JSON 时即此类）同样先扫描后转发：
        // transport=stream 由本端判定（`?stream=1` / 头），与上游模态可能不一致，
        // 免检直通会让该子类的响应侧 checker 全部落空（R2-N1 扫描回归）。
        if (f.data === undefined) {
          if (scanDelivered(f.raw)) { yield encodeVetoEvent(deliveredChunks); terminated = true; return; }
          yield f.raw + "\n\n";
          continue;
        }
        if (f.data === "[DONE]") { yield `data: ${f.data}\n\n`; continue; }
        if (scanDelivered(f.data)) {
          yield encodeVetoEvent(deliveredChunks);
          terminated = true;
          return;
        }
        // SL-01：归并增量扫描在交付当前帧之前——跨帧才完整的载荷此刻已可判定
        if (scanMergedArgs()) {
          yield encodeVetoEvent(deliveredChunks);
          terminated = true;
          return;
        }
        yield `data: ${f.data}\n\n`;
        deliveredChunks += 1;
      }
    }
    // EOF 残尾（未以空行收束的最后一帧，含"上游返回非 SSE JSON 体"的整段内容）：
    // 补帧终止符后按帧规则解析出可扫描文本，命中则不发残尾直接 veto。
    if (pending.length > 0) {
      const tail = parseSseFrames(pending + "\n\n").frames[0];
      if (scanDelivered(tail?.data ?? tail?.raw ?? pending)) {
        yield encodeVetoEvent(deliveredChunks);
        terminated = true;
        return;
      }
      yield pending;
    }
    // SL-01：残尾帧可能补进最后的 arguments 片段——流收束前对归并文本做末次整体扫描
    if (scanMergedArgs()) {
      yield encodeVetoEvent(deliveredChunks);
      terminated = true;
      return;
    }
  }
  // 用 getter 而不是快照：sse() 是惰性 generator，调用方 server.ts 在 `for await` 完成后才写 evidence；
  // 届时 actionTaken / deliveredChunks / scenario / findings 需要反映终止时的真值（AC-VETO-014-05 场景 4）。
  // D-11：action_taken 经 resolveActionTaken 单值化——顶层档（terminated）> degraded_observational
  // > allowed；流式路径不掺 warned 候选（v1 流式 warn 语义本就不改 action_taken，零回归）。
  // D-10：reason 同为 getter —— findings 是惰性累积的，终止时刻的 error 条目集才完整。
  return {
    status: 200,
    body: "",
    sse: sse(),
    forwardedBody: p.forwardedBody, canaryMeta: p.canaryMeta, // 注入产物请求侧定型（流式只改请求体，SL-02 债边界）
    get actionTaken(): ActionTaken {
      return resolveActionTaken([
        ...(terminated ? (["terminated_after_delivery"] as const) : []),
        ...(degradedSeen ? (["degraded_observational"] as const) : []),
        "allowed",
      ]);
    },
    get findings(): EvidenceFinding[] { return allFindings; },
    get reason(): string | undefined { return reasonOf(allFindings, p.gwReasons); },
    get deliveredChunks(): number { return deliveredChunks; },
    get scenario(): BehaviorScenario { return pickScenario({ side: "response", transport: "stream", deliveredChunks }); },
  };
}

function flattenFindings(inputs: readonly PolicyInput[]): EvidenceFinding[] {
  const out: EvidenceFinding[] = [];
  for (const i of inputs) {
    // D-10 第二层：verdict=error 的输入本身落一条 error 条目（rule_id 承载成因，
    // 即 i.result.reason）；threat 由 §4.5 表提供——查不到视为登记缺陷，显式失败
    // （fail-closed），绝不自造 threat。观测类与安全类 error 一视同仁，无分类豁免。
    if (i.result.verdict === "error") {
      const threat = CHECKER_THREAT_BY_ID[i.checkerId];
      if (threat === undefined) {
        throw new Error(`D-10: checker '${i.checkerId}' has no threat mapping in the §4.5 table (registration defect)`);
      }
      out.push({
        checker: i.checkerId,
        threat,
        verdict: "error",
        ...(i.result.reason !== undefined ? { rule_id: i.result.reason } : {}),
      });
    }
    for (const f of i.result.evidence) {
      const finding: EvidenceFinding = {
        checker: f.checker,
        threat: f.threat,
        verdict: f.verdict,
        ...(f.severity !== undefined ? { severity: f.severity } : {}),
        ...(f.offsets !== undefined ? { offsets: f.offsets } : {}),
        ...(f.rule_id !== undefined ? { rule_id: f.rule_id } : {}),
      };
      out.push(finding);
    }
  }
  return out;
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
