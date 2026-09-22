/**
 * @test REQ-VETO-013
 * @intent 三个 runner 控制台输出的**解析契约唯一来源**（`record-baseline.ts` 与 `check-regression.ts`
 *         双侧共用，收口 R8-B-M3 的"两侧解析器平行漂移"面）。契约要点：
 *   - **行首锚定**（R6-B4）：档位号在正则里是子串（如 `"8KB"` 会命中 `"128KB"` 行），锚定后与档位一一对应；
 *   - **捕获组顺序恒为 p50/p95/p99**：判定取哪一组由调用方决定（相对门取第 1 组 p50，见 docs/adr/0002 补遗三；
 *     record 侧取三组逐分位取最小）；
 *   - **位数与各 runner 的 `toFixed` 绑定**：G1 三位小数（`g1-ttft.ts`）、G2/G3 两位小数（`g2-request-gate.ts` /
 *     `g3-checker-timeout.ts`）；G3 行内数值无 `ms` 后缀（取 `(g3=…)` 前缀前的裸数）；
 *   - 正则**不是数值校验**：`[\d.]+` 可匹配出 `1.2.3` 型 NaN——数值合法性由调用侧的有限数守卫 fail-loud
 *     （check 侧 `finite()`；record 侧 `Number(m[i])` 后由 `minOf` 语义与下游门守卫兜住）。
 */

/** G1 单行：`G1 TTFT delta → p50=X.XXXms p95=X.XXXms p99=X.XXXms PASS|FAIL(…)`。 */
export const G1_LINE_RE = /^G1 TTFT delta → p50=([\d.]+)ms p95=([\d.]+)ms p99=([\d.]+)ms/m;

/** G2 单档单行：`G2 {tierKb}KB → p50=X.XXms p95=X.XXms p99=X.XXms PASS|FAIL(…)`。 */
export function g2LineRe(tierKb: number): RegExp {
  return new RegExp(`^G2 ${tierKb}KB → p50=([\\d.]+)ms p95=([\\d.]+)ms p99=([\\d.]+)ms`, "m");
}

/** G3 单 checker 单档单行：`G3 {checker} {tierKb}KB → p50=X.XX p95=X.XX p99=X.XX (g3=Nms) TAG`。 */
export function g3LineRe(checker: string, tierKb: number): RegExp {
  return new RegExp(`^G3 ${checker} ${tierKb}KB → p50=([\\d.]+) p95=([\\d.]+) p99=([\\d.]+)`, "m");
}
