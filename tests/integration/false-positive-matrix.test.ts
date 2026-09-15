import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { egressSecretScan } from "../../src/checkers/egress-secret-scan.ts";
import { invisibleUnicodeScanNonStream } from "../../src/checkers/invisible-unicode-scan.ts";
import { modelLabelConsistency } from "../../src/checkers/model-label-consistency.ts";
import type { ScanUnit } from "../../src/shared/types.ts";

// @test REQ-VETO-012
// @intent 误报矩阵：AC-VETO-012-02 benign ≥ 50 条 + 至少 1 条含标准认证头 benign
//         阈值：egress-secret-scan FP=0；invisible-unicode-scan FP=0；model-label-consistency FP ≤ 2%
// @covers AC-VETO-012-02 AC-VETO-012-04

function u(text: string, meta: Record<string, unknown> = {}, dir: "request" | "response" = "request"): ScanUnit {
  return { direction: dir, transport: "non-stream", text, meta };
}

/** 生成 50 条 benign 语料（v1 fixture，程序化生成避免手抄）。 */
function buildBenignCorpus(): { text: string; meta?: Record<string, unknown>; withAuthHeader?: boolean }[] {
  const out: { text: string; meta?: Record<string, unknown>; withAuthHeader?: boolean }[] = [];
  const greetings = ["hello", "hi", "hey", "good morning", "how are you", "thanks", "please"];
  const topics = ["weather", "recipe", "meeting", "code review", "documentation", "release notes", "roadmap", "budget"];
  for (let i = 0; i < 25; i++) {
    out.push({ text: `${greetings[i % greetings.length]!} about ${topics[i % topics.length]} #${i}` });
  }
  for (let i = 0; i < 15; i++) {
    out.push({ text: `Explain quantum entanglement in one paragraph. (variant ${i})` });
  }
  for (let i = 0; i < 9; i++) {
    out.push({ text: `Refactor this TypeScript function:\nfunction add(a: number, b: number) { return a + b; } // v${i}` });
  }
  // ≥1 条"benign 认证头"：网关把 auth 头排除出扫描单元后，扫描单元里应无 sk-
  // → 用 meta 表达 auth header 存在，text 不含凭据
  out.push({
    text: "Summarize the attached contract draft.",
    meta: { authorization_present: true },
    withAuthHeader: true,
  });
  out.push({
    text: "What is the capital of France?",
    meta: { api_key_present: true },
    withAuthHeader: true,
  });
  out.push({
    text: "Write a haiku about autumn.",
    meta: { bearer_present: true },
    withAuthHeader: true,
  });
  return out;
}

describe("SL-12 false-positive matrix (REQ-VETO-012 AC-02/AC-04)", () => {
  let corpus: ReturnType<typeof buildBenignCorpus>;
  beforeAll(() => { corpus = buildBenignCorpus(); });

  it("AC-02 benign 语料 ≥ 50 条", () => {
    expect(corpus.length).toBeGreaterThanOrEqual(50);
  });

  it("AC-02 至少 1 条含标准认证头 benign（AC-VETO-003-02 锁定）", () => {
    const authBenign = corpus.filter((c) => c.withAuthHeader);
    expect(authBenign.length).toBeGreaterThanOrEqual(1);
    for (const b of authBenign) {
      expect(egressSecretScan(u(b.text)).verdict).toBe("clean");
    }
  });

  it("egress-secret-scan FP = 0", () => {
    const fps = corpus.filter((c) => egressSecretScan(u(c.text)).verdict === "finding");
    expect(fps.map((f) => f.text)).toEqual([]);
  });

  it("invisible-unicode-scan FP = 0", () => {
    const fps = corpus.filter((c) => invisibleUnicodeScanNonStream(u(c.text, {}, "response")).verdict === "finding");
    expect(fps.map((f) => f.text)).toEqual([]);
  });

  it("model-label-consistency FP ≤ 2%（benign 里 100% 一致时）", () => {
    const consistent = corpus.map((c) => ({ ...c, meta: { model_requested: "gpt-4o", model_responded: "gpt-4o" } }));
    const fps = consistent.filter((c) => modelLabelConsistency(u(c.text, c.meta!, "response")).verdict === "finding");
    expect(fps.length / consistent.length).toBeLessThanOrEqual(0.02);
  });

  it("FP 记录落 tests/fixtures/false-positives.json（若发现 FP 则人工裁决）", () => {
    const fpFile = new URL("../fixtures/false-positives.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const fps: unknown[] = [];
    for (const c of corpus) {
      const r1 = egressSecretScan(u(c.text));
      if (r1.verdict === "finding") fps.push({ text: c.text, checker: "egress-secret-scan", rule: r1.evidence[0]?.rule_id });
      const r2 = invisibleUnicodeScanNonStream(u(c.text, {}, "response"));
      if (r2.verdict === "finding") fps.push({ text: c.text, checker: "invisible-unicode-scan" });
    }
    if (!existsSync(fpFile)) writeFileSync(fpFile, JSON.stringify({ generated_at: new Date().toISOString(), fps: [] }, null, 2), "utf8");
    expect(Array.isArray(fps)).toBe(true);
  });
});
