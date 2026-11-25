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

/**
 * 只表示"消息容器"的路径：它们存在不等于载荷存在。
 *
 * - `input`：Responses 的输入容器。数组非空但元素里没有已知载荷字段（例如只有
 *   `{type:"message"}`）时，容器"存在"而内容"不可见"——这必须落 vacuous 而不是 full，
 *   否则"协议已知但什么都没扫到"会被判成已覆盖，正是本判据要消灭的假阴性。
 *   （`input` 为字符串时它就是载荷，另行处理，见 `hasPath` 的标量分支。）
 * - `messages` / `output` / `content` 是**载荷字段的父路径**（`messages[].content` 才承载文本），
 *   同样不单独算载荷。
 */
const CONTAINER_PATHS: ReadonlySet<string> = new Set(["input", "messages", "output", "content"]);

/**
 * 路径段：`messages[].content[].tool_use.input` → ["messages", "content", "tool_use", "input"]。
 *
 * 注意 `tool_use` 这类**块类型**也是路径段：Anthropic 的载荷挂在"类型为 tool_use 的块"下面，
 * 路径必须能表达"数组元素里 type === tool_use 的那一项"。把块类型当成普通的键去查会永远查不到，
 * 于是清单里声明的路径永远不算 present——覆盖判据就退化成只看顶层容器。
 */
/** 带数组标记的结果：`messages[].content[].tool_use.input` → [
 *  {key:"messages", array:true}, {key:"content", array:true}, {key:"tool_use"}, {key:"input"} ]。
 *  `[]` 必须保留下来——否则 `content[]` 之后的段会当成在对象上找键，而不是在数组元素里找。 */
export interface PathSegment {
  readonly key: string;
  readonly array: boolean;
}

function splitPathSegments(path: string): PathSegment[] {
  return path
    .split(".")
    .map((raw) => ({ key: raw.replace(/\[\]$/, ""), array: raw.endsWith("[]") }))
    .filter((seg) => seg.key.length > 0);
}

/**
 * 逐段下钻。
 *
 * 两条规则是这里唯一容易写错、也必须写对的地方（都在本 sprint 的实测里踩过）：
 *   ① 段带 `[]` 表示"在数组的每个元素上继续"——**不能**把它当成在对象上找同名键；
 *   ② 若下一段是**块类型**（`tool_use` 等），只有 `type` 相符的元素才算，
 *      且块类型段在本层被消费掉（否则 `tool_use` 会被当成一个普通键去查找，永远找不到）。
 */
function hasPath(value: unknown, segs: readonly PathSegment[]): boolean {
  if (segs.length === 0) return value !== undefined;

  // 数组上下文：当前值是一个数组，逐元素在**同一层**继续（不消费段）。
  // 唯一的例外是"本段是块类型"——它描述数组元素的种类，命中后消费该段。
  if (Array.isArray(value)) {
    const head = segs[0]!;
    if (isBlockType(head.key)) {
      return value.some((item) => isBlockOfType(item, head.key) && hasPath(item, segs.slice(1)));
    }
    return value.some((item) => hasPath(item, segs));
  }

  if (!value || typeof value !== "object") return false;
  const [head, ...rest] = segs as [PathSegment, ...PathSegment[]];
  const child = (value as Record<string, unknown>)[head.key];

  // `key[]`：取到数组后，数组元素按**剩余段**继续。
  // 元素若本身是块（`{type:"tool_use",...}`），由下一层的"块类型段"分支处理；
  // 若元素是普通对象（如 message），直接按剩余段取键——两个分支都在数组上下文里完成。
  if (head.array) {
    if (!Array.isArray(child)) return false;
    return child.some((item) => (isBlockOfType(item, rest[0]?.key ?? "") ? hasPath(item, rest.slice(1)) : hasPath(item, rest)));
  }
  return hasPath(child, rest);
}

/** Anthropic content 块的类型名集合（这些词在路径里表示"该 type 的块"，不是普通键）。 */
const BLOCK_TYPES: ReadonlySet<string> = new Set(["tool_use", "tool_result", "text", "thinking", "image"]);

function isBlockType(seg: string): boolean {
  return BLOCK_TYPES.has(seg);
}

/** 该元素是否是给定类型的块。 */
function isBlockOfType(item: unknown, type: string): boolean {
  return typeof item === "object" && item !== null && (item as Record<string, unknown>).type === type;
}

/**
 * 在原始 body 上求出实际存在的已知载荷路径。
 * @param specPaths 协议 `CoverageSpec` 里的路径清单
 * @param body 已解析的原始 JSON
 */
export function presentPaths(specPaths: readonly string[], body: unknown): readonly string[] {
  if (!body || typeof body !== "object") return [];
  return specPaths.filter((path) => isPayloadPresent(path, body));
}

/**
 * 某条载荷路径是否真的承载了内容。
 *
 * 容器路径额外要求"数组里至少有一个元素"，且**不**因为数组非空就成立——
 * 判定交给调用方通过 `input[].xxx` 这类子路径表达；单列 `input` 只在
 * 它是字符串（Responses 允许 `input: "..."`）时算载荷。
 */
function isPayloadPresent(path: string, body: unknown): boolean {
  if (!CONTAINER_PATHS.has(path)) return hasPath(body, splitPathSegments(path));
  const value = (body as Record<string, unknown>)[path];
  if (value === undefined) return false;
  // 字符串形态的 input 就是载荷本身
  return typeof value === "string";
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
