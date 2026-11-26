// @no-test-required: 测试在 tests/unit/fingerprint/catchup.test.ts（Gate 5a 仅识别同目录/根 tests/ 六种路径）
import type { Patrol } from "./patrol.ts";
import type { CatchUpQuotaEvent, FingerprintStore } from "./store.ts";
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
  private readonly store: FingerprintStore | undefined;

  /**
   * @param now 时钟注入。测试不真的等 24 小时，而"用真实时钟 + 不测"是
   *   配额检查最典型的失效方式——它看起来有约束，实际从没被验证过。
   */
  /**
   * @param opts.store 传入则配额**跨重启保留**。
   *
   * 第一版只用内存 Map：重启即清空，配额形同虚设（评审 C1）。
   * 那条约束与本模块的其它约束同源——"探针可被观测"是已接受的代价，
   * 而配额是**控制这个代价的手段**，能用重启清零的控制不算控制。
   */
  constructor(opts: { readonly now?: () => number; readonly store?: FingerprintStore } = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.store = opts.store;
    this.loadQuotas();
  }

  /** 从 store 恢复各 provider 的上次补齐时刻。 */
  private loadQuotas(): void {
    if (this.store === undefined) return;
    // 取**最大**时间戳而不是"最后一条"：append-only log 在并发写入下不保证
    // 全局时间序，用最后一条可能被旧时间戳覆盖，导致配额意外重置（评审 caveat 1）。
    // 取**最大**时间戳而不是"最后一条"：append-only log 在并发写入下不保证
    // 全局时间序，用最后一条可能被旧时间戳覆盖，导致配额意外重置。
    for (const e of this.store.readAll()) {
      if (e.kind !== "catchup_quota") continue;
      this.recordQuotaOnly(e.provider_id, e.ts_ms);
    }
  }

  /** 只更新内存中的配额（回放用），取最大值。 */
  private recordQuotaOnly(providerId: string, tsMs: number): void {
    this.lastCatchUp.set(providerId, Math.max(this.lastCatchUp.get(providerId) ?? 0, tsMs));
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
    const at = this.now();
    this.lastCatchUp.set(providerId, at);
    // 落盘：否则重启即重置配额（评审 C1）。
    // 用真正的强类型记录而不是 `as unknown as` 强转——后者会让 store 的
    // 封闭枚举校验形同虚设（第 3 轮评审 caveat 3）。
    this.store?.append({ kind: "catchup_quota", provider_id: providerId, ts_ms: at } satisfies CatchUpQuotaEvent);
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
