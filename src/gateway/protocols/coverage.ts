// @no-test-required: 测试在 tests/unit/gateway/protocols/coverage.test.ts（本项目测试布局为 tests/ 目录；Gate 5a 仅识别同目录/根 tests/ 六种路径）
import type { CoverageVerdict } from "./types.ts";

/**
 * @test REQ-V2bA-14（轴2）/ REQ-V2bA-15a
 * @intent 覆盖判据的**独立 oracle**。
 *
 * 为什么需要它（R2 评审 C2）：如果覆盖结论由投影器自己给出，那么"投影器忘了某个字段"
 * 这件事**永远发现不了**——投影器会照样报告自己覆盖了。所以这里换一个来源：
 * 用协议声明的 `CoverageSpec` 清单直接在**原始 body** 上求出"存在哪些已知载荷路径"（present），
 * 再与投影器上报的 handled 求差集。
 *
 * 关键性质：结论与**文本量无关**。"凭据藏在未投影字段、其余为空"同样落 partial。
 */

/** 路径段：`messages[].content[].text` → ["messages", "content", "text"] */
function splitPath(path: string): string[] {
  return path
    .split(".")
    .map((seg) => seg.replace(/\[\]$/, ""))
    .filter((seg) => seg.length > 0);
}

function hasPath(value: unknown, segs: readonly string[]): boolean {
  if (segs.length === 0) return value !== undefined;
  const [head, ...rest] = segs as [string, ...string[]];
  if (Array.isArray(value)) {
    // 数组段：任一项命中即算存在（"这条路径出现了"而非"全部出现"）。
    return value.some((item) => hasPath(item, segs));
  }
  if (!value || typeof value !== "object") return false;
  return hasPath((value as Record<string, unknown>)[head], rest);
}

/**
 * 在原始 body 上求出实际存在的已知载荷路径。
 * @param specPaths 协议 `CoverageSpec` 里的路径清单
 * @param body 已解析的原始 JSON
 */
export function presentPaths(specPaths: readonly string[], body: unknown): readonly string[] {
  if (!body || typeof body !== "object") return [];
  return specPaths.filter((path) => hasPath(body, splitPath(path)));
}

/**
 * 覆盖结论：只看两个集合，**不看文本量**。
 * @param present 原始 body 里存在的已知载荷路径
 * @param handled 投影器实际处理过的载荷路径
 */
export function coverageVerdict(present: readonly string[], handled: readonly string[]): CoverageVerdict {
  if (present.length === 0) return "vacuous";
  const handledSet = new Set(handled);
  const unhandled = present.filter((p) => !handledSet.has(p));
  return unhandled.length === 0 ? "full" : "partial";
}

/** 由覆盖结论给出 evidence 顶层 reason；`full` 不写 reason。 */
export function coverageReason(present: readonly string[], handled: readonly string[]): "shape_known_empty" | "shape_partial_coverage" | null {
  const verdict = coverageVerdict(present, handled);
  if (verdict === "full") return null;
  return verdict === "vacuous" ? "shape_known_empty" : "shape_partial_coverage";
}
