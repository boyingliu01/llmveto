// @no-test-required: 测试在 tests/unit/fingerprint/patrol.test.ts（Gate 5a 仅识别同目录/根 tests/ 六种路径）
import type { ProbeDimension } from "./probe.ts";
import type { FingerprintStore, PatrolStateEvent, ProbeErrorClass } from "./store.ts";

/**
 * 探针调度、频率约束与熔断。
 *
 * 这是 v2b-C 里唯一持有"该不该再发请求"这个决定的地方。三条不变量（各配断言）：
 *
 *   ① 频率上限：每 provider 每 6h 至多一次（AC-08a）
 *   ② 手动与周期**共享**同一个配额（AC-08c）——否则 CLI 就是绕过最小暴露的侧信道
 *   ③ 熔断跨重启保留（AC-09c/AC-20）——破了就是"重启即绕过"
 *
 * 状态为什么落 store 而不是内存：③ 是硬要求，而 daemon 会重启。
 */

/** 基准周期（6 小时，需求 C2a）。 */
export const PROBE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** 抖动幅度（需求 C2c：±20%）。 */
export const JITTER_RATIO = 0.2;

/** 连续失败多少次进入退避（C7b）。 */
export const FAILURES_BEFORE_BACKOFF = 3;

/** 退避基数；第 n 轮退避 = 基数 × 2^(n-1)（C7b：6h→12h→24h）。 */
export const BACKOFF_BASE_MS = 6 * 60 * 60 * 1000;

/** 退避轮数上限（防无限增长；24h 已足够）。 */
export const MAX_BACKOFF_ROUNDS = 2;

type PatrolState = PatrolStateEvent;

export interface PatrolOptions {
  readonly store: FingerprintStore;
  readonly now?: () => number;
  /** 抖动函数：[0,1) → 偏移比例。测试注入固定值以消除随机性。 */
  readonly jitter?: () => number;
}

export class Patrol {
  private readonly store: FingerprintStore;
  private readonly now: () => number;
  private readonly jitter: () => number;
  private readonly states = new Map<string, PatrolState>();

  constructor(opts: PatrolOptions) {
    this.store = opts.store;
    this.now = opts.now ?? (() => Date.now());
    this.jitter = opts.jitter ?? Math.random;
    this.loadState();
  }

  /** 从 store 恢复状态（AC-09c：重启后仍退避）。 */
  private loadState(): void {
    for (const event of this.store.readAll()) {
      if (event.kind !== "patrol_state") continue;
      const s = event as unknown as PatrolState;
      // 同一 provider 取最后一条（后写的覆盖先写的）
      this.states.set(s.provider_id, s);
    }
  }

  private stateOf(providerId: string): PatrolState {
    return (
      this.states.get(providerId) ?? {
        kind: "patrol_state",
        provider_id: providerId,
        last_attempt_ts: 0,
        consecutive_failures: 0,
        backoff_rounds: 0,
        backoff_until_ts: 0,
      }
    );
  }

  private put(state: PatrolState): void {
    this.states.set(state.provider_id, state);
  }

  /** 该 provider 是否仍在退避（AC-20）。 */
  isBackingOff(providerId: string): boolean {
    return this.now() < this.stateOf(providerId).backoff_until_ts;
  }

  /** 退避结束时刻（无退避时为 0）。 */
  backoffUntil(providerId: string): number {
    return this.stateOf(providerId).backoff_until_ts;
  }

  /** 下一次可探时刻：上次 + 周期 ×(1±抖动)。 */
  nextEligibleAt(providerId: string): number {
    const s = this.stateOf(providerId);
    // 从未探过：立即可探（0 是"没有上次"，不是"1970 年探过"）
    if (s.last_attempt_ts === 0) return 0;
    const factor = 1 + (this.jitter() * 2 - 1) * JITTER_RATIO;
    return s.last_attempt_ts + Math.round(PROBE_INTERVAL_MS * factor);
  }

  /**
   * 现在能不能探。
   *
   * `manual` 只影响**日志措辞**，不影响配额（AC-08c）——手动探针若独立配额，
   * 用户连点就能达到事实上高频探测，那正是"最小暴露"要防的。
   */
  shouldProbe(providerId: string, _opts: { readonly manual?: boolean } = {}): boolean {
    if (this.isBackingOff(providerId)) return false;
    return this.now() >= this.nextEligibleAt(providerId);
  }

  /** 记录一次探测尝试（占用配额）。 */
  recordAttempt(providerId: string): void {
    const s = this.stateOf(providerId);
    this.put({ ...s, last_attempt_ts: this.now() });
  }

  /** 探测成功：清空失败计数与退避轮数。 */
  recordSuccess(providerId: string): void {
    const s = this.stateOf(providerId);
    this.put({ ...s, consecutive_failures: 0, backoff_rounds: 0, backoff_until_ts: 0, last_attempt_ts: this.now() });
  }

  /**
   * 探测失败：累计失败数，达阈值则进退避。
   *
   * 补齐探针的失败**走同一条路径**（D-04a）：不存在"补齐失败不算数"的分支，
   * 否则对手只要专打补齐就既维持降级又永不退避。
   */
  recordFailure(providerId: string, dimension: ProbeDimension, errorClass: ProbeErrorClass): void {
    const s = this.stateOf(providerId);
    const failures = s.consecutive_failures + 1;
    const rounds = failures >= FAILURES_BEFORE_BACKOFF ? Math.min(s.backoff_rounds + 1, MAX_BACKOFF_ROUNDS) : s.backoff_rounds;
    const backingOff = failures >= FAILURES_BEFORE_BACKOFF;
    this.put({
      ...s,
      consecutive_failures: failures,
      backoff_rounds: rounds,
      backoff_until_ts: backingOff ? this.now() + BACKOFF_BASE_MS * 2 ** (rounds - 1) : s.backoff_until_ts,
      last_attempt_ts: this.now(),
    });
    // 失败事件独立落链（C7f）：不进特征窗口，但要让运维看得见
    this.store.append({
      kind: "probe_failure",
      provider_id: providerId,
      target_dimension: dimension,
      error_class: errorClass,
      ts: new Date(this.now()).toISOString(),
    });
  }

  /** 把当前状态写盘（AC-09c）。 */
  persistState(): void {
    for (const s of this.states.values()) {
      this.store.append(s);
    }
  }

  /** 某 provider 的退避轮数（诊断用）。 */
  backoffRounds(providerId: string): number {
    return this.stateOf(providerId).backoff_rounds;
  }
}
