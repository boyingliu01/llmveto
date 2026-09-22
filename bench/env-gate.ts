/**
 * @test REQ-VETO-013
 * @intent 相对回归门的环境前置条件（docs/adr/0002 补遗）：基准与本次采样必须同构环境才可比。
 *         os/arch 不同（Windows 占位基线 vs ubuntu CI）或录制来源不同（本地 vs CI）时，
 *         环境噪声会把网关真实成本淹没——跨环境比较制造的确定性假红与放行同样不可接受。
 *         故不匹配时门 SKIP（显式提示 + exit 0 非阻断），而非误伤或静默通过。
 */

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
