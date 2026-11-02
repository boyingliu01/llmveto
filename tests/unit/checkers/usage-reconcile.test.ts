import { describe, expect, it } from "vitest";
import {
  checkUsageReconcile,
  USAGE_RECONCILE_SPEC,
} from "../../../src/checkers/usage-reconcile.ts";
import type { ScanUnit } from "../../../src/shared/types.ts";

// @test REQ-V2a-04 / AC-V2a-05
// @intent T4a usage-reconcile：三段本地估算 vs 上游自报 usage，方向性判定 + 严格不等边界
// @covers AC-V2a-05

const unit = (opts: {
  text?: string;
  meta?: Record<string, unknown>;
}): ScanUnit => ({
  direction: "response",
  transport: "non-stream",
  text: opts.text ?? "",
  meta: opts.meta ?? {},
});

describe("SL-11 usage-reconcile (REQ-V2a-04 / AC-V2a-05)", () => {
  // ── AC-05: over-reporting（估算 < 自报） ────────────────────────

  it("AC-05 过报 → finding（报值 > 估算 × 1.5 且差值 ≥ 64 token）", () => {
    // ASCII: ~4.1 char/token → 410 char ≈ 100 token
    const text = "a".repeat(410);
    const r = checkUsageReconcile(unit({
      text,
      meta: { usage: { total_tokens: 200 } }, // 报 200，估约 100
    }));
    expect(r.verdict).toBe("finding");
    expect(r.evidence[0]?.rule_id).toBe("usage-over-reporting");
    expect(r.evidence[0]?.threat).toBe("T4a");
  });

  it("AC-05 过报但差值不足 64 token → clean", () => {
    const text = "a".repeat(410); // ≈ 100 token
    const r = checkUsageReconcile(unit({
      text,
      meta: { usage: { total_tokens: 150 } }, // 差值 50 < 64
    }));
    expect(r.verdict).toBe("clean");
  });

  // ── AC-05: under-reporting（估算 > 自报） ───────────────────────

  it("AC-05 虚低 → clean（报值 < 估算 × 0.7 不判 finding）", () => {
    const text = "a".repeat(820); // ≈ 200 token
    const r = checkUsageReconcile(unit({
      text,
      meta: { usage: { total_tokens: 100 } }, // 报 100 < 200×0.7=140
    }));
    expect(r.verdict).toBe("clean");
  });

  // ── AC-05: within tolerance → clean ────────────────────────────

  it("AC-05 在容差内 → clean", () => {
    const text = "a".repeat(410); // ≈ 100 token
    const r = checkUsageReconcile(unit({
      text,
      meta: { usage: { total_tokens: 110 } }, // 10% 偏差
    }));
    expect(r.verdict).toBe("clean");
  });

  // ── AC-05: strict inequality boundary ──────────────────────────

  it("AC-05 恰等于 ×1.5 → clean（严格不等）", () => {
    const text = "a".repeat(410); // ≈ 100 token
    const r = checkUsageReconcile(unit({
      text,
      meta: { usage: { total_tokens: 150 } }, // 恰好 1.5×
    }));
    expect(r.verdict).toBe("clean");
  });

  it("AC-05 差值恰为 64 token → clean（严格不等）", () => {
    const text = "a".repeat(410); // ≈ 100 token
    const r = checkUsageReconcile(unit({
      text,
      meta: { usage: { total_tokens: 164 } }, // 差值 64，不满足 >64
    }));
    expect(r.verdict).toBe("clean");
  });

  it("AC-05 恰等于 ×0.7 → clean（严格不等）", () => {
    const text = "a".repeat(700); // ≈ 170.7 token
    const r = checkUsageReconcile(unit({
      text,
      meta: { usage: { total_tokens: 119 } }, // 170.7×0.7 ≈ 119.5，向下取整 119
    }));
    expect(r.verdict).toBe("clean");
  });

  // ── Edge cases ─────────────────────────────────────────────────

  it("缺失 meta.usage → clean（无比较基础）", () => {
    const r = checkUsageReconcile(unit({ text: "hello" }));
    expect(r.verdict).toBe("clean");
  });

  it("空响应 → clean", () => {
    const r = checkUsageReconcile(unit({ text: "", meta: { usage: { total_tokens: 0 } } }));
    expect(r.verdict).toBe("clean");
  });

  it("meta.usage 非数值 → error（双层落链）", () => {
    const r = checkUsageReconcile(unit({
      text: "hello",
      meta: { usage: { total_tokens: "invalid" } },
    }));
    expect(r.verdict).toBe("error");
    expect(r.reason).toBe("scanner_error");
  });

  it("纯 CJK 文本估算正确", () => {
    const text = "你好世界".repeat(25); // 100 char ≈ 100 token
    const r = checkUsageReconcile(unit({
      text,
      meta: { usage: { total_tokens: 200 } }, // 2× 过报
    }));
    expect(r.verdict).toBe("finding");
  });

  it("混合文本（ASCII + CJK）估算正确", () => {
    const text = "hello你好".repeat(50); // 450 ASCII + 100 CJK ≈ 110 + 100 = 210 token
    const r = checkUsageReconcile(unit({
      text,
      meta: { usage: { total_tokens: 400 } }, // 近 2× 过报
    }));
    expect(r.verdict).toBe("finding");
  });

  // ── Spec declarations ──────────────────────────────────────────

  it("spec 声明：观测类、响应侧、同步", () => {
    expect(USAGE_RECONCILE_SPEC.safetyClass).toBe(false);
    expect(USAGE_RECONCILE_SPEC.side).toBe("response");
    expect(USAGE_RECONCILE_SPEC.synchronous).toBe(true);
  });

  it("纯函数性：相同输入产出相同结果", () => {
    const u = unit({ text: "test", meta: { usage: { total_tokens: 10 } } });
    expect(checkUsageReconcile(u)).toEqual(checkUsageReconcile(u));
  });
});
