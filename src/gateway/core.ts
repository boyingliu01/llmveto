import { createHash } from "node:crypto";
import { checkersFor, CHECKER_THREAT_BY_ID, REGISTRY } from "./registry.ts";
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
import { encodeVetoEvent, parseSseFrames, tryParseJson, type SseFrame } from "./sse-tee.ts";
import type { WireFormat } from "./protocols/types.ts";
import { protocolFor } from "./protocols/table.ts";
import { shapeVerdict } from "./protocols/outcome.ts";
import { decide, pickScenario, pickTopReasonFromErrorFindings, type BehaviorScenario } from "../policy/engine.ts";
import type { PolicyInput } from "../policy/engine.ts";
import { resolveActionTaken } from "../policy/mapping.ts";
import { directionsOf } from "../shared/types.ts";
import type {
  CheckerResult,
  CheckerSpec,
  Direction,
  Finding,
  ScanUnit,
  ScanWindow,
  NonStreamChecker,
  StreamChecker,
  BodyCapture,
} from "../shared/types.ts";
import type { EvidenceWriter } from "../evidence/writer.ts";
import type { EvidenceFinding } from "../evidence/schema.ts";
import type { ActionTaken } from "../shared/types.ts";
import { CanaryStore } from "../canary/store.ts";
import { deriveSessionKey } from "../canary/session-key.ts";
import { inject } from "../canary/inject.ts";
import { checkDangerousCommandWithDedup, createDangerousCommandDedup } from "../checkers/dangerous-command-scan.ts";

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

/**
 * 无 adapter 契约的显式判定域扩展（与 adapter 推导集合分开维护）：
 * dsh 的全部 OpenAI 兼容 provider 共用 `<gw>/dsh/cliproxy/v1` 路由（LLMVETO_UPSTREAMS 的
 * `dsh/cliproxy` 条目），故注入/串流检出按该单一路由键生效。集成测试断言
 * CANARY_MANAGED_ROUTES = adapter 推导集合 ∪ 本集合，adapter 侧漂移仍会被抓到。
 */
export const MANUAL_CANARY_MANAGED_ROUTES: ReadonlySet<string> = Object.freeze(
  // v2b-A（REQ-V2bA-13）：两条新路由**在注入判定域内**，但对应的线格式不支持注入——
  // 所以它们会以 inject_skipped 被记账，而不是被当成"非受管路径"静默跳过。
  // "不在域内"与"在域内但不注入"是两件不同的事：前者无声，后者可观测。
  new Set(["dsh/cliproxy", "claude/anthropic", "codex/openai"]),
);

/** REQ-V2a-11/D-05 注入判定域（路由键 client/provider）：gateway 层镜像常量——architecture.yaml 禁 import adapters，与 adapters 层 MANAGED_CONFIG_IDS 的同源一致性由集成测试以真实 adapter 产物推导钉死（canary-inject 防漂移断言）。 */
export const CANARY_MANAGED_ROUTES: ReadonlySet<string> = Object.freeze(new Set([
  "opencode/openai", "opencode/anthropic", "opencode/mock", "delphi/default",
  ...MANUAL_CANARY_MANAGED_ROUTES,
]));

/** D-03 计数面：GET /_llmveto/metrics 的 canary 观测（D-14 live p50/p95/max 属 SL-12 handoff）。 */
export type CanaryMetrics = { inject_skipped: number; registry_unavailable: number; canary_injected: number };

/** 响应侧扫描单元 meta 的 canary 形状（SL-08 return-scan 判定面）：快照不可用时 canary_candidates 键缺席。 */
export interface CanaryRequestMeta {
  readonly canary_injected: boolean;
  readonly canary_candidates?: readonly string[];
  /** P1-2 归因面：与 canary_candidates 同集合，附带来源会话键；缺席时 checker 退化为只报命中。 */
  readonly canary_candidates_with_origin?: readonly { readonly canary: string; readonly origin: string }[];
}

/** canary 域的装配点（类体不直接 new 依赖：测试仍可经 config 注入路径构造替身）。 */
function createCanaryStore(cfg: GatewayConfig): CanaryStore | null {
  return cfg.canaryRegistryPath !== undefined ? new CanaryStore(cfg.canaryRegistryPath) : null;
}

/** 0.6.0：需要在一次请求内跨单元去重的 checker（同一命令被 DSH 全历史重放 20 次是常态）。 */
const DEDUP_CHECKER_IDS: ReadonlySet<string> = Object.freeze(new Set(["dangerous-command-scan"]));

export class GatewayCore {
  /** canary：D-02 单写者 store（null = 未配置，判定域外）；计数面恒在（进程内，durable 聚合属 SL-12），未配置全零。 */
  readonly canary: CanaryStore | null;
  readonly canaryMetrics: CanaryMetrics = { inject_skipped: 0, registry_unavailable: 0, canary_injected: 0 };

  constructor(private readonly cfg: GatewayConfig) {
    this.canary = createCanaryStore(cfg);
  }

  /** 分派序列：REGISTRY + 配置注入的额外 checker（按 side 过滤）。 */
  private checkersIncludingInjected(side: Direction): readonly CheckerSpec[] {
    const extra = this.cfg.extraCheckers;
    if (extra === undefined || extra.length === 0) return checkersFor(side);
    return [...checkersFor(side), ...extra.filter((c) => directionsOf(c).includes(side))];
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
  scanRequest(
    bodyText: string,
    headers: Readonly<Record<string, string>>,
    transport: "stream" | "non-stream",
    cmdDedup: ReturnType<typeof createDangerousCommandDedup> = createDangerousCommandDedup(),
    shape?: { readonly format: WireFormat } | undefined,
  ): {
    inputs: PolicyInput[];
    scanUnit: ScanUnit;
  } {
    const parsed = tryParseJson(bodyText);
    const scanUnit = buildRequestScanUnit(bodyText, parsed, headers, transport, shape);
    // D-09 默认接线（AC-V2a-27①）：请求体路径按 body 字节数走 G3 分档。
    const defaultBudget = g3BudgetForBodyBytes(Buffer.byteLength(bodyText, "utf8"));
    const inputs: PolicyInput[] = [];
    for (const spec of this.checkersIncludingInjected("request")) {
      const fn = spec.runNonStream as NonStreamChecker | undefined;
      if (!fn) continue;
      const r = DEDUP_CHECKER_IDS.has(spec.id)
        ? safeRun((u: ScanUnit) => checkDangerousCommandWithDedup(u, cmdDedup), scanUnit, this.budgetFor(spec.id, defaultBudget))
        : safeRun(fn, scanUnit, this.budgetFor(spec.id, defaultBudget));
      inputs.push({ checkerId: spec.id, safetyClass: spec.safetyClass, threat: spec.threat, result: r });
    }
    return { inputs, scanUnit };
  }

  /** 危险命令去重入口（0.6.0）：请求侧与响应侧共用一份状态；其它 checker 不受影响。 */
  scanWithDangerousCommandDedup(unit: ScanUnit, dedup: ReturnType<typeof createDangerousCommandDedup>): PolicyInput[] {
    const spec = this.checkersIncludingInjected(unit.direction).find((c) => c.id === "dangerous-command-scan");
    if (spec === undefined) return [];
    const result = safeRun((u: ScanUnit) => checkDangerousCommandWithDedup(u, dedup), unit, this.budgetFor(spec.id, G1_PER_CHUNK));
    return [{ checkerId: spec.id, safetyClass: spec.safetyClass, threat: spec.threat, result }];
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
      inputs.push({ checkerId: spec.id, safetyClass: spec.safetyClass, threat: spec.threat, result: r });
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
    const { advance, ledger, effectiveUnit } = resolveStreamScanContext(windows, unit, opts);
    // D-09 默认接线（AC-V2a-27①）：流式路径每次 checker 调用走 G1 每 chunk 门。
    // advance:false 的归并重投影再扫描（归并文本 = 已消费内容的重放）按"每次调用"
    // 字面同样包裹与裁决（含注入 override）；超时只改写 result，窗口推进语义不变。
    const inputs: PolicyInput[] = [];
    const nextWindows = new Map<string, ScanWindow>();
    for (const spec of this.checkersIncludingInjected("response")) {
      const prev = windows.get(spec.id) ?? initialWindow();
      const step = this.runStreamSpec(spec, prev, effectiveUnit, {
        advance,
        ledger,
        sourceText: unit.text,
      });
      if (step === null) continue;
      inputs.push(step.input);
      if (step.window !== undefined) nextWindows.set(spec.id, step.window);
    }
    return { inputs, nextWindows };
  }

  private policyInput(spec: CheckerSpec, result: CheckerResult): PolicyInput {
    return { checkerId: spec.id, safetyClass: spec.safetyClass, threat: spec.threat, result };
  }

  /** 重组点 = 网关唯一推进点；ledger 在场时落账（AC-V2a-26③ 字节账本）随行。 */
  private advanceWindow(
    ledger: WindowStore | undefined,
    checkerId: string,
    prev: ScanWindow,
    returned: ScanWindow,
    consumedText: string,
  ): ScanWindow {
    return ledger ? ledger.recordChunk(checkerId, returned, consumedText) : recombineWindow(prev, returned, consumedText.length);
  }

  /** 响应侧流式扫描：per-chunk → policy；返回 action + evidence。 */
  /**
   * 单 checker 在流式单元上的执行（D-09 逐调用 G1 门）：runStream 优先，
   * 否则退到 runNonStream；两者都没有时返回 null（该 spec 不参与本单元）。
   * advance=false（归并重投影）不推进窗口，窗口原样回收。
   */
  private runStreamSpec(
    spec: { readonly id: string; readonly runStream?: StreamChecker; readonly runNonStream?: NonStreamChecker },
    prev: ScanWindow,
    unit: ScanUnit,
    ctx: { readonly advance: boolean; readonly ledger: WindowStore | undefined; readonly sourceText: string },
  ): { readonly input: PolicyInput; readonly window?: ScanWindow } | null {
    if (spec.runStream) {
      const [result, returned] = runStreamWithBudget(spec.runStream, prev, unit, this.budgetFor(spec.id, G1_PER_CHUNK));
      const window = ctx.advance ? this.advanceWindow(ctx.ledger, spec.id, prev, returned, ctx.sourceText) : prev;
      return { input: this.policyInput(spec as CheckerSpec, result), window };
    }
    if (!spec.runNonStream) return null;
    const result = safeRun(spec.runNonStream, unit, this.budgetFor(spec.id, G1_PER_CHUNK));
    return { input: this.policyInput(spec as CheckerSpec, result) };
  }

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
function orchestrateCanary(
  core: GatewayCore,
  req: { body: string; headers: Record<string, string>; client: string; providerId: string; wireFormat?: WireFormat },
): CanaryStep {
  const store = core.canary;
  if (store === null || !CANARY_MANAGED_ROUTES.has(`${req.client}/${req.providerId}`)) {
    return { forwardedBody: req.body, meta: null }; // 判定域外：未配置或非受管路径（≠ inject_skipped，零计数零字段）
  }
  // SL-12（REQ-V2bA-13 / D4）：注入只对 chat 线格式生效。
  // 两种新协议上**显式不注入并记账**——"没注入"必须是可观测事实，不能是沉默的缺口。
  if (req.wireFormat !== undefined && !supportsCanaryInjection(req.wireFormat)) {
    core.canaryMetrics.inject_skipped += 1;
    return { forwardedBody: req.body, meta: { canary_injected: false }, gatewayReason: "inject_skipped" };
  }
  if (store.loadStatus.status !== "ok") {
    core.canaryMetrics.registry_unavailable += 1;
    return { forwardedBody: req.body, meta: { canary_injected: false }, gatewayReason: "registry_unavailable" };
  }
  const sessionKey = deriveSessionKey(req.headers, req.body);
  const { canary } = store.assign(sessionKey); // 分配点 = 过闸时
  const candidates = store.snapshot(sessionKey); // 冻结只读快照（跨客户端共享；在途请求不受后续轮换影响）
  // P1-2 归因面：同一集合、同一排除语义，额外保留来源会话键（命中时可报「谁串进了谁」）。
  const candidatesWithOrigin = store.snapshotWithOrigin(sessionKey);
  const result = inject(req.body, canary);
  const meta = (injected: boolean): CanaryRequestMeta => ({
    canary_injected: injected,
    canary_candidates: candidates,
    canary_candidates_with_origin: candidatesWithOrigin,
  });
  if (!result.injected) {
    core.canaryMetrics.inject_skipped += 1;
    return { forwardedBody: result.body, meta: meta(false), gatewayReason: "inject_skipped" };
  }
  core.canaryMetrics.canary_injected += 1;
  return { forwardedBody: result.body, meta: meta(true) };
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

/** 请求侧 block 早退：canary 编排尚未执行 ⇒ 无 gateway reason 可携带（恒空）。 */
/**
 * 网关侧 reason 清单。
 *
 * 形状降级（受管路由上已阻断，走到这说明是非受管路径）与 canary 原因可能同时存在；
 * 两者都是"网关没能覆盖这段流量"的事实，都要可查。
 */
function gatewayReasonsOf(canaryReason: string | undefined, shapeReason: string | undefined): readonly string[] | undefined {
  const out = [shapeReason, canaryReason].filter((r): r is string => r !== undefined);
  return out.length === 0 ? undefined : out;
}

/** 阻断的 action 序列（block 恒胜；degraded 仅作附加事实）。 */
function blockActions(degraded: boolean): readonly ("blocked_before_forward" | "degraded_observational")[] {
  return degraded ? ["blocked_before_forward", "degraded_observational"] : ["blocked_before_forward"];
}

/**
 * 请求侧阻断。
 * @param overrideReason 覆盖顶层 reason（SL-05 的形状判定用：形状阻断没有 finding，
 *   若沿用 `reasonOf(findings)` 就会写出空 reason——"阻断了但说不出为什么"正是本项目要避免的形态）
 */
function blockedBeforeForward(reqFindings: EvidenceFinding[], degraded: boolean, body: string, overrideReason?: string): ChatOutcome {
  return {
    status: 502,
    body: JSON.stringify({ error: { code: "llmveto:rejected" } }),
    actionTaken: resolveActionTaken(blockActions(degraded)),
    findings: reqFindings,
    reason: overrideReason ?? reasonOf(reqFindings),
    forwardedBody: body, canaryMeta: null, // block 前置：编排不进入，链上 sha = 客户端原体
    deliveredChunks: 0,
    scenario: "1",
  };
}

interface UpstreamFailureParams {
  readonly upstream: Awaited<ReturnType<typeof fetch>>;
  readonly degraded: boolean;
  readonly reqFindings: EvidenceFinding[];
  readonly gwReasons: readonly string[] | undefined;
  readonly forwardedBody: string;
  readonly canaryMeta: CanaryRequestMeta | null;
  readonly stream: boolean;
}

function upstreamFailureOutcome(p: UpstreamFailureParams): Promise<ChatOutcome> {
  return p.upstream.text().then((body) => ({
    status: p.upstream.status,
    body,
    actionTaken: resolveActionTaken([
      "allowed",
      ...(p.degraded ? (["degraded_observational"] as const) : []),
    ]),
    findings: p.reqFindings,
    reason: reasonOf(p.reqFindings, p.gwReasons),
    forwardedBody: p.forwardedBody, canaryMeta: p.canaryMeta,
    deliveredChunks: 0,
    scenario: p.stream ? "3" : "2",
  }));
}

/** canary meta 随声明面并入全部响应侧扫描单元（SL-08 return-scan 判定面）；判定域外保持 declaredMeta 原样。 */
function responseMetaFor(canaryMeta: CanaryRequestMeta | null, declaredMeta: Record<string, unknown>): Record<string, unknown> {
  if (canaryMeta === null) return declaredMeta;
  return {
    ...declaredMeta,
    canary_injected: canaryMeta.canary_injected,
    ...(canaryMeta.canary_candidates !== undefined ? { canary_candidates: canaryMeta.canary_candidates } : {}),
    // P1-2：归因面必须一并并入扫描单元。此处的逐键构造是第二个"静默丢弃"点——
    // 编排层算出了 with_origin，但未并入 meta 时 checker 永远读不到它。
    ...(canaryMeta.canary_candidates_with_origin !== undefined
      ? { canary_candidates_with_origin: canaryMeta.canary_candidates_with_origin }
      : {}),
  };
}

/**
 * 0.6.0：把「共享去重」的第二遍扫描结果与常规响应侧结果合并——只替换
 * dangerous-command-scan 这一项（其它 checker 结果原样）。若注入的 checker 集合里
 * 没有该 checker（登记域外），则保留常规结果不动。
 */
function withDedupScan(
  _meta: Record<string, unknown>,
  regular: readonly PolicyInput[],
  dedup: readonly PolicyInput[],
): readonly PolicyInput[] {
  if (dedup.length === 0) return regular;
  const id = dedup[0]!.checkerId;
  return [...regular.filter((i) => i.checkerId !== id), ...dedup];
}

/**
 * 流式扫描的上下文解析（D-09）：advance 缺省为 true；只有 advance 且 windows 本身是
 * WindowStore 时才启用窗口账本；归并重投影（advance=false）给单元打 reprojected 标记，
 * 让 checker 知道这段文本是"已消费内容的重放"。
 */
function resolveStreamScanContext(
  windows: ReadonlyMap<string, ScanWindow>,
  unit: ScanUnit,
  opts?: { readonly advance?: boolean },
): { readonly advance: boolean; readonly ledger: WindowStore | undefined; readonly effectiveUnit: ScanUnit } {
  const advance = opts?.advance !== false;
  const ledger = advance && isWindowStore(windows) ? windows : undefined;
  const effectiveUnit = advance ? unit : { ...unit, meta: { ...unit.meta, [REPROJECTION_META_KEY]: true } };
  return { advance, ledger, effectiveUnit };
}

interface NonStreamResponseParams {
  readonly core: GatewayCore;
  readonly text: string;
  readonly requestedModel: string | null;
  readonly responseMeta: Record<string, unknown>;
  readonly requestInputs: readonly PolicyInput[];
  readonly reqFindings: EvidenceFinding[];
  readonly forwardedBody: string;
  readonly canaryMeta: CanaryRequestMeta | null;
  readonly gwReasons: readonly string[] | undefined;
  readonly cmdDedup: ReturnType<typeof createDangerousCommandDedup>;
}

function handleNonStreamResponse(p: NonStreamResponseParams): ChatOutcome {
  const respInputs = p.core.scanResponseNonStream(p.text, p.requestedModel, p.responseMeta);
  // 0.6.0：与请求侧共享去重的第二遍（响应复述请求里的同一命令不再二次告警）。
  const dedupInputs = p.core.scanWithDangerousCommandDedup(
    buildResponseScanUnit(p.text, tryParseJson(p.text), p.requestedModel, "non-stream", p.responseMeta),
    p.cmdDedup,
  );
  const combinedResp = withDedupScan(p.responseMeta, respInputs, dedupInputs);
  const respDecision = decide([...p.requestInputs, ...combinedResp]);
  const allFindings = [...p.reqFindings, ...flattenFindings(combinedResp)];
  if (respDecision.action === "block") {
    return {
      status: 502,
      body: "",
      actionTaken: resolveActionTaken([
        "blocked_before_deliver",
        ...(respDecision.degraded ? (["degraded_observational"] as const) : []),
      ]),
      findings: allFindings,
      reason: reasonOf(allFindings, p.gwReasons),
      forwardedBody: p.forwardedBody, canaryMeta: p.canaryMeta,
      deliveredChunks: 0,
      scenario: "2",
    };
  }
  const actionTaken = resolveActionTaken([
    "allowed",
    ...(respDecision.action === "warn" ? (["warned"] as const) : []),
    ...(respDecision.degraded ? (["degraded_observational"] as const) : []),
  ]);
  return { status: 200, body: p.text, actionTaken, findings: allFindings, reason: reasonOf(allFindings, p.gwReasons), forwardedBody: p.forwardedBody, canaryMeta: p.canaryMeta, deliveredChunks: 1, scenario: "2" };
}

/**
 * 上游 POST 的边界封装：`fetch` 的网络层异常（DNS / 连接重置 / TLS）在此翻译成带阶段标记的错误，
 * 由 server 的 dispatch 兜底路径统一收敛为 502 + evidence（rule_id 直接携带该消息，便于区分
 * "转发阶段就失败"与"扫描内部异常"）。其余 `!upstream.ok` 属协议层，走正常 outcome 分支。
 */
async function postToUpstream(url: string, forwardedBody: string, authorization: string | undefined): Promise<Response> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
      body: forwardedBody,
    });
  } catch (err) {
    throw new Error(`upstream fetch failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

/**
 * 端到端 handler：接收 req（HTTP），向 upstream 转发 + 扫描 + 落 evidence。
 * 该函数是 gateway 层的"骨架"，测试通过 mock-upstream 集成。
 */
export async function handleChatCompletions(
  core: GatewayCore,
  req: { body: string; headers: Record<string, string>; upstreamUrl: string; requestId: string; sessionId: string; turnId: string; client: string; providerId: string; endpointHost: string; transport: "stream" | "non-stream"; routePrefix?: string | null; managedRoute?: boolean },
): Promise<ChatOutcome> {
  // transport 由 server 层判定后下传（单一真相源）：本层不再自行从 headers/body 重判。
  const { transport } = req;
  const stream = transport === "stream";
  const cmdDedup = createDangerousCommandDedup();
  // SL-05（REQ-V2bA-14/15）：先判形状——认不出的形态在这里就阻断，
  // 不让它走到"扫了但什么都没扫到、然后判 clean"那条路。
  const shape = shapeVerdict("request", tryParseJson(req.body), req.routePrefix ?? null, req.managedRoute === true);
  let degradedReason: string | undefined;
  // 受管路由上覆盖降级 = 阻断；非受管路由上只记录（REQ-15 的分权），由 shape.block 表达。
  if (shape.block && shape.reason !== null) return blockedBeforeForward([], false, req.body, shape.reason);
  if (shape.reason !== null) {
    // 非受管路径的覆盖降级：不阻断，但必须可查——把它挂到 outcome.reason 上落链。
    degradedReason = shape.reason;
  }
  const reqScan = core.scanRequest(req.body, req.headers, transport, cmdDedup, shapeFormat(shape));
  // SL-01/D-12：请求体 tools 声明面（declared_tools/declared_required）提取自请求扫描
  // 单元 meta，下传给响应侧全部扫描单元（非流式 / 流式逐帧 / 归并单元）。
  const declaredMeta = declaredToolsMeta(reqScan.scanUnit.meta);
  const reqDecision = decide(reqScan.inputs);
  const reqFindings = flattenFindings(reqScan.inputs);

  if (reqDecision.action === "block") {
    return blockedBeforeForward(reqFindings, reqDecision.degraded, req.body);
  }
  // canary 注入编排（D-04）：先于 fetch，注入后体作为转发体；请求侧扫描仍以客户端原体为准。
  const canaryStep = orchestrateCanary(core, { ...req, ...(shape.format === null ? {} : { wireFormat: shape.format }) });
  // 转发到 upstream（体 = 注入编排产出：受管路径为注入后体，其余为原体）
  const upstream = await postToUpstream(req.upstreamUrl, canaryStep.forwardedBody, req.headers.authorization);
  return deliverUpstream({
    core,
    upstream,
    stream,
    requestedModel: requestedModelOf(reqScan.scanUnit),
    // canary meta 随声明面并入全部响应侧扫描单元（SL-08 return-scan 判定面）；判定域外保持 declaredMeta 原样。
    responseMeta: responseMetaFor(canaryStep.meta, declaredMeta),
    requestInputs: reqScan.inputs,
    cmdDedup,
    degraded: reqDecision.degraded,
    reqFindings,
    forwardedBody: canaryStep.forwardedBody,
    canaryMeta: canaryStep.meta,
    gwReasons: gatewayReasonsOf(canaryStep.gatewayReason, degradedReason),
  });
}

/** 该线格式是否支持 canary 注入（协议表是唯一权威：chat 为 true，其余为 false）。 */
function supportsCanaryInjection(format: WireFormat): boolean {
  return protocolFor(format)?.canaryInjection === true;
}

/** 形状判定给出的线格式 → scanRequest 的协议参数（未识别时 undefined，走既有 Chat 投影）。 */
function shapeFormat(shape: { readonly format: WireFormat | null }): { readonly format: WireFormat } | undefined {
  return shape.format === null ? undefined : { format: shape.format };
}

/** 请求扫描单元里声明的 response model（缺声明即 null）。 */
function requestedModelOf(unit: ScanUnit): string | null {
  return (unit.meta.model_requested as string | undefined) ?? null;
}

/** 上游已应答后的三分支交付（非 2xx / 非流式 / 流式）——主 handler 只保留请求侧骨架。 */
interface UpstreamDelivery {
  readonly core: GatewayCore;
  readonly upstream: Response;
  readonly stream: boolean;
  readonly requestedModel: string | null;
  readonly responseMeta: Record<string, unknown>;
  readonly requestInputs: readonly PolicyInput[];
  readonly degraded: boolean;
  readonly reqFindings: EvidenceFinding[];
  readonly forwardedBody: string;
  readonly canaryMeta: CanaryRequestMeta | null;
  readonly gwReasons: readonly string[] | undefined;
  /** 危险命令去重状态（请求侧已消费），透传给响应侧各路径。 */
  readonly cmdDedup: ReturnType<typeof createDangerousCommandDedup>;
}

async function deliverUpstream(d: UpstreamDelivery): Promise<ChatOutcome> {
  if (!d.upstream.ok) {
    return upstreamFailureOutcome({
      upstream: d.upstream,
      degraded: d.degraded,
      reqFindings: d.reqFindings,
      gwReasons: d.gwReasons,
      forwardedBody: d.forwardedBody,
      canaryMeta: d.canaryMeta,
      stream: d.stream,
    });
  }
  if (!d.stream) {
    return handleNonStreamResponse({
      core: d.core,
      text: await d.upstream.text(),
      requestedModel: d.requestedModel,
      responseMeta: d.responseMeta,
      requestInputs: d.requestInputs,
      reqFindings: d.reqFindings,
      forwardedBody: d.forwardedBody,
      canaryMeta: d.canaryMeta,
      gwReasons: d.gwReasons,
      cmdDedup: d.cmdDedup,
    });
  }
  // 流式：tee（逐帧交付逻辑独立成 handleStreaming，主 handler 只保留分支骨架）
  return handleStreaming({
    core: d.core,
    body: d.upstream.body,
    requested: d.requestedModel,
    responseMeta: d.responseMeta,
    requestInputs: d.requestInputs,
    degraded: d.degraded,
    reqFindings: d.reqFindings,
    forwardedBody: d.forwardedBody,
    canaryMeta: d.canaryMeta,
    gwReasons: d.gwReasons,
    cmdDedup: d.cmdDedup,
  });
}

/** handleStreaming 入参：请求侧扫描结果 + 已注入的转发体 + 上游响应体流。 */
interface StreamParams {
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
  readonly cmdDedup: ReturnType<typeof createDangerousCommandDedup>;
}

/** 流式交付的跨帧可变状态：扫描窗口、归并桶与交付计数同住一处，收束时由 getter 读真值。 */
interface StreamState {
  readonly core: GatewayCore;
  readonly windows: WindowStore;
  readonly requested: string | null;
  readonly responseMeta: Record<string, unknown>;
  readonly requestInputs: readonly PolicyInput[];
  readonly argsMerger: ReturnType<typeof createToolCallArgsMerger>;
  /** 危险命令去重（0.6.0）：与请求侧共持一份，响应里复述请求中的同一命令不再二次告警。 */
  readonly cmdDedup: ReturnType<typeof createDangerousCommandDedup>;
  readonly allFindings: EvidenceFinding[];
  pending: string;
  deliveredChunks: number;
  terminated: boolean;
  degradedSeen: boolean;
  mergedOverflowReported: boolean;
}

/** 交付前扫描（含非 SSE 内容）：命中 block → true，调用方改发 veto 终止流。 */
function scanDelivered(st: StreamState, text: string): boolean {
  const scan = st.core.scanResponseStreamChunk(st.windows, text, st.requested, st.responseMeta);
  st.argsMerger.feed(scan.parsed); // 帧内 delta 片段进归并桶（归并后统一扫描，不逐 chunk 扫碎片）
  // 0.6.0 去重只覆盖非流式与归并单元：逐帧窗口才承载跨帧命令拼接（dangerous-command-scan 的
  // 流式语义），用逐帧原文另做一遍去重扫描会丢跨帧命中（2026-11-24 实测回归）。
  const inputs = scan.inputs;
  st.allFindings.push(...flattenFindings(inputs));
  const d = decide([...st.requestInputs, ...inputs]);
  if (d.degraded) st.degradedSeen = true;
  return d.action === "block";
}

/**
 * SL-01 归并增量扫描：把归并文本作为**整体**进扫描域（交付当前帧之前），命中则
 * 当前帧起不交付。归并文本是已消费内容的重投影：findings 收编，但窗口零推进
 * （advance:false + REPROJECTION_META_KEY 标记；消费计数只认逐帧口径，
 * 窗口归属/offsets 语义由 D-07/D-08 接管）。
 *
 * AC-V2a-14：归并器在 256 KiB 处封顶；越顶本身就是安全类判定（window_overflow），
 * 不再重扫已封顶文本，也不得让上游继续喂大（内存/CPU 有界）。
 * 本函数运行在 sse() 惰性 generator 内：任何 throw 都会冒泡出 for-await，headers
 * 已发出时无法再收敛为 HTTP 错误，且未处理的 rejection 可能杀 daemon（fail-open）。
 * 因此注册表缺项也不得抛错——合成 scanner_error 条目并照常 block。
 */
/** 归并缓冲溢出只报一次（window_overflow）；注册表缺项也不得抛错，合成 scanner_error 的威胁面兜底。 */
function reportArgsOverflow(st: StreamState): void {
  if (st.mergedOverflowReported) return;
  st.mergedOverflowReported = true;
  const spec = REGISTRY.find((c) => c.id === "tool-call-shape");
  st.allFindings.push({
    checker: "tool-call-shape",
    threat: spec?.threat ?? CHECKER_THREAT_BY_ID["tool-call-shape"] ?? "T2a",
    verdict: "error",
    rule_id: "window_overflow",
  });
}

function scanMergedArgs(st: StreamState): boolean {
  if (st.argsMerger.overflowed) {
    reportArgsOverflow(st);
    return true;
  }
  const merged = st.argsMerger.mergedText();
  if (merged === "") return false;
  const mergedUnit = buildMergedToolCallScanUnit(merged, st.responseMeta);
  const scan = st.core.scanResponseStreamUnit(st.windows, mergedUnit, { advance: false });
  const dedupInputs = st.core.scanWithDangerousCommandDedup(mergedUnit, st.cmdDedup);
  const inputs = withDedupScan(st.responseMeta, scan.inputs, dedupInputs);
  st.allFindings.push(...flattenFindings(inputs));
  const d = decide([...st.requestInputs, ...inputs]);
  if (d.degraded) st.degradedSeen = true;
  return d.action === "block";
}

type FrameStep =
  | { readonly kind: "veto" }
  | { readonly kind: "emit"; readonly text: string; readonly delivers: boolean };

/** 单帧处置：非 `data:` 帧（上游按 body 判模态而回整段 JSON 时即此类）同样先扫描后转发：
 * transport=stream 由本端判定（`?stream=1` / 头），与上游模态可能不一致，免检直通会让
 * 该子类的响应侧 checker 全部落空（R2-N1 扫描回归）。 */
function stepForFrame(st: StreamState, f: SseFrame): FrameStep {
  if (f.data === undefined) return stepRawFrame(st, f.raw);
  if (f.data === "[DONE]") return { kind: "emit", text: `data: ${f.data}\n\n`, delivers: false };
  // SL-01：归并增量扫描在交付当前帧之前——跨帧才完整的载荷此刻已可判定
  if (scanDelivered(st, f.data) || scanMergedArgs(st)) return { kind: "veto" };
  return { kind: "emit", text: `data: ${f.data}\n\n`, delivers: true };
}

/** 无 data 字段的帧：按原文扫描，命中即 veto。 */
function stepRawFrame(st: StreamState, raw: string): FrameStep {
  if (scanDelivered(st, raw)) return { kind: "veto" };
  return { kind: "emit", text: raw + "\n\n", delivers: false };
}

/** EOF 残尾（未以空行收束的最后一帧，含"上游返回非 SSE JSON 体"的整段内容）：
 * 补帧终止符后按帧规则解析出可扫描文本，命中则不发残尾直接 veto。 */
function scanPendingTail(st: StreamState): boolean {
  const tail = parseSseFrames(st.pending + "\n\n").frames[0];
  return scanDelivered(st, tail?.data ?? tail?.raw ?? st.pending);
}

/** 上游响应体的最小读取面（只取 `read()`，避免绑定 DOM/Node 两套 ReadableStream 类型）。 */
interface ByteReader {
  read(): Promise<{ readonly done: boolean; readonly value?: Uint8Array | undefined }>;
}

/** 逐帧 generator：读上游流 → 扫描 → 产出待转发文本；命中则发 veto 事件并终止（置 terminated）。 */
async function* streamSseFrames(
  st: StreamState,
  reader: ByteReader,
  decoder: TextDecoder,
): AsyncIterable<string> {
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    st.pending += decoder.decode(value, { stream: true });
    const batch = takeFrames(st);
    // 先交付本批已判定通过的帧，再按需收束——命中前的 benign 帧必须已送达客户端
    // （AC-VETO-014：delivered_chunks 反映真实交付数，不可因后帧 veto 而回退）。
    yield* batch.texts;
    if (batch.veto) {
      yield encodeVetoEvent(st.deliveredChunks);
      st.terminated = true;
      return;
    }
  }
  yield* flushStreamTail(st);
}

/**
 * 从 st.pending 切出一批完整帧并逐帧判定：遇 veto 立即停止（后续帧不再交付），
 * 记录已交付计数。返回值里 texts 是待交给客户端的帧文本。
 */
function takeFrames(st: StreamState): { readonly texts: string[]; readonly veto: boolean } {
  const { frames, rest } = parseSseFrames(st.pending);
  st.pending = rest;
  const texts: string[] = [];
  for (const f of frames) {
    const step = stepForFrame(st, f);
    if (step.kind === "veto") return { texts, veto: true };
    texts.push(step.text);
    if (step.delivers) st.deliveredChunks += 1;
  }
  return { texts, veto: false };
}

/**
 * 流收束：残尾（未以空行收束的最后一帧）先行判定与交付，再对归并文本做末次整体扫描
 * （SL-01：残尾帧可能补进最后的 arguments 片段）。命中则产 veto 并置 terminated。
 */
async function* flushStreamTail(st: StreamState): AsyncIterable<string> {
  if (st.pending.length === 0) return;
  if (scanPendingTail(st)) {
    yield encodeVetoEvent(st.deliveredChunks);
    st.terminated = true;
    return;
  }
  yield st.pending;
  if (scanMergedArgs(st)) {
    yield encodeVetoEvent(st.deliveredChunks);
    st.terminated = true;
  }
}

/** 上游 200 但无响应体：按"零交付 + 场景 3"收束（reason / 降级仍取请求侧结果）。 */
function emptyStreamOutcome(p: StreamParams): ChatOutcome {
  return {
    status: 200,
    body: "",
    actionTaken: resolveActionTaken([
      "allowed",
      ...(p.degraded ? (["degraded_observational"] as const) : []),
    ]),
    findings: [...p.reqFindings],
    reason: reasonOf(p.reqFindings, p.gwReasons),
    forwardedBody: p.forwardedBody, canaryMeta: p.canaryMeta,
    deliveredChunks: 0,
    scenario: "3",
  };
}

/** 流式交付：逐帧扫描 + veto 截断 + tool_call arguments 归并；上游无 body 时按空交付收束。 */
function handleStreaming(p: StreamParams): ChatOutcome {
  const { core, body, requested, responseMeta, requestInputs, reqFindings } = p;
  if (!body) return emptyStreamOutcome(p);
  // D-07：窗口按 checkerId 分持的 store（含 per-checker 字节账本）；推进/落账在
  // scanResponseStreamUnit 重组点单点发生，本层不再持有任何单一窗口变量。
  const st: StreamState = {
    core, windows: createWindowStore(), requested, responseMeta, requestInputs,
    argsMerger: createToolCallArgsMerger(),
    cmdDedup: p.cmdDedup,
    allFindings: [...reqFindings],
    pending: "",
    deliveredChunks: 0,
    terminated: false,
    // D-11：流式路径的观测类降级累积——任一帧扫描出现观测类 error 即置位；
    // 收束时（即便无 veto）action_taken 如实降级为 degraded_observational。
    degradedSeen: p.degraded,
    mergedOverflowReported: false,
  };
  // 用 getter 而不是快照：sse() 是惰性 generator，调用方 server.ts 在 `for await` 完成后才写 evidence；
  // 届时 actionTaken / deliveredChunks / scenario / findings 需要反映终止时的真值（AC-VETO-014-05 场景 4）。
  // D-11：action_taken 经 resolveActionTaken 单值化——顶层档（terminated）> degraded_observational
  // > allowed；流式路径不掺 warned 候选（v1 流式 warn 语义本就不改 action_taken，零回归）。
  // D-10：reason 同为 getter —— findings 是惰性累积的，终止时刻的 error 条目集才完整。
  return {
    status: 200,
    body: "",
    sse: streamSseFrames(st, body.getReader(), new TextDecoder("utf-8", { fatal: false })),
    forwardedBody: p.forwardedBody, canaryMeta: p.canaryMeta, // 注入产物请求侧定型（流式只改请求体，SL-02 债边界）
    get actionTaken(): ActionTaken {
      return resolveActionTaken([
        ...(st.terminated ? (["terminated_after_delivery"] as const) : []),
        ...(st.degradedSeen ? (["degraded_observational"] as const) : []),
        "allowed",
      ]);
    },
    get findings(): EvidenceFinding[] { return st.allFindings; },
    get reason(): string | undefined { return reasonOf(st.allFindings, p.gwReasons); },
    get deliveredChunks(): number { return st.deliveredChunks; },
    get scenario(): BehaviorScenario { return pickScenario({ side: "response", transport: "stream", deliveredChunks: st.deliveredChunks }); },
  };
}

/** D-10 第二层：verdict=error 的输入本身落一条 error 条目（rule_id 承载成因）。
 * threat 从 CheckerSpec.threat 经 PolicyInput 下传——单一声明，缺登记即显式失败；
 * 缺 reason 归一为 scanner_error，保证 reasonOf 不会静默丢条目（§4.5）。 */
function errorFindingOf(input: PolicyInput): EvidenceFinding | null {
  if (input.result.verdict !== "error") return null;
  const threat = input.threat ?? CHECKER_THREAT_BY_ID[input.checkerId];
  if (threat === undefined) {
    throw new Error(`D-10: checker '${input.checkerId}' has no threat mapping (registration defect)`);
  }
  return {
    checker: input.checkerId,
    threat,
    verdict: "error",
    rule_id: input.result.reason ?? "scanner_error",
  };
}

function toEvidenceFinding(f: Finding): EvidenceFinding {
  return {
    checker: f.checker,
    threat: f.threat,
    verdict: f.verdict,
    ...(f.severity !== undefined ? { severity: f.severity } : {}),
    ...(f.offsets !== undefined ? { offsets: f.offsets } : {}),
    ...(f.rule_id !== undefined ? { rule_id: f.rule_id } : {}),
    // P1-2：命中来源会话键（canary 串入归因）。逐字段构造会静默丢弃它，必须显式透传，
    // 否则 checker 算出了 origin 却永远进不了证据链（"看起来实现了、实际没生效"）。
    ...(f.origin !== undefined ? { origin: f.origin } : {}),
  };
}

function flattenFindings(inputs: readonly PolicyInput[]): EvidenceFinding[] {
  const out: EvidenceFinding[] = [];
  for (const i of inputs) {
    const errorFinding = errorFindingOf(i);
    if (errorFinding !== null) out.push(errorFinding);
    for (const f of i.result.evidence) out.push(toEvidenceFinding(f));
  }
  return out;
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
