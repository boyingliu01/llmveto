// @no-test-required: 测试在 tests/unit/gateway/budget.test.ts + tests/integration/budget-gate.test.ts（Gate 5a 仅识别同目录/根 tests/ 六种路径）

/**
 * @test REQ-V2a-12（D-09 / AC-V2a-27）
 * @intent 预算门唯一档位常量源 + runWithBudget 事后判定（裁决面非止损面）。
 *
 * 关键契约：
 *   - G3 档位（docs/issues/2-design-v1.md §性能预算 G3 行源表）：body ≤8KB→20ms /
 *     ≤64KB→50ms / ≤512KB→120ms。D-09 文字写 "32KB" 系笔误，以其引用的源表
 *     （2-design-v1.md:79）为准，命名跟源表（8/64/512）。fixture 引用本表，非复抄。
 *   - G1_PER_CHUNK = 12ms：G1 行 p99<12ms 的封顶（"该 chunk 未在 G1 预算内返回"的
 *     硬门）。与 bench/regression-formula.ts G1_TTFT_P99_MAX_MS 同源——src 不 import
 *     bench（分层），一致性由 tests/unit/gateway/budget.test.ts 互钉。
 *   - 事后判定：同步 JS 无法抢占纯函数，performance.now() 在 checker 返回后比较；
 *     elapsed >= budget 判超（与 bench classifyLatency 的 g3_timeout 谓词同口径）。
 *     超时 → 改写为 {verdict:"error", evidence:[], reason:"checker_timeout"}：连同原
 *     result 的 evidence 一并丢弃是有意为之（R2 T-m3：超时结果不具取证资格，保留部分
 *     evidence 会造成"已裁决又改判"的双痕迹；丢弃事实由 findings 的 checker_timeout
 *     条目承载）。未超预算 → 原样返回（evidence/extra 全保留）。
 *   - 改写只替换 result，不吞 checker 回传窗口（AC-V2a-27④）：流式变体把回传窗口
 *     原样透传，网关重组点照常按片推进与保留 extra。
 *   - 异常传播关系：checker 抛异常时，异常在事后判定之前穿出本模块，由调用方 safeRun
 *     捕获 → scanner_error 优先；超时改写仅对正常返回生效（具体错误比超时判定信息量大）。
 */

import { performance } from "node:perf_hooks";
import type {
  CheckerResult,
  NonStreamChecker,
  ScanUnit,
  ScanWindow,
  StreamChecker,
} from "../shared/types.ts";

/** G3 档位常量（ms）—— 2-design-v1.md:79 G3 行源表值（单笔硬超时门）。 */
export const G3_TIER_8KB = 20 as const;
export const G3_TIER_64KB = 50 as const;
export const G3_TIER_512KB = 120 as const;

/** G1 每 chunk 门（ms）—— 2-design-v1.md:77 G1 行 p99<12ms 封顶（流式路径逐调用）。 */
export const G1_PER_CHUNK = 12 as const;

/** G3 档位表：≤ maxBytes 归该档（边界含入）；超表尾按顶档。fixture 引用非复抄。 */
export const G3_TIER_TABLE: readonly { readonly maxBytes: number; readonly ms: number }[] = Object.freeze([
  { maxBytes: 8 * 1024, ms: G3_TIER_8KB },
  { maxBytes: 64 * 1024, ms: G3_TIER_64KB },
  { maxBytes: 512 * 1024, ms: G3_TIER_512KB },
]);

/** 按 body UTF-8 字节数选 G3 档：≤8192→20 / ≤65536→50 / 其余→120（超档归顶）。 */
export function g3BudgetForBodyBytes(bodyBytes: number): number {
  for (const tier of G3_TIER_TABLE) {
    if (bodyBytes <= tier.maxBytes) return tier.ms;
  }
  return G3_TIER_512KB;
}

/** 超时改写形状（单一真相源）：evidence 一并丢弃（有意，R2 T-m3）。 */
export const CHECKER_TIMEOUT_RESULT: CheckerResult = Object.freeze({
  verdict: "error",
  evidence: Object.freeze([]),
  reason: "checker_timeout",
});

/** 事后谓词：elapsed >= budget 判超（与 bench classifyLatency 的 g3_timeout 同口径）。 */
function budgetExceeded(startedAt: number, budgetMs: number): boolean {
  return performance.now() - startedAt >= budgetMs;
}

/** 非 stream checker 预算包裹：超时改写 result（evidence 丢弃），未超时原样返回。 */
export function runWithBudget(fn: NonStreamChecker, unit: ScanUnit, budgetMs: number): CheckerResult {
  const startedAt = performance.now();
  const result = fn(unit);
  return budgetExceeded(startedAt, budgetMs) ? CHECKER_TIMEOUT_RESULT : result;
}

/**
 * stream checker 预算包裹：超时只改写 result 位，回传窗口原样透传（AC-V2a-27④——
 * 改写不吞窗口，网关重组点照常单点推进与保留 extra）。
 */
export function runStreamWithBudget(
  fn: StreamChecker,
  window: ScanWindow,
  unit: ScanUnit,
  budgetMs: number,
): readonly [CheckerResult, ScanWindow] {
  const startedAt = performance.now();
  const [result, returned] = fn(window, unit);
  return budgetExceeded(startedAt, budgetMs) ? [CHECKER_TIMEOUT_RESULT, returned] : [result, returned];
}
