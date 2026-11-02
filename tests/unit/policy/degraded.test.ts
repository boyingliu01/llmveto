import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { decide, type PolicyInput } from "../../../src/policy/engine.ts";
import { ACTION_TAKEN_PRIORITY, resolveActionTaken } from "../../../src/policy/mapping.ts";
import { verifyRecord } from "../../../src/evidence/chain.ts";
import { validateEvidence } from "../../../src/evidence/schema.ts";
import { verifyEvidenceFile } from "../../../src/evidence/verify.ts";
import { EvidenceWriter } from "../../../src/evidence/writer.ts";
import type { CheckerResult } from "../../../src/shared/types.ts";

// @test REQ-V2a-13 / REQ-V2a-11(§4.1)
// @intent D-11 观测类降级机制：decide() 的 degraded 标志 + action_taken 优先序
//         （blocked_* / terminated_after_delivery > degraded_observational > warned > allowed）
//         + AC-V2a-11：degraded_observational 被真实产出并写入链、verify schema 接受该值。
// @covers AC-V2a-11

/**
 * 机制级合成 CheckerResult。
 * @mock-justified: D-11/D-10 的判定输入域按 SL-03 契约用合成结果覆盖——观测类 checker
 * （thinking-signature-presence / usage-reconcile）尚未存在（SL-10/SL-11），它们的端到端
 * fixture 随那些切片闭合；此处只断言机制（degraded 标志 + 优先序），不冒充端到端。
 */
function errResult(reason?: string): CheckerResult {
  return reason === undefined
    ? { verdict: "error", evidence: [] }
    : ({ verdict: "error", evidence: [], reason } as CheckerResult);
}
const findingResult = (): CheckerResult => ({
  verdict: "finding",
  evidence: [{ checker: "model-label-consistency", threat: "T3a", verdict: "finding", severity: "low", rule_id: "model-label-mismatch" }],
});
const cleanResult = (): CheckerResult => ({ verdict: "clean", evidence: [] });

const input = (checkerId: string, safetyClass: boolean, result: CheckerResult): PolicyInput => ({
  checkerId,
  safetyClass,
  result,
});

describe("SL-03 D-11: decide() degraded 标志（REQ-V2a-13 / AC-V2a-11 机制）", () => {
  it("观测类（safetyClass=false）输入 verdict=error → degraded=true，action 仍 warn（降级不阻断）", () => {
    const d = decide([input("model-label-consistency", false, errResult("scanner_error"))]);
    expect(d.degraded).toBe(true);
    expect(d.action).toBe("warn");
  });

  it("安全类 error → degraded=false，action=block（fail-closed 不变；落链无分类豁免由 findings 位承载）", () => {
    const d = decide([input("egress-secret-scan", true, errResult("scanner_error"))]);
    expect(d.degraded).toBe(false);
    expect(d.action).toBe("block");
  });

  it("观测类 finding（非 error）→ degraded=false（v1 warn 语义零回归）", () => {
    const d = decide([input("model-label-consistency", false, findingResult())]);
    expect(d.degraded).toBe(false);
    expect(d.action).toBe("warn");
  });

  it("观测类 clean → degraded=false", () => {
    const d = decide([input("model-label-consistency", false, cleanResult())]);
    expect(d.degraded).toBe(false);
    expect(d.action).toBe("allow");
  });

  it("混合：观测类 error + 安全类 finding 并发 → degraded=true 且 action=block（严者胜不变）", () => {
    const d = decide([
      input("egress-secret-scan", true, findingResult()),
      input("model-label-consistency", false, errResult("scanner_error")),
    ]);
    expect(d.degraded).toBe(true);
    expect(d.action).toBe("block");
  });

  it("空输入 → degraded=false、action=allow", () => {
    const d = decide([]);
    expect(d.degraded).toBe(false);
    expect(d.action).toBe("allow");
  });

  it("decide() 不读 reason：reason 缺席/在场的同型观测类 error，action 与 degraded 全等（落链位不参与裁决）", () => {
    const withoutReason = decide([input("model-label-consistency", false, errResult())]);
    const withReason = decide([input("model-label-consistency", false, errResult("scanner_error"))]);
    expect(withoutReason.action).toBe(withReason.action);
    expect(withoutReason.degraded).toBe(withReason.degraded);
    expect(withReason.degraded).toBe(true);
  });
});

describe("SL-03 D-11: action_taken 优先序（mapping 层）", () => {
  it("ACTION_TAKEN_PRIORITY 冻结 + 六值封闭 + 顺序逐位钉死（blocked_* / terminated > degraded > warned > allowed）", () => {
    expect(Object.isFrozen(ACTION_TAKEN_PRIORITY)).toBe(true);
    expect([...ACTION_TAKEN_PRIORITY]).toEqual([
      "blocked_before_forward",
      "blocked_before_deliver",
      "terminated_after_delivery",
      "degraded_observational",
      "warned",
      "allowed",
    ]);
  });

  it("顶层档（blocked_* / terminated）压过 degraded_observational / warned / allowed", () => {
    const top = ["blocked_before_forward", "blocked_before_deliver", "terminated_after_delivery"] as const;
    for (const t of top) {
      expect(resolveActionTaken([t, "degraded_observational", "warned", "allowed"])).toBe(t);
      expect(resolveActionTaken(["allowed", "warned", "degraded_observational", t])).toBe(t);
    }
  });

  it("degraded_observational > warned > allowed", () => {
    expect(resolveActionTaken(["degraded_observational", "warned", "allowed"])).toBe("degraded_observational");
    expect(resolveActionTaken(["warned", "degraded_observational"])).toBe("degraded_observational");
    expect(resolveActionTaken(["warned", "allowed"])).toBe("warned");
    expect(resolveActionTaken(["allowed", "warned"])).toBe("warned");
  });

  it("单候选透传；与输入顺序无关", () => {
    expect(resolveActionTaken(["allowed"])).toBe("allowed");
    expect(resolveActionTaken(["warned"])).toBe("warned");
    expect(resolveActionTaken(["degraded_observational"])).toBe("degraded_observational");
    expect(resolveActionTaken(["terminated_after_delivery"])).toBe("terminated_after_delivery");
  });

  it("空候选集 → allowed（基线值）", () => {
    expect(resolveActionTaken([])).toBe("allowed");
  });
});

describe("SL-03 AC-V2a-11: degraded_observational 真实产出并写入链，verify schema 接受", () => {
  let dir: string;
  afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } });

  function baseAppend(overrides: Partial<Parameters<EvidenceWriter["append"]>[0]> = {}) {
    return {
      session_id: "s-d11", turn_id: "t-d11", request_id: "r-d11",
      client: "test", provider_id: "mock", endpoint_host: "127.0.0.1",
      model_requested: "gpt-4o", model_responded: "gpt-4o",
      transport: "non-stream" as const,
      request_bytes: 16, response_bytes: 16, chunk_count: 1, latency: 1,
      findings: [],
      action_taken: "allowed" as const,
      response_delivered: { partial: false, delivered_chunks: 1 },
      request_body_sha256: "c".repeat(64),
      response_body_sha256: "d".repeat(64),
      body_capture: "metadata_only" as const,
      ...overrides,
    };
  }

  it("decide → resolveActionTaken → writer 全链：action_taken=degraded_observational 上链且 verifyEvidenceFile 通过", () => {
    dir = mkdtempSync(join(tmpdir(), "llmveto-d11-"));
    mkdirSync(dir, { recursive: true });
    // 真实生产序：观测类 error → decide().degraded → resolveActionTaken → 落链
    const d = decide([input("model-label-consistency", false, errResult("scanner_error"))]);
    const actionTaken = resolveActionTaken([
      ...(d.degraded ? (["degraded_observational"] as const) : []),
      ...(d.action === "warn" ? (["warned"] as const) : []),
      "allowed",
    ]);
    expect(actionTaken).toBe("degraded_observational");

    const path = join(dir, "ev.jsonl");
    const w = new EvidenceWriter(path);
    const rec = w.append(baseAppend({ action_taken: actionTaken }));
    expect(rec.action_taken).toBe("degraded_observational");

    const line = JSON.parse(readFileSync(path, "utf8").split("\n")[0]!) as Record<string, unknown>;
    expect(line["action_taken"]).toBe("degraded_observational");
    expect(validateEvidence(line).ok).toBe(true);
    expect(verifyRecord(rec, null).ok).toBe(true);
    expect(verifyEvidenceFile(path)).toEqual({ ok: true, records: 1 });
  });
});
