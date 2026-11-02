import { createHash } from "node:crypto";

/**
 * @test REQ-V2a-11
 * @intent canary 会话键派生（D-06 / §4.3）：头优先（x-llmveto-session-id，取值 trim 非空即用）→ 回退
 *         sha256(首条 user 的 text parts 按 `${len}:${text}` 逐 part 串接) hex 前 16 字符；长度前缀消
 *         拼接歧义（["ab","c"]→"2:ab1:c" ≠ ["a","bc"]→"1:a2:bc"）；非 text part 不计入；文本零归一化
 *         （不 NFKC / 不折叠 / 不裁空白：宁可键不同而少共享，不可键相同而漏检）；空集（无 user /
 *         user 无 text part / body 不可解析）→ 确定性锚 "0:"。headers 约定：与 server.ts
 *         normalizeHeaders 同形（键已小写化、多值取首），归一职责在网关边界；与 evidence session_id
 *         （server.ts 既有 per-request 派生）两套并存是 D-06 注册的有意设计事实，后者不动。
 * @no-test-required: 测试在 tests/unit/canary/session-key.test.ts（Gate 5a 仅识别同目录/根 tests/ 六种路径）
 */

export const SESSION_KEY_HEADER = "x-llmveto-session-id" as const; // §10.1-10 拍板默认头名；传入前应经 normalizeHeaders 小写化
export const SESSION_KEY_HEX_CHARS = 16 as const; // §4.3 定值：回退键 = hex 摘要前 16 字符

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** text part 判定（{type:"text", text:string}；图像/文件/音频/畸形一律非 text）—— canary 域内共享，inject.ts 复用。 */
export function isTextPart(part: unknown): part is { text: string } {
  return isPlainObject(part) && part["type"] === "text" && typeof part["text"] === "string";
}

/** content 的 text parts 投影：字符串 → 单 part（含空串）；数组 → 过滤 text part；其它 → 空集。零归一化。 */
export function textContentParts(content: unknown): readonly string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  return content.filter((p): p is { text: string } => isTextPart(p)).map((p) => p.text);
}

/** D-06 会话键：头优先（trim 非空即用）→ 缺头回退摘要键；纯函数，同输入恒同键（AC-V2a-17）。 */
export function deriveSessionKey(headers: Readonly<Record<string, string>>, body: string): string {
  const fromHeader = headers[SESSION_KEY_HEADER];
  if (fromHeader !== undefined && fromHeader.trim() !== "") return fromHeader.trim();
  return fallbackKey(body);
}

/** 回退键：`${len}:${text}` 串接 → sha256 hex 前 16 字符（len = UTF-16 code unit 数，D-08 同口径）。 */
function fallbackKey(body: string): string {
  const parts = firstUserTextParts(body);
  const digestInput = parts.length === 0 ? "0:" : parts.map((p) => `${p.length}:${p}`).join("");
  return createHash("sha256").update(digestInput, "utf8").digest("hex").slice(0, SESSION_KEY_HEX_CHARS);
}

/** 首条 role="user" 的 text parts；无 user / messages 缺失 / body 不可解析 → 空集（锚键见 fallbackKey）。 */
function firstUserTextParts(body: string): readonly string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  if (!isPlainObject(parsed)) return [];
  const messages = parsed["messages"];
  if (!Array.isArray(messages)) return [];
  for (const m of messages) if (isPlainObject(m) && m["role"] === "user") return textContentParts(m["content"]);
  return [];
}
