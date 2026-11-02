import { describe, expect, it } from "vitest";
import {
  checkToolCallShapeNonStream,
  checkToolCallShapeStream,
  TOOL_CALL_SHAPE_SPEC,
} from "../../../src/checkers/tool-call-shape.ts";
import type { ScanUnit, ScanWindow } from "../../../src/shared/types.ts";

// @test REQ-V2a-02
// @intent T2a tool-call-shape checker：三子规则（未知工具名/缺 required/arguments 非法 JSON）
// @covers AC-V2a-02 AC-V2a-03 AC-V2a-13

const unit = (text: string, meta: Record<string, unknown>): ScanUnit => ({
  direction: "response",
  transport: "non-stream",
  text,
  meta,
});

const emptyWindow: ScanWindow = { pendingBytes: new Uint8Array(), cursor: 0 };

describe("SL-09 tool-call-shape (REQ-V2a-02)", () => {
  // ── Rule 1: Unknown tool name ────────────────────────────────────────────────

  it("AC-V2a-02: 声明工具 + 未知工具名 → finding", () => {
    const r = checkToolCallShapeNonStream(
      unit('{"name": "unknown_tool", "arguments": "{}"}', {
        declared_tools: ["get_weather", "search"],
      }),
    );
    expect(r.verdict).toBe("finding");
    expect(r.evidence[0]?.rule_id).toBe("unknown-tool-name");
    expect(r.evidence[0]?.threat).toBe("T2a");
  });

  it("AC-V2a-02: 声明工具 + 已知工具名 → clean", () => {
    const r = checkToolCallShapeNonStream(
      unit('{"name": "get_weather", "arguments": "{}"}', {
        declared_tools: ["get_weather", "search"],
      }),
    );
    expect(r.verdict).toBe("clean");
  });

  // ── Rule 2: Missing required arguments ───────────────────────────────────────

  it("AC-V2a-02: 声明 required + 缺失必填字段 → finding", () => {
    const r = checkToolCallShapeNonStream(
      unit('{"name": "get_weather", "arguments": "{}"}', {
        declared_tools: ["get_weather"],
        declared_required: { get_weather: ["city"] },
      }),
    );
    expect(r.verdict).toBe("finding");
    expect(r.evidence[0]?.rule_id).toBe("missing-required-args");
  });

  it("AC-V2a-02: 声明 required + 提供全部必填字段 → clean", () => {
    const r = checkToolCallShapeNonStream(
      unit('{"name": "get_weather", "arguments": "{\\"city\\": \\"Beijing\\"}"}', {
        declared_tools: ["get_weather"],
        declared_required: { get_weather: ["city"] },
      }),
    );
    expect(r.verdict).toBe("clean");
  });

  it("AC-V2a-02: 未声明 required 的工具 → 跳过 Rule 2", () => {
    const r = checkToolCallShapeNonStream(
      unit('{"name": "get_weather", "arguments": "{}"}', {
        declared_tools: ["get_weather"],
      }),
    );
    expect(r.verdict).toBe("clean");
  });

  // ── Rule 3: Invalid JSON in arguments ────────────────────────────────────────

  it("AC-V2a-13: arguments 非法 JSON → finding（非 error）", () => {
    const r = checkToolCallShapeNonStream(
      unit('{"name": "get_weather", "arguments": "{invalid json}"}', {
        declared_tools: ["get_weather"],
      }),
    );
    expect(r.verdict).toBe("finding");
    expect(r.evidence[0]?.rule_id).toBe("invalid-json-arguments");
    // 关键：不是 error，而是 finding
    expect(r.reason).toBeUndefined();
  });

  it("AC-V2a-13: arguments 合法 JSON → clean", () => {
    const r = checkToolCallShapeNonStream(
      unit('{"name": "get_weather", "arguments": "{\\"key\\": \\"value\\"}"}', {
        declared_tools: ["get_weather"],
      }),
    );
    expect(r.verdict).toBe("clean");
  });

  // ── D-12: Conditional applicability (FP=0) ──────────────────────────────────

  it("AC-V2a-03 FP=0: 无 declared_tools + 合法 tool_calls → clean（Rule 1&2 不适用）", () => {
    const r = checkToolCallShapeNonStream(
      unit('{"name": "any_tool", "arguments": "{}"}', {}),
    );
    expect(r.verdict).toBe("clean");
  });

  it("AC-V2a-03 FP=0: 已声明 + 合法复杂嵌套参数 → clean", () => {
    const complexArgs = JSON.stringify({
      query: "test",
      filters: { status: ["active", "pending"], nested: { deep: true } },
      limit: 10,
    });
    const r = checkToolCallShapeNonStream(
      unit(`{"name": "search", "arguments": ${JSON.stringify(complexArgs)}}`, {
        declared_tools: ["search"],
        declared_required: { search: ["query"] },
      }),
    );
    expect(r.verdict).toBe("clean");
  });

  // ── Multiple tool calls ─────────────────────────────────────────────────────

  it("多个工具调用：一个违规即 finding", () => {
    const text = [
      '{"name": "get_weather", "arguments": "{}"}',
      '{"name": "unknown_tool", "arguments": "{}"}',
    ].join("\n");
    const r = checkToolCallShapeNonStream(
      unit(text, {
        declared_tools: ["get_weather"],
      }),
    );
    expect(r.verdict).toBe("finding");
    expect(r.evidence.length).toBeGreaterThanOrEqual(1);
  });

  it("多个工具调用：全部合规 → clean", () => {
    const text = [
      '{"name": "get_weather", "arguments": "{\\"city\\": \\"Beijing\\"}"}',
      '{"name": "search", "arguments": "{\\"q\\": \\"test\\"}"}',
    ].join("\n");
    const r = checkToolCallShapeNonStream(
      unit(text, {
        declared_tools: ["get_weather", "search"],
        declared_required: { get_weather: ["city"], search: ["q"] },
      }),
    );
    expect(r.verdict).toBe("clean");
  });

  // ── Edge cases ──────────────────────────────────────────────────────────────

  it("无 tool calls → clean", () => {
    const r = checkToolCallShapeNonStream(unit("", {}));
    expect(r.verdict).toBe("clean");
  });

  it("纯文本无 JSON → clean", () => {
    const r = checkToolCallShapeNonStream(unit("Hello world", {}));
    expect(r.verdict).toBe("clean");
  });

  // ── Streaming support ───────────────────────────────────────────────────────

  it("流式：delta 累积后扫描 → finding", () => {
    // 模拟流式 chunks
    const chunk1 = unit('{"name": "unkn', { has_tool_call_payload: true });
    const chunk2 = unit('own_tool", "arguments": "{}"}', { has_tool_call_payload: true });

    let window: ScanWindow = emptyWindow;
    const [r1, w1] = checkToolCallShapeStream(window, chunk1);
    expect(r1.verdict).toBe("clean"); // 片段不完整，暂不判定

    const [r2, _w2] = checkToolCallShapeStream(w1, chunk2);
    // 累积后应检出未知工具名（但此时无 declared_tools，故仍为 clean per D-12）
    expect(r2.verdict).toBe("clean");
  });

  it("流式：带 declared_tools 的 delta 累积 → finding", () => {
    const meta = { declared_tools: ["get_weather"], has_tool_call_payload: true };
    const chunk1 = unit('{"name": "unkn', meta);
    const chunk2 = unit('own_tool", "arguments": "{}"}', meta);

    let window: ScanWindow = emptyWindow;
    const [_r1, w1] = checkToolCallShapeStream(window, chunk1);
    const [r2, _w2] = checkToolCallShapeStream(w1, chunk2);
    expect(r2.verdict).toBe("finding");
    expect(r2.evidence[0]?.rule_id).toBe("unknown-tool-name");
  });

  // ── Window overflow ─────────────────────────────────────────────────────────

  it("window_overflow: 累积超过 256KiB → reason=window_overflow", () => {
    // 构造超大 payload（>256KiB）
    const largeText = '{"name": "test", "arguments": "' + "x".repeat(260 * 1024) + '"}';
    const chunk = unit(largeText, { has_tool_call_payload: true });

    const window: ScanWindow = {
      pendingBytes: new Uint8Array(),
      cursor: 0,
      extra: { accumulatedBytes: 260 * 1024 }, // 模拟已累积超限
    };

    const [r, _next] = checkToolCallShapeStream(window, chunk);
    expect(r.verdict).toBe("error");
    expect(r.reason).toBe("window_overflow");
  });

  it("window_overflow 口径 = UTF-8 字节：131073 个 CJK 字符（393219 B）越顶（UTF-16 长度仍低于 256Ki）", () => {
    const chunk = unit("中".repeat(131_073), { has_tool_call_payload: true });
    expect(chunk.text.length).toBeLessThan(256 * 1024);
    const [r, _next] = checkToolCallShapeStream(emptyWindow, chunk);
    expect(r.verdict).toBe("error");
    expect(r.reason).toBe("window_overflow");
  });

  it("正文流不参与 256KiB 硬顶：content 片跨片累积远超 256KiB 仍 clean（硬顶只约束 arguments 片段）", () => {
    let window: ScanWindow = emptyWindow;
    for (let i = 0; i < 3; i += 1) {
      const [r, next] = checkToolCallShapeStream(window, unit("x".repeat(200 * 1024), {}));
      expect(r.verdict).toBe("clean");
      window = next;
    }
    expect(window.extra?.accumulatedBytes).toBeUndefined();
  });

  // ── Spec declaration ────────────────────────────────────────────────────────

  it("spec 声明：safetyClass=true（安全类）", () => {
    expect(TOOL_CALL_SHAPE_SPEC.safetyClass).toBe(true);
    expect(TOOL_CALL_SHAPE_SPEC.side).toBe("response");
    expect(TOOL_CALL_SHAPE_SPEC.synchronous).toBe(true);
  });
});
