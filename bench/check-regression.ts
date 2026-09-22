// @no-test-required: CI 入口脚本（无逻辑分支），核心判定由 regression-formula.test.ts 与环境门由 env-gate.test.ts 覆盖。
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isRegression } from "./regression-formula.ts";
import { currentEnvironment, environmentMatches } from "./env-gate.ts";

/**
 * @test REQ-VETO-013
 * @intent CI 端读取基准文件（默认 bench/baseline.json，可用 LLMVETO_BENCH_BASELINE 覆写）的 p95_base
 *         与当前 PR 采样（p95_pr），套用 regression-formula.isRegression()。
 *         任一档命中回退 → exit 1 阻断合并。
 *
 * 环境前置门（docs/adr/0002 补遗）：基准与本次采样必须同构环境（os/arch/ci 全等）才可比。
 * 不匹配 → SKIP（exit 0，非阻断）+ 醒目提示与补救指引：跨环境比较的"假红"与"静默放行"
 * 同样有害，权威基准由 main 分支 workflow_dispatch 的 record job 在 ubuntu-latest 重录后提交。
 *
 * 使用方式（.github/workflows/bench.yml）：
 *   bun run bench/check-regression.ts
 */

interface Baseline {
  readonly _environment?: unknown;
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

const baselinePath = process.env.LLMVETO_BENCH_BASELINE ?? "bench/baseline.json";
const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;

const gate = environmentMatches(baseline._environment, currentEnvironment());
if (!gate.comparable) {
  // SKIP ≠ 放行：相对门在当前环境不具备判别力（缺权威基准或跨环境噪声）。绝对门按 ADR-0002 v2
  // 既有决策只打印不设退出码（见 docs/adr/0002 "绝对门仅供人读"）→ 过渡期内本 job 没有阻断性
  // 性能门，必须显式声明（不得让"逐档打印"被读成仍有强制力）；权威基线落地后同一环境自动转强制。
  console.log(`SKIP  relative regression gate — ${gate.reason}`);
  console.log(`      ⚠️  no blocking performance gate in effect (relative gate skipped; absolute gates print-only per ADR-0002)`);
  console.log(`          mandatory follow-up: record the CI authoritative baseline, then commit bench/baseline.json`);
  console.log(`      baseline: ${baselinePath}`);
  console.log(`      remediation (CI authoritative baseline): Actions → bench → Run workflow (workflow_dispatch, record job)`);
  console.log(`                                              → download 'bench-baseline' artifact → commit bench/baseline.json`);
  console.log(`      remediation (local enforcement): bun run bench:record bench/baseline.local.json`);
  console.log(`                 LLMVETO_BENCH_BASELINE=bench/baseline.local.json bun run bench/check-regression.ts`);
  if (process.env.CI === "true") {
    console.log(`::warning::bench relative gate SKIPPED — ${gate.reason}; no blocking performance gate in effect until the CI baseline is committed; see docs/adr/0002`);
  }
  process.exit(0);
}

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
