// @no-test-required: 测试在 tests/unit/fingerprint/trust.test.ts（Gate 5a 仅识别同目录/根 tests/ 六种路径）
import { BASELINE_WINDOW } from "./baseline.ts";
import type { FingerprintStore } from "./store.ts";

/**
 * provider 信任分。
 *
 * **这条能力的天花板由设计 D-01 / 需求 C6 决定：只输出展示，不流入策略引擎。**
 * 明确禁止的四项写在下面，因为凡是"展示层指标"最后都会被顺手接进某个判定，
 * 而那会把观测类偷偷变成安全类。
 *
 *   不驱动 doctor 的 PASS/FAIL —— doctor FAIL 是准 action
 *   不驱动自动禁用 provider —— 那是事实上的 block
 *   不驱动路由变更或降权 —— 同上
 *   不进 verdict → action 映射 —— 观测类的定义就是"最多 warn"
 */

/** 信任分取值范围。 */
export const TRUST_MIN = 0 as const;
export const TRUST_MAX = 100 as const;

export interface ProviderTrust {
  readonly provider_id: string;
  /** 0..100。分数越高越可信。 */
  readonly score: number;
  /** 窗口内参与计算的样本数。 */
  readonly samples: number;
  /** 窗口内 finding 次数。 */
  readonly findings: number;
  /** 窗口内探针失败次数（不计入分数，但影响置信度）。 */
  readonly failures: number;
  /** 样本不足 BASELINE_WINDOW 时为 true，分数仅供参考。 */
  readonly provisional: boolean;
}

/**
 * 计算某 provider 的信任分。
 *
 * 算法刻意简单：窗口内 clean 占比 × 100。不引入加权、不引入衰减曲线——
 * 第一版要能被人一眼看懂，否则"这个 73 分是怎么来的"没人答得出。
 *
 * **失败不计入分母**：探针失败是"没测到"，不是"测到了不好"。
 * 把它算成扣分会让上游的一次抖动永久拉低分数，而那正是误报的形态。
 */
export function trustFor(store: FingerprintStore, providerId: string): ProviderTrust {
  const events = store.forProvider(providerId);
  const features = events.filter((e) => e.kind === "probe_feature");
  const failures = events.filter((e) => e.kind === "probe_failure").length;
  const window = features.slice(-BASELINE_WINDOW);

  const findings = window.filter((e) => e.kind === "probe_feature" && e.verdict === "finding").length;
  const judged = window.filter((e) => e.kind === "probe_feature" && e.verdict !== "baseline_pending").length;

  // 没有可判定样本时给满分而不是 0：0 会被读成"很可疑"，而事实是"还没测"
  const score = judged === 0 ? TRUST_MAX : Math.round(((judged - findings) / judged) * TRUST_MAX);

  return {
    provider_id: providerId,
    score,
    samples: judged,
    findings,
    failures,
    provisional: judged < BASELINE_WINDOW,
  };
}

/**
 * doctor 的判定结果（用户要求：指纹结论驱动 doctor 的 PASS/FAIL）。
 *
 * 为什么是 doctor 而不是阻断（用户决策）：doctor 由用户显式运行，
 * 报 FAIL 不打断任何流量——它给出"这个 provider 有问题"的明确信号，
 * 又不承担误判的可用性代价。等积累足够数据证明 FP=0 后再谈阻断。
 *
 * 判据刻意保守：
 *   - 样本不足 K 窗口 → PASS（还没有证据，不是有证据说明它坏）
 *   - 有 finding 但仍在宽限期 → PASS + 提示
 *   - 信任分 < 阈值 → FAIL
 */
export const DOCTOR_FAIL_THRESHOLD = 60 as const;

export interface DoctorFingerprintVerdict {
  readonly ok: boolean;
  readonly message: string;
}

/** 单个 provider 的 doctor 判定。 */
export function doctorVerdictFor(trust: ProviderTrust): DoctorFingerprintVerdict {
  if (trust.provisional) {
    return { ok: true, message: `${trust.provider_id}: trust=${trust.score} (provisional, ${trust.samples} samples — 尚不足以判定)` };
  }
  if (trust.score < DOCTOR_FAIL_THRESHOLD) {
    return { ok: false, message: `${trust.provider_id}: trust=${trust.score} < ${DOCTOR_FAIL_THRESHOLD} (${trust.findings}/${trust.samples} findings) — 疑似模型被偷换或降级` };
  }
  return { ok: true, message: `${trust.provider_id}: trust=${trust.score}` };
}

/** 全部 provider 的 doctor 判定汇总（无数据时 PASS，因为"没测过"不是"测出问题"）。 */
export function doctorFingerprintCheck(store: FingerprintStore): { readonly ok: boolean; readonly message: string } {
  const report = trustReport(store);
  if (report.length === 0) return { ok: true, message: "no fingerprint data yet (not a failure: nothing has been measured)" };
  const verdicts = report.map(doctorVerdictFor);
  return { ok: verdicts.every((v) => v.ok), message: verdicts.map((v) => v.message).join("; ") };
}

/** 全部已知 provider 的信任分（按 id 排序，便于人类阅读与 diff）。 */
export function trustReport(store: FingerprintStore): ProviderTrust[] {
  const ids = new Set(store.readAll().map((e) => e.provider_id));
  return [...ids].sort().map((id) => trustFor(store, id));
}
