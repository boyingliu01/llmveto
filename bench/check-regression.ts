// @no-test-required: CI 入口脚本（含内联解析/守卫逻辑，异常即 fail-loud 抛出并在 CI 日志直接可见）；核心判定由 regression-formula.test.ts 覆盖、可比性前置门由 env-gate.test.ts 覆盖。
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isRegression } from "./regression-formula.ts";
import { currentEnvironment, environmentMatches, isCiCalibrated, samplingMatches } from "./env-gate.ts";
import { BENCH_SAMPLING, medianOf, minOf } from "./repeat.ts";
import { G1_LINE_RE, g2LineRe } from "./runner-format.ts";

/**
 * @test REQ-VETO-013
 * @intent CI 端读取基准文件（默认 bench/baseline.json，可用 LLMVETO_BENCH_BASELINE 覆写）的 p50_base
 *         与当前 PR 采样（p50_pr），套用 regression-formula.isRegression()。
 *         任一档命中回退 → exit 1 阻断合并。
 *
 * 判定量 = 相对口径下 N 次独立运行 runner 的 **p50** 最小值（docs/adr/0002 补遗三）。
 *         分位数取 p50 而非 p95：尾部在共享 runner 上受偶发停顿支配，跨实例波动实测达 +25%，
 *         已超过 1.2× 容差本身（补遗三的三次同码实测），会把无回归的改动判红；p50 反映网关真实增量
 *         且跨运行稳定。尾部回归由绝对门（G1 p95/p99、G2 p95、G3）在 job 日志中呈现，
 *         其是否升级为阻断须单独修订 ADR（补遗一"后续决策点"）。
 *
 * 估计量：每档取 BENCH_REPEATS 次独立运行 runner 的对应分位数 **最小值**（docs/adr/0002 补遗二）。
 *         干扰只会抬高测得成本，最小值最接近真成本；单次采样在共享 runner 上受突发干扰支配，
 *         实测同 job 内同码同档可差 3×——比 1.2× 容差更宽，会把无回归的改动判红。基准侧由
 *         record-baseline.ts 用同一估计量录制（逐分位取 N 次最小，故 p50 与 p95 皆可直接消费）。
 *         中位数、全部采样与 p95 对照行只作人读输出，不参与判定。
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
  readonly g1_ttft_delta_ms: { readonly p50: number; readonly p95: number };
  readonly g2_request_gate_ms: {
    readonly tiers: readonly { readonly body_kb: number; readonly p50: number; readonly p95: number }[];
  };
}

/**
 * 数值守卫（R6-B2，fail-loud）：NaN/Infinity 经 isRegression 两条件皆 false 会**静默 PASS**
 * ——等于"无阻断性性能门"被无声放行。日志解析与基准字段两侧共用本守卫：任一缺失/畸形都抛。
 */
function finite(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${what} is not a finite number (fail-loud: NaN would silently pass both regression conditions)`);
  }
  return value;
}

/** 取日志中第 group 个捕获组为有限数。runner 输出自控，但 `[\d.]+` 仍可匹配出 `1.2.3` 型 NaN，故守卫不放行。 */
function parseStat(log: string, labelRe: RegExp, group: number, label: string): number {
  const raw = log.match(labelRe)?.[group];
  return finite(raw === undefined ? NaN : Number(raw), `${label} in runner log (pattern: ${labelRe.source})`);
}

function runRunner(file: string): string {
  // 使用 spawnSync + argv 数组而非 shell 字符串，避免任何 shell 元字符解析面。
  const res = spawnSync("bun", ["run", file], { encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`runner ${file} exited ${res.status}: ${res.stderr ?? ""}`);
  }
  return res.stdout;
}

interface Stat {
  readonly values: number[];
  readonly min: number;
  readonly median: number;
}

function summarize(values: number[]): Stat {
  return { values, min: minOf(values), median: medianOf(values) };
}

/**
 * 一个档位的两组统计量：`judged` = 判定用 p50（第 1 捕获组），`tail` = 仅供人读的 p95 对照（第 2 捕获组）。
 * 逐采样打印保留日志可读性（突发样本肉眼可辨）；p95 对照为补遗三的复审留数据，不参与判定。
 */
function sampleStats(samples: readonly string[], labelRe: RegExp, label: string): { judged: Stat; tail: Stat } {
  return {
    judged: summarize(samples.map((log) => parseStat(log, labelRe, 1, `${label} p50`))),
    tail: summarize(samples.map((log) => parseStat(log, labelRe, 2, `${label} p95`))),
  };
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
  `relative regression gate — p50 ${BENCH_SAMPLING.estimator} of ${BENCH_SAMPLING.repeats} runs vs baseline (${baselinePath})`,
);

interface Check {
  readonly name: string;
  readonly base: number;
  readonly judged: Stat;
  readonly tailLabel: string;
  readonly tailBase: number;
  readonly tail: Stat;
}

// 解析契约（行首锚定 + 捕获组顺序）由 bench/runner-format.ts 单源提供，与 record 侧共用（R8-B-M3）。
const g1 = sampleStats(g1Samples, G1_LINE_RE, "G1 TTFT");
const checks: Check[] = [
  {
    name: "G1 TTFT p50",
    base: finite(baseline.g1_ttft_delta_ms.p50, "baseline g1_ttft_delta_ms.p50 (bench/baseline.json)"),
    judged: g1.judged,
    tailLabel: "G1 TTFT p95",
    tailBase: finite(baseline.g1_ttft_delta_ms.p95, "baseline g1_ttft_delta_ms.p95 (bench/baseline.json)"),
    tail: g1.tail,
  },
];

for (const tier of baseline.g2_request_gate_ms.tiers) {
  const s = sampleStats(g2Samples, g2LineRe(tier.body_kb), `G2 ${tier.body_kb}KB`);
  checks.push({
    name: `G2 ${tier.body_kb}KB p50`,
    base: finite(tier.p50, `baseline G2 ${tier.body_kb}KB p50 (bench/baseline.json)`),
    judged: s.judged,
    tailLabel: `G2 ${tier.body_kb}KB p95`,
    tailBase: finite(tier.p95, `baseline G2 ${tier.body_kb}KB p95 (bench/baseline.json)`),
    tail: s.tail,
  });
}

let regressed = false;
for (const c of checks) {
  const v = isRegression({ base_ms: c.base, pr_ms: c.judged.min });
  const samples = `[${c.judged.values.map((x) => x.toFixed(3)).join(", ")}]`;
  const line = `${c.name}: base=${c.base} pr=${c.judged.min.toFixed(3)} (min of ${c.judged.values.length}; median=${c.judged.median.toFixed(3)}) runs=${samples}`;
  if (v.regressed) {
    regressed = true;
    console.log(`FAIL  ${line} → ${v.reasons.join("; ")}`);
  } else {
    console.log(`PASS  ${line}`);
  }
  console.log(
    `      ${c.tailLabel} [info only, not judged]: base=${c.tailBase} pr=${c.tail.min.toFixed(3)} (median=${c.tail.median.toFixed(3)})`,
  );
}

process.exit(regressed ? 1 : 0);
