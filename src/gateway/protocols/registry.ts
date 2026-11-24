// @no-test-required: 测试在 tests/unit/gateway/protocols/registry.test.ts（含"跨格式相似性"三条回归）（本项目测试布局为 tests/ 目录；Gate 5a 仅识别同目录/根 tests/ 六种路径）
import type { Direction, RecognizedFormat, WireFormat, WireProtocol } from "./types.ts";
import { chatProtocol } from "./chat.ts";

/**
 * @test REQ-V2bA-03 / REQ-V2bA-04 / REQ-V2bA-10
 * @intent 协议注册表与"路由权威"识别。
 *
 * 路由权威的理由（R2 评审 C1，实测）：Claude 的"无 system + 纯文本"请求与 Chat 请求
 * **在结构上完全相同**，任何纯内容识别都必然二选一或判歧义。判歧义在 fail-closed 下
 * 会阻断目标客户端自己的全部流量。所以：
 *
 *   ① 已知前缀（WIRE_ROUTE_PREFIXES）→ 直接决定线格式，不投票；
 *   ② 无权威前缀时才看正文，且用**互斥**判别键，最后落 chat（倾向已支持格式而非判未知）；
 *   ③ 两者都不命中 → unknown（只可能是真正无法归类的 body）。
 *
 * 识别是**纯数据分类，不抛异常**（设计 D3a）：坏输入返回 unknown，而不是让异常冒泡成
 * "checker error → block" 那条无度量的失败路径。
 */

/** 路由前缀 → 线格式。前缀是**第一段**路径（`<gw>/<prefix>/<provider>/...`）。 */
export const WIRE_ROUTE_PREFIXES: ReadonlyMap<string, WireFormat> = Object.freeze(
  new Map<string, WireFormat>([
    ["claude", "anthropic-messages"],
    ["codex", "openai-responses"],
    ["promptfoo", "chat"],
    ["opencode", "chat"],
    ["delphi", "chat"],
    ["dsh", "chat"],
  ]),
);

const PROTOCOLS: ReadonlyMap<WireFormat, WireProtocol> = new Map<WireFormat, WireProtocol>([["chat", chatProtocol]]);

/** 已注册的协议（未注册的格式不会出现在 WIRE_ROUTE_PREFIXES 的可达集里）。 */
export function protocolFor(format: WireFormat): WireProtocol | undefined {
  return PROTOCOLS.get(format);
}

/** 前缀 → 线格式；未知前缀返回 undefined（= 没有权威）。 */
export function formatForPrefix(prefix: string | null | undefined): WireFormat | undefined {
  if (!prefix) return undefined;
  return WIRE_ROUTE_PREFIXES.get(prefix);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Responses 的特征键：出现任一个即足以归类（与 messages 不冲突，因为 Claude 不带这些键）。 */
function looksLikeResponses(parsed: Record<string, unknown>, direction: Direction): boolean {
  if (direction === "response") return parsed.object === "response" || Array.isArray(parsed.output);
  return parsed.input !== undefined || parsed.output !== undefined || parsed.instructions !== undefined;
}

/** Anthropic 响应/帧特征：帧类型前缀集合。 */
const ANTHROPIC_FRAME_PREFIXES = ["content_block", "message_start", "message_delta"] as const;

function frameTypeOf(parsed: Record<string, unknown>): string {
  return typeof parsed.type === "string" ? parsed.type : "";
}

function looksLikeAnthropicResponse(parsed: Record<string, unknown>): boolean {
  const t = frameTypeOf(parsed);
  if (t === "message" && Array.isArray(parsed.content)) return true;
  return ANTHROPIC_FRAME_PREFIXES.some((prefix) => t.startsWith(prefix));
}

/** 请求侧流式帧：带自己 type、且既不是 chat 体也不是 responses 帧。 */
function looksLikeAnthropicFrame(parsed: Record<string, unknown>): boolean {
  const t = frameTypeOf(parsed);
  const isFrame = t.length > 0 && parsed.choices === undefined && parsed.messages === undefined;
  if (!isFrame || t.startsWith("response.")) return false;
  return ANTHROPIC_FRAME_PREFIXES.some((prefix) => t.startsWith(prefix));
}

/** 消息里是否有 tool_use / tool_result 块（Anthropic 独有的块类型）。 */
function hasAnthropicToolBlocks(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false;
  const isToolBlock = (seg: unknown): boolean => isObject(seg) && (seg.type === "tool_use" || seg.type === "tool_result");
  return messages.some((m: unknown) => isObject(m) && Array.isArray(m.content) && m.content.some(isToolBlock));
}

function looksLikeAnthropicRequest(parsed: Record<string, unknown>): boolean {
  if (looksLikeAnthropicFrame(parsed)) return true;
  return Array.isArray(parsed.system) || hasAnthropicToolBlocks(parsed.messages);
}

/** Anthropic 特征：块数组 system、tool_use/tool_result 块，或 Anthropic 帧类型。 */
function looksLikeAnthropic(parsed: Record<string, unknown>, direction: Direction): boolean {
  return direction === "response" ? looksLikeAnthropicResponse(parsed) : looksLikeAnthropicRequest(parsed);
}

/** 是否有"看起来像 chat"的迹象（判别键用完之后的兜底）。 */
function looksLikeChatLike(parsed: Record<string, unknown>, direction: Direction): boolean {
  if (direction === "response") {
    const t = typeof parsed.type === "string" ? parsed.type : "";
    if (t.startsWith("response.")) return false;
    return Array.isArray(parsed.choices);
  }
  return Array.isArray(parsed.messages);
}

/**
 * 识别线格式。
 * @param direction 请求或响应
 * @param parsed 已解析的 JSON（不可解析时传 null）
 * @param routePrefix 路由前缀（`<gw>/<prefix>/...` 的第一段）；无权威时传 null/undefined
 */
function recognizeResponse(body: Record<string, unknown>): RecognizedFormat {
  if (frameTypeOf(body).startsWith("response.")) return { kind: "known", format: "openai-responses" };
  return recognizeBody(body, "response");
}

function recognizeBody(body: Record<string, unknown>, direction: Direction): RecognizedFormat {
  if (looksLikeResponses(body, direction)) return { kind: "known", format: "openai-responses" };
  if (looksLikeAnthropic(body, direction)) return { kind: "known", format: "anthropic-messages" };
  if (looksLikeChatLike(body, direction)) return { kind: "known", format: "chat" };
  return { kind: "unknown" };
}

/**
 * 识别线格式。
 * @param direction 请求或响应
 * @param parsed 已解析的 JSON（不可解析时传 null）
 * @param routePrefix 路由前缀（`<gw>/<prefix>/...` 的第一段）；无权威时传 null/undefined
 */
export function recognize(direction: Direction, parsed: unknown, routePrefix?: string | null): RecognizedFormat {
  const authoritative = formatForPrefix(routePrefix);
  if (authoritative) return { kind: "known", format: authoritative };
  if (!isObject(parsed)) return { kind: "unknown" };
  return direction === "response" ? recognizeResponse(parsed) : recognizeBody(parsed, "request");
}

/** `parseRoute` 用：给定首段路径返回与之绑定的线格式（未绑定时 undefined）。 */
export function boundFormatForPath(firstSegment: string | null): WireFormat | undefined {
  return formatForPrefix(firstSegment);
}

/** 供测试与文档列出全部已绑定前缀。 */
export function wireRoutePrefixes(): readonly string[] {
  return [...WIRE_ROUTE_PREFIXES.keys()];
}
