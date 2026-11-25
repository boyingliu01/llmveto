// @no-test-required: 测试在 tests/unit/gateway/protocols/responses.test.ts（本项目测试布局为 tests/ 目录；Gate 5a 仅识别同目录/根 tests/ 六种路径）
import type { CoverageSpec, Projection, WireProtocol } from "./types.ts";

/**
 * @test REQ-V2bA-01 / AC-V2bA-01a~b
 * @intent OpenAI Responses 协议投影（Codex 的线格式；`wire_api="responses"` 是唯一支持值）。
 *
 * 改动前的盲区（实测，见 var/probes/scan-unit-probe.mjs）：
 *   请求侧只有 `tools` 进扫描单元——`instructions`、`input[]`（`input_text` /
 *   `function_call.arguments` / `function_call_output.output`）全不可见；
 *   响应侧 **投影为空字符串**——`output[]` 的 `output_text` 与 `function_call.arguments` 全不可见。
 *
 * 形态要点：
 *   - `input` 可为**字符串**或数组（数组元素按 `type` 分派）；
 *   - 两代 Responses 形态并存，故 `output[]` 的元素既可能是 `message/content[]` 也可能是扁平文本字段。
 *
 * 实现要点：每个元素的投影拆成若干小函数，避免深层嵌套（Clean Code 门限 4 层）。
 */

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 字符串直接入投影；对象走 JSON 规范化并报告"派生"。返回是否派生。 */
function pushPayload(value: unknown, parts: string[]): boolean {
  if (typeof value === "string") {
    parts.push(value);
    return false;
  }
  if (value === undefined) return false;
  parts.push(JSON.stringify(value));
  return true;
}

/** content[] 的单个块：字符串 / `{text}` / `{arguments}`。 */
function pushOneContentBlock(c: unknown, parts: string[]): boolean {
  if (typeof c === "string") {
    parts.push(c);
    return false;
  }
  if (!isObject(c)) return false;
  if (typeof c.text === "string") {
    parts.push(c.text);
    return false;
  }
  return c.arguments === undefined ? false : pushPayload(c.arguments, parts);
}

/** content[] 块：字符串 / `{text}` / `{arguments}`。 */
function pushContentBlocks(blocks: unknown, parts: string[]): boolean {
  if (!Array.isArray(blocks)) return false;
  let derived = false;
  for (const c of blocks) derived = pushOneContentBlock(c, parts) || derived;
  return derived;
}

/** summary[] 的 `{text}`。 */
function pushSummary(summary: unknown, parts: string[]): void {
  if (!Array.isArray(summary)) return;
  for (const s of summary) if (isObject(s) && typeof s.text === "string") parts.push(s.text);
}

/** output 字段：字符串或块数组。 */
function pushOutputField(output: unknown, parts: string[]): void {
  if (typeof output === "string") {
    parts.push(output);
    return;
  }
  pushContentBlocks(output, parts);
}

/** 元素的标量文本字段：扁平 text（两代 Responses 形态并存）。 */
function pushItemText(it: Record<string, unknown>, parts: string[]): void {
  if (typeof it.name === "string") parts.push(it.name);
  if (typeof it.text === "string") parts.push(it.text);
}

/** 单个 input/output 元素的投影。返回是否产生派生文本。 */
function pushItem(it: unknown, parts: string[]): boolean {
  if (typeof it === "string") {
    parts.push(it);
    return false;
  }
  if (!isObject(it)) return false;
  const fromContent = pushContentBlocks(it.content, parts);
  pushItemText(it, parts);
  const fromArgs = it.arguments === undefined ? false : pushPayload(it.arguments, parts);
  pushOutputField(it.output, parts);
  pushSummary(it.summary, parts);
  return fromContent || fromArgs;
}

/** input / output 整体投影（字符串或数组）。 */
function pushItems(items: unknown, parts: string[]): boolean {
  if (typeof items === "string") {
    parts.push(items);
    return false;
  }
  if (!Array.isArray(items)) return false;
  let derived = false;
  for (const it of items) derived = pushItem(it, parts) || derived;
  return derived;
}

/** 元素字段 → 是否"存在即算该 handled 路径"（与 pushItem 的可见面一一对应）。 */
const ITEM_HANDLED: ReadonlyArray<readonly [string, (v: unknown) => boolean]> = Object.freeze([
  ["content", Array.isArray],
  ["name", (v: unknown) => typeof v === "string"],
  ["arguments", (v: unknown) => v !== undefined],
  ["output", (v: unknown) => v !== undefined],
  ["summary", Array.isArray],
  ["text", (v: unknown) => typeof v === "string"],
]);

function markOneItem(it: unknown, prefix: string, handled: Set<string>): void {
  if (!isObject(it)) return;
  for (const [field, present] of ITEM_HANDLED) if (present(it[field])) handled.add(`${prefix}[].${field}`);
}

/** 登记 handled 路径（与 pushItem 的可见面一一对应）。 */
function markHandledItems(items: unknown, prefix: string, handled: Set<string>): void {
  if (typeof items === "string") {
    handled.add(prefix);
    return;
  }
  if (!Array.isArray(items)) return;
  for (const it of items) markOneItem(it, prefix, handled);
}

function projectRequest(parsed: Record<string, unknown>): Projection {
  const parts: string[] = [];
  const handled = new Set<string>();
  let derived = false;
  if (typeof parsed.instructions === "string") {
    parts.push(parsed.instructions);
    handled.add("instructions");
  }
  if (parsed.input !== undefined) {
    derived = pushItems(parsed.input, parts) || derived;
    markHandledItems(parsed.input, "input", handled);
    handled.add("input");
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
  if (parsed.output !== undefined) {
    derived = pushItems(parsed.output, parts);
    markHandledItems(parsed.output, "output", handled);
    handled.add("output");
  }
  return { parts, derived, handled: [...handled], present: [] };
}

/**
 * SL-04（AC-V2bA-01c）：Responses 流式帧投影。
 *
 * 帧类型（官方 SSE）：`response.created` / `response.output_item.added`（无文本）/
 * `response.output_text.delta`（`delta` 字符串）/ `response.function_call_arguments.delta`
 * 与 **`…done`**（`done` 帧带完整 `arguments`，不能只靠 delta 拼接）/
 * `response.reasoning_summary_text.delta` / `response.completed`（带 `response.usage`）。
 * 心跳/元数据帧投影为空串（合法常态，不计入 present）。
 */
function projectFrame(parsed: Record<string, unknown>): Projection {
  const parts: string[] = [];
  const handled: string[] = [];
  let derived = false;
  if (typeof parsed.delta === "string") {
    parts.push(parsed.delta);
    handled.push("delta");
  }
  if (typeof parsed.name === "string") {
    parts.push(parsed.name);
    handled.push("name");
  }
  if (parsed.arguments !== undefined) {
    derived = pushPayload(parsed.arguments, parts);
    handled.push("arguments");
  }
  if (Array.isArray(parsed.summary)) {
    pushSummary(parsed.summary, parts);
    handled.push("summary");
  }
  return { parts, derived, handled, present: [] };
}

export const RESPONSES_COVERAGE: CoverageSpec = Object.freeze({
  requestPayloadPaths: Object.freeze([
    "instructions",
    "input",
    "input[].content",
    "input[].arguments",
    "input[].output",
    "tools",
  ]) as readonly string[],
  responsePayloadPaths: Object.freeze([
    "output",
    "output[].content",
    "output[].arguments",
    "output[].summary",
    "output[].text",
  ]) as readonly string[],
});

export const responsesProtocol: WireProtocol = Object.freeze({
  format: "openai-responses" as const,
  coverage: RESPONSES_COVERAGE,
  projectRequest,
  projectResponse,
  projectFrame,
  canaryInjection: false,
});
