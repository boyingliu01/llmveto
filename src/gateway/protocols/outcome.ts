// @no-test-required: 测试在 tests/integration/protocol-outcome.test.ts（本项目测试布局为 tests/ 目录；Gate 5a 仅识别同目录/根 tests/ 六种路径）
import { coverageReason, coverageVerdict, presentPaths } from "./coverage.ts";
import { egressSecretScan } from "../../checkers/egress-secret-scan.ts";
import { protocolFor, recognize } from "./registry.ts";
import type { CoverageReason, Direction, RecognizedFormat, WireFormat, WireProtocol } from "./types.ts";

type ShapeReason = CoverageReason;

/**
 * @test REQ-V2bA-14 / REQ-V2bA-15 / REQ-V2bA-15a
 * @intent 两轴处置：轴1 识别（known / unknown）× 轴2 覆盖（full / partial / vacuous）。
 *
 * 为什么分两轴（R2 评审 C2）：上一版把"识别结果"与"覆盖结果"揉成一张四态表，
 * 结果 `known_but_empty` 不可达、`shape_partial_coverage` 与它重叠、
 * "零文本但部分未覆盖"落进四态之外。两轴相乘后同一条请求只有一个格。
 *
 * 判据是**投影器有没有覆盖已知载荷字段**，不是"文本是不是空的"——
 * 这条区分让"纯工具调用"（tool_result 本身就是内容字段）正常放行，
 * 同时让"凭据藏在未投影字段"必然落 partial。
 */

/** 一次判定的结果：需要阻断时给出 reason，否则 reason 为 null。 */
export interface ShapeVerdict {
  readonly format: WireFormat | null;
  /** 覆盖降级的原因（**无论受管与否都要写**）：不写就等于把降级藏起来。 */
  readonly reason: CoverageReason | null;
  /** 是否因此阻断。受管路由恒等于 `reason !== null`；非受管路由恒为 false。 */
  readonly block: boolean;
}

const NOTHING: ShapeVerdict = Object.freeze({ format: null, reason: null, block: false });

/**
 * 判定一个已解析 body 的形状。
 *
 * @param direction 请求或响应
 * @param parsed 已解析 JSON；不可解析传 null（不可解析的 body 由调用方按既有 malformed 路径处理）
 * @param routePrefix 路由前缀（受管前缀即权威）
 * @param consoleManaged 该路由是否受管（受管才 fail-closed；非受管只记录）
 */
export function shapeVerdict(
  direction: Direction,
  parsed: unknown,
  routePrefix: string | null | undefined,
  consoleManaged: boolean,
): ShapeVerdict {
  const body = asBody(parsed);
  if (body === null) return NOTHING;
  const recognized = recognize(direction, body, routePrefix);
  if (isUnrecognizable(direction, body, recognized)) return unrecognized(recognized, consoleManaged);
  return recognized.kind === "known" ? judged(recognized.format, direction, body, consoleManaged) : NOTHING;
}

/**
 * "认不出"的结论。
 *
 * reason **总是**给出（受管与否都一样）：REQ-15 要求"非受管路由同样写 reason，但不阻断"。
 * 只把阻断与记录分开，不把两者绑在一起——否则非受管路径上的覆盖降级在 evidence 里完全不可见，
 * 那正是本项目要消灭的形态。
 */
function unrecognized(recognized: RecognizedFormat, consoleManaged: boolean): ShapeVerdict {
  const format = recognized.kind === "known" ? recognized.format : null;
  return { format, reason: "shape_unrecognized", block: consoleManaged };
}

/** 已解析 body 的对象视图；不是对象（null / 数组 / 标量）返回 null。 */
function asBody(parsed: unknown): Record<string, unknown> | null {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

/** 识别成功后的处置：有投影器 → 覆盖轴；无投影器 → 覆盖缺失。 */
function judged(format: WireFormat, direction: Direction, body: Record<string, unknown>, consoleManaged: boolean): ShapeVerdict {
  const proto = protocolFor(format);
  // 已识别但本网关没有该格式的投影器：与"认不出来"同属覆盖缺失（原因不同，处置相同）。
  const reason = proto === undefined ? "shape_unrecognized" : coverageShape(direction, body, proto);
  return { format, reason, block: consoleManaged && reason !== null };
}

/** 是否需要判为"认不出"：识别失败，或请求体是个认不出的壳。 */
function isUnrecognizable(direction: Direction, body: Record<string, unknown>, recognized: RecognizedFormat): boolean {
  if (recognized.kind === "unknown") return true;
  return direction === "request" && isUnrecognizableShell(body);
}

/** 覆盖轴：由 present 与投影器上报的 handled 求差集。 */
function coverageShape(direction: Direction, body: Record<string, unknown>, proto: WireProtocol): ShapeReason | null {
  const present = presentFor(direction, body, proto);
  const projection = projectionFor(direction, body, proto);
  const coverage = coverageReason(present, projection.handled);
  // 兜底**必须先于**豁免判定（R3 C1）：豁免的判据是"present 为空或容器为空"，
  // 而"凭据藏在未登记字段、恰好没有任何载荷字段"正是 present 为空的情形——
  // 把兜底放在豁免之后就等于给它留了一道门。
  if (unseenSecret(body, projection.parts.join("\n"))) {
    return "shape_partial_coverage";
  }
  return reasonFor(direction, body, present, coverage);
}

/**
 * 协议已知，但 body 里**有凭据形状的内容没被任何投影器看过**。
 *
 * 为什么不是"逐字符串比对扫描文本"（第 3/4 轮的写法，都失败了）：
 *   - 第 3 轮按裸键名豁免 `id`，凭据藏在 `id` 下就看不见；
 *   - 第 4 轮按值形态判（短标识符 / URL / base64），于是 `url` 键下的、
 *     大写开头的、35 字符无空白的凭据又都漏了。
 * 每加一条豁免就多一个绕过面——**判据本身成了攻击面**。
 *
 * 现在的做法把顺序倒过来：不管 body 长什么样，**先用既有凭据扫描器扫原始 body 的 JSON 文本**，
 * 扫到的每一处都必须能在投影文本里找到。找不到 = 这个凭据没有人看过 = 覆盖不足。
 * 判据就是扫描器自己的规则集，与真正拦截时用的是同一套，不需要猜"哪些字符串像载荷"。
 */
function unseenSecret(body: Record<string, unknown>, scannedText: string): boolean {
  const raw = JSON.stringify(body);
  const scan = egressSecretScan({ direction: "request", transport: "non-stream", text: raw, meta: {} });
  if (scan.verdict !== "finding") return false;
  for (const finding of scan.evidence) {
    const start = finding.offsets?.[0];
    if (start === undefined) return true; // 有命中但拿不到位置：按"没看过"处理
    const token = /^[^\s"',}\]]+/.exec(raw.slice(start));
    const hit = token === null ? "" : token[0];
    if (hit.length > 0 && !scannedText.includes(hit)) return true;
  }
  return false;
}

/**
 * 把"覆盖结论"落到四种情形上（顺序即优先级）：
 *
 * 1. **没有消息容器**（只有 `model` 之类元数据）→ 合法空请求，放行。
 *    注入逻辑本来就把它当"无 user message → inject_skipped"，形状判定没有理由更严。
 * 2. **容器是空的**（`messages: []`）→ 合法空请求（健康探针、空会话续写），放行。
 * 3. **容器有元素但一个已知载荷字段都没有**（`messages: [{role:"user"}]`）→ 也是合法空请求；
 *    canary 注入的"分支 4"正是这种形态，判得比注入更严会把它误杀。
 * 4. 其余 → 按覆盖结论：`full` 不写 reason；`partial` / `vacuous` 写对应码并阻断。
 *
 * 第 3 条是刻意的取舍：它让"攻击者发一个空壳 body"不被判为覆盖缺口。
 * 代价是"容器在、字段名却全都不认识"这种情况不会单独报码——那属于协议扩面的
 * 长期工作（REQ-V2bA-15a 的 partial 守卫覆盖了"已知字段未投影"那一半），
 * 而不是靠形状判定硬猜。
 */
function reasonFor(
  direction: Direction,
  body: Record<string, unknown>,
  present: readonly string[],
  coverage: "shape_known_empty" | "shape_partial_coverage" | null,
): ShapeReason | null {
  if (direction !== "request") return coverage;
  const excused = !hasAnyElement(direction, body) || present.length === 0;
  return excused ? null : coverage;
}

/**
 * 请求体是否是"认不出的壳"：既没有消息容器，正文本身也归类不了。
 *
 * 判据必须同时看两件事——
 *   - `{model:"m"}`（无容器、但正文可归为 chat/空请求）→ **不是**壳，放行；
 *   - `{totally:"x", model:"m"}`（无容器、正文也认不出）→ 是壳，阻断。
 * 只看前者会把合法空请求打死；只看后者会让任意陌生 body 借权威前缀蒙混过关。
 */
function isUnrecognizableShell(body: Record<string, unknown>): boolean {
  const hasContainer = hasMessageContainer(body.messages) || hasMessageContainer(body.input) || body.input !== undefined;
  if (hasContainer) return false;
  // 只有元数据、没有任何协议特征键：这是"空请求"，不是"壳"。
  // 与注入逻辑的"无 user message → inject_skipped"同口径——形状判定不得比它更严。
  if (!hasAnyProtocolSignal(body)) return false;
  return recognize("request", body, null).kind === "unknown";
}

/** 正文里是否出现任何一种协议特征键（出现才谈得上"试图冒充某种格式"）。 */
function hasAnyProtocolSignal(body: Record<string, unknown>): boolean {
  const signals = ["input", "output", "instructions", "system", "tools", "tool_choice", "choices", "content"];
  return signals.some((k) => body[k] !== undefined) || typeof body.type === "string";
}

/** 可读容器里是否至少有一个实际元素（空容器 = 合法空请求）。 */
function hasAnyElement(direction: Direction, body: Record<string, unknown>): boolean {
  const containers = direction === "response" ? [body.choices, body.output, body.content] : [body.messages, body.input];
  return containers.some((c) => Array.isArray(c) ? c.length > 0 : typeof c === "string");
}

/**
 * 消息容器**存在**（数组即可，空数组也算）。
 *
 * 空数组是"合法空请求"（健康探针、空会话续写），不是"认不出"——
 * 两者处置相同（受管路由 fail-closed），但判成"认不出"会让运维噪声与协议缺口混在一起。
 */
function hasMessageContainer(value: unknown): boolean {
  return Array.isArray(value);
}

/** 仅用于测试与审计：暴露某 body 的覆盖结论（不含 fail-closed 决策）。 */
export function coverageOf(direction: Direction, parsed: unknown): "full" | "partial" | "vacuous" | "unknown" {
  const body = asBody(parsed);
  if (body === null) return "unknown";
  const recognized = recognize(direction, body, null);
  const proto = recognized.kind === "unknown" ? undefined : protocolFor(recognized.format);
  if (proto === undefined) return "unknown";
  return coverageVerdict(presentFor(direction, body, proto), projectionFor(direction, body, proto).handled);
}

/** 某方向下 body 实际存在的已知载荷路径。 */
function presentFor(direction: Direction, body: Record<string, unknown>, proto: WireProtocol): readonly string[] {
  return presentPaths(direction === "request" ? proto.coverage.requestPayloadPaths : proto.coverage.responsePayloadPaths, body);
}

/** 某方向下协议投影器的产物。 */
function projectionFor(direction: Direction, body: Record<string, unknown>, proto: WireProtocol) {
  return direction === "request" ? proto.projectRequest(body) : proto.projectResponse(body, null);
}
