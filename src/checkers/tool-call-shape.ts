// @no-test-required: 测试在 tests/unit/checkers/tool-call-shape.test.ts（Gate 5a 仅识别同目录/根 tests/ 六种路径）
import type {
  CheckerResult,
  Finding,
  NonStreamChecker,
  ScanUnit,
  ScanWindow,
  StreamChecker,
} from "../shared/types.ts";
import { scanTexts } from "../shared/types.ts";

/**
 * @test REQ-V2a-02
 * @intent T2a tool-call-shape checker（安全类）：三子规则
 *   1. 未知工具名  2. 缺失 required 参数  3. arguments 非法 JSON
 * D-12 FP=0：Rule 1&2 仅 declared_tools 存在时适用；Rule 3 始终适用。
 */

export const CHECKER_ID = "tool-call-shape";
const WINDOW_LIMIT = 256 * 1024;

interface ToolCallShape { name: string; arguments: string }

function isToolCall(obj: unknown): obj is ToolCallShape {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return typeof o.name === "string" && typeof o.arguments === "string";
}

function extractToolCalls(text: string): ToolCallShape[] {
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
  const prevLen = typeof window.extra?.accumulatedLength === "number" ? window.extra.accumulatedLength : 0;
  const curLen = prevLen + chunk.text.length;
  if (curLen > WINDOW_LIMIT) {
    return [{ verdict: "error", evidence: [], reason: "window_overflow" }, {
      pendingBytes: window.pendingBytes, cursor: window.cursor + chunk.text.length,
      extra: { ...window.extra, accumulatedLength: curLen },
    }] as const;
  }
  const prev = typeof window.extra?.accumulatedText === "string" ? window.extra.accumulatedText : "";
  const acc = prev + chunk.text;
  const result = checkUnit({ ...chunk, text: acc });
  return [result, {
    pendingBytes: window.pendingBytes, cursor: window.cursor + chunk.text.length,
    extra: { ...window.extra, accumulatedText: acc, accumulatedLength: curLen },
  }] as const;
};

export const TOOL_CALL_SHAPE_SPEC = {
  id: CHECKER_ID, side: "response", synchronous: true, safetyClass: true,
  runNonStream: checkToolCallShapeNonStream, runStream: checkToolCallShapeStream,
} as const;
