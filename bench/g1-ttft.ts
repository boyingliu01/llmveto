// @no-test-required: bench runner（可执行脚本），其核心决策逻辑 percentile/isRegression/classifyLatency 已由 bench/regression-formula.test.ts 全量覆盖；本文件仅负责采样 + 控制台输出。
import { performance } from "node:perf_hooks";
import { invisibleUnicodeScanNonStream } from "../src/checkers/invisible-unicode-scan.ts";
import { modelLabelConsistency } from "../src/checkers/model-label-consistency.ts";
import { egressSecretScan } from "../src/checkers/egress-secret-scan.ts";
import { decide } from "../src/policy/engine.ts";
import type { PolicyInput } from "../src/policy/engine.ts";
import type { ScanUnit } from "../src/shared/types.ts";
import { percentile } from "./regression-formula.ts";

/**
 * @test REQ-VETO-013
 * @intent G1 TTFT (time-to-first-token) delta 采样：
 *   "网关启用"路径 = 首帧到达后执行 [egress-secret-scan ∘ invisible-unicode-scan ∘ model-label-consistency] + policy.decide；
 *   "旁路"路径     = 首帧到达后直接透传（不做扫描/决策）。
 *   ttft_delta = t(启用侧首帧可转发) − t(旁路侧首帧可转发)。
 *
 * 采样规范：预热 50 次 + n=200；报告 p50 / p95 / p99（AC-VETO-013-01）。
 * 阈值：G1 p95 < 5ms 且 p99 < 12ms（AC-VETO-013-01 v1 冻结）。
 */

const WARMUP = 50;
const N = 200;

const SAMPLE_CHUNK: ScanUnit = {
  direction: "response",
  transport: "stream",
  text: "Hello! Let me help you with that.",
  meta: { model_requested: "gpt-4o", model_responded: "gpt-4o" },
};

function bypassFirstToken(unit: ScanUnit): number {
  // 旁路：仅解码 + 帧解析，不扫描；用一个 constant-work 表达式避免 JIT 完全消除。
  const t0 = performance.now();
  const len = unit.text.length | 0;
  return performance.now() - t0 + len * 0; // ~0ms
}

function enabledFirstToken(unit: ScanUnit): number {
  const t0 = performance.now();
  const inputs: PolicyInput[] = [
    { checkerId: "egress-secret-scan", safetyClass: true, result: egressSecretScan(unit) },
    { checkerId: "invisible-unicode-scan", safetyClass: true, result: invisibleUnicodeScanNonStream(unit) },
    { checkerId: "model-label-consistency", safetyClass: false, result: modelLabelConsistency(unit) },
  ];
  decide(inputs);
  return performance.now() - t0;
}

export interface G1Result {
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

export function sampleG1(): G1Result {
  for (let i = 0; i < WARMUP; i++) { bypassFirstToken(SAMPLE_CHUNK); enabledFirstToken(SAMPLE_CHUNK); }
  const deltas: number[] = [];
  for (let i = 0; i < N; i++) {
    const bypass = bypassFirstToken(SAMPLE_CHUNK);
    const enabled = enabledFirstToken(SAMPLE_CHUNK);
    deltas.push(Math.max(0, enabled - bypass));
  }
  return { p50: percentile(deltas, 0.5), p95: percentile(deltas, 0.95), p99: percentile(deltas, 0.99) };
}

if (process.argv[1]?.includes("g1-ttft")) {
  const r = sampleG1();
  const pass = r.p95 < 5 && r.p99 < 12;
  console.log(`G1 TTFT delta → p50=${r.p50.toFixed(3)}ms p95=${r.p95.toFixed(3)}ms p99=${r.p99.toFixed(3)}ms ${pass ? "PASS" : "FAIL (limit p95<5ms & p99<12ms)"}`);
}
