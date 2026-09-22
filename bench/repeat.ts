/**
 * @test REQ-VETO-013
 * @intent 相对回归门的降噪口径（docs/adr/0002 补遗二）。
 *
 * 噪声形态（实测）：共享 runner 上的单次采样受偶发干扰支配，且干扰只会**抬高**测得的成本、
 * 不会降低真实成本——同一 job 内、同一份代码、相隔数秒的两次采样，G2 8KB 档 p95 相差 3.05×
 * （0.60ms vs 1.83ms），远超回退公式 1.2× 容差。
 *
 * 估计量取 N 次独立采样的**最小值**：最小值最接近"无干扰时的真实成本"，且假红需要全部 N 次
 * 都落在慢模式。中位数不作判定用——在双峰噪声（1–2ms 档实测快模式 ~1.0–1.3ms / 慢模式
 * ~1.9–2.2ms）下，中位数落在哪个模式取决于多数样本落在哪一侧：本机同码对拍即出现
 * base 中位 1.34 vs pr 中位 2.01 的假红，属"模式抽签"而非回归。
 *
 * 两侧必须共用本模块的常量与函数：基准与 PR 若用不同估计量或不同 N，比较本身失义
 * （可比性由 env-gate.samplingMatches 机器化把关）。
 */
import { percentile } from "./regression-formula.ts";

/**
 * N=10。min 是单一顺序统计量：N 越小，两侧越可能抽到不同的"最深谷"（N=5 时本机实测
 * 仍有 64KB 档 base=2.64 vs pr=3.77 的漂移）；N 越大两侧越收敛到同一个干净底。代价是
 * bench/record 单 job 线性增长（CI 单轮三台 runner 实测 ~13s → N=10 约 2 分钟）。
 */
export const BENCH_REPEATS = 10;

/** 判定用估计量名（写入基准 `_estimator`，与门口径逐字比对）。 */
export const BENCH_ESTIMATOR = "min";

export interface SamplingSpec {
  readonly repeats: number;
  readonly estimator: string;
}

/** 当前门采用的录制口径（record 写入、check 比对，同一真相源）。 */
export const BENCH_SAMPLING: SamplingSpec = { repeats: BENCH_REPEATS, estimator: BENCH_ESTIMATOR };

/** 判定用估计量：N 次采样的最小值。空样本集是调用方错误，直接抛出。 */
export function minOf(values: readonly number[]): number {
  if (values.length === 0) throw new Error("minOf: empty sample set");
  return Math.min(...values);
}

/** 仅供人读的稳健中心量（percentile(0.5) 在奇数样本上即中位数）。不参与判定——见文件头。 */
export function medianOf(values: readonly number[]): number {
  if (values.length === 0) throw new Error("medianOf: empty sample set");
  return percentile(values, 0.5);
}
