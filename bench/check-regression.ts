// @no-test-required: CI 入口脚本（无逻辑分支），核心判定由 regression-formula.test.ts 与环境门由 env-gate.test.ts 覆盖。
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isRegression } from "./regression-formula.ts";
import { currentEnvironment, environmentMatches, isCiCalibrated, samplingMatches } from "./env-gate.ts";
import { BENCH_SAMPLING, medianOf, minOf } from "./repeat.ts";

/**
 * @test REQ-VETO-013
 * @intent CI 端读取基准文件（默认 bench/baseline.json，可用 LLMVETO_BENCH_BASELINE 覆写）的 p95_base
 *         与当前 PR 采样（p95_pr），套用 regression-formula.isRegression()。
 *         任一档命中回退 → exit 1 阻断合并。
 *
 * 估计量：每档取 BENCH_REPEATS 次独立运行 runner 的 p95 **最小值**（docs/adr/0002 补遗二）。
 *         干扰只会抬高测得成本，最小值最接近真成本；单次采样在共享 runner 上受突发干扰支配，
 *         实测同 job 内同码同档可差 3×——比 1.2× 容差更宽，会把无回归的改动判红。基准侧由
 *         record-baseline.ts 用同一估计量录制。中位数与全部采样只作人读输出。
 *
 * 可比性前置门（docs/adr/0002 补遗一/二）：环境（os/arch/ci 全等）与录制口径（_repeats/_estimator
 * 相等）二者缺一即不可比。不匹配 → SKIP（exit 0，非阻断）+ 醒目提示与补救指引：跨环境/跨口径
 * 比较的"假红"与"静默放行"同样有害，权威基准由 main 分支 workflow_dispatch 的 record job 在
 * ubuntu-latest 重录后提交。
 *
 * 使用方式（.github/workflows/bench.yml）：
 *   bun run bench/check-regression.ts
 */

interface Baseline {
  readonly _environment?: unknown;
  readonly _repeats?: unknown;
  readonly _estimator?: unknown;
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

/** N 次采样各自的 p95，及判定用最小值与仅供人读的中位数。逐采样打印保留日志可读性（突发样本肉眼可辨）。 */
function sampleStats(samples: readonly string[], labelRe: RegExp): { min: number; median: number; values: number[] } {
  const values = samples.map((log) => parseP95(log, labelRe));
  return { min: minOf(values), median: medianOf(values), values };
}

const baselinePath = process.env.LLMVETO_BENCH_BASELINE ?? "bench/baseline.json";
const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;

const envGate = environmentMatches(baseline._environment, currentEnvironment());
const methodGate = samplingMatches(baseline._repeats, baseline._estimator, BENCH_SAMPLING);
if (!envGate.comparable || !methodGate.comparable) {
  // SKIP ≠ 放行：相对门在当前环境不具备判别力（缺权威基准/跨环境噪声/跨口径）。绝对门按 ADR-0002 v2
  // 既有决策只打印不设退出码（见 docs/adr/0002 "绝对门仅供人读"）→ 本环境内没有阻断性性能门，
  // 必须显式声明（不得让"逐档打印"被读成仍有强制力）。不可比子因的补救不同，故分支措辞：
  // 口径漂移 → 必须按当前口径重录；基线已是 CI 录制 → 判定权在同构 CI 运行；
  // 基线仍是本地占位 → 待办是录权威基线并提交。
  const reason = [envGate.reason, methodGate.reason].filter((r) => r !== "").join("; ");
  console.log(`SKIP  relative regression gate — ${reason}`);
  console.log(`      baseline: ${baselinePath}`);
  console.log(`      ⚠️  no blocking performance gate in effect (relative gate skipped; absolute gates print-only per ADR-0002)`);
  if (!methodGate.comparable) {
    console.log(
      `      cause: the committed baseline lacks this gate's sampling markers (_repeats/_estimator, schema < 4) or they differ from the current procedure (${BENCH_SAMPLING.estimator} of ${BENCH_SAMPLING.repeats} runs).`,
    );
    console.log(`          mandatory follow-up: re-record the baseline with the current procedure, then commit bench/baseline.json`);
  } else if (isCiCalibrated(baseline._environment)) {
    console.log(`      cause: the committed baseline was recorded on CI (ubuntu-latest); this environment cannot be compared against it.`);
    console.log(`      authoritative enforcement: every bench run in CI (ubuntu-latest) is compared against this same baseline.`);
  } else {
    console.log(`          mandatory follow-up: record the CI authoritative baseline, then commit bench/baseline.json`);
  }
  if (!methodGate.comparable || !isCiCalibrated(baseline._environment)) {
    console.log(`      remediation (CI authoritative baseline): Actions → bench → Run workflow (workflow_dispatch, record job)`);
    console.log(`                                              → download 'bench-baseline' artifact → commit bench/baseline.json`);
  }
  console.log(`      remediation (local enforcement): bun run bench:record bench/baseline.local.json`);
  console.log(`                 LLMVETO_BENCH_BASELINE=bench/baseline.local.json bun run bench/check-regression.ts`);
  if (process.env.CI === "true") {
    console.log(`::warning::bench relative gate SKIPPED — ${reason}; no blocking performance gate in effect in this environment; see docs/adr/0002`);
  }
  process.exit(0);
}

const g1Samples: string[] = [];
const g2Samples: string[] = [];
for (let i = 0; i < BENCH_SAMPLING.repeats; i++) {
  // 两个 runner 交替采样：任何慢窗口对两条指标等同地施加影响，不引入指标间的时间偏置。
  g1Samples.push(runRunner("bench/g1-ttft.ts"));
  g2Samples.push(runRunner("bench/g2-request-gate.ts"));
}

console.log(
  `relative regression gate — ${BENCH_SAMPLING.estimator} of ${BENCH_SAMPLING.repeats} runs vs baseline (${baselinePath})`,
);

const g1 = sampleStats(g1Samples, /p95=([\d.]+)ms/);
const checks: { name: string; base: number; pr: number; median: number; values: number[] }[] = [
  { name: "G1 TTFT p95", base: baseline.g1_ttft_delta_ms.p95, pr: g1.min, median: g1.median, values: g1.values },
];

for (const tier of baseline.g2_request_gate_ms.tiers) {
  const re = new RegExp(`${tier.body_kb}KB → p50=[\\d.]+ms p95=([\\d.]+)ms`);
  const s = sampleStats(g2Samples, re);
  checks.push({ name: `G2 ${tier.body_kb}KB p95`, base: tier.p95, pr: s.min, median: s.median, values: s.values });
}

let regressed = false;
for (const c of checks) {
  const v = isRegression({ p95_base_ms: c.base, p95_pr_ms: c.pr });
  const samples = `[${c.values.map((x) => x.toFixed(3)).join(", ")}]`;
  if (v.regressed) {
    regressed = true;
    console.log(
      `FAIL  ${c.name}: base=${c.base} pr=${c.pr.toFixed(3)} (min of ${c.values.length}; median=${c.median.toFixed(3)}) runs=${samples} → ${v.reasons.join("; ")}`,
    );
  } else {
    console.log(`PASS  ${c.name}: base=${c.base} pr=${c.pr.toFixed(3)} (min of ${c.values.length}; median=${c.median.toFixed(3)}) runs=${samples}`);
  }
}

process.exit(regressed ? 1 : 0);
