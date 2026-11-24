// @no-test-required: 测试在 tests/unit/gateway/protocols/anthropic.test.ts（本项目测试布局为 tests/ 目录；Gate 5a 仅识别同目录/根 tests/ 六种路径）
import type { CoverageSpec, Projection, WireProtocol } from "./types.ts";

/**
 * @test REQ-V2bA-02 / AC-V2bA-02a~c
 * @intent Anthropic Messages 协议投影（Claude Code 的线格式）。
 *
 * 改动前的三个盲区（实测，见 var/probes/scan-unit-probe.mjs）：
 *   ① `system` 是**块数组**（带 cache_control）而不是字符串 → 整段系统提示不可见；
 *   ② `tool_use.input` 是 **JSON 对象**而不是字符串 → 工具调用载荷不可见；
 *   ③ 响应体是顶层 `content[]`，不在 `choices[]` 里 → **整个响应投影为空**。
 *
 * 派生文本：`tool_use.input` 投影时被 JSON.stringify（原文是对象，没有对应字节）→ derived。
 * `tool_result.content` 的块数组形态也走规范化 —— 但其中的 `text` 块原样取用，不算派生。
 */

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 块级文本字段：普通文本块取 `text`，thinking 块取 `thinking`。 */
function pushBlockText(block: Record<string, unknown>, out: string[]): void {
  if (block.type === "thinking" && typeof block.thinking === "string") {
    out.push(block.thinking);
    return;
  }
  if (typeof block.text === "string") out.push(block.text);
}

/** 单个 content 块的投影；返回是否产生派生文本。 */
function pushOneBlock(block: unknown, out: string[]): boolean {
  if (typeof block === "string") {
    out.push(block);
    return false;
  }
  if (!isObject(block)) return false;
  pushBlockText(block, out);
  if (block.type === "tool_result") pushBlocks(block.content, out);
  return pushToolUse(block, out);
}

/** tool_use 块：name 进投影（与 chat 的 function name 口径一致），input 对象 → 派生 JSON。 */
function pushToolUse(block: Record<string, unknown>, out: string[]): boolean {
  if (block.type !== "tool_use") return false;
  if (typeof block.name === "string") out.push(block.name);
  if (block.input === undefined) return false;
  if (typeof block.input === "string") {
    out.push(block.input);
    return false;
  }
  out.push(JSON.stringify(block.input));
  return true;
}

/** 投影一个 content 块数组（消息 content / tool_result.content / 响应 content 共用）。 */
function pushBlocks(blocks: unknown, out: string[]): boolean {
  if (typeof blocks === "string") {
    out.push(blocks);
    return false;
  }
  if (!Array.isArray(blocks)) return false;
  let derived = false;
  for (const b of blocks) derived = pushOneBlock(b, out) || derived;
  return derived;
}

/** 块类型 → 该类型在 CoverageSpec 里的路径后缀（与 pushOneBlock 的可见面一一对应）。 */
const BLOCK_HANDLED_SUFFIX: Readonly<Record<string, readonly string[]>> = Object.freeze({
  text: [".text"],
  thinking: [".thinking"],
  tool_result: [".tool_result.content"],
  tool_use: [".tool_use.input", ".tool_use.name"],
});

/** 单个块登记 handled 路径。 */
function markOneBlock(block: unknown, prefix: string, handled: Set<string>): void {
  if (!isObject(block) || typeof block.type !== "string") return;
  for (const suffix of BLOCK_HANDLED_SUFFIX[block.type] ?? []) handled.add(prefix + suffix);
}

/** 逐块登记 handled 路径（与 pushBlocks 的可见面一一对应）。 */
function markHandledBlocks(blocks: unknown, prefix: string, handled: Set<string>): void {
  if (!Array.isArray(blocks)) return;
  for (const b of blocks) markOneBlock(b, prefix, handled);
}

/** 请求侧单条消息的投影与 handled 登记。 */
function projectMessage(m: unknown, parts: string[], handled: Set<string>): boolean {
  if (!isObject(m)) return false;
  if (m.content !== undefined) handled.add("messages[].content");
  const derived = pushBlocks(m.content, parts);
  markHandledBlocks(m.content, "messages[].content[]", handled);
  return derived;
}

/** system：字符串或是块数组。 */
function projectSystem(system: unknown, parts: string[], handled: Set<string>): boolean {
  if (system === undefined) return false;
  handled.add("system");
  if (typeof system === "string") {
    parts.push(system);
    return false;
  }
  return pushBlocks(system, parts);
}

function projectRequest(parsed: Record<string, unknown>): Projection {
  const parts: string[] = [];
  const handled = new Set<string>();
  let derived = projectSystem(parsed.system, parts, handled);
  if (Array.isArray(parsed.messages)) {
    for (const m of parsed.messages) derived = projectMessage(m, parts, handled) || derived;
  }
  if (Array.isArray(parsed.tools)) {
    parts.push(JSON.stringify(parsed.tools));
    handled.add("tools");
    derived = true;
  }
  return { parts, derived, handled: [...handled], present: [] };
}

function projectResponse(parsed: Record<string, unknown>, _requestedModel: string | null): Projection {
  const parts: string[] = [];
  const handled = new Set<string>();
  let derived = false;
  if (parsed.content !== undefined) {
    handled.add("content");
    derived = pushBlocks(parsed.content, parts);
    markHandledBlocks(parsed.content, "content[]", handled);
  }
  return { parts, derived, handled: [...handled], present: [] };
}

/** 流式 delta 的文本字段（text / partial_json / thinking）。 */
function pushDelta(delta: Record<string, unknown>, parts: string[], handled: string[]): void {
  for (const key of ["text", "partial_json", "thinking"] as const) {
    if (typeof delta[key] !== "string") continue;
    parts.push(delta[key]);
    handled.push(`delta.${key}`);
  }
}

/** content_block_start 帧：块声明里可能直接带完整 input。 */
function pushContentBlockStart(block: unknown, parts: string[], handled: string[]): boolean {
  if (!isObject(block)) return false;
  handled.push("content_block");
  if (!isObject(block.input)) return false;
  parts.push(JSON.stringify(block.input));
  handled.push("content_block.input");
  return true;
}

/**
 * SL-04（AC-V2bA-02d）：Anthropic 流式帧投影。
 *
 * 帧类型（官方 SSE）：`message_start`（无文本）/ `content_block_start`（块声明）/
 * `content_block_delta`（`text_delta.text` 与 `input_json_delta.partial_json`）/
 * `message_delta`（stop_reason）/ `message_stop`。
 * 只有 `content_block_delta` 带可扫载荷；其余投影为空串（合法常态，不计入 present）。
 */
function projectFrame(parsed: Record<string, unknown>): Projection {
  const parts: string[] = [];
  const handled: string[] = [];
  let derived = false;
  if (isObject(parsed.delta)) pushDelta(parsed.delta, parts, handled);
  derived = pushContentBlockStart(parsed.content_block, parts, handled);
  return { parts, derived, handled, present: [] };
}

export const ANTHROPIC_COVERAGE: CoverageSpec = Object.freeze({
  requestPayloadPaths: Object.freeze([
    "system",
    "messages[].content",
    "messages[].content[].tool_use.input",
    "messages[].content[].tool_use.name",
    "messages[].content[].tool_result.content",
    "tools",
  ]) as readonly string[],
  responsePayloadPaths: Object.freeze([
    "content",
    "content[].text",
    "content[].tool_use.input",
    "content[].tool_use.name",
    "content[].thinking",
  ]) as readonly string[],
});

export const anthropicMessagesProtocol: WireProtocol = Object.freeze({
  format: "anthropic-messages" as const,
  coverage: ANTHROPIC_COVERAGE,
  projectRequest,
  projectResponse,
  projectFrame,
  canaryInjection: false,
});
