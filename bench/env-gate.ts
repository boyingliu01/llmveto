/**
 * @test REQ-VETO-013
 * @intent 相对回归门的可比性前置条件（docs/adr/0002 补遗一/补遗二）：基准与本次采样必须
 *         **同构环境**且**同口径估计量**才可比。
 *         - 环境：os/arch 不同（Windows 占位基线 vs ubuntu CI）或录制来源不同（本地 vs CI）时，
 *           环境噪声会把网关真实成本淹没；跨环境比较制造的确定性假红与放行同样不可接受。
 *         - 口径：基准若用单次采样 / 中位 / 不同 N，与门的估计量不同分布，比较本身失义。
 *         任一不匹配 → 门 SKIP（显式提示 + exit 0 非阻断），而非误伤或静默通过。
 */
import type { SamplingSpec } from "./repeat.ts";

export interface BenchEnvironment {
  readonly os: string;
  readonly arch: string;
  readonly ci: boolean;
}

export interface EnvGateResult {
  readonly comparable: boolean;
  readonly reason: string;
}

function describe(env: BenchEnvironment): string {
  return `${env.os}-${env.arch}-${env.ci ? "ci" : "local"}`;
}

/** 当前进程的环境画像（record 与 check 两侧共用一个真相源）。 */
export function currentEnvironment(): BenchEnvironment {
  return { os: process.platform, arch: process.arch, ci: process.env.CI === "true" };
}

/**
 * 基准环境标记 vs 当前环境可否比较。
 * 标记缺失/畸形（schema < 3 的旧基准）同样判不可比：无法验证同构就不能判定回退。
 */
export function environmentMatches(baselineEnv: unknown, current: BenchEnvironment): EnvGateResult {
  if (baselineEnv === null || typeof baselineEnv !== "object" || Array.isArray(baselineEnv)) {
    return { comparable: false, reason: "baseline has no _environment marker (schema < 3) — re-record required" };
  }
  const b = baselineEnv as Record<string, unknown>;
  if (typeof b.os !== "string" || typeof b.arch !== "string" || typeof b.ci !== "boolean") {
    return { comparable: false, reason: "baseline _environment marker is malformed — re-record required" };
  }
  const base = { os: b.os, arch: b.arch, ci: b.ci };
  if (base.os !== current.os || base.arch !== current.arch || base.ci !== current.ci) {
    return { comparable: false, reason: `environment mismatch: baseline=${describe(base)} current=${describe(current)}` };
  }
  return { comparable: true, reason: "" };
}

/**
 * 基准是否标注为 CI 录制。只用于 SKIP 提示选择措辞（"待录权威基线" vs "权威判定在同构 CI 运行"），
 * 不参与可比性判定——可比性一律由 environmentMatches 决定。
 */
export function isCiCalibrated(baselineEnv: unknown): boolean {
  if (baselineEnv === null || typeof baselineEnv !== "object" || Array.isArray(baselineEnv)) return false;
  return (baselineEnv as Record<string, unknown>).ci === true;
}

/**
 * 基准的录制口径 vs 当前门的估计量可否比较（docs/adr/0002 补遗二）。
 * `_repeats` / `_estimator` 是 schema v4 起随录制写入的口径标记：不同 N 或不同统计量
 * （如单次采样、N 次取中位、N 次取最小）不是同一个估计量，其差异与跨环境噪声同一量级
 * （1–2ms 量级的 1.2× 容差只有 0.2–0.33ms 绝对宽度），故判不可比而非误伤。
 */
export function samplingMatches(
  baselineRepeats: unknown,
  baselineEstimator: unknown,
  expected: SamplingSpec,
): EnvGateResult {
  if (typeof baselineRepeats !== "number" || !Number.isInteger(baselineRepeats) || baselineRepeats < 1) {
    return { comparable: false, reason: "baseline has no _repeats marker or it is malformed (schema < 4) — re-record required" };
  }
  // R6-C2：畸形判据与"确有口径差异"判据分开——`_estimator` 是机器写入的口径标记，带首尾空白即说明它
  // 不是任何已知 producer 的产物（属畸形，需重录），而非"另一种统计量"（属口径不匹配）。
  // 两侧仍走同一个 fail-closed（SKIP）出口，严格逐字比对（R6-A2 从严裁决）不因本分类放宽。
  if (typeof baselineEstimator !== "string" || baselineEstimator.trim() === "" || baselineEstimator !== baselineEstimator.trim()) {
    return { comparable: false, reason: "baseline has no _estimator marker or it is malformed (schema < 4) — re-record required" };
  }
  if (baselineRepeats !== expected.repeats || baselineEstimator !== expected.estimator) {
    return {
      comparable: false,
      reason:
        `sampling procedure mismatch: baseline=${baselineEstimator} of ${baselineRepeats} vs ` +
        `gate=${expected.estimator} of ${expected.repeats}`,
    };
  }
  return { comparable: true, reason: "" };
}
