import { describe, expect, it } from "vitest";
import {
  checkThinkingSignaturePresence,
  THINKING_SIGNATURE_PRESENCE_SPEC,
} from "../../../src/checkers/thinking-signature-presence.ts";
import type { ScanUnit } from "../../../src/shared/types.ts";

// @test REQ-V2a-03
// @intent T3a thinking-signature-presence: request thinking flag vs response thinking block consistency.
// @covers AC-V2a-04

const unit = (text: string, meta: Record<string, unknown>): ScanUnit => ({
  direction: "response",
  transport: "non-stream",
  text,
  meta,
});

describe("SL-10 thinking-signature-presence (REQ-V2a-03)", () => {
  // ── Four quadrants (AC-V2a-04) ──────────────────────────────

  it("Q1: thinking ON + has thinking block → clean", () => {
    const r = checkThinkingSignaturePresence(
      unit("<think>some reasoning</think>The answer is 42", { thinking_enabled: true }),
    );
    expect(r.verdict).toBe("clean");
    expect(r.evidence).toEqual([]);
  });

  it("Q2: thinking ON + no thinking block → finding", () => {
    const r = checkThinkingSignaturePresence(
      unit("The answer is 42", { thinking_enabled: true }),
    );
    expect(r.verdict).toBe("finding");
    expect(r.evidence[0]?.rule_id).toBe("thinking-missing-in-response");
    expect(r.evidence[0]?.threat).toBe("T3a");
  });

  it("Q3: thinking OFF + has thinking block → finding", () => {
    const r = checkThinkingSignaturePresence(
      unit("<think>leaked reasoning</think>The answer is 42", { thinking_enabled: false }),
    );
    expect(r.verdict).toBe("finding");
    expect(r.evidence[0]?.rule_id).toBe("thinking-unexpected-in-response");
    expect(r.evidence[0]?.threat).toBe("T3a");
  });

  it("Q4: thinking OFF + no thinking block → clean", () => {
    const r = checkThinkingSignaturePresence(
      unit("The answer is 42", { thinking_enabled: false }),
    );
    expect(r.verdict).toBe("clean");
    expect(r.evidence).toEqual([]);
  });

  // ── Thinking signature detection patterns ────────────────────

  it("detects <think>...</think> tags", () => {
    const r = checkThinkingSignaturePresence(
      unit("<think>reasoning</think>answer", { thinking_enabled: true }),
    );
    expect(r.verdict).toBe("clean");
  });

  it("detects multiple thinking blocks", () => {
    const r = checkThinkingSignaturePresence(
      unit("<think>a</think>mid<think>b</think>end", { thinking_enabled: true }),
    );
    expect(r.verdict).toBe("clean");
  });

  it("detects thinking block with newlines inside", () => {
    const r = checkThinkingSignaturePresence(
      unit("<think>line1\nline2\nline3</think>answer", { thinking_enabled: true }),
    );
    expect(r.verdict).toBe("clean");
  });

  // ── Edge cases ───────────────────────────────────────────────

  it("no thinking flag in meta → clean (no basis for judgment)", () => {
    const r = checkThinkingSignaturePresence(unit("anything", {}));
    expect(r.verdict).toBe("clean");
  });

  it("empty response + thinking ON → finding", () => {
    const r = checkThinkingSignaturePresence(unit("", { thinking_enabled: true }));
    expect(r.verdict).toBe("finding");
  });

  it("empty response + thinking OFF → clean", () => {
    const r = checkThinkingSignaturePresence(unit("", { thinking_enabled: false }));
    expect(r.verdict).toBe("clean");
  });

  it("partial/malformed thinking tag → no detection (no false positive)", () => {
    const r = checkThinkingSignaturePresence(
      unit("<think> incomplete tag answer", { thinking_enabled: false }),
    );
    expect(r.verdict).toBe("clean");
  });

  // ── Error degradation ────────────────────────────────────────

  it("non-boolean thinking_enabled (string 'true') → treated as truthy", () => {
    const r = checkThinkingSignaturePresence(
      unit("answer", { thinking_enabled: "true" }),
    );
    // "true" is truthy but not boolean true → still treated as enabled
    expect(r.verdict).toBe("finding"); // no thinking block found
  });

  // ── Spec metadata ────────────────────────────────────────────

  it("SPEC: response-side / synchronous / safetyClass=false (observational)", () => {
    expect(THINKING_SIGNATURE_PRESENCE_SPEC.id).toBe("thinking-signature-presence");
    expect(THINKING_SIGNATURE_PRESENCE_SPEC.side).toBe("response");
    expect(THINKING_SIGNATURE_PRESENCE_SPEC.synchronous).toBe(true);
    expect(THINKING_SIGNATURE_PRESENCE_SPEC.safetyClass).toBe(false);
  });

  it("pure function: same input → same output", () => {
    const u = unit("<think>r</think>a", { thinking_enabled: true });
    expect(checkThinkingSignaturePresence(u)).toEqual(checkThinkingSignaturePresence(u));
  });
});
