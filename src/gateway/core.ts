import { createHash } from "node:crypto";
import { checkersFor } from "./registry.ts";
import { buildRequestScanUnit, buildResponseScanUnit } from "./scan-unit.ts";
import { encodeVetoEvent, parseSseFrames, tryParseJson } from "./sse-tee.ts";
import { decide, pickScenario, type BehaviorScenario } from "../policy/engine.ts";
import type { PolicyInput } from "../policy/engine.ts";
import type {
  CheckerResult,
  ScanUnit,
  ScanWindow,
  StreamChecker,
  NonStreamChecker,
  BodyCapture,
} from "../shared/types.ts";
import { EvidenceWriter } from "../evidence/writer.ts";
import type { EvidenceFinding } from "../evidence/schema.ts";
import type { ActionTaken } from "../shared/types.ts";

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
}

export class GatewayCore {
  constructor(private readonly cfg: GatewayConfig) {}

  /** 请求侧扫描 + policy → action；返回 action 与 evidence findings。 */
  scanRequest(bodyText: string, headers: Readonly<Record<string, string>>, transport: "stream" | "non-stream"): {
    inputs: PolicyInput[];
    scanUnit: ScanUnit;
  } {
    const parsed = tryParseJson(bodyText);
    const scanUnit = buildRequestScanUnit(bodyText, parsed, headers, transport);
    const inputs: PolicyInput[] = [];
    for (const spec of checkersFor("request")) {
      const fn = spec.runNonStream as NonStreamChecker | undefined;
      if (!fn) continue;
      const r = safeRun(fn, scanUnit);
      inputs.push({ checkerId: spec.id, safetyClass: spec.safetyClass, result: r });
    }
    return { inputs, scanUnit };
  }

  /** 响应侧非流式扫描 + policy。 */
  scanResponseNonStream(bodyText: string, requestedModel: string | null): PolicyInput[] {
    const parsed = tryParseJson(bodyText);
    const unit = buildResponseScanUnit(bodyText, parsed, requestedModel, "non-stream");
    const inputs: PolicyInput[] = [];
    for (const spec of checkersFor("response")) {
      const fn = spec.runNonStream as NonStreamChecker | undefined;
      if (!fn) continue;
      const r = safeRun(fn, unit);
      inputs.push({ checkerId: spec.id, safetyClass: spec.safetyClass, result: r });
    }
    return inputs;
  }

  /** 响应侧流式扫描：per-chunk → policy；返回 action + evidence。 */
  scanResponseStreamChunk(window: ScanWindow, chunkData: string, requestedModel: string | null): {
    inputs: PolicyInput[];
    nextWindow: ScanWindow;
    parsed: Record<string, unknown> | null;
  } {
    const parsed = tryParseJson(chunkData);
    const unit = buildResponseScanUnit(chunkData, parsed, requestedModel, "stream");
    const inputs: PolicyInput[] = [];
    let nextWindow: ScanWindow = { pendingBytes: window.pendingBytes, cursor: window.cursor + unit.text.length };
    for (const spec of checkersFor("response")) {
      if (spec.runStream) {
        const [r, w] = (spec.runStream as StreamChecker)(nextWindow, unit);
        inputs.push({ checkerId: spec.id, safetyClass: spec.safetyClass, result: r });
        nextWindow = w;
      } else if (spec.runNonStream) {
        const r = safeRun(spec.runNonStream as NonStreamChecker, unit);
        inputs.push({ checkerId: spec.id, safetyClass: spec.safetyClass, result: r });
      }
    }
    return { inputs, nextWindow, parsed };
  }
}

function safeRun(fn: NonStreamChecker, unit: ScanUnit): CheckerResult {
  try {
    return fn(unit);
  } catch {
    return { verdict: "error", evidence: [], reason: "scanner_error" };
  }
}

/**
 * 端到端 handler：接收 req（HTTP），向 upstream 转发 + 扫描 + 落 evidence。
 * 该函数是 gateway 层的"骨架"，测试通过 mock-upstream 集成。
 */
export async function handleChatCompletions(
  core: GatewayCore,
  req: { body: string; headers: Record<string, string>; upstreamUrl: string; requestId: string; sessionId: string; turnId: string; client: string; providerId: string; endpointHost: string; transport: "stream" | "non-stream" },
): Promise<{ status: number; body: string; sse?: AsyncIterable<string>; actionTaken: ActionTaken; findings: EvidenceFinding[]; deliveredChunks: number; scenario: BehaviorScenario }> {
  // transport 由 server 层判定后下传（单一真相源）：本层不再自行从 headers/body 重判。
  const stream = req.transport === "stream";
  const transport = req.transport;
  const reqScan = core.scanRequest(req.body, req.headers, transport);
  const reqDecision = decide(reqScan.inputs);
  const reqFindings = flattenFindings(reqScan.inputs);

  if (reqDecision.action === "block") {
    return {
      status: 502,
      body: JSON.stringify({ error: { code: "llmveto:rejected" } }),
      actionTaken: "blocked_before_forward",
      findings: reqFindings,
      deliveredChunks: 0,
      scenario: "1",
    };
  }
  // 转发到 upstream
  const upstream = await fetch(req.upstreamUrl, {
    method: "POST",
    headers: { "content-type": "application/json", ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}) },
    body: req.body,
  });
  if (!upstream.ok) {
    return {
      status: upstream.status,
      body: await upstream.text(),
      actionTaken: "allowed",
      findings: reqFindings,
      deliveredChunks: 0,
      scenario: transport === "stream" ? "3" : "2",
    };
  }
  if (!stream) {
    const text = await upstream.text();
    const respInputs = core.scanResponseNonStream(text, (reqScan.scanUnit.meta.model_requested as string | undefined) ?? null);
    const respDecision = decide([...reqScan.inputs, ...respInputs]);
    const allFindings = [...reqFindings, ...flattenFindings(respInputs)];
    if (respDecision.action === "block") {
      return { status: 502, body: "", actionTaken: "blocked_before_deliver", findings: allFindings, deliveredChunks: 0, scenario: "2" };
    }
    const actionTaken: ActionTaken = respDecision.action === "warn" ? "warned" : "allowed";
    return { status: 200, body: text, actionTaken, findings: allFindings, deliveredChunks: 1, scenario: "2" };
  }
  // 流式：tee
  const requested = (reqScan.scanUnit.meta.model_requested as string | undefined) ?? null;
  const body = upstream.body;
  if (!body) return { status: 200, body: "", actionTaken: "allowed", findings: reqFindings, deliveredChunks: 0, scenario: "3" };
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let window: ScanWindow = { pendingBytes: new Uint8Array(0), cursor: 0 };
  let pending = "";
  let deliveredChunks = 0;
  const allFindings: EvidenceFinding[] = [...reqFindings];
  let terminated = false;
  /** 交付前扫描（含非 SSE 内容）：命中 block → true，调用方改发 veto 终止流。 */
  function scanDelivered(text: string): boolean {
    const scan = core.scanResponseStreamChunk(window, text, requested);
    window = scan.nextWindow;
    allFindings.push(...flattenFindings(scan.inputs));
    return decide([...reqScan.inputs, ...scan.inputs]).action === "block";
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
  }
  // 用 getter 而不是快照：sse() 是惰性 generator，调用方 server.ts 在 `for await` 完成后才写 evidence；
  // 届时 actionTaken / deliveredChunks / scenario / findings 需要反映终止时的真值（AC-VETO-014-05 场景 4）。
  return {
    status: 200,
    body: "",
    sse: sse(),
    get actionTaken(): ActionTaken { return terminated ? "terminated_after_delivery" : "allowed"; },
    get findings(): EvidenceFinding[] { return allFindings; },
    get deliveredChunks(): number { return deliveredChunks; },
    get scenario(): BehaviorScenario { return pickScenario({ side: "response", transport: "stream", deliveredChunks }); },
  };
}

function flattenFindings(inputs: readonly PolicyInput[]): EvidenceFinding[] {
  const out: EvidenceFinding[] = [];
  for (const i of inputs) {
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
