import type { Direction, ScanUnit, Transport } from "../shared/types.ts";

/**
 * @test REQ-VETO-002
 * @intent 扫描单元组装（AC-VETO-002-06）：
 *   1. 认证类头（Authorization / x-api-key / api-key / x-goog-api-key / Proxy-Authorization / Cookie）
 *      一律**排除**出扫描单元 → 不进 text；
 *   2. 结构性字段（model / usage / finish_reason）解析后作为 meta 传入；
 *   3. text = messages + system + tools + extra_headers 的 UTF-8 解码文本投影；
 *   4. SSE data 无法解析 JSON → 原文本 + malformed: true（edge case）。
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
    return { direction: "request", transport, text: parts.join("\n"), meta };
  }
  // parsed 失败：原样 text，标记 malformed
  return { direction: "request", transport, text: body, meta, malformed: true };
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
    return { direction: "response", transport, text, meta, malformed: true };
  }
  if (typeof parsed.model === "string") meta.model_responded = parsed.model;
  if (parsed.usage && typeof parsed.usage === "object") meta.usage = parsed.usage;
  // 提取内容文本（非流 completion：choices[*].message.content；流：choices[*].delta.content）
  const parts: string[] = [];
  const choices = parsed.choices;
  if (Array.isArray(choices)) {
    for (const c of choices) {
      if (!c || typeof c !== "object") continue;
      const c0 = c as Record<string, unknown>;
      const delta = c0.delta;
      const message = c0.message;
      if (delta && typeof delta === "object" && typeof (delta as { content?: unknown }).content === "string") {
        parts.push((delta as { content: string }).content);
      }
      if (message && typeof message === "object" && typeof (message as { content?: unknown }).content === "string") {
        parts.push((message as { content: string }).content);
      }
      if (typeof c0.finish_reason === "string") meta.finish_reason = c0.finish_reason;
    }
  }
  return { direction: "response", transport, text: parts.join(""), meta };
}

export function directionToSide(d: Direction): "request" | "response" {
  return d;
}
