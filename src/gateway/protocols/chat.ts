// @no-test-required: 测试在 tests/unit/gateway/protocols/chat.test.ts（含 Chat 对照快照：既有投影逐字节不变）（本项目测试布局为 tests/ 目录；Gate 5a 仅识别同目录/根 tests/ 六种路径）
import type { CoverageSpec, Projection, WireProtocol } from "./types.ts";
import { isAuthHeader } from "../scan-unit.ts";

/**
 * @test REQ-V2bA-04 / AC-V2bA-04a / AC-V2bA-05a
 * @intent Chat Completions 协议（既有能力的显式化）。
 *
 * 本文件与 `scan-unit.ts` 的既有投影**必须逐字节等价**——SL-01 用 chat-baseline.test.ts
 * 把这条等价关系钉死。它不是"新能力"，而是把既有能力接进注册表，
 * 让另外两种线格式有一个可对齐的参照物。
 *
 * 派生标记：`function_call.arguments` / `tool_calls[].function.arguments` 若以**对象**形态出现，
 * 会被 JSON.stringify 成文本（原文里没有这段字节）→ derived。字符串形态不派生。
 */

function pushArguments(args: unknown, out: string[]): "derived" | "verbatim" | "none" {
  if (typeof args === "string") {
    out.push(args);
    return "verbatim";
  }
  if (args && typeof args === "object") {
    out.push(JSON.stringify(args));
    return "derived";
  }
  return "none";
}

/** content 投影：字符串直取；分段数组取 seg.text（与 scan-unit.pushContentParts 一致）。 */
function pushContent(content: unknown, out: string[]): void {
  if (typeof content === "string") {
    out.push(content);
    return;
  }
  if (!Array.isArray(content)) return;
  for (const seg of content) out.push(...textOfSegment(seg));
}

/** 分段数组的一项 → 其 text（非对象 / 无 text 字段则为空）。 */
function textOfSegment(seg: unknown): string[] {
  if (!seg || typeof seg !== "object" || !("text" in seg)) return [];
  return [String((seg as { text: unknown }).text)];
}

/** function 包裹形态（tool_calls[*].function）；无包裹返回 null。 */
function fnOf(tc: Record<string, unknown>): Record<string, unknown> | null {
  const fn = tc.function;
  return fn && typeof fn === "object" ? (fn as Record<string, unknown>) : null;
}

/** pushArguments 的三值结果 → 本函数的二值契约。 */
function derivedOf(result: "derived" | "verbatim" | "none"): "derived" | "none" {
  if (result === "derived") return "derived";
  return "none";
}

/** 工具调用的"载荷源"：有 function 包裹取包裹，扁平形态取工具自身。 */
function payloadOf(t: Record<string, unknown>): Record<string, unknown> {
  return fnOf(t) ?? t;
}

/** 扁平形态的名字挂在工具自身；包裹形态的名字由 payload.name 提供。 */
function pushToolNames(t: Record<string, unknown>, payload: Record<string, unknown>, out: string[]): void {
  if (typeof t.name === "string") out.push(t.name);
  if (payload !== t && typeof payload.name === "string") out.push(payload.name);
}

function collectToolCall(tc: unknown, out: string[]): "derived" | "none" {
  if (!tc || typeof tc !== "object") return "none";
  const t = tc as Record<string, unknown>;
  const payload = payloadOf(t);
  pushToolNames(t, payload, out);
  return derivedOf(pushArguments(payload.arguments, out));
}

/** 一个 message/delta 盒子里所有工具调用载荷的投影。 */
function collectToolCalls(b: Record<string, unknown>, out: string[]): boolean {
  let derived = false;
  if (Array.isArray(b.tool_calls)) {
    for (const tc of b.tool_calls) if (collectToolCall(tc, out) === "derived") derived = true;
  }
  if (collectToolCall(b.function_call, out) === "derived") derived = true;
  return derived;
}

function collectMessageBox(box: unknown, out: string[]): "derived" | "none" {
  if (!box || typeof box !== "object") return "none";
  const b = box as Record<string, unknown>;
  pushContent(b.content, out);
  const derived = collectToolCalls(b, out);
  if (typeof b.reasoning_content === "string") out.push(b.reasoning_content);
  return derived ? "derived" : "none";
}

/** 请求侧单条消息：投影文本 + 登记 handled（containers / tool_calls / function_call）。 */
/** 请求侧 message 的 handled 路径（与 collectMessageBox 的可见面一一对应）。 */
const REQUEST_MESSAGE_HANDLED: ReadonlyMap<string, string> = Object.freeze(
  new Map([
    ["content", "messages[].content"],
    ["tool_calls", "messages[].tool_calls[].function.arguments"],
    ["function_call", "messages[].function_call.arguments"],
  ]),
);

function projectRequestMessage(m: unknown, parts: string[], handled: Set<string>): boolean {
  if (!m || typeof m !== "object") return false;
  const mm = m as Record<string, unknown>;
  for (const [key, path] of REQUEST_MESSAGE_HANDLED) if (mm[key] !== undefined) handled.add(path);
  return collectMessageBox(mm, parts) === "derived";
}

/** extra_headers：非认证头进投影（AC-VETO-002-06）；认证头一律排除。 */
function projectExtraHeaders(extra: unknown, parts: string[]): boolean {
  if (!extra || typeof extra !== "object") return false;
  for (const [k, v] of Object.entries(extra as Record<string, unknown>)) {
    if (isAuthHeader(k)) continue;
    parts.push(`${k}: ${String(v)}`);
  }
  return true;
}

function projectRequest(parsed: Record<string, unknown>): Projection {
  const parts: string[] = [];
  const handled = new Set<string>();
  let derived = false;
  if (Array.isArray(parsed.messages)) {
    derived = projectMessages(parsed.messages, parts, handled);
  }
  if (typeof parsed.system === "string") {
    parts.push(parsed.system);
    handled.add("system");
  }
  if (Array.isArray(parsed.tools)) {
    parts.push(JSON.stringify(parsed.tools));
    handled.add("tools");
    derived = true; // tools 历来以 JSON 文本入投影
  }
  if (projectExtraHeaders(parsed.extra_headers, parts)) handled.add("extra_headers");
  return { parts, derived, handled: [...handled], present: [] };
}

function projectMessages(msgs: readonly unknown[], parts: string[], handled: Set<string>): boolean {
  let derived = false;
  for (const m of msgs) derived = projectRequestMessage(m, parts, handled) || derived;
  return derived;
}

/** 响应侧一个 choice 的 message/delta 盒子：投影 + 登记 handled。 */
/** 响应侧盒子的 handled 路径后缀（与 collectMessageBox 的可见面一一对应）。 */
const RESPONSE_BOX_HANDLED: readonly string[] = Object.freeze(["content", "tool_calls", "function_call", "reasoning_content"]);

function projectOneBox(key: "message" | "delta", box: unknown, parts: string[], handled: Set<string>): boolean {
  if (!box || typeof box !== "object") return false;
  const b = box as Record<string, unknown>;
  for (const field of RESPONSE_BOX_HANDLED) if (b[field] !== undefined) handled.add(`choices[].${key}.${field}`);
  return collectMessageBox(b, parts) === "derived";
}

function projectResponseChoice(c: unknown, parts: string[], handled: Set<string>): boolean {
  if (!c || typeof c !== "object") return false;
  const c0 = c as Record<string, unknown>;
  const d1 = projectOneBox("message", c0.message, parts, handled);
  const d2 = projectOneBox("delta", c0.delta, parts, handled);
  return d1 || d2;
}

function projectResponse(parsed: Record<string, unknown>, _requestedModel: string | null): Projection {
  const parts: string[] = [];
  const handled = new Set<string>();
  let derived = false;
  if (Array.isArray(parsed.choices)) {
    for (const c of parsed.choices) derived = projectResponseChoice(c, parts, handled) || derived;
  }
  return { parts, derived, handled: [...handled], present: [] };
}

export const CHAT_COVERAGE: CoverageSpec = Object.freeze({
  requestPayloadPaths: Object.freeze([
    "messages[].content",
    "messages[].tool_calls[].function.arguments",
    "messages[].function_call.arguments",
    "system",
    "tools",
  ]) as readonly string[],
  responsePayloadPaths: Object.freeze([
    "choices[].message.content",
    "choices[].message.tool_calls[].function.arguments",
    "choices[].message.function_call.arguments",
    "choices[].message.reasoning_content",
    "choices[].delta.content",
    "choices[].delta.tool_calls[].function.arguments",
  ]) as readonly string[],
});

export const chatProtocol: WireProtocol = Object.freeze({
  format: "chat" as const,
  coverage: CHAT_COVERAGE,
  projectRequest,
  projectResponse,
  projectFrame(parsed: Record<string, unknown>): Projection {
    return projectResponse(parsed, null);
  },
  canaryInjection: true,
});
