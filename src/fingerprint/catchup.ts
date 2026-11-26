// @no-test-required: 测试在 tests/unit/fingerprint/catchup.test.ts（Gate 5a 仅识别同目录/根 tests/ 六种路径）
import type { Patrol } from "./patrol.ts";
import { type ProbeDimension, PROBE_DIMENSIONS } from "./probe.ts";

/**
 * 补齐探针与分片识别。
 *
 * 背景（需求评审 R4 指出的盲区）：四个维度分四次采，所以系统**无法证明**
 * 退化都来自同一个底层模型——对手可以按 seq%4 分片，只在你测的那一维露馅。
 *
 * 补齐是**确认**手段，不是发现手段：主判据已经发现了某一维退化，
 * 补齐回答的是"这是稳定态还是分片态"。
 *
 * 为什么只补 2 个维度而不是 3 个：判断分片不需要全集。
 * 补的 2 个里任一也退化 → 稳定降级；2 个都正常 → 高度可疑分片。
 * 补全部 3 个只会把暴露面扩大 50%，换不来额外的判断力。
 */

/** 补齐探针的最少间隔（R5 CAVEAT-2：串行发，3–5 秒，不用抖动）。 */
export const CATCHUP_SERIES_GAP_MS = 4_000;

/** 补齐的每日配额（D-04a：与 C2a 的豁免**不叠加**）。 */
export const CATCHUP_DAILY_LIMIT = 1;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** 补齐补几个维度。 */
export const CATCHUP_DIMENSIONS = 2;

/** 补齐结果：分片（强信号）还是稳定降级。 */
export type CatchUpVerdict =
  | { readonly kind: "inconsistent_degradation"; readonly degraded_dimension: ProbeDimension; readonly healthy_dimensions: readonly ProbeDimension[] }
  | { readonly kind: "stable_degradation" };

export interface CatchUpSample {
  readonly dimension: ProbeDimension;
  readonly degraded: boolean;
}

export class CatchUpPlanner {
  private readonly lastCatchUp = new Map<string, number>();
  private readonly now: () => number;

  /**
   * @param now 时钟注入。测试不真的等 24 小时，而"用真实时钟 + 不测"是
   *   配额检查最典型的失效方式——它看起来有约束，实际从没被验证过。
   */
  constructor(opts: { readonly now?: () => number } = {}) {
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * 退化维度 → 该补哪几个。
   *
   * 按枚举顺序取**前 N 个非自身**维度，而不是随机：补齐本身要可预测，
   * 否则"补了哪些"会变成另一个随机源，让事后复盘困难。
   */
  planFor(degraded: ProbeDimension): readonly ProbeDimension[] {
    return PROBE_DIMENSIONS.filter((d) => d !== degraded).slice(0, CATCHUP_DIMENSIONS);
  }

  /**
   * 现在能不能为这个 provider 发起补齐。
   *
   * 两个否决条件：
   *   ① patrol 处于退避（D-04a：已失败态别雪上加霜，而且那会切断主流量）
   *   ② 24h 配额已用
   */
  shouldCatchUp(providerId: string, patrol: Patrol): boolean {
    if (patrol.isBackingOff(providerId)) return false;
    const last = this.lastCatchUp.get(providerId) ?? 0;
    return this.now() - last >= ONE_DAY_MS;
  }

  recordCatchUp(providerId: string): void {
    this.lastCatchUp.set(providerId, this.now());
  }

  /**
   * 把补齐结果解释成分片信号或稳定降级。
   *
   * 判据：补齐的**任一**维也退化 → 稳定降级。都被补的维正常 → 分片。
   * 这条不对称是刻意的：稳定降级的证据更强（多处同时坏），
   * 而分片的证据本来就弱（只有一处坏，其余"恰好"正常）。
   */
  interpret(degraded: ProbeDimension, samples: readonly CatchUpSample[]): CatchUpVerdict {
    const healthy = samples.filter((s) => !s.degraded);
    if (healthy.length !== samples.length) return { kind: "stable_degradation" };
    return {
      kind: "inconsistent_degradation",
      degraded_dimension: degraded,
      healthy_dimensions: samples.map((s) => s.dimension),
    };
  }
}
