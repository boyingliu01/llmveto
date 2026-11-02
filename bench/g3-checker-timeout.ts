// @no-test-required: bench runner（可执行脚本），阈值判定通过 regression-formula.test.ts 覆盖；本文件仅负责采样 + 控制台输出。
import { performance } from "node:perf_hooks";
import { egressSecretScan } from "../src/checkers/egress-secret-scan.ts";
import { invisibleUnicodeScanNonStream } from "../src/checkers/invisible-unicode-scan.ts";
import { modelLabelConsistency } from "../src/checkers/model-label-consistency.ts";
import { CANARY_RETURN_SCAN_SPEC } from "../src/checkers/canary-return-scan.ts";
import { THINKING_SIGNATURE_PRESENCE_SPEC } from "../src/checkers/thinking-signature-presence.ts";
import { TOOL_CALL_SHAPE_SPEC } from "../src/checkers/tool-call-shape.ts";
import { USAGE_RECONCILE_SPEC } from "../src/checkers/usage-reconcile.ts";
import type { NonStreamChecker, ScanUnit } from "../src/shared/types.ts";
import { G3_THRESHOLDS, percentile } from "./regression-formula.ts";

/**
 * @test REQ-VETO-013
 * @intent G3 单 checker 执行上限（AC-VETO-013-03）：
 *   分档 8/64/512KB → 20/50/120ms；超时 → verdict=error → action=block。
 *   G-BENCH 报告 512KB 档 p99_scan，须满足 p99_scan < G3 × 0.6，否则触发 ADR 记录。
 *
 * Runner：对每个 checker 分别采样 3 档 body；预热 50 + n=200；输出 p50/p95/p99 + PASS/FAIL/ADR。
 * v1 采"三 checker 顺序跑"作为最坏情况上界（同 gateway 内 pipeline 一致）。
 */

const WARMUP = 50;
const N = 200;

function makeBody(sizeKb: number): string {
  const filler = "The quick brown fox jumps over the lazy dog. ";
  const target = sizeKb * 1024;
  let body = "";
  while (body.length < target) body += filler;
  return body.slice(0, target);
}

function sampleChecker(checker: NonStreamChecker, unit: ScanUnit): { p50: number; p95: number; p99: number } {
  for (let i = 0; i < WARMUP; i++) checker(unit);
  const samples: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    checker(unit);
    samples.push(performance.now() - t0);
  }
  return { p50: percentile(samples, 0.5), p95: percentile(samples, 0.95), p99: percentile(samples, 0.99) };
}

interface TierReport {
  readonly checker: string;
  readonly tier_kb: number;
  readonly g3_ms: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly within_g3: boolean;   // 单次未超时（< g3）
  readonly adr_required: boolean; // p99_scan >= g3 × 0.6 → 触发 ADR
}

export function sampleG3(): TierReport[] {
  // v2a 四个新 checker 的 non-stream 面纳入同一采样（G-PERF：新 checker 全集跑既有三台）。
  const v2aCheckers = [
    CANARY_RETURN_SCAN_SPEC,
    THINKING_SIGNATURE_PRESENCE_SPEC,
    TOOL_CALL_SHAPE_SPEC,
    USAGE_RECONCILE_SPEC,
  ].flatMap((s) => (s.runNonStream ? [{ name: s.id, fn: s.runNonStream }] : []));
  const checkers: { name: string; fn: NonStreamChecker }[] = [
    { name: "egress-secret-scan", fn: egressSecretScan },
    { name: "invisible-unicode-scan", fn: invisibleUnicodeScanNonStream },
    { name: "model-label-consistency", fn: modelLabelConsistency },
    ...v2aCheckers,
  ];
  const out: TierReport[] = [];
  for (const c of checkers) {
    for (const gate of G3_THRESHOLDS) {
      const kb = gate.body_bytes / 1024;
      const unit: ScanUnit = { direction: "request", transport: "non-stream", text: makeBody(kb), meta: {} };
      const r = sampleChecker(c.fn, unit);
      out.push({
        checker: c.name,
        tier_kb: kb,
        g3_ms: gate.ms,
        p50: r.p50,
        p95: r.p95,
        p99: r.p99,
        within_g3: r.p99 < gate.ms,
        adr_required: r.p99 >= gate.ms * 0.6,
      });
    }
  }
  return out;
}

if (process.argv[1]?.includes("g3-checker-timeout")) {
  const reports = sampleG3();
  let failed = false;
  let adrTriggered = false;
  for (const r of reports) {
    const tag = !r.within_g3 ? "FAIL(TIMEOUT)" : r.adr_required ? "ADR-REQUIRED" : "PASS";
    if (!r.within_g3) failed = true;
    if (r.adr_required) adrTriggered = true;
    console.log(`G3 ${r.checker} ${r.tier_kb}KB → p50=${r.p50.toFixed(2)} p95=${r.p95.toFixed(2)} p99=${r.p99.toFixed(2)} (g3=${r.g3_ms}ms) ${tag}`);
  }
  if (adrTriggered) {
    console.log("ℹ️  AC-VETO-013-03 尾条件触发：p99_scan ≥ G3 × 0.6 → 需写 ADR 记录或上调阈值。");
  }
  if (failed) process.exitCode = 1;
}
