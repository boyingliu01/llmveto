import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  CHECKER_TIMEOUT_RESULT,
  G1_PER_CHUNK,
  G3_TIER_8KB,
  G3_TIER_64KB,
  G3_TIER_512KB,
  G3_TIER_TABLE,
  g3BudgetForBodyBytes,
  runStreamWithBudget,
  runWithBudget,
} from "../../../src/gateway/budget.ts";
import { G1_TTFT_P99_MAX_MS, G3_THRESHOLDS } from "../../../bench/regression-formula.ts";
import { GatewayCore, handleChatCompletions } from "../../../src/gateway/core.ts";
import { EvidenceWriter } from "../../../src/evidence/writer.ts";
import { CHECKER_ERROR_REASON_ORDER, decide, pickTopReasonWinner } from "../../../src/policy/engine.ts";
import { resolveActionTaken } from "../../../src/policy/mapping.ts";
import type {
  CheckerResult,
  NonStreamChecker,
  ScanUnit,
  ScanWindow,
  StreamChecker,
} from "../../../src/shared/types.ts";
import { startMockUpstream, type MockUpstream } from "../../utils/mock-upstream.ts";

// @test REQ-V2a-12（D-09 / AC-V2a-27）
// @intent SL-04 预算门单元判定面：
//   ① 唯一档位常量源：G3 三档 / G1 每 chunk 门与 bench 常量互钉（src 不 import bench，
//      分层一致性由测试承载，防漂移）；
//   ② 档位边界：8192 / 65536 归档钉死（"≤8KB" 含 8192；源表 2-design-v1.md:79 为准，
//      D-09 文字 "32KB" 系笔误）；
//   ③ runWithBudget 事后判定：超预算改写形状（evidence 一并丢弃，R2 T-m3）+ 未超时恒等
//      透传；流式变体不吞回传窗口（AC-V2a-27④）；
//   ④ 注入 map 只影响被点名 checker（真 registry checker 扮演，AC-V2a-27③）；
//   ⑤ 归并重投影（advance:false）的再扫描同受预算裁决且零推进语义不被包裹破坏；
//   ⑥ checker_timeout 经 policy 层映射（守护测试：复用 SL-03 既有映射，无新代码）；
//   ⑦ checker_timeout 生产者经 handleChatCompletions 双层落链（AC-V2a-27⑤ v1 现状消除）。

// ── 真实慢函数（无 fake timer：performance.now 事后判定天然可测） ──
function busy(ms: number): void {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // 自旋等待真实时钟
  }
}

function unit(text = "hello"): ScanUnit {
  return { direction: "request", transport: "non-stream", text, meta: {} };
}

const benignReqBody = JSON.stringify({ model: "m", messages: [{ role: "user", content: "hi" }] });
const benignRespBody = JSON.stringify({
  model: "m",
  choices: [{ message: { role: "assistant", content: "hello" } }],
});

/** GatewayCore 测试构造（scan 层不发起网络；evidenceWriter 恒不 append）。 */
function coreWith(checkerBudgetMs?: ReadonlyMap<string, number>): GatewayCore {
  return new GatewayCore({
    upstreamBaseUrl: "http://127.0.0.1:9",
    evidenceWriter: new EvidenceWriter(join(tmpdir(), "sl04-unit-unused.jsonl")),
    ...(checkerBudgetMs !== undefined ? { checkerBudgetMs } : {}),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ① 唯一档位常量源（互钉）
// ─────────────────────────────────────────────────────────────────────────────
describe("SL-04 D-09 唯一档位常量源：src 常量与 bench 冻结值互钉（测试承载同源，防漂移）", () => {
  it("G1_PER_CHUNK === bench G1_TTFT_P99_MAX_MS（2-design-v1.md:77 p99<12ms 封顶）", () => {
    expect(G1_PER_CHUNK).toBe(G1_TTFT_P99_MAX_MS);
  });

  it("G3 三档与 bench G3_THRESHOLDS 逐位同源（源表：8KB→20 / 64KB→50 / 512KB→120）", () => {
    expect(G3_THRESHOLDS.map((t) => t.ms)).toEqual([G3_TIER_8KB, G3_TIER_64KB, G3_TIER_512KB]);
    expect(G3_THRESHOLDS.map((t) => t.body_bytes)).toEqual(G3_TIER_TABLE.map((t) => t.maxBytes));
  });

  it("常量表冻结（Object.freeze + as const 学习项）", () => {
    expect(Object.isFrozen(G3_TIER_TABLE)).toBe(true);
    expect(Object.isFrozen(CHECKER_TIMEOUT_RESULT)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② 档位选择边界
// ─────────────────────────────────────────────────────────────────────────────
describe("SL-04 G3 档位选择：body 字节数归档（边界值 8192/65536 钉死）", () => {
  it("≤8192 → G3_TIER_8KB（'≤8KB' 含 8192：边界值归下档）", () => {
    expect(g3BudgetForBodyBytes(0)).toBe(G3_TIER_8KB);
    expect(g3BudgetForBodyBytes(8191)).toBe(G3_TIER_8KB);
    expect(g3BudgetForBodyBytes(8192)).toBe(G3_TIER_8KB);
  });

  it("8193..65536 → G3_TIER_64KB（以源表 64KB→50ms 为准；D-09 文字 32KB 为笔误）", () => {
    expect(g3BudgetForBodyBytes(8193)).toBe(G3_TIER_64KB);
    expect(g3BudgetForBodyBytes(65535)).toBe(G3_TIER_64KB);
    expect(g3BudgetForBodyBytes(65536)).toBe(G3_TIER_64KB);
  });

  it(">65536 → G3_TIER_512KB（超档归顶：恰 512KiB 与 1MiB 同档）", () => {
    expect(g3BudgetForBodyBytes(65537)).toBe(G3_TIER_512KB);
    expect(g3BudgetForBodyBytes(512 * 1024)).toBe(G3_TIER_512KB);
    expect(g3BudgetForBodyBytes(1024 * 1024)).toBe(G3_TIER_512KB);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ runWithBudget 事后判定
// ─────────────────────────────────────────────────────────────────────────────
describe("SL-04 runWithBudget：事后判定（裁决面非止损面，同步 JS 无抢占）", () => {
  it("超预算 → 改写 {verdict:error, evidence:[], reason:checker_timeout}；原 result 的 evidence 一并丢弃（R2 T-m3）", () => {
    let ranToCompletion = false;
    const fn: NonStreamChecker = () => {
      busy(2);
      ranToCompletion = true;
      return {
        verdict: "finding",
        evidence: [{ checker: "slow", threat: "T0", verdict: "finding", rule_id: "never-kept" }],
      };
    };
    const r = runWithBudget(fn, unit(), 0.0001);
    expect(ranToCompletion).toBe(true); // 判定在 checker 返回后（无抢占假设）
    expect(r).toEqual({ verdict: "error", evidence: [], reason: "checker_timeout" });
    expect(r).toEqual(CHECKER_TIMEOUT_RESULT);
    expect(r.evidence).toHaveLength(0); // 超时结果不具取证资格
  });

  it("未超预算 → 原样透传（恒等：evidence 全保留，默认 G1 门内不误改写）", () => {
    const result: CheckerResult = {
      verdict: "finding",
      evidence: [{ checker: "fast", threat: "T1b", verdict: "finding", rule_id: "kept" }],
    };
    const fn: NonStreamChecker = () => result;
    expect(runWithBudget(fn, unit(), G1_PER_CHUNK)).toBe(result);
  });
});

describe("SL-04 流式包裹：改写只替换 result，不吞 checker 回传窗口（AC-V2a-27④）", () => {
  const inWindow: ScanWindow = { pendingBytes: new Uint8Array(0), cursor: 7, extra: { k: "in" } };

  it("超预算 → result 改写为 checker_timeout，回传窗口恒等透传（extra 存活）", () => {
    const returned: ScanWindow = { pendingBytes: new Uint8Array(0), cursor: 999, extra: { accumulated: 5 } };
    const fn: StreamChecker = () => {
      busy(2);
      return [
        { verdict: "finding", evidence: [{ checker: "s", threat: "T2c", verdict: "finding" }] },
        returned,
      ] as const;
    };
    const [result, ret] = runStreamWithBudget(fn, inWindow, unit("abc"), 0.0001);
    expect(result).toEqual({ verdict: "error", evidence: [], reason: "checker_timeout" });
    expect(ret).toBe(returned); // 回传窗口未被吞（cursor 值由网关重组点忽略，此处只证透传）
    expect(ret.extra).toEqual({ accumulated: 5 });
  });

  it("未超预算 → result 与回传窗口恒等透传", () => {
    const result: CheckerResult = { verdict: "clean", evidence: [] };
    const returned: ScanWindow = { pendingBytes: new Uint8Array(0), cursor: 8, extra: { accumulated: 3 } };
    const fn: StreamChecker = () => [result, returned] as const;
    const [r, ret] = runStreamWithBudget(fn, inWindow, unit("abc"), G1_PER_CHUNK);
    expect(r).toBe(result);
    expect(ret).toBe(returned);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ④ 注入 map 只影响被点名 checker（真 registry checker，零 checker mock）
// ─────────────────────────────────────────────────────────────────────────────
describe("SL-04 GatewayConfig.checkerBudgetMs：注入只影响被点名 checker（AC-V2a-27③）", () => {
  it("点名 egress-secret-scan：请求路径唯一 checker 被改写为 checker_timeout", () => {
    const core = coreWith(new Map([["egress-secret-scan", 0.0001]]));
    const { inputs } = core.scanRequest(benignReqBody, {}, "non-stream");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.checkerId).toBe("egress-secret-scan");
    expect(inputs[0]!.result).toEqual({ verdict: "error", evidence: [], reason: "checker_timeout" });
  });

  it("点名未注册 id：egress 不受任何影响（clean 照常）→ 覆盖按 checkerId 键生效", () => {
    const core = coreWith(new Map([["no-such-checker", 0.0001]]));
    const { inputs } = core.scanRequest(benignReqBody, {}, "non-stream");
    expect(inputs[0]!.result.verdict).toBe("clean");
    expect(inputs[0]!.result.reason).toBeUndefined();
  });

  it("响应路径点名 invisible-unicode-scan：被点名者超时，同趟未点名的 model-label-consistency 照常 clean", () => {
    const core = coreWith(new Map([["invisible-unicode-scan", 0.0001]]));
    const inputs = core.scanResponseNonStream(benignRespBody, "m");
    const inv = inputs.find((i) => i.checkerId === "invisible-unicode-scan")!;
    const ml = inputs.find((i) => i.checkerId === "model-label-consistency")!;
    expect(inv.result).toEqual({ verdict: "error", evidence: [], reason: "checker_timeout" });
    expect(ml.result.verdict).toBe("clean");
  });

  it("默认预算不误伤：无注入配置下真 checker 全 clean（checker_timeout 词汇不出现）", () => {
    const core = coreWith();
    const reqInputs = core.scanRequest(benignReqBody, {}, "non-stream").inputs;
    const respInputs = core.scanResponseNonStream(benignRespBody, "m");
    for (const i of [...reqInputs, ...respInputs]) {
      expect(i.result.reason).toBeUndefined();
      expect(i.result.verdict).toBe("clean");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ 归并重投影（advance:false）再扫描同受预算裁决
// ─────────────────────────────────────────────────────────────────────────────
describe("SL-04 归并重投影（advance:false）的再扫描同受预算裁决（'每次调用'字面）", () => {
  it("advance:false 下超预算同样改写，且重投影零推进语义不被包裹破坏（SL-02 标记语义不变）", () => {
    const core = coreWith(new Map([["invisible-unicode-scan", 0.0001]]));
    const windows = new Map<string, ScanWindow>();
    const merged: ScanUnit = { direction: "response", transport: "stream", text: '{"cmd":"x"}', meta: {} };
    const { inputs, nextWindows } = core.scanResponseStreamUnit(windows, merged, { advance: false });
    const inv = inputs.find((i) => i.checkerId === "invisible-unicode-scan")!;
    expect(inv.result).toEqual({ verdict: "error", evidence: [], reason: "checker_timeout" });
    expect(nextWindows.get("invisible-unicode-scan")!.cursor).toBe(0); // 零推进保持
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑥ checker_timeout 经 policy 层映射（守护测试：SL-03 既有映射已覆盖，无新代码）
// ─────────────────────────────────────────────────────────────────────────────
describe("SL-04 checker_timeout 经 policy 层映射（守护：复用 SL-03 映射）", () => {
  it("安全类 error（含 checker_timeout）→ block（fail-closed 不降级）", () => {
    const d = decide([{ checkerId: "egress-secret-scan", safetyClass: true, result: CHECKER_TIMEOUT_RESULT }]);
    expect(d.action).toBe("block");
    expect(d.degraded).toBe(false);
  });

  it("观测类 error → 既有降级语义：degraded=true + action=warn → action_taken=degraded_observational", () => {
    const d = decide([{ checkerId: "usage-reconcile", safetyClass: false, result: CHECKER_TIMEOUT_RESULT }]);
    expect(d.degraded).toBe(true);
    expect(d.action).toBe("warn");
    expect(resolveActionTaken(["degraded_observational", "warned"])).toBe("degraded_observational");
  });

  it("checker_timeout 在 SL-03 固定序内：顶层选取压过 scanner_error/input_malformed", () => {
    expect(CHECKER_ERROR_REASON_ORDER).toContain("checker_timeout");
    const w = pickTopReasonWinner({
      checkerErrors: [
        { checker: "a", reason: "scanner_error" },
        { checker: "b", reason: "checker_timeout" },
      ],
      checkerDeclarationOrder: ["a", "b"],
    });
    expect(w?.reason).toBe("checker_timeout");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑦ 生产者端到端（core 级，同 SL-03 reason.test.ts fixture 形态）
// ─────────────────────────────────────────────────────────────────────────────
describe("SL-04 checker_timeout 生产者（AC-V2a-27⑤）：经 handleChatCompletions 双层落链", () => {
  let mock: MockUpstream | null = null;
  const dirs: string[] = [];
  let reqSeq = 0;

  afterAll(async () => {
    if (mock) await mock.close();
    for (const d of dirs) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* noop */ }
    }
  });

  afterEach(async () => {
    if (mock) {
      await mock.close();
      mock = null;
    }
  });

  function mkReq(body: string, transport: "stream" | "non-stream", upstreamUrl: string) {
    reqSeq += 1;
    return {
      body,
      headers: { "content-type": "application/json" } as Record<string, string>,
      upstreamUrl,
      requestId: `r-sl04-${reqSeq}`,
      sessionId: "s-sl04",
      turnId: "t-sl04",
      client: "test",
      providerId: "mock",
      endpointHost: "127.0.0.1",
      transport,
    };
  }

  it("安全类（egress 注入不可满足预算）：502 + blocked_before_forward + 顶层 reason 与 findings 条目同现", async () => {
    mock = await startMockUpstream({ transport: "non-stream", body: '{"ok":true}' });
    const dir = mkdtempSync(join(tmpdir(), "llmveto-sl04-"));
    dirs.push(dir);
    const evidencePath = join(dir, "ev.jsonl");
    const core = new GatewayCore({
      upstreamBaseUrl: mock.url,
      evidenceWriter: new EvidenceWriter(evidencePath),
      checkerBudgetMs: new Map([["egress-secret-scan", 0.0001]]),
    });
    const outcome = await handleChatCompletions(
      core,
      mkReq(
        JSON.stringify({ model: "m", messages: [{ role: "user", content: "x".repeat(512) }] }),
        "non-stream",
        mock.url + "/v1/chat/completions",
      ),
    );
    expect(outcome.status).toBe(502);
    expect(outcome.actionTaken).toBe("blocked_before_forward");
    expect(outcome.reason).toBe("checker_timeout"); // D-10 第一层
    expect(outcome.findings).toContainEqual({
      checker: "egress-secret-scan",
      threat: "T1b",
      verdict: "error",
      rule_id: "checker_timeout",
    }); // D-10 第二层
    expect(mock.requests).toHaveLength(0); // 判定在前，未转发
    expect(existsSync(evidencePath)).toBe(false); // core 级不落盘（evidence 由 server 层统一写）
  });

  it("观测类（model-label 注入不可满足预算）：200 照常交付 + degraded_observational（D-11 不新增格）", async () => {
    mock = await startMockUpstream({
      transport: "non-stream",
      body: JSON.stringify({ model: "m", choices: [{ message: { role: "assistant", content: "hello" } }] }),
    });
    const dir = mkdtempSync(join(tmpdir(), "llmveto-sl04-"));
    dirs.push(dir);
    const core = new GatewayCore({
      upstreamBaseUrl: mock.url,
      evidenceWriter: new EvidenceWriter(join(dir, "ev.jsonl")),
      checkerBudgetMs: new Map([["model-label-consistency", 0.0001]]),
    });
    const outcome = await handleChatCompletions(
      core,
      mkReq(benignReqBody, "non-stream", mock.url + "/v1/chat/completions"),
    );
    expect(outcome.status).toBe(200);
    expect(outcome.actionTaken).toBe("degraded_observational");
    expect(outcome.reason).toBe("checker_timeout");
    expect(outcome.findings).toContainEqual({
      checker: "model-label-consistency",
      threat: "T3a",
      verdict: "error",
      rule_id: "checker_timeout",
    });
    expect(outcome.body).toContain("hello"); // 观测类不阻断：响应照常交付
  });
});
