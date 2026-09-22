// @no-test-required: bench 工具（可执行脚本），复刻 check-regression.ts 的 runner 编排与解析格式；核心判定由 regression-formula.test.ts 覆盖。
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { arch, cpus, platform } from "node:os";
import { G1_TTFT_P95_MAX_MS, G1_TTFT_P99_MAX_MS, G2_THRESHOLDS, G3_THRESHOLDS } from "./regression-formula.ts";

/**
 * @test REQ-VETO-013
 * @intent 按 AC-VETO-013 采样协议（预热 50 + n=200）运行 G1/G2/G3 runner，
 *         解析 p50/p95/p99 重录 bench/baseline.json（兑现 _refresh_policy 约定的
 *         `bun run bench:record`），供相对回归门（check-regression.ts）消费。
 *
 * 纪律：重录不改变任何冻结阈值（regression-formula.ts 常量）。基准与 PR 须同构
 *       环境才可比；dev 机数值为占位，权威基准以 main 分支绿色 CI (ubuntu-latest)
 *       口径为准（docs/adr/0002）。
 */

const SAMPLE_SIZE = 200;
const WARMUP = 50;

const CHECKERS = ["egress-secret-scan", "invisible-unicode-scan", "model-label-consistency"] as const;

interface Percentiles {
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

function runRunner(file: string): string {
  // 与 check-regression.ts 同款：spawnSync + argv 数组，避免 shell 解析面。
  const res = spawnSync("bun", ["run", file], { encoding: "utf8" });
  if (res.status !== 0) throw new Error(`runner ${file} exited ${res.status}: ${res.stderr ?? ""}`);
  process.stdout.write(res.stdout);
  return res.stdout;
}

function percentilesFrom(log: string, re: RegExp, label: string): Percentiles {
  const m = log.match(re);
  if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined) {
    throw new Error(`${label}: p50/p95/p99 not found (pattern: ${re.source})`);
  }
  return { p50: Number(m[1]), p95: Number(m[2]), p99: Number(m[3]) };
}

const g1Log = runRunner("bench/g1-ttft.ts");
const g2Log = runRunner("bench/g2-request-gate.ts");
const g3Log = runRunner("bench/g3-checker-timeout.ts");

const g1 = percentilesFrom(g1Log, /p50=([\d.]+)ms p95=([\d.]+)ms p99=([\d.]+)ms/, "G1");

const g2Tiers = G2_THRESHOLDS.map((gate) => {
  const kb = gate.body_bytes / 1024;
  const re = new RegExp(`${kb}KB → p50=([\\d.]+)ms p95=([\\d.]+)ms p99=([\\d.]+)ms`);
  return {
    body_kb: kb,
    ...percentilesFrom(g2Log, re, `G2 ${kb}KB`),
    gate_p95_lt_ms: gate.p95_ms,
  };
});

const g3Tiers = G3_THRESHOLDS.flatMap((gate) => {
  const kb = gate.body_bytes / 1024;
  return CHECKERS.map((checker) => {
    const re = new RegExp(`G3 ${checker} ${kb}KB → p50=([\\d.]+) p95=([\\d.]+) p99=([\\d.]+)`);
    return {
      checker,
      body_kb: kb,
      ...percentilesFrom(g3Log, re, `G3 ${checker} ${kb}KB`),
      g3_lt_ms: gate.ms,
    };
  });
});

const today = new Date().toISOString().slice(0, 10);
const cpu = cpus()[0]?.model ?? "unknown cpu";

const baseline = {
  _schema_version: 3,
  _purpose:
    "AC-VETO-013-04 回退公式基准：p95_base 取本文件对应 runner 的 p95_ms 字段。CI 中 bench 每次运行按同 runner 采样 n=200 后调用 regression-formula.isRegression({p95_base_ms, p95_pr_ms}) 判定；regressed=true → 阻断合并。v2 起 G1/G2 为 HTTP 端到端口径（逐请求配对增量），G3 仍为进程内 checker 计时；口径变更详见 docs/adr/0002-bench-http-e2e-methodology.md。v3 起增 _environment 标记：check-regression 前置环境门要求基准与采样 os/arch/ci 全等，不匹配即 SKIP（见该 ADR 补遗）。",
  _measured_at: today,
  _environment: { os: platform(), arch: arch(), ci: process.env.CI === "true" },
  _measured_on: `${platform()} ${arch()} · ${cpu}（bun run bench:record 自动重录${process.env.CI === "true" ? "，CI runner" : "，本地"}）`,
  _refresh_policy:
    "权威基准由 main 分支 CI 重录：Actions → bench → Run workflow（workflow_dispatch）触发 record job 在 ubuntu-latest 跑 `bun run bench:record`，下载 bench-baseline artifact 后人工提交（保留 main 写路径的人工门）。本地强制：`bun run bench:record bench/baseline.local.json` + LLMVETO_BENCH_BASELINE 覆写。环境门与 SKIP 语义详见 docs/adr/0002。",
  g1_ttft_delta_ms: {
    runner: "bench/g1-ttft.ts",
    method: "http-e2e-paired-delta",
    sample_size: SAMPLE_SIZE,
    warmup: WARMUP,
    ...g1,
    gate_pass: { p95_lt_ms: G1_TTFT_P95_MAX_MS, p99_lt_ms: G1_TTFT_P99_MAX_MS },
  },
  g2_request_gate_ms: {
    runner: "bench/g2-request-gate.ts",
    method: "http-e2e-paired-delta",
    sample_size: SAMPLE_SIZE,
    warmup: WARMUP,
    tiers: g2Tiers,
    _note:
      "p50 为网关真实增量；p95/p99 尾部受测量环境偶发停顿（杀软/索引/回环 socket 缓冲边界）支配，跨运行可能双峰。绝对门与相对门均以 CI (ubuntu-latest) 为权威，见 docs/adr/0002。",
  },
  g3_checker_timeout_ms: {
    runner: "bench/g3-checker-timeout.ts",
    method: "in-process-microbench",
    sample_size: SAMPLE_SIZE,
    warmup: WARMUP,
    tiers: g3Tiers,
    _adr_note: "AC-VETO-013-03 尾条件：任一 512KB 档 p99_scan ≥ G3 × 0.6 时须写 ADR（当前实测远低于，无需触发）。",
  },
};

const outPath = process.argv[2] ?? "bench/baseline.json";
writeFileSync(outPath, JSON.stringify(baseline, null, 2) + "\n", "utf8");
console.log(`baseline written → ${outPath} (_measured_at=${today}, _environment=${platform()}-${arch()}${process.env.CI === "true" ? "-ci" : "-local"})`);
