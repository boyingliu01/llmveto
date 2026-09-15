// @no-test-required: CI 入口脚本（无逻辑分支），核心判定由 regression-formula.test.ts 覆盖。
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isRegression } from "./regression-formula.ts";

/**
 * @test REQ-VETO-013
 * @intent CI 端读取 bench/baseline.json（p95_base）与当前 PR 采样（p95_pr），
 *         套用 regression-formula.isRegression()。任一档命中回退 → exit 1 阻断合并。
 *
 * 使用方式（.github/workflows/bench.yml）：
 *   bun run bench/check-regression.ts
 */

interface Baseline {
  readonly g1_ttft_delta_ms: { readonly p95: number };
  readonly g2_request_gate_ms: {
    readonly tiers: readonly { readonly body_kb: number; readonly p95: number }[];
  };
}

function parseP95(log: string, labelRe: RegExp): number {
  const m = log.match(labelRe);
  if (!m || m[1] === undefined) throw new Error(`p95 not found in log (pattern: ${labelRe.source})`);
  return Number(m[1]);
}

function runRunner(file: string): string {
  // 使用 spawnSync + argv 数组而非 shell 字符串，避免任何 shell 元字符解析面。
  const res = spawnSync("bun", ["run", file], { encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`runner ${file} exited ${res.status}: ${res.stderr ?? ""}`);
  }
  return res.stdout;
}

const baseline = JSON.parse(readFileSync("bench/baseline.json", "utf8")) as Baseline;

const g1Log = runRunner("bench/g1-ttft.ts");
const g2Log = runRunner("bench/g2-request-gate.ts");

const checks: { name: string; base: number; pr: number }[] = [
  { name: "G1 TTFT p95", base: baseline.g1_ttft_delta_ms.p95, pr: parseP95(g1Log, /p95=([\d.]+)ms/) },
];

for (const tier of baseline.g2_request_gate_ms.tiers) {
  const re = new RegExp(`${tier.body_kb}KB → p50=[\\d.]+ms p95=([\\d.]+)ms`);
  checks.push({ name: `G2 ${tier.body_kb}KB p95`, base: tier.p95, pr: parseP95(g2Log, re) });
}

let regressed = false;
for (const c of checks) {
  const v = isRegression({ p95_base_ms: c.base, p95_pr_ms: c.pr });
  if (v.regressed) {
    regressed = true;
    console.log(`FAIL  ${c.name}: base=${c.base} pr=${c.pr.toFixed(3)} → ${v.reasons.join("; ")}`);
  } else {
    console.log(`PASS  ${c.name}: base=${c.base} pr=${c.pr.toFixed(3)}`);
  }
}

process.exit(regressed ? 1 : 0);
