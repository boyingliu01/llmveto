import { isPlainObject, isTextPart } from "./session-key.ts";

/**
 * @test REQ-V2a-11
 * @intent canary 注入六分支纯函数（§4.4 逐字实现；AC-V2a-07·18 单元级判定面）。inject(body, canary)
 *         = 解析 → 结构手术 → JSON.stringify 重组（R2 A-MAJ1：通用不变式参数化为按分支的值级判据，
 *         字符串格式规范化不属违例；分支 6 的不可解析体必须原样返回、一字节不动）。只增不改：
 *         分支 1/4 值级前缀 + 长度差 27；分支 2/3 数组等长（或 +1）逐 index 相等 + 唯一元素差异；
 *         分支 5 回溯最近 role="user" 注入、其后 message 与顶层非 messages 字段不动；canary 在注入
 *         后体中恰出现一次（唯一 k 判据的可执行形态）。分支 6（不可解析 / 无 user / 表外形态）→
 *         injected=false + skip_reason="inject_skipped"（§4.5：只进顶层 reason，不产 findings 条目；
 *         meta.canary_injected 与 status 计数由网关接线，SL-07）。
 * @no-test-required: 测试在 tests/unit/canary/inject.test.ts（Gate 5a 仅识别同目录/根 tests/ 六种路径）
 */

/** skip_reason 取值对齐 src/evidence/schema.ts REASON_VOCAB（canary 层禁 import evidence，由测试钉死对齐）。 */
export type InjectSkipReason = "inject_skipped";

/** {body, injected, skip_reason}：skip_reason 仅 injected=false 时存在（整键缺席，exactOptionalPropertyTypes）。 */
export type InjectResult =
  | { readonly body: string; readonly injected: true }
  | { readonly body: string; readonly injected: false; readonly skip_reason: InjectSkipReason };

function skipped(body: string): InjectResult {
  return { body, injected: false, skip_reason: "inject_skipped" }; // 分支 6：原串原样返回
}

/**
 * §4.4 六分支分派（逐字）：1 content 非空字符串 → 尾部追加；2 parts 数组含 text part → 追加到
 * 最后一个 text part 的 text 尾部；3 parts 数组无 text part → 末尾新增只含 canary 的 text part；
 * 4 content 缺失或空字符串 → 置为只含 canary 的文本；5 末条 role="tool" → 回溯最近 role="user"
 * 的 message 再按 1/2/3/4 分派（整请求无 user → 6）；6 body 不可解析或整请求无 user message →
 * 不注入、原样返回。
 */
export function inject(body: string, canary: string): InjectResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return skipped(body); // 分支 6①：不可解析体一字节不动
  }
  if (!isPlainObject(parsed)) return skipped(body);
  const messages = parsed["messages"];
  if (!Array.isArray(messages)) return skipped(body); // 分支 6②：缺 messages（AC-V2a-18 B_skip 形态）
  const point = injectionPoint(messages);
  if (point === null) return skipped(body); // 分支 6②：整请求无 user message（含 messages 为空）
  const msg = messages[point];
  if (!isPlainObject(msg)) return skipped(body); // 表外形态：注入点 message 非对象 → 不可安置
  if (!placeCanary(msg, canary)) return skipped(body); // 表外形态：content 形态 §4.4 表未定义 → 不注入
  return { body: JSON.stringify(parsed), injected: true }; // 字符串格式规范化不属违例（R2 A-MAJ1）
}

/** 注入点：末条非 tool → 末条自身；末条 role="tool" → 回溯最近 role="user"（§4.4 分支 5）；无 → null。 */
function injectionPoint(messages: readonly unknown[]): number | null {
  const last = messages.length - 1;
  if (last < 0) return null;
  const lastMsg = messages[last];
  if (!(isPlainObject(lastMsg) && lastMsg["role"] === "tool")) return last;
  for (let i = last - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (isPlainObject(m) && m["role"] === "user") return i;
  }
  return null;
}

/** 在注入点 message 上就地安置 canary（只增不改，parse 树为本函数独有）；false = content 形态不可安置。 */
function placeCanary(msg: Record<string, unknown>, canary: string): boolean {
  const content = msg["content"];
  if (typeof content === "string") {
    msg["content"] = content.length > 0 ? content + canary : canary; // 分支 1（非空尾部追加）／分支 4（""）
    return true;
  }
  if (Array.isArray(content)) {
    let lastText = -1;
    for (let i = content.length - 1; i >= 0; i -= 1) {
      if (isTextPart(content[i])) {
        lastText = i;
        break;
      }
    }
    if (lastText >= 0) {
      (content[lastText] as { text: string }).text += canary; // 分支 2：追加到最后一个 text part 的 text 尾部
    } else {
      content.push({ type: "text", text: canary }); // 分支 3：纯图像/文件 → 末尾新增只含 canary 的 text part
    }
    return true;
  }
  if (content === undefined) {
    msg["content"] = canary; // 分支 4：字段缺失 → 置为只含 canary 的文本（前置：原值确为缺失）
    return true;
  }
  return false; // 表外形态（null/数字/对象等 §4.4 未定义）→ 不可安置 → 分支 6（不注入、可观测）
}
