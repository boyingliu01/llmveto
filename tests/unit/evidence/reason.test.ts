import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  REQUIRED_FIELDS,
  REASON_VOCAB,
  validateEvidence,
  type EvidenceRecord,
} from "../../../src/evidence/schema.ts";
import { verifyRecord, sealRecord, GENESIS_HASH } from "../../../src/evidence/chain.ts";
import { verifyEvidenceFile } from "../../../src/evidence/verify.ts";
import { EvidenceWriter } from "../../../src/evidence/writer.ts";
import {
  CHECKER_ERROR_REASON_ORDER,
  GATEWAY_REASON_PRIORITY,
  pickTopReasonFromErrorFindings,
  pickTopReasonWinner,
} from "../../../src/policy/engine.ts";
import { CHECKER_THREAT_BY_ID } from "../../../src/policy/mapping.ts";
import { REGISTRY, checkersFor } from "../../../src/gateway/registry.ts";
import { GatewayCore, handleChatCompletions, sha256Hex } from "../../../src/gateway/core.ts";
import { startMockUpstream, type MockUpstream } from "../../utils/mock-upstream.ts";
import type {
  CheckerResult,
  NonStreamChecker,
  ScanUnit,
  ScanWindow,
  StreamChecker,
} from "../../../src/shared/types.ts";

// @test REQ-V2a-13（D-10 error 双层落链 + 顶层 reason 单值规则）/ REQ-V2a-14（§4.5 reason 词表）
// @intent ① evidence schema：AppendInput/EvidenceRecord 的 reason 可选位 —— 无异常时键整体缺席
//         （§14.4-4：不落 null），validateEvidence 校验 §4.5 六值词表；v1 无 reason 旧记录 verify 仍过。
//         ② D-10 单值选择：gateway 值（registry_unavailable > inject_skipped）> checker error 固定序
//         （window_overflow > checker_timeout > scanner_error > input_malformed，同级按注册表声明序，
//         全同取先见）；顶层 checker reason 由 findings[] error 条目重放（R3 T-M1）选出。
//         ③ REGISTRY 声明序钉死；④ CHECKER_THREAT_BY_ID 按 §4.5 威胁表钉死且对 REGISTRY 完备。
//         ⑤ v1 可达的 scanner_error / input_malformed 各 ≥1 真路径 fixture：真实 HTTP mock-upstream
//         + 真实扫描管线，顶层 reason 与 findings[] error 条目同时出现（双层），并经 writer 落链 verify。
// @covers AC-V2a-23 AC-V2a-24 AC-V2a-12(机制部分)
//
// 延迟到后续切片的端到端面（本文件只断言机制，不冒充端到端）：
//   - tool-call-shape / canary-return-scan → SL-09 / SL-08；checker_timeout 重写 → SL-04；
//     window_overflow 2049×128B 真实窗口 fixture → SL-02。

// ─────────────────────────────────────────────────────────────────────────────
// A. schema 层：reason 可选位 + §4.5 词表（REQ-V2a-14 / AC-V2a-23①②）
// ─────────────────────────────────────────────────────────────────────────────

/** AC-V2a-23① 类型侧守卫：reason 必须声明为可选位（键缺席合法，v1 记录形状零扰动）。 */
type ReasonIsOptional = undefined extends EvidenceRecord["reason"] ? true : false;
const REASON_OPTIONAL_GUARD: ReasonIsOptional = true;
void REASON_OPTIONAL_GUARD;

describe("SL-03 REASON_VOCAB：§4.5 六值词表（REQ-V2a-14）", () => {
  it("词表逐字钉死且冻结", () => {
    expect(Object.isFrozen(REASON_VOCAB)).toBe(true);
    expect([...REASON_VOCAB]).toEqual([
      "registry_unavailable",
      "inject_skipped",
      "window_overflow",
      "checker_timeout",
      "scanner_error",
      "input_malformed",
    ]);
  });

  it("与 policy 层选择常量同源一致：gateway ∪ checker 恰好等于词表，且两集合不相交（gateway 值无对应 findings 条目）", () => {
    expect([...REASON_VOCAB].sort()).toEqual(
      [...GATEWAY_REASON_PRIORITY, ...CHECKER_ERROR_REASON_ORDER].sort(),
    );
    for (const g of GATEWAY_REASON_PRIORITY) {
      expect(CHECKER_ERROR_REASON_ORDER).not.toContain(g);
    }
  });

  it("validateEvidence：reason 缺席 → ok（§14.4-4：无异常不落键，更不落 null）", () => {
    // 手工构造最小 v1 形记录：缺席 reason 仅为 schema 判定，不涉及链
    const rec = { ...minimalV1Record() };
    expect("reason" in rec).toBe(false);
    expect(validateEvidence(rec).ok).toBe(true);
  });

  it("validateEvidence：六个词表值全部接受", () => {
    for (const rv of REASON_VOCAB) {
      const v = validateEvidence({ ...minimalV1Record(), reason: rv });
      expect(v.ok, `reason=${rv} should be accepted`).toBe(true);
    }
  });

  it("validateEvidence：未知值 / null / 非字符串一律拒绝", () => {
    for (const bad of ["totally_unknown_reason", null, 42, true, {}]) {
      const v = validateEvidence({ ...minimalV1Record(), reason: bad });
      expect(v.ok, `reason=${JSON.stringify(bad)} should be rejected`).toBe(false);
      if (!v.ok) expect(v.errors.join("; ")).toContain("reason");
    }
  });

  it("词表值上链后链校验仍通过（canonical JSON 兼容：reason 参与 record_hash 输入、不改链算法）", () => {
    const { record_hash: _drop, ...minus } = minimalV1Record();
    const sealed = sealRecord({ prev_hash: GENESIS_HASH, record: { ...minus, reason: "scanner_error" } });
    expect(sealed.reason).toBe("scanner_error");
    expect(verifyRecord(sealed, null).ok).toBe(true);
    // 同一记录去掉 reason 键重封 → 哈希不同（键缺席与在场是不同事实，不靠 null 充数）
    const sealedNoReason = sealRecord({ prev_hash: GENESIS_HASH, record: minus });
    expect("reason" in sealedNoReason).toBe(false);
    expect(verifyRecord(sealedNoReason, null).ok).toBe(true);
    expect(sealed.record_hash).not.toBe(sealedNoReason.record_hash);
  });
});

/** 最小合法 v1 记录（无 reason 键），仅用于 schema/verify 断言；不写盘。 */
function minimalV1Record(): EvidenceRecord {
  return {
    evidence_version: 1,
    event_id: "ev-00000000-0000-4000-8000-000000000000",
    seq: 0,
    ts: "2026-09-27T00:00:00.000Z",
    session_id: "s-sl03",
    turn_id: "t-sl03",
    request_id: "r-sl03",
    client: "test",
    provider_id: "mock",
    endpoint_host: "127.0.0.1",
    model_requested: "gpt-4o",
    model_responded: "gpt-4o",
    transport: "non-stream",
    request_bytes: 16,
    response_bytes: 16,
    chunk_count: 1,
    latency: 1,
    findings: [],
    action_taken: "allowed",
    response_delivered: { partial: false, delivered_chunks: 1 },
    request_body_sha256: "a".repeat(64),
    response_body_sha256: "b".repeat(64),
    prev_hash: "0".repeat(64),
    record_hash: "c".repeat(64),
    canary: null,
    body_capture: "metadata_only",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// B. D-10 单值选择（REQ-V2a-13）：gateway 优先 > checker 固定序；同级按声明序；重放适配
// ─────────────────────────────────────────────────────────────────────────────

describe("SL-03 D-10：顶层 reason 单值选择（GATEWAY_REASON_PRIORITY / CHECKER_ERROR_REASON_ORDER）", () => {
  const DECL = REGISTRY.map((c) => c.id);

  it("两个固定序常量冻结且逐位钉死", () => {
    expect(Object.isFrozen(GATEWAY_REASON_PRIORITY)).toBe(true);
    expect([...GATEWAY_REASON_PRIORITY]).toEqual(["registry_unavailable", "inject_skipped"]);
    expect(Object.isFrozen(CHECKER_ERROR_REASON_ORDER)).toBe(true);
    expect([...CHECKER_ERROR_REASON_ORDER]).toEqual([
      "window_overflow",
      "checker_timeout",
      "scanner_error",
      "input_malformed",
    ]);
  });

  it("checker 固定序：序内任意两两组合，前者胜，与候选输入顺序无关（测试由常量自身派生，不誊抄字面序）", () => {
    for (let i = 0; i < CHECKER_ERROR_REASON_ORDER.length; i++) {
      for (let j = i + 1; j < CHECKER_ERROR_REASON_ORDER.length; j++) {
        const a = CHECKER_ERROR_REASON_ORDER[i]!;
        const b = CHECKER_ERROR_REASON_ORDER[j]!;
        const winner = pickTopReasonWinner({
          checkerErrors: [
            { checker: "c-a", reason: a },
            { checker: "c-b", reason: b },
          ],
          checkerDeclarationOrder: DECL,
        });
        expect(winner, `${a} vs ${b}`).toEqual({ source: "checker", reason: a, checker: "c-a" });
        const reversed = pickTopReasonWinner({
          checkerErrors: [
            { checker: "c-b", reason: b },
            { checker: "c-a", reason: a },
          ],
          checkerDeclarationOrder: DECL,
        });
        expect(reversed, `${a} vs ${b} reversed`).toEqual({ source: "checker", reason: a, checker: "c-a" });
      }
    }
  });

  it("gateway 值无条件压过 checker error（R2 修正后的优先级：gateway 描述符 > checker 固定序）", () => {
    const winner = pickTopReasonWinner({
      gatewayReasons: [GATEWAY_REASON_PRIORITY[1]!], // inject_skipped
      checkerErrors: [{ checker: "c-a", reason: CHECKER_ERROR_REASON_ORDER[0]! }], // window_overflow
      checkerDeclarationOrder: DECL,
    });
    expect(winner).toEqual({ source: "gateway", reason: "inject_skipped", checker: undefined });
  });

  it("两个 gateway 值并存 → 取 GATEWAY_REASON_PRIORITY 首位（registry_unavailable > inject_skipped）", () => {
    const winner = pickTopReasonWinner({
      gatewayReasons: [GATEWAY_REASON_PRIORITY[1]!, GATEWAY_REASON_PRIORITY[0]!],
      checkerErrors: [],
      checkerDeclarationOrder: DECL,
    });
    expect(winner).toEqual({ source: "gateway", reason: GATEWAY_REASON_PRIORITY[0], checker: undefined });
  });

  it("同级并列：同一 reason 来自多个 checker → 注册表声明序在前的胜（输入顺序无关，稳定）", () => {
    const later = DECL[2]!; // model-label-consistency
    const earlier = DECL[0]!; // egress-secret-scan
    const one = pickTopReasonWinner({
      checkerErrors: [
        { checker: later, reason: "scanner_error" },
        { checker: earlier, reason: "scanner_error" },
      ],
      checkerDeclarationOrder: DECL,
    });
    const two = pickTopReasonWinner({
      checkerErrors: [
        { checker: earlier, reason: "scanner_error" },
        { checker: later, reason: "scanner_error" },
      ],
      checkerDeclarationOrder: DECL,
    });
    expect(one).toEqual({ source: "checker", reason: "scanner_error", checker: earlier });
    expect(two).toEqual(one);
  });

  it("词表外 reason 仍可被选出（不得静默丢弃），但排位低于一切词表内值", () => {
    const onlyUnknown = pickTopReasonWinner({
      checkerErrors: [{ checker: "c-x", reason: "mystery_reason" }],
      checkerDeclarationOrder: DECL,
    });
    expect(onlyUnknown).toEqual({ source: "checker", reason: "mystery_reason", checker: "c-x" });
    const mixed = pickTopReasonWinner({
      checkerErrors: [
        { checker: "c-x", reason: "mystery_reason" },
        { checker: "c-a", reason: "input_malformed" }, // 固定序末位
      ],
      checkerDeclarationOrder: DECL,
    });
    expect(mixed).toEqual({ source: "checker", reason: "input_malformed", checker: "c-a" });
  });

  it("空候选集（无 gateway 值、无 checker error）→ undefined（顶层 reason 键整体缺席）", () => {
    expect(pickTopReasonWinner({ checkerErrors: [], checkerDeclarationOrder: DECL })).toBeUndefined();
    expect(
      pickTopReasonWinner({ gatewayReasons: [], checkerErrors: [], checkerDeclarationOrder: DECL }),
    ).toBeUndefined();
  });

  it("R3 T-M1 重放适配：findings[] error 条目重放与直接候选集选择完全一致；非 error 条目与缺 rule_id 的 error 条目被过滤", () => {
    const candidates = [
      { checker: "invisible-unicode-scan", reason: "input_malformed" },
      { checker: "egress-secret-scan", reason: "scanner_error" },
    ] as const;
    const direct = pickTopReasonWinner({ checkerErrors: candidates, checkerDeclarationOrder: DECL });
    const findings = candidates.map((c) => ({
      checker: c.checker,
      threat: "T0",
      verdict: "error" as const,
      rule_id: c.reason,
    }));
    const replayed = pickTopReasonFromErrorFindings({ findings, checkerDeclarationOrder: DECL });
    expect(replayed).toEqual(direct);
    // scanner_error（固定序第 3 位）压过 input_malformed（第 4 位），归属 = egress-secret-scan
    expect(replayed).toEqual({ source: "checker", reason: "scanner_error", checker: "egress-secret-scan" });

    // 过滤面：finding/clean 条目、无 rule_id 的 error 条目都不参与选择
    const filtered = pickTopReasonFromErrorFindings({
      findings: [
        { checker: "egress-secret-scan", threat: "T1b", verdict: "finding", rule_id: "openai-sk" },
        { checker: "model-label-consistency", threat: "T3a", verdict: "error" }, // 无 reason → 无 rule_id
        { checker: "invisible-unicode-scan", threat: "T2c", verdict: "clean" },
      ],
      checkerDeclarationOrder: DECL,
    });
    expect(filtered).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. REGISTRY 声明序 + D. CHECKER_THREAT_BY_ID（§4.5 威胁表）
// ─────────────────────────────────────────────────────────────────────────────

describe("SL-03 REGISTRY 声明序（tie-break 单一真相源）", () => {
  it("v2a 注册表声明序逐位钉死", () => {
    expect(REGISTRY.map((c) => c.id)).toEqual([
      "canary-return-scan",
      "egress-secret-scan",
      "invisible-unicode-scan",
      "model-label-consistency",
      "thinking-signature-presence",
      "tool-call-shape",
      "usage-reconcile",
    ]);
  });

  it("checkersFor 分派序与注册表声明序一致（请求侧 / 响应侧）", () => {
    expect(checkersFor("request").map((c) => c.id)).toEqual(["egress-secret-scan"]);
    expect(checkersFor("response").map((c) => c.id)).toEqual([
      "canary-return-scan",
      "invisible-unicode-scan",
      "model-label-consistency",
      "thinking-signature-presence",
      "tool-call-shape",
      "usage-reconcile",
    ]);
  });
});

describe("SL-03 CHECKER_THREAT_BY_ID：error 条目 threat 取值表（§4.5）", () => {
  it("冻结且按 §4.5 威胁表逐项钉死", () => {
    expect(Object.isFrozen(CHECKER_THREAT_BY_ID)).toBe(true);
    expect(CHECKER_THREAT_BY_ID["egress-secret-scan"]).toBe("T1b");
    expect(CHECKER_THREAT_BY_ID["invisible-unicode-scan"]).toBe("T2c");
    expect(CHECKER_THREAT_BY_ID["model-label-consistency"]).toBe("T3a");
    expect(CHECKER_THREAT_BY_ID["tool-call-shape"]).toBe("T2a");
    expect(CHECKER_THREAT_BY_ID["canary-return-scan"]).toBe("T1a");
    expect(CHECKER_THREAT_BY_ID["thinking-signature-presence"]).toBe("T3a");
    expect(CHECKER_THREAT_BY_ID["usage-reconcile"]).toBe("T4a");
  });

  it("对 REGISTRY 完备（fail-closed：flatten error 条目时 threat 查不到必须显式失败，而非自造）", () => {
    for (const c of REGISTRY) {
      expect(typeof CHECKER_THREAT_BY_ID[c.id], `threat for ${c.id}`).toBe("string");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E. 真路径双层 fixture（AC-V2a-24①）：真实 HTTP mock-upstream + 真实扫描管线，
//    故障注入只在 checker spec 边界（swap + try/finally 还原）。
// ─────────────────────────────────────────────────────────────────────────────

/** 把 spec 的 runNonStream 换成 impl，返回旧实现（供 finally 还原）。spec 对象是 as const 但并未运行期冻结。 */
function swapRunNonStream(
  spec: object,
  impl: NonStreamChecker | undefined,
): NonStreamChecker | undefined {
  const s = spec as { runNonStream?: NonStreamChecker | undefined };
  const prev = s.runNonStream;
  s.runNonStream = impl;
  return prev;
}

/** 同上，针对 runStream。 */
function swapRunStream(spec: object, impl: StreamChecker | undefined): StreamChecker | undefined {
  const s = spec as { runStream?: StreamChecker | undefined };
  const prev = s.runStream;
  s.runStream = impl;
  return prev;
}

const throwingNonStream: NonStreamChecker = () => {
  throw new Error("injected fault: scanner internals blew up");
};

describe("SL-03 真路径双层 fixture：顶层 reason + findings[] error 条目同时出现（AC-V2a-24①）", () => {
  const dirs: string[] = [];
  let mock: MockUpstream | null = null;
  let reqSeq = 0;

  afterAll(async () => {
    if (mock) await mock.close();
    for (const d of dirs) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* noop */ }
    }
  });

  function mkReq(body: string, transport: "stream" | "non-stream", upstreamUrl: string) {
    reqSeq += 1;
    return {
      body,
      headers: { "content-type": "application/json" } as Record<string, string>,
      upstreamUrl,
      requestId: `r-sl03-${reqSeq}`,
      sessionId: "s-sl03",
      turnId: "t-sl03",
      client: "test",
      providerId: "mock",
      endpointHost: "127.0.0.1",
      transport,
    };
  }

  function baseAppend(overrides: Partial<Parameters<EvidenceWriter["append"]>[0]> = {}) {
    return {
      session_id: "s-sl03", turn_id: "t-sl03", request_id: "r-sl03",
      client: "test", provider_id: "mock", endpoint_host: "127.0.0.1",
      model_requested: "gpt-4o", model_responded: "gpt-4o",
      transport: "non-stream" as const,
      request_bytes: 16, response_bytes: 16, chunk_count: 1, latency: 1,
      findings: [],
      action_taken: "allowed" as const,
      response_delivered: { partial: false, delivered_chunks: 1 },
      request_body_sha256: "a".repeat(64),
      response_body_sha256: "b".repeat(64),
      body_capture: "metadata_only" as const,
      ...overrides,
    };
  }

  function bootCore(mockUrl: string, evidencePath: string): GatewayCore {
    return new GatewayCore({ upstreamBaseUrl: mockUrl, evidenceWriter: new EvidenceWriter(evidencePath) });
  }

  /** 双层痕迹断言：顶层 reason 与 findings[] error 条目同时出现在同一条 JSONL 记录里。 */
  function assertDoubleLayerInJsonl(path: string, expectedReason: string, expectedChecker: string, expectedThreat: string): void {
    const line = JSON.parse(readFileSync(path, "utf8").split("\n")[0]!) as Record<string, unknown>;
    expect(line["reason"], "顶层 reason（D-10 第一层）").toBe(expectedReason);
    const findings = line["findings"] as readonly { checker: string; verdict: string; threat: string; rule_id?: string }[];
    const errEntry = findings.find((f) => f.verdict === "error");
    expect(errEntry, "findings[] error 条目（D-10 第二层）").toBeDefined();
    expect(errEntry?.checker).toBe(expectedChecker);
    expect(errEntry?.threat).toBe(expectedThreat);
    expect(errEntry?.rule_id).toBe(expectedReason);
    // reason 词表运行时半断言（AC-V2a-24①）：真路径产出的 reason 必在 checker 固定序内
    expect(CHECKER_ERROR_REASON_ORDER).toContain(line["reason"]);
    expect(verifyEvidenceFile(path).ok).toBe(true);
  }

  afterEach(async () => {
    if (mock) { await mock.close(); mock = null; }
  });

  it("fixture-1 观测类 scanner_error（非流式，model-label 抛错）：200 + degraded_observational + 双层痕迹落链", async () => {
    mock = await startMockUpstream({
      transport: "non-stream",
      body: JSON.stringify({ model: "gpt-4o", choices: [{ message: { role: "assistant", content: "hi" } }] }),
    });
    dirs.push(mkdtempSync(join(tmpdir(), "llmveto-sl03-")));
    mkdirSync(dirs[dirs.length - 1]!, { recursive: true });
    const evidencePath = join(dirs[dirs.length - 1]!, "ev-obs.jsonl");
    const core = bootCore(mock.url, evidencePath);

    // @mock-justified: v1 无观测类 checker 会自然抛错（checker_timeout 重写在 SL-04）。
    // 注入点选 checker spec 边界 —— safeRun 的真实异常→error 翻译路径、真实扫描管线与
    // 真实 HTTP mock-upstream 全部保留，仅"checker 内部实现"被故障注入替换。
    const prev = swapRunNonStream(
      REGISTRY.find((c) => c.id === "model-label-consistency")!,
      throwingNonStream,
    );
    let outcome: Awaited<ReturnType<typeof handleChatCompletions>>;
    try {
      outcome = await handleChatCompletions(core, mkReq(
        JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
        "non-stream",
        mock.url + "/v1/chat/completions",
      ));
    } finally {
      swapRunNonStream(REGISTRY.find((c) => c.id === "model-label-consistency")!, prev);
    }

    expect(outcome.status).toBe(200);
    expect(outcome.actionTaken).toBe("degraded_observational"); // D-11：观测类 error 降级不阻断
    expect(outcome.reason).toBe("scanner_error"); // D-10 第一层：顶层 reason
    const errEntry = outcome.findings.find((f) => f.verdict === "error");
    expect(errEntry).toEqual({
      checker: "model-label-consistency",
      threat: "T3a",
      verdict: "error",
      rule_id: "scanner_error",
    }); // D-10 第二层

    const writer = new EvidenceWriter(evidencePath);
    writer.append(baseAppend({
      request_id: "r-sl03-obs",
      findings: outcome.findings,
      action_taken: outcome.actionTaken,
      response_delivered: { partial: false, delivered_chunks: outcome.deliveredChunks },
      reason: outcome.reason,
    }));
    assertDoubleLayerInJsonl(evidencePath, "scanner_error", "model-label-consistency", "T3a");
  });

  it("fixture-2 安全类 scanner_error（请求侧 egress 抛错）：502 fail-closed + blocked_before_forward + 双层痕迹落链", async () => {
    mock = await startMockUpstream({ transport: "non-stream", body: '{"ok":true}' });
    dirs.push(mkdtempSync(join(tmpdir(), "llmveto-sl03-")));
    mkdirSync(dirs[dirs.length - 1]!, { recursive: true });
    const evidencePath = join(dirs[dirs.length - 1]!, "ev-safe.jsonl");
    const core = bootCore(mock.url, evidencePath);

    // @mock-justified: 同 fixture-1 —— 注入点在 checker spec 边界，safeRun/扫描管线/HTTP 全真。
    const prev = swapRunNonStream(
      REGISTRY.find((c) => c.id === "egress-secret-scan")!,
      throwingNonStream,
    );
    let outcome: Awaited<ReturnType<typeof handleChatCompletions>>;
    try {
      outcome = await handleChatCompletions(core, mkReq(
        JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hello" }] }),
        "non-stream",
        mock.url + "/v1/chat/completions",
      ));
    } finally {
      swapRunNonStream(REGISTRY.find((c) => c.id === "egress-secret-scan")!, prev);
    }

    expect(outcome.status).toBe(502);
    expect(JSON.parse(outcome.body)).toEqual({ error: { code: "llmveto:rejected" } });
    expect(outcome.actionTaken).toBe("blocked_before_forward"); // 安全类 error：fail-closed 不降级
    expect(outcome.reason).toBe("scanner_error");
    expect(outcome.findings).toContainEqual({
      checker: "egress-secret-scan",
      threat: "T1b",
      verdict: "error",
      rule_id: "scanner_error",
    });
    expect(mock.requests).toHaveLength(0); // 未转发

    const writer = new EvidenceWriter(evidencePath);
    writer.append(baseAppend({
      request_id: "r-sl03-safe",
      findings: outcome.findings,
      action_taken: outcome.actionTaken,
      response_delivered: { partial: false, delivered_chunks: 0 },
      reason: outcome.reason,
    }));
    assertDoubleLayerInJsonl(evidencePath, "scanner_error", "egress-secret-scan", "T1b");
  });

  it("fixture-3 input_malformed（流式，真实 malformed SSE data 帧）：veto 终止 + terminated_after_delivery + 双层痕迹落链", async () => {
    mock = await startMockUpstream({
      transport: "stream",
      chunks: [
        "not-json{{{", // 真实 HTTP 载荷：JSON 解析失败 → buildResponseScanUnit malformed:true
        JSON.stringify({ choices: [{ delta: { content: "after-marker" } }] }),
      ],
    });
    dirs.push(mkdtempSync(join(tmpdir(), "llmveto-sl03-")));
    mkdirSync(dirs[dirs.length - 1]!, { recursive: true });
    const evidencePath = join(dirs[dirs.length - 1]!, "ev-malformed.jsonl");
    const core = bootCore(mock.url, evidencePath);

    // @mock-justified: malformed 标志由真实 scan-unit 代码从真实 HTTP 字节产出（下方
    // sawMalformed 断言为证）；此 stand-in 只在 spec 边界替换 checker 的"判定逻辑"——
    // v1 尚无以 malformed 为输入的已注册 checker（其随 SL-09 结构类 checker 落地），
    // input_malformed 的真实注册生产者到 SL-09 才存在。
    let sawMalformed = false;
    const malformedReactive: StreamChecker = (window: ScanWindow, chunk: ScanUnit) => {
      if (chunk.malformed === true) sawMalformed = true;
      const next: ScanWindow = { pendingBytes: window.pendingBytes, cursor: window.cursor + chunk.text.length };
      const result: CheckerResult = chunk.malformed
        ? { verdict: "error", evidence: [], reason: "input_malformed" }
        : { verdict: "clean", evidence: [] };
      return [result, next] as const;
    };
    const prev = swapRunStream(
      REGISTRY.find((c) => c.id === "invisible-unicode-scan")!,
      malformedReactive,
    );
    let outcome: Awaited<ReturnType<typeof handleChatCompletions>>;
    const parts: string[] = [];
    try {
      outcome = await handleChatCompletions(core, mkReq(
        JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
        "stream",
        mock.url + "/v1/chat/completions",
      ));
      // 注意：sse 是惰性 generator，必须在还原 spec **之前**消费完，否则流式扫描
      // 跑在原始 checker 上（swap 窗口失效）。
      for await (const f of outcome.sse!) parts.push(f);
    } finally {
      swapRunStream(REGISTRY.find((c) => c.id === "invisible-unicode-scan")!, prev);
    }

    const text = parts.join("");
    expect(sawMalformed).toBe(true); // malformed 标志确由真实扫描单元管线产出
    expect(text).toContain("llmveto:veto-mid-stream"); // 安全类 error → 流内终止
    expect(text).toContain('"delivered_chunks":0'); // 命中帧即 malformed 帧：零交付
    expect(text).not.toContain("after-marker");
    expect(outcome.deliveredChunks).toBe(0);
    expect(outcome.actionTaken).toBe("terminated_after_delivery");
    expect(outcome.reason).toBe("input_malformed");
    expect(outcome.findings).toContainEqual({
      checker: "invisible-unicode-scan",
      threat: "T2c",
      verdict: "error",
      rule_id: "input_malformed",
    });

    const writer = new EvidenceWriter(evidencePath);
    writer.append(baseAppend({
      request_id: "r-sl03-malformed",
      transport: "stream",
      model_responded: null,
      findings: outcome.findings,
      action_taken: outcome.actionTaken,
      response_delivered: { partial: true, delivered_chunks: 0 },
      reason: outcome.reason,
    }));
    assertDoubleLayerInJsonl(evidencePath, "input_malformed", "invisible-unicode-scan", "T2c");
  });

  it("fixture-4 观测类 scanner_error（流式但流正常收束）：全帧透传 + [DONE] + action_taken=degraded_observational", async () => {
    mock = await startMockUpstream({
      transport: "stream",
      chunks: [
        JSON.stringify({ model: "gpt-4o", choices: [{ delta: { content: "a" } }] }),
        JSON.stringify({ model: "gpt-4o", choices: [{ delta: { content: "b" } }] }),
      ],
    });
    dirs.push(mkdtempSync(join(tmpdir(), "llmveto-sl03-")));
    mkdirSync(dirs[dirs.length - 1]!, { recursive: true });
    const evidencePath = join(dirs[dirs.length - 1]!, "ev-stream-degraded.jsonl");
    const core = bootCore(mock.url, evidencePath);

    // @mock-justified: 同 fixture-1（checker spec 边界故障注入，其余全真）。
    const prev = swapRunNonStream(
      REGISTRY.find((c) => c.id === "model-label-consistency")!,
      throwingNonStream,
    );
    let outcome: Awaited<ReturnType<typeof handleChatCompletions>>;
    const parts: string[] = [];
    try {
      outcome = await handleChatCompletions(core, mkReq(
        JSON.stringify({ model: "gpt-4o", stream: true, messages: [{ role: "user", content: "hi" }] }),
        "stream",
        mock.url + "/v1/chat/completions",
      ));
      // 惰性 generator：必须在还原 spec 之前消费完（同 fixture-3 注意事项）。
      for await (const f of outcome.sse!) parts.push(f);
    } finally {
      swapRunNonStream(REGISTRY.find((c) => c.id === "model-label-consistency")!, prev);
    }

    const text = parts.join("");
    expect(text).toContain('"content":"a"');
    expect(text).toContain('"content":"b"');
    expect(text).toContain("[DONE]");
    expect(text).not.toContain("veto-mid-stream"); // 观测类：不终止流
    expect(outcome.deliveredChunks).toBe(2);
    expect(outcome.actionTaken).toBe("degraded_observational"); // D-11：流式正常收束也如实降级
    expect(outcome.reason).toBe("scanner_error");
    expect(outcome.findings.filter((f) => f.verdict === "error").length).toBeGreaterThanOrEqual(1);
    expect(outcome.findings.find((f) => f.verdict === "error")).toMatchObject({
      checker: "model-label-consistency",
      threat: "T3a",
      rule_id: "scanner_error",
    });
  });

  it("fixture-5 全 benign（无任何异常）：outcome.reason 缺席（undefined）+ writer 不落 reason 键 + v1 记录 verify 通过（AC-V2a-23②）", async () => {
    mock = await startMockUpstream({
      transport: "non-stream",
      body: JSON.stringify({ model: "gpt-4o", choices: [{ message: { role: "assistant", content: "hi" } }] }),
    });
    dirs.push(mkdtempSync(join(tmpdir(), "llmveto-sl03-")));
    mkdirSync(dirs[dirs.length - 1]!, { recursive: true });
    const evidencePath = join(dirs[dirs.length - 1]!, "ev-benign.jsonl");
    const core = bootCore(mock.url, evidencePath);

    const outcome = await handleChatCompletions(core, mkReq(
      JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hello" }] }),
      "non-stream",
      mock.url + "/v1/chat/completions",
    ));

    expect(outcome.status).toBe(200);
    expect(outcome.actionTaken).toBe("allowed");
    expect(outcome.reason).toBeUndefined(); // 无异常 → 顶层 reason 键整体缺席（§14.4-4）
    expect(outcome.findings.some((f) => f.verdict === "error")).toBe(false);

    const writer = new EvidenceWriter(evidencePath);
    writer.append(baseAppend({ request_id: "r-sl03-benign", findings: outcome.findings })); // 不传 reason
    const line = JSON.parse(readFileSync(evidencePath, "utf8").split("\n")[0]!) as Record<string, unknown>;
    expect("reason" in line).toBe(false); // v1 兼容：键缺席而非 null
    expect(verifyEvidenceFile(evidencePath)).toEqual({ ok: true, records: 1 });
    // AC-V2a-23①：无 reason 记录的键集与 REQUIRED_FIELDS 完全一致（26 项，不加不减）
    expect(Object.keys(line).sort()).toEqual(REQUIRED_FIELDS.map((f) => String(f)).sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F. AC-V2a-23③：gateway 值机制断言 —— 顶层 reason 在场，findings[] 两集合不含它
// ─────────────────────────────────────────────────────────────────────────────

describe("SL-03 AC-V2a-23③：gateway 值（registry_unavailable / inject_skipped）双层落链机制", () => {
  it("reason=registry_unavailable 上链：顶层在场；findings[].rule_id 与 findings[].checker 值集都不含任何 gateway 值", () => {
    const dir = mkdtempSync(join(tmpdir(), "llmveto-sl03-"));
    try {
      const path = join(dir, "ev-gw.jsonl");
      const writer = new EvidenceWriter(path);
      // gateway 值没有对应的 checker error 条目（gateway 描述符不是 checker）——
      // findings 只带一条良性 finding 以证明"值集排除"不是空集平凡真。
      writer.append({
        session_id: "s-gw", turn_id: "t-gw", request_id: "r-gw",
        client: "test", provider_id: "mock", endpoint_host: "127.0.0.1",
        model_requested: "gpt-4o", model_responded: "gpt-4o",
        transport: "non-stream",
        request_bytes: 16, response_bytes: 16, chunk_count: 1, latency: 1,
        findings: [{
          checker: "model-label-consistency", threat: "T3a", verdict: "finding",
          severity: "low", rule_id: "model-label-mismatch",
        }],
        action_taken: "degraded_observational",
        response_delivered: { partial: false, delivered_chunks: 1 },
        request_body_sha256: sha256Hex("gw"),
        response_body_sha256: sha256Hex("gw"),
        body_capture: "metadata_only",
        reason: "registry_unavailable",
      });
      const line = JSON.parse(readFileSync(path, "utf8").split("\n")[0]!) as {
        reason?: unknown;
        findings: readonly { checker: string; verdict: string; rule_id?: string }[];
      };
      expect(line.reason).toBe("registry_unavailable");
      const ruleIds = line.findings.map((f) => f.rule_id ?? "");
      const checkers = line.findings.map((f) => f.checker);
      for (const g of GATEWAY_REASON_PRIORITY) {
        expect(ruleIds).not.toContain(g);
        expect(checkers).not.toContain(g);
      }
      expect(ruleIds).toContain("model-label-mismatch"); // 非平凡：值集本身非空
      expect(verifyEvidenceFile(path)).toEqual({ ok: true, records: 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("机制侧：gateway 值经 pickTopReasonWinner 选中时 source= 且无 checker 归属；findings 重放在无 error 条目时仍能选出 gateway 值", () => {
    const winner = pickTopReasonFromErrorFindings({
      gatewayReasons: ["inject_skipped"],
      findings: [
        { checker: "model-label-consistency", threat: "T3a", verdict: "finding", rule_id: "model-label-mismatch" },
      ],
      checkerDeclarationOrder: REGISTRY.map((c) => c.id),
    });
    expect(winner).toEqual({ source: "gateway", reason: "inject_skipped", checker: undefined });
  });
});
