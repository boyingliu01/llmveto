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
 *
 * 已知边界（PWR1 Round 1 成文，均在 README 扫描面口径有对应申报）：
 *   - 多重反斜杠（如 `\\u200b`）：最内层"单个反斜杠 + uXXXX"总会被还原，前置的多余
 *     反斜杠留作字面量——多层转义**不**构成绕过面（逐层实测见 decodeEscapes 单测）。
 *   - `\uD83D\uDE00` 类代理对逐元还原为两个代理码元；两语法（`\uXXXX` / `\u{XXXXX}`）在
 *     PWR3-B-m2 后统一走 safeFromCodePoint，孤立代理码元两式同样**保留**该码元（改前 `\u{d800}`
 *     会被 fromCodePoint 拒绝而丢字，是 `\uXXXX` 式没有的绕过面）。v1 冻结码点集全为 BMP。
 *   - URL 编码（`%E2%80%8B`）、base64 等**二次编码不还原**（排场外语，非疏漏）。
 */
export function decodeEscapes(s: string): string {
  if (!s.includes("\\")) return s;
  return s
    .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (_m, h: string) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, h: string) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_m, h: string) => safeFromCodePoint(parseInt(h, 16)));
}

function safeFromCodePoint(cp: number): string {
  if (cp < 0 || cp > 0x10ffff) return "";
  try {
    return String.fromCodePoint(cp);
  } catch {
    // 孤立代理码元（0xD800–0xDFFF）：fromCodePoint 按规范拒绝，但解码投影要**保留**该码元
    // 而非静默丢弃——丢弃会让 `\u{d800}` 写法从第二遍扫描里消失，反而造出绕过面（PWR3-B-m2）。
    return String.fromCharCode(cp);
  }
}

/**
 * 从 tool_call 形态的对象里抽取可扫文本（T2a 载荷）。
 * 覆盖 OpenAI 兼容协议的三种形态：
 *   - `tool_calls[*].function.{name,arguments}`（现代）
 *   - `tool_calls[*].{name,arguments}`（部分网关扁平化）
 *   - `function_call.{name,arguments}`（legacy）
 * `arguments` 协议规定为字符串，但个别网关直发对象形态——一并 `JSON.stringify` 入扫描面，
 * 否则又构成"载体丢失"（PWR1-B-m5）。`tool_call_id`/`id` 是随机标识、无可扫文本，**不**入单元
 * （原注释声称"另含 id"与代码不符，PWR1-B-m1 订正）。
 */
function collectToolCallParts(tc: unknown, out: string[]): void {
  if (!tc || typeof tc !== "object") return;
  const t = tc as Record<string, unknown>;
  const fn = t.function;
  if (fn && typeof fn === "object") {
    const f = fn as Record<string, unknown>;
    if (typeof f.name === "string") out.push(f.name);
    pushArguments(f.arguments, out);
  }
  // 扁平形态（无 function 包裹）
  if (typeof t.name === "string") out.push(t.name);
  if (!fn) pushArguments(t.arguments, out); // 扁平分支才在这里取；function 包裹的已在上面取过
}

/** arguments 可为 string（协议）或 object（非标准网关直发）；其余类型不可扫。 */
function pushArguments(args: unknown, out: string[]): void {
  if (typeof args === "string") out.push(args);
  else if (args && typeof args === "object") out.push(JSON.stringify(args));
}

/** content 投影：string 直取；多模态分段数组取 seg.text。请求侧 messages 与响应侧 choices 共用。 */
function pushContentParts(content: unknown, out: string[]): void {
  if (typeof content === "string") {
    out.push(content);
  } else if (Array.isArray(content)) {
    for (const seg of content) {
      if (seg && typeof seg === "object" && "text" in seg) out.push(String((seg as { text: unknown }).text));
    }
  }
}

/** 请求侧单条 message 投影：content + 工具调用载荷（助手历史里的 arguments 同为 T2a 载体）。 */
function collectMessageParts(m: unknown, out: string[]): void {
  if (!m || typeof m !== "object") return;
  const mm = m as Record<string, unknown>;
  if ("content" in mm) pushContentParts(mm.content, out);
  if (Array.isArray(mm.tool_calls)) for (const tc of mm.tool_calls) collectToolCallParts(tc, out);
  if (mm.function_call) collectToolCallParts(mm.function_call, out);
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
      pushContentParts(b.content, out);
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
    // messages 展平为 text；extra_headers 里的 auth 头跳过（AC-VETO-002-06）
    const parts: string[] = [];
    const msgs = parsed.messages;
    if (Array.isArray(msgs)) {
      for (const m of msgs) collectMessageParts(m, parts);
    }
    if (typeof parsed.system === "string") parts.push(parsed.system);
    if (Array.isArray(parsed.tools)) {
      parts.push(JSON.stringify(parsed.tools));
      // D-12（SL-01/REQ-V2a-01）：声明面进请求 meta，经 core 下传给响应侧扫描单元
      // （非流式 / 流式逐帧 / 归并单元三处同参）—— SL-09 tool-call-shape 的
      // "未知工具名 / 缺 required" 判定源；declared_tools 为空时两子规则不适用
      // （无声明即漏检，#C 登记）。
      const declared = extractDeclaredTools(parsed.tools);
      if (declared.declared_tools.length > 0) meta.declared_tools = declared.declared_tools;
      if (Object.keys(declared.declared_required).length > 0) meta.declared_required = declared.declared_required;
    }
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

/**
 * D-12：请求体 tools 声明面提取。declared_tools = tools[*].function.name
 * （扁平形态退化为 tools[*].name）；declared_required = 工具名 → parameters.required
 * （仅收字符串项；未声明 required 的工具不进表 —— "缺 required" 子规则只对
 * 已声明 required 的工具适用）。
 */
function extractDeclaredTools(tools: readonly unknown[]): {
  declared_tools: string[];
  declared_required: Record<string, string[]>;
} {
  const names: string[] = [];
  const required: Record<string, string[]> = {};
  for (const t of tools) {
    if (!t || typeof t !== "object") continue;
    const to = t as Record<string, unknown>;
    const fn = to.function && typeof to.function === "object" ? (to.function as Record<string, unknown>) : null;
    const name = fn && typeof fn.name === "string" ? fn.name : typeof to.name === "string" ? to.name : null;
    if (name === null) continue;
    names.push(name);
    const params = fn ? fn.parameters : to.parameters;
    if (params && typeof params === "object") {
      const reqRaw = (params as Record<string, unknown>).required;
      if (Array.isArray(reqRaw)) {
        const req = reqRaw.filter((x): x is string => typeof x === "string");
        if (req.length > 0) required[name] = req;
      }
    }
  }
  return { declared_tools: names, declared_required: required };
}

/** core 据此把请求 meta 里的声明面键喂给响应侧扫描单元（只挑 declared_*，不夹带其他 meta）。 */
export function declaredToolsMeta(meta: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (meta.declared_tools !== undefined) out.declared_tools = meta.declared_tools;
  if (meta.declared_required !== undefined) out.declared_required = meta.declared_required;
  return out;
}

/** 响应侧：SSE data 或 body 文本 → 扫描单元；已解析 JSON 时提取 model / usage / finish_reason。 */
export function buildResponseScanUnit(
  text: string,
  parsed: Record<string, unknown> | null,
  requestedModel: string | null,
  transport: Transport,
  declaredMeta?: Readonly<Record<string, unknown>>,
): ScanUnit {
  // SL-01/D-12：声明面（declared_tools/declared_required）随单元下传；先展开，
  // 让下方解析出的结构性字段（model/usage/finish_reason）保持优先。
  const meta: Record<string, unknown> = { ...declaredMeta };
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

// ── SL-01（AC-V2a-01）：流式 tool-call arguments 跨 chunk 归并 ─────────────────

/**
 * 流式 delta.tool_calls arguments 归并器（AC-V2a-01）。
 *
 * v1 缺陷：流式管线逐帧扫描，而 OpenAI 兼容协议把 arguments 按**任意切点**分片进
 * 不同 SSE 帧（`delta.tool_calls[*].function.arguments` 增量拼接）。隐形字符的
 * 字面转义（如六字符的 `\u200b`）被帧边界切开时，任一单帧均无完整命中——
 * invisible-unicode-scan 的参数覆盖面从声明落空为事实漏检。
 *
 * 修法：同一 response 内按 tool_call index 累积片段，**归并完成后再进扫描域**
 * （不能逐 chunk 扫碎片）；不丢字节 = 任意切分点下重组结果与原始字符串逐字符
 * 相等（纯字符串拼接，零归一化）。归并只覆盖流式 delta 增量；非流式
 * message.tool_calls 与"流式传输但整段 JSON"的载体在单帧内载荷完整，
 * 由 buildResponseScanUnit 的逐帧提取直接覆盖，无需归并。
 */
export interface ToolCallArgsMerger {
  /** 吸收一帧的 parsed JSON（SSE data 解析结果；null / 非 chat 帧为 no-op）。 */
  feed(parsed: Record<string, unknown> | null): void;
  /**
   * 归并文本：各 tool_call 的片段按到达序拼接；**工具之间以 \n 分隔**——
   * 防止工具 A 尾部的半个转义与工具 B 开头的字符跨桶拼出原文里不存在的伪转义（FP 面）。
   */
  mergedText(): string;
  /** 已累积的 tool_call 数（0 = 本流未出现工具调用载荷）。 */
  readonly toolCallCount: number;
}

export function createToolCallArgsMerger(): ToolCallArgsMerger {
  const acc = new Map<string, string>();
  return {
    get toolCallCount() {
      return acc.size;
    },
    feed(parsed) {
      if (!parsed || typeof parsed !== "object") return;
      const choices = parsed.choices;
      if (!Array.isArray(choices)) return;
      for (let ci = 0; ci < choices.length; ci++) feedChoiceDelta(acc, ci, choices[ci]);
    },
    mergedText() {
      let out = "";
      for (const v of acc.values()) out = out === "" ? v : out + "\n" + v;
      return out;
    },
  };
}

/** 吸收单条 choice 的 delta：tool_calls 数组按 index 分桶，旧式 function_call 单独一桶。 */
function feedChoiceDelta(acc: Map<string, string>, ci: number, choice: unknown): void {
  if (!choice || typeof choice !== "object") return;
  const delta = (choice as Record<string, unknown>).delta;
  if (!delta || typeof delta !== "object") return;
  const d = delta as Record<string, unknown>;
  if (Array.isArray(d.tool_calls)) {
    for (let ti = 0; ti < d.tool_calls.length; ti++) {
      const t = d.tool_calls[ti];
      if (!t || typeof t !== "object") continue;
      const to = t as Record<string, unknown>;
      // 键 = choice 序 + tool_call index（协议字段；缺省退化为帧内数组位）——
      // 跨帧稳定，保证同一 tool_call 的片段落进同一桶按到达序拼接。
      const key = `${ci}:${typeof to.index === "number" ? to.index : ti}`;
      const fn = to.function;
      if (fn && typeof fn === "object") appendFragment(acc, key, (fn as Record<string, unknown>).arguments);
      else if (!fn) appendFragment(acc, key, to.arguments); // 扁平形态（无 function 包裹）
    }
  }
  if (d.function_call && typeof d.function_call === "object") {
    appendFragment(acc, `${ci}:fc`, (d.function_call as Record<string, unknown>).arguments);
  }
}

/** arguments 协议为 string 且流式分片只对 string 有意义；对象形态直发由逐帧单元覆盖（非字符串不归并）。 */
function appendFragment(acc: Map<string, string>, key: string, args: unknown): void {
  if (typeof args !== "string" || args.length === 0) return;
  const prev = acc.get(key);
  acc.set(key, prev === undefined ? args : prev + args);
}

/**
 * 归并文本 → 扫描单元（AC-V2a-01）：与逐帧单元同一套转义还原投影（withDecoded），
 * 使 `\u200b` 跨帧切开的字面转义在归并后经 decoded 投影命中。meta 只携带下传的
 * 声明面（declared_tools/declared_required）——不携带 model_*，避免喂出
 * model-label-consistency 的结构性噪声 finding。
 */
export function buildMergedToolCallScanUnit(text: string, declaredMeta?: Readonly<Record<string, unknown>>): ScanUnit {
  return withDecoded({ direction: "response", transport: "stream", text, meta: { ...declaredMeta } });
}

/**
 * 附加转义还原投影。契约：无转义序列时不产出 `decoded` 字段，
 * 使 `scanTexts()` 退化为单遍扫描（与修复前行为逐字一致，零额外开销、零误报面）。
 */
function withDecoded(unit: ScanUnit): ScanUnit {
  const decoded = decodeEscapes(unit.text);
  return decoded === unit.text ? unit : { ...unit, decoded };
}
