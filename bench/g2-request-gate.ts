// @no-test-required: bench runner（可执行脚本），其核心 percentile / isRegression 已由 regression-formula.test.ts 覆盖；本文件仅负责采样 + 控制台输出。
import { performance } from "node:perf_hooks";
import { egressSecretScan } from "../src/checkers/egress-secret-scan.ts";
import type { ScanUnit } from "../src/shared/types.ts";
import { percentile } from "./regression-formula.ts";

/**
 * @test REQ-VETO-013
 * @intent G2 请求侧端到端（含 egress-secret-scan 全量扫描）p95 三档：3/10/40ms。
 *         本 runner 在 CI 里跑；预热 50 + n=200（AC-VETO-013-01 采样规范）。
 */

const WARMUP = 50;
const N = 200;

function makeBody(sizeKb: number, embedSecret: boolean): string {
  const filler = "The quick brown fox jumps over the lazy dog. ".repeat(50);
  const target = sizeKb * 1024;
  let body = "";
  while (body.length < target) body += filler;
  body = body.slice(0, target);
  return embedSecret ? body + " sk-abcdefghijklmnopqrstuvwxyz" : body;
}

export interface SampleResult {
  readonly tier_kb: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

export function sampleG2(tierKb: number): SampleResult {
  const body = makeBody(tierKb, false);
  const unit: ScanUnit = { direction: "request", transport: "non-stream", text: body, meta: {} };
  for (let i = 0; i < WARMUP; i++) egressSecretScan(unit);
  const samples: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    egressSecretScan(unit);
    samples.push(performance.now() - t0);
  }
  return { tier_kb: tierKb, p50: percentile(samples, 0.5), p95: percentile(samples, 0.95), p99: percentile(samples, 0.99) };
}

if (process.argv[1]?.includes("g2-request-gate")) {
  const results = [sampleG2(8), sampleG2(64), sampleG2(512)];
  const limits = [3, 10, 40];
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    const limit = limits[i]!;
    const pass = r.p95 < limit;
    console.log(`G2 ${r.tier_kb}KB → p50=${r.p50.toFixed(2)}ms p95=${r.p95.toFixed(2)}ms p99=${r.p99.toFixed(2)}ms ${pass ? "PASS" : "FAIL (limit " + limit + "ms)"}`);
  }
}
