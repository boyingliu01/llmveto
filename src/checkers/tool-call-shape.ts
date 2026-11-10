// @no-test-required: 测试在 tests/unit/checkers/tool-call-shape.test.ts（Gate 5a 仅识别同目录/根 tests/ 六种路径）
import type {
  CheckerResult,
  Finding,
  NonStreamChecker,
  ScanUnit,
  StreamChecker,
} from "../shared/types.ts";
import { scanTexts, STREAM_WINDOW_OVERFLOW_LIMIT } from "../shared/types.ts";

/**
 * @test REQ-V2a-02
 * @intent T2a tool-call-shape checker（安全类）：三子规则
 *   1. 未知工具名  2. 缺失 required 参数  3. arguments 非法 JSON
 * D-12 FP=0：Rule 1&2 仅 declared_tools 存在时适用；Rule 3 始终适用。
 */

export const CHECKER_ID = "tool-call-shape";
/** §4.2/ADR-0003：单个 tool_call 的 arguments 累积硬顶（常量单一来源 = window-store）。 */
const WINDOW_LIMIT = STREAM_WINDOW_OVERFLOW_LIMIT;
const ACCUMULATED_BYTES_KEY = "accumulatedBytes";

interface ToolCallShape { name: string; arguments: string }

function isToolCall(obj: unknown): obj is ToolCallShape {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return typeof o.name === "string" && typeof o.arguments === "string";
}

function extractToolCalls(text: string): ToolCallShape[] {
  // 廉价前置：ToolCallShape 必然同时含 "name" 与 "arguments" 两个键。
  // 流式 arguments 片段（本 checker 逐帧累积的主体）通常一个都没有，跳过
  // JSON.parse + 全文正则，避免 O(n²) 重扫在 G1 12ms/片预算里超时误阻断。
  if (!text.includes('"name"') || !text.includes('"arguments"')) return [];
  try {
    const obj = JSON.parse(text);
    if (isToolCall(obj)) return [obj];
  } catch {}
  const calls: ToolCallShape[] = [];
  for (const line of text.split("\n").filter((l) => l.trim())) {
    try {
      const obj = JSON.parse(line);
      if (isToolCall(obj)) calls.push(obj);
    } catch {}
  }
  if (calls.length === 0) {
    const re = /\{[^{}]*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*"[^"]*"[^{}]*\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      try { const obj = JSON.parse(m[0]); if (isToolCall(obj)) calls.push(obj); } catch {}
    }
  }
  return calls;
}

function makeFinding(rule_id: string): Finding {
  return { checker: CHECKER_ID, threat: "T2a", verdict: "finding", severity: "high", rule_id };
}

function checkUnknownTool(call: ToolCallShape, declared: readonly string[]): Finding | null {
  return declared.includes(call.name) ? null : makeFinding("unknown-tool-name");
}

function checkMissingRequired(
  call: ToolCallShape,
  reqMap: Readonly<Record<string, readonly string[]>>,
): Finding | null {
  const fields = reqMap[call.name];
  if (!fields?.length) return null;
  let args: Record<string, unknown>;
  try { args = JSON.parse(call.arguments); } catch { return null; }
  if (typeof args !== "object" || !args) return null;
  return fields.some((f) => !(f in args)) ? makeFinding("missing-required-args") : null;
}

function checkInvalidJson(call: ToolCallShape): Finding | null {
  try { JSON.parse(call.arguments); } catch { return makeFinding("invalid-json-arguments"); }
  return null;
}

function checkUnit(unit: ScanUnit): CheckerResult {
  for (const text of scanTexts(unit)) {
    const calls = extractToolCalls(text);
    if (!calls.length) continue;
    const declared = Array.isArray(unit.meta.declared_tools)
      ? (unit.meta.declared_tools as string[]) : [];
    const reqMap = unit.meta.declared_required && typeof unit.meta.declared_required === "object"
      ? (unit.meta.declared_required as Record<string, readonly string[]>) : {};
    const findings: Finding[] = [];
    for (const call of calls) {
      if (declared.length) {
        const f1 = checkUnknownTool(call, declared);
        if (f1) findings.push(f1);
        const f2 = checkMissingRequired(call, reqMap);
        if (f2) findings.push(f2);
      }
      const f3 = checkInvalidJson(call);
      if (f3) findings.push(f3);
    }
    if (findings.length) return { verdict: "finding", evidence: findings };
  }
  return { verdict: "clean", evidence: [] };
}

export const checkToolCallShapeNonStream: NonStreamChecker = (unit) => checkUnit(unit);

export const checkToolCallShapeStream: StreamChecker = (window, chunk) => {
  const advanced = {
    pendingBytes: window.pendingBytes,
    cursor: window.cursor + chunk.text.length,
    ...(window.extra !== undefined ? { extra: window.extra } : {}),
  };
  // 256KiB 硬顶的计量对象是**未闭合的 arguments 片段**（§4.2），不是普通正文。
  // content/reasoning 片不累积、不参与越顶判定：各片独立判定，正文长度不受此顶约束。
  if (chunk.meta.has_tool_call_payload !== true) {
    return [checkUnit(chunk), advanced] as const;
  }
  const prevBytes = typeof window.extra?.[ACCUMULATED_BYTES_KEY] === "number"
    ? (window.extra[ACCUMULATED_BYTES_KEY] as number) : 0;
  // 口径 = UTF-8 字节（与 gateway 窗口账本 consumedBytes 一致）；UTF-16 长度会在
  // CJK 文本上低估实际留存最高 3 倍。
  const curBytes = prevBytes + Buffer.byteLength(chunk.text, "utf8");
  if (curBytes > WINDOW_LIMIT) {
    return [{ verdict: "error", evidence: [], reason: "window_overflow" }, {
      pendingBytes: window.pendingBytes, cursor: window.cursor + chunk.text.length,
      extra: { ...window.extra, [ACCUMULATED_BYTES_KEY]: curBytes },
    }] as const;
  }
  const prev = typeof window.extra?.accumulatedText === "string" ? window.extra.accumulatedText : "";
  const acc = prev + chunk.text;
  // 只有可能闭合一个结构时才重扫累积文本：未闭合片段逐帧全文 JSON.parse 是
  // O(n²)，在 G1 12ms/片预算下长 arguments 流会自超时（checker_timeout 误阻断）。
  const next = {
    pendingBytes: window.pendingBytes, cursor: window.cursor + chunk.text.length,
    extra: { ...window.extra, accumulatedText: acc, [ACCUMULATED_BYTES_KEY]: curBytes },
  } as const;
  if (!chunk.text.includes("}")) return [{ verdict: "clean", evidence: [] }, next] as const;
  const result = checkUnit({ ...chunk, text: acc });
  return [result, next] as const;
};

export const TOOL_CALL_SHAPE_SPEC = {
  id: CHECKER_ID, side: "response", synchronous: true, safetyClass: true, threat: "T2a",
  runNonStream: checkToolCallShapeNonStream, runStream: checkToolCallShapeStream,
} as const;
