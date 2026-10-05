import type { ScanUnit, Transport } from "../shared/types.ts";

/**
 * @test REQ-VETO-002
 * @intent 扫描单元组装（AC-VETO-002-06）：
 *   1. 认证类头（Authorization / x-api-key / api-key / x-goog-api-key / Proxy-Authorization / Cookie）
 *      一律**排除**出扫描单元 → 不进 text；
 *   2. 结构性字段（model / usage / finish_reason）解析后作为 meta 传入；
 *   3. text = messages + system + tools + extra_headers 的 UTF-8 解码文本投影，
 *      **含 tool_calls / function_call 的 arguments**（T2a 载荷，见下）；
 *   4. SSE data 无法解析 JSON → 原文本 + malformed: true（edge case）；
 *   5. decoded = 转义还原投影（`\uXXXX` 等），供 checker 同时扫描两份文本。
 *
 * 两处历史缺陷（本文件的回归守护对象）：
 *   A. **tool_call 载荷丢失**：只取 `content` 时，工具调用的实际载荷
 *      `tool_calls[*].function.arguments`（此时 content 恒为 null）完全不进扫描单元，
 *      响应侧全部 checker 落空。这是"扫描单元构造阶段丢数据"，比"不做 T2a 判定"更隐蔽。
 *   B. **转义序列绕过**：只在解码后的字面文本上匹配，则 `"\u200b"`（六个字符的转义写法）
 *      绕过整类检查。故额外投影 decoded 文本。
 */

export const AUTH_HEADERS: readonly string[] = Object.freeze([
  "authorization",
  "x-api-key",
  "api-key",
  "x-goog-api-key",
  "proxy-authorization",
  "cookie",
]);

export function isAuthHeader(name: string): boolean {
  return AUTH_HEADERS.includes(name.toLowerCase());
}

/**
 * 转义还原投影：把文本里的 `\uXXXX` / `\u{XXXXX}` / `\xXX` 序列还原为真实字符。
 * 用于对抗"用转义写法书写同一字符以绕过匹配"这一整类绕过（编码层）。
 *
 * 刻意**不做**通用 JSON 解转义（不处理 `\"` `\\` `\n` 等）：目标是让转义编码的
 * 敏感字符以真实码点出现在被扫文本里，而非重建原文；保持转换单向、幂等、无状态。
 * 无转义序列时返回原串（`scanTexts` 据此省略第二遍扫描）。
 */
export function decodeEscapes(s: string): string {
  if (!s.includes("\\")) return s;
  return s
    .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (_m, h: string) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
}

function safeFromCodePoint(cp: number): string {
  try {
    return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
  } catch {
    return "";
  }
}

/**
 * 从 tool_call 形态的对象里抽取可扫文本（T2a 载荷）。
 * 覆盖 OpenAI 兼容协议的三种形态：
 *   - `tool_calls[*].function.{name,arguments}`（现代）
 *   - `tool_calls[*].{name,arguments}`（部分网关扁平化）
 *   - `function_call.{name,arguments}`（legacy）
 * 另含 `tool_call_id` / `id`，使工具身份也可被取证（但不单独构成 finding 语义）。
 */
function collectToolCallParts(tc: unknown, out: string[]): void {
  if (!tc || typeof tc !== "object") return;
  const t = tc as Record<string, unknown>;
  const fn = t.function;
  if (fn && typeof fn === "object") {
    const f = fn as Record<string, unknown>;
    if (typeof f.name === "string") out.push(f.name);
    if (typeof f.arguments === "string") out.push(f.arguments);
  }
  // 扁平形态（无 function 包裹）
  if (typeof t.name === "string") out.push(t.name);
  if (typeof t.arguments === "string") out.push(t.arguments);
}

/** 抽 choices[*] 里 message/delta 的文本 + 工具调用载荷；同时回填结构性 meta。 */
function collectChoiceParts(parsed: Record<string, unknown>, out: string[]): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  const choices = parsed.choices;
  if (!Array.isArray(choices)) return meta;
  for (const c of choices) {
    if (!c || typeof c !== "object") continue;
    const c0 = c as Record<string, unknown>;
    for (const key of ["delta", "message"] as const) {
      const box = c0[key];
      if (!box || typeof box !== "object") continue;
      const b = box as Record<string, unknown>;
      // 文本内容（含多模态分段）
      if (typeof b.content === "string") out.push(b.content);
      else if (Array.isArray(b.content)) {
        for (const seg of b.content) {
          if (seg && typeof seg === "object" && "text" in seg) {
            out.push(String((seg as { text: unknown }).text));
          }
        }
      }
      // 工具调用载荷（T2a 载体）
      if (Array.isArray(b.tool_calls)) for (const tc of b.tool_calls) collectToolCallParts(tc, out);
      if (b.function_call) collectToolCallParts(b.function_call, out);
      if (typeof b.reasoning_content === "string") out.push(b.reasoning_content);
    }
    if (typeof c0.finish_reason === "string") meta.finish_reason = c0.finish_reason;
  }
  return meta;
}

/** 请求侧：把 body JSON 展平为 text 投影 + meta。 */
export function buildRequestScanUnit(
  body: string,
  parsed: Record<string, unknown> | null,
  headers: Readonly<Record<string, string>>,
  transport: Transport,
): ScanUnit {
  const meta: Record<string, unknown> = {};
  if (parsed && typeof parsed === "object") {
    if (typeof parsed.model === "string") meta.model_requested = parsed.model;
    // messages 展平为 text；跳过 auth 头（不在 body 中，但 extra_headers 也可能带 auth）
    const parts: string[] = [];
    const msgs = parsed.messages;
    if (Array.isArray(msgs)) {
      for (const m of msgs) {
        if (m && typeof m === "object" && "content" in m) {
          const c = (m as { content: unknown }).content;
          if (typeof c === "string") parts.push(c);
          else if (Array.isArray(c)) {
            for (const seg of c) {
              if (seg && typeof seg === "object" && "text" in seg) parts.push(String((seg as { text: unknown }).text));
            }
          }
        }
        // 助手历史里的工具调用：arguments 是请求侧同样存在的 T2a 载体
        if (m && typeof m === "object") {
          const mm = m as Record<string, unknown>;
          if (Array.isArray(mm.tool_calls)) for (const tc of mm.tool_calls) collectToolCallParts(tc, parts);
          if (mm.function_call) collectToolCallParts(mm.function_call, parts);
        }
      }
    }
    if (typeof parsed.system === "string") parts.push(parsed.system);
    if (Array.isArray(parsed.tools)) parts.push(JSON.stringify(parsed.tools));
    const extra = parsed.extra_headers;
    if (extra && typeof extra === "object") {
      for (const [k, v] of Object.entries(extra as Record<string, unknown>)) {
        if (isAuthHeader(k)) continue; // AC-VETO-002-06
        parts.push(`${k}: ${String(v)}`);
      }
    }
    return withDecoded({ direction: "request", transport, text: parts.join("\n"), meta });
  }
  // parsed 失败：原样 text，标记 malformed
  return withDecoded({ direction: "request", transport, text: body, meta, malformed: true });
}

/** 响应侧：SSE data 或 body 文本 → 扫描单元；已解析 JSON 时提取 model / usage / finish_reason。 */
export function buildResponseScanUnit(
  text: string,
  parsed: Record<string, unknown> | null,
  requestedModel: string | null,
  transport: Transport,
): ScanUnit {
  const meta: Record<string, unknown> = {};
  if (requestedModel) meta.model_requested = requestedModel;
  if (!parsed) {
    return withDecoded({ direction: "response", transport, text, meta, malformed: true });
  }
  if (typeof parsed.model === "string") meta.model_responded = parsed.model;
  if (parsed.usage && typeof parsed.usage === "object") meta.usage = parsed.usage;
  // 提取内容文本（choices[*].delta/message.content + **tool_calls/function_call.arguments**）
  const parts: string[] = [];
  const choiceMeta = collectChoiceParts(parsed, parts);
  if (choiceMeta.finish_reason !== undefined) meta.finish_reason = choiceMeta.finish_reason;
  return withDecoded({ direction: "response", transport, text: parts.join(""), meta });
}

/**
 * 附加转义还原投影。契约：无转义序列时不产出 `decoded` 字段，
 * 使 `scanTexts()` 退化为单遍扫描（与修复前行为逐字一致，零额外开销、零误报面）。
 */
function withDecoded(unit: ScanUnit): ScanUnit {
  const decoded = decodeEscapes(unit.text);
  return decoded === unit.text ? unit : { ...unit, decoded };
}
