import { describe, expect, it } from "vitest";
import { decodeEscapes, isAuthHeader, buildRequestScanUnit, buildResponseScanUnit, createToolCallArgsMerger, buildMergedToolCallScanUnit } from "../../../src/gateway/scan-unit.ts";
import { encodeVetoEvent, parseSseFrames, tryParseJson } from "../../../src/gateway/sse-tee.ts";
import { GatewayCore } from "../../../src/gateway/core.ts";
import { EvidenceWriter } from "../../../src/evidence/writer.ts";
import type { ScanWindow } from "../../../src/shared/types.ts";
import { invisibleUnicodeScanNonStream } from "../../../src/checkers/invisible-unicode-scan.ts";
import { egressSecretScan } from "../../../src/checkers/egress-secret-scan.ts";

// @test REQ-VETO-002
// @intent 扫描单元组装 + SSE 帧解析 + veto-mid-stream 契约（AC-VETO-002-06 / AC-VETO-002-03）
// @covers AC-VETO-002-03 AC-VETO-002-06

describe("SL-09 gateway: scan-unit + sse-tee", () => {
  it("AC-06 认证类头名单：6 项", () => {
    expect(isAuthHeader("Authorization")).toBe(true);
    expect(isAuthHeader("X-API-Key")).toBe(true);
    expect(isAuthHeader("api-key")).toBe(true);
    expect(isAuthHeader("x-goog-api-key")).toBe(true);
    expect(isAuthHeader("Proxy-Authorization")).toBe(true);
    expect(isAuthHeader("Cookie")).toBe(true);
    expect(isAuthHeader("X-Request-Id")).toBe(false);
  });

  it("AC-06 extra_headers 里 Authorization 被排除出扫描单元 text", () => {
    const body = JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      extra_headers: { Authorization: "Bearer sk-abcdefghijklmnopqrstuvwxyz", "X-Trace": "abc" },
    });
    const unit = buildRequestScanUnit(body, JSON.parse(body), {}, "non-stream");
    expect(unit.text).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(unit.text).toContain("X-Trace: abc");
    expect(unit.meta.model_requested).toBe("gpt-4o");
  });

  it("edge: 请求 body 非 JSON → text 原样 + malformed=true", () => {
    const u = buildRequestScanUnit("not-json", null, {}, "non-stream");
    expect(u.text).toBe("not-json");
    expect(u.malformed).toBe(true);
  });

  it("AC-03 encodeVetoEvent：event:error + delivered_chunks 契约", () => {
    const s = encodeVetoEvent(7);
    expect(s).toBe('event: error\ndata: {"error":{"code":"llmveto:veto-mid-stream","delivered_chunks":7}}\n\n');
  });

  it("SSE 帧解析：多帧 + 残帧返回", () => {
    const buf = 'data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c":';
    const { frames, rest } = parseSseFrames(buf);
    expect(frames).toHaveLength(2);
    expect(frames[0]!.data).toBe('{"a":1}');
    expect(frames[1]!.data).toBe('{"b":2}');
    expect(rest).toBe('data: {"c":');
  });

  it("[DONE] 帧：data 值原样透传", () => {
    const { frames } = parseSseFrames("data: [DONE]\n\n");
    expect(frames[0]!.data).toBe("[DONE]");
  });

  it("SSE 帧：event: 行 + 多行 data 累加（\\n 分隔）", () => {
    const buf = "event: ping\ndata: line1\ndata: line2\n\ndata: x\n\n";
    const { frames } = parseSseFrames(buf);
    expect(frames).toHaveLength(2);
    expect(frames[0]!.event).toBe("ping");
    expect(frames[0]!.data).toBe("line1\nline2");
    expect(frames[1]!.data).toBe("x");
    expect(frames[1]!.event).toBeUndefined();
  });

  it("tryParseJson：非对象 JSON 返回 null（number / string / null）", () => {
    expect(tryParseJson("42")).toBeNull();
    expect(tryParseJson('"hi"')).toBeNull();
    expect(tryParseJson("null")).toBeNull();
    expect(tryParseJson("{\"a\":1}")).toEqual({ a: 1 });
    // 数组也是 object (typeof === "object")，非 null → 原样返回
    expect(tryParseJson("[1,2]")).toEqual([1, 2]);
  });

  it("buildRequestScanUnit: content 为数组 → 提取每段 .text", () => {
    const body = JSON.stringify({
      model: "m",
      messages: [{ role: "user", content: [{ type: "text", text: "seg-a" }, { type: "text", text: "seg-b" }] }],
      system: "sys-prompt",
      tools: [{ name: "t" }],
    });
    const unit = buildRequestScanUnit(body, JSON.parse(body), {}, "non-stream");
    expect(unit.text).toContain("seg-a");
    expect(unit.text).toContain("seg-b");
    expect(unit.text).toContain("sys-prompt");
    expect(unit.text).toContain("[{\"name\":\"t\"}]");
  });

  it("buildResponseScanUnit: parsed=null → malformed 分支", () => {
    const u = buildResponseScanUnit("not-json", null, "req-model", "stream");
    expect(u.malformed).toBe(true);
    expect(u.direction).toBe("response");
    expect(u.meta.model_requested).toBe("req-model");
  });

  it("buildResponseScanUnit: 流式 delta.content + finish_reason", () => {
    const text = JSON.stringify({
      model: "gpt-4o",
      usage: { total_tokens: 5 },
      choices: [{ delta: { content: "hello" }, finish_reason: "stop" }],
    });
    const u = buildResponseScanUnit(text, JSON.parse(text), "req", "stream");
    expect(u.text).toBe("hello");
    expect(u.meta.model_responded).toBe("gpt-4o");
    expect(u.meta.finish_reason).toBe("stop");
    expect(u.meta.usage).toEqual({ total_tokens: 5 });
  });

  it("buildResponseScanUnit: 非流式 message.content", () => {
    const text = JSON.stringify({
      model: "claude-x",
      choices: [{ message: { content: "world" } }],
    });
    const u = buildResponseScanUnit(text, JSON.parse(text), null, "non-stream");
    expect(u.text).toBe("world");
    expect(u.meta.model_responded).toBe("claude-x");
    expect(u.meta.model_requested).toBeUndefined();
  });

  it("buildResponseScanUnit: choices 内含非对象项 → 跳过（continue 分支）", () => {
    const text = JSON.stringify({ choices: [null, 42, { delta: { content: "ok" } }] });
    const u = buildResponseScanUnit(text, JSON.parse(text), null, "stream");
    expect(u.text).toBe("ok");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SL-01（REQ-V2a-01 / D-12）：declared_tools / declared_required 从请求体提取。
// v1 缺陷：请求体 tools 声明面从未进 meta —— SL-09 tool-call-shape 的
// "未知工具名 / 缺 required" 子规则没有判定源。下传链：请求 meta → core →
// 响应 meta（非流式单元 / 流式逐帧单元 / 归并单元三处同参）。
// ─────────────────────────────────────────────────────────────────────────────
describe("SL-01 gateway: declared_tools / declared_required 提取与下传（D-12）", () => {
  it("buildRequestScanUnit: tools[*].function.name → meta.declared_tools；parameters.required → meta.declared_required（非字符串项剔除）", () => {
    const body = JSON.stringify({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      tools: [
        { type: "function", function: { name: "run_shell", parameters: { type: "object", required: ["cmd", "cwd", 42] } } },
        { type: "function", function: { name: "search_web" } },
      ],
    });
    const u = buildRequestScanUnit(body, JSON.parse(body), {}, "non-stream");
    expect(u.meta.declared_tools).toEqual(["run_shell", "search_web"]);
    expect(u.meta.declared_required).toEqual({ run_shell: ["cmd", "cwd"] });
  });

  it("buildRequestScanUnit: 无 tools → meta 不含 declared 键（declared_tools 为空即两子规则不适用的判定源）", () => {
    const body = JSON.stringify({ model: "m", messages: [{ role: "user", content: "hi" }] });
    const u = buildRequestScanUnit(body, JSON.parse(body), {}, "non-stream");
    expect(u.meta.declared_tools).toBeUndefined();
    expect(u.meta.declared_required).toBeUndefined();
  });

  it("buildResponseScanUnit: declaredMeta 参数下传进响应单元 meta（非流式与流式同参）", () => {
    const text = JSON.stringify({ choices: [{ message: { content: "ok" } }] });
    const declared = { declared_tools: ["run_shell"], declared_required: { run_shell: ["cmd"] } };
    const u1 = buildResponseScanUnit(text, JSON.parse(text), null, "non-stream", declared);
    const u2 = buildResponseScanUnit(text, JSON.parse(text), null, "stream", declared);
    expect(u1.meta.declared_tools).toEqual(["run_shell"]);
    expect(u2.meta.declared_required).toEqual({ run_shell: ["cmd"] });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SL-01（AC-V2a-01）：流式 delta.tool_calls 跨 chunk 归并。
// v1 缺陷：流式管线逐帧扫描，arguments 按任意切点分片进不同 SSE 帧，隐形字符的
// 字面转义（\u200b 六字符）被帧边界切开时任一单帧均无完整命中——invisible-unicode
// 参数覆盖面从声明落空为事实。修法：同一 response 内按 tool_call index 累积片段，
// 归并完成后再进扫描域（不能逐 chunk 扫碎片）；不丢字节 = 任意切分点下重组结果
// 与原始字符串逐字符相等（纯字符串拼接，零归一化）。
// ─────────────────────────────────────────────────────────────────────────────

/** 构造一帧流式 delta.tool_calls 的 SSE data JSON；首帧带 name/id，续帧只有 index+arguments。 */
function toolCallFrame(args: string, index = 0, withName = false): string {
  const tc: Record<string, unknown> = { index, function: withName ? { name: "run_shell", arguments: args } : { arguments: args } };
  if (withName) { tc.id = "call_" + index; tc.type = "function"; }
  return JSON.stringify({ choices: [{ delta: { tool_calls: [tc] } }] });
}

describe("SL-01 gateway: 流式 delta.tool_calls 跨 chunk 归并（AC-V2a-01）", () => {
  it("RED 基准：转义序列跨帧切开的 U+200B 藏于 arguments，逐帧扫描均 clean（v1 漏检面本体）", () => {
    const f1 = toolCallFrame('{"cmd":"echo \\u200', 0, true);
    const f2 = toolCallFrame('b.png"}');
    for (const f of [f1, f2]) {
      const u = buildResponseScanUnit(f, JSON.parse(f), null, "stream");
      expect(invisibleUnicodeScanNonStream(u).verdict).toBe("clean");
    }
  });

  it("归并后检出：跨帧切开的 \\u200b → finding（invisible-unicode-escaped），归并文本逐字符还原", () => {
    const m = createToolCallArgsMerger();
    m.feed(JSON.parse(toolCallFrame('{"cmd":"echo \\u200', 0, true)));
    m.feed(JSON.parse(toolCallFrame('b.png"}')));
    expect(m.mergedText()).toBe('{"cmd":"echo \\u200b.png"}'); // 字面 6 字符转义完整重组
    expect(m.toolCallCount).toBe(1);
    const r = invisibleUnicodeScanNonStream(buildMergedToolCallScanUnit(m.mergedText()));
    expect(r.verdict).toBe("finding");
    expect(r.evidence[0]!.rule_id).toBe("invisible-unicode-escaped");
  });

  it("真实 U+200B 经归并 → finding 且 offsets 可定位（原始投影命中）", () => {
    const m = createToolCallArgsMerger();
    m.feed(JSON.parse(toolCallFrame('{"p":"a\u200Bb"}', 0, true)));
    const r = invisibleUnicodeScanNonStream(buildMergedToolCallScanUnit(m.mergedText()));
    expect(r.verdict).toBe("finding");
    expect(r.evidence[0]!.rule_id).toBe("invisible-unicode");
    expect(r.evidence[0]!.offsets).toHaveLength(1);
  });

  it("不丢字节：arguments 在任意切分点切成两帧 + 空片段帧，归并结果与原始字符串逐字符相等", () => {
    const ARGS = '{"cmd":"echo \\u200bhi","path":"a\u200Bb","n":42}'; // 字面转义 + 真实字符混合形态
    for (let cut = 1; cut < ARGS.length; cut++) {
      const m = createToolCallArgsMerger();
      m.feed(JSON.parse(toolCallFrame(ARGS.slice(0, cut), 0, true)));
      m.feed(JSON.parse(toolCallFrame(ARGS.slice(cut))));
      m.feed(JSON.parse(toolCallFrame("", 0))); // 空片段续帧不得引入噪声
      expect(m.mergedText(), `cut=${cut}`).toBe(ARGS);
    }
  });

  it("按 tool_call index 独立累积：跨工具片段以分隔符隔断，不得拼出伪转义（防 FP）", () => {
    const m = createToolCallArgsMerger();
    m.feed(JSON.parse(toolCallFrame('{"a":"x\\u200', 0, true))); // 工具0 尾部留半个转义
    m.feed(JSON.parse(toolCallFrame('{"b":"y', 1)));            // 工具1 首片段恰为转义后半的 b
    m.feed(JSON.parse(toolCallFrame('b"}', 1)));
    const r = invisibleUnicodeScanNonStream(buildMergedToolCallScanUnit(m.mergedText()));
    expect(r.verdict).toBe("clean"); // 工具0 的 \u200 与工具1 的 b 之间有分隔 → 不构成 \u200b
    // 同工具内仍逐字节拼接
    const m2 = createToolCallArgsMerger();
    m2.feed(JSON.parse(toolCallFrame('{"b":"y', 1)));
    m2.feed(JSON.parse(toolCallFrame('\\u200z"}', 1)));
    expect(m2.mergedText()).toBe('{"b":"y\\u200z"}');
  });

  it("legacy delta.function_call.arguments 与扁平 tool_calls 形态同样归并", () => {
    const legacyFrame = (args: string, withName = false) =>
      JSON.stringify({ choices: [{ delta: { function_call: withName ? { name: "legacy", arguments: args } : { arguments: args } } }] });
    const m = createToolCallArgsMerger();
    m.feed(JSON.parse(legacyFrame('{"x":"LE', true)));
    m.feed(JSON.parse(legacyFrame('GACY"}')));
    expect(m.mergedText()).toBe('{"x":"LEGACY"}');
    // 扁平形态（无 function 包裹，部分网关直发）
    const flatFrame = (args: string, withName = false) =>
      JSON.stringify({ choices: [{ delta: { tool_calls: [withName ? { index: 0, name: "flat", arguments: args } : { index: 0, arguments: args }] } }] });
    const m2 = createToolCallArgsMerger();
    m2.feed(JSON.parse(flatFrame('{"f":"FL', true)));
    m2.feed(JSON.parse(flatFrame('AT"}')));
    expect(m2.mergedText()).toBe('{"f":"FLAT"}');
  });

  it("feed(null)（malformed 帧）/ 非 chat 帧为 no-op；无工具调用 → mergedText 空串", () => {
    const m = createToolCallArgsMerger();
    m.feed(null);
    m.feed({ ok: 1 });
    m.feed(JSON.parse('{"choices":[null,42,{"delta":{"content":"hi"}}]}'));
    expect(m.mergedText()).toBe("");
    expect(m.toolCallCount).toBe(0);
    expect(buildMergedToolCallScanUnit(m.mergedText()).text).toBe("");
  });

  it("benign 工具调用流（含可还原的良性转义）经归并零误报", () => {
    const m = createToolCallArgsMerger();
    m.feed(JSON.parse(toolCallFrame('{"cmd":"ls \\\\u0041.tmp"}', 0, true)));
    m.feed(JSON.parse(toolCallFrame(',"cwd":"/tmp"}')));
    expect(invisibleUnicodeScanNonStream(buildMergedToolCallScanUnit(m.mergedText())).verdict).toBe("clean");
  });

  it("GatewayCore.scanResponseStreamUnit: 归并单元走全量响应 checker 分派（流式+非流式），advance:false 零推进", () => {
    const core = new GatewayCore({ upstreamBaseUrl: "http://127.0.0.1:9", evidenceWriter: new EvidenceWriter("unused-sl01-evidence.jsonl") });
    const u = buildMergedToolCallScanUnit('{"cmd":"a\u200Bb"}');
    const base: ScanWindow = { pendingBytes: new Uint8Array([7]), cursor: 5 };
    const windows = new Map<string, ScanWindow>([["invisible-unicode-scan", base]]);
    // D-07 落地后：归并单元是已消费内容的重投影 → advance:false，窗口零推进
    // （cursor 保持 5，pendingBytes 原样透传）；重投影 meta 由 core 统一打标。
    const { inputs, nextWindows } = core.scanResponseStreamUnit(windows, u, { advance: false });
    expect(inputs.find((i) => i.checkerId === "invisible-unicode-scan")?.result.verdict).toBe("finding");
    const w = nextWindows.get("invisible-unicode-scan");
    expect(w?.cursor).toBe(5);
    expect(w?.pendingBytes).toBe(base.pendingBytes);
  });
});

// 回归组 A（T2a 载体丢失）：tool_calls / function_call 的 arguments 必须进入扫描单元。
// 缺陷形态：原实现只取 `delta.content` / `message.content`，而 OpenAI 兼容协议下**工具调用
// 的载荷全在 `tool_calls[*].function.arguments`**（content 为 null）。于是整条 tool-call 的
// 文本投影为空串 → 响应侧全部 checker 落空。这是"扫描单元构造阶段就丢数据"，
// 比"v1 不做 T2a 判定"更隐蔽：连取证字段都没有。
describe("SL-09 gateway: tool_call 载荷进入扫描单元（T2a 回归）", () => {
  it("非流式 message.tool_calls[*].function.arguments 进入 text", () => {
    const text = JSON.stringify({
      model: "m",
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: { name: "run_shell", arguments: '{"cmd":"echo INJECTED"}' },
          }],
        },
        finish_reason: "tool_calls",
      }],
    });
    const u = buildResponseScanUnit(text, JSON.parse(text), "m", "non-stream");
    expect(u.text).toContain("INJECTED");
    expect(u.text).toContain("run_shell");
  });

  it("流式 delta.tool_calls[*].function.arguments 进入 text", () => {
    // 流式下 arguments 是**逐片增量**拼接的，每片单独一个 JSON 帧
    const t1 = JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "run", arguments: '{"a":' } }] } }] });
    const t2 = JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "1}" } }] } }] });
    const u1 = buildResponseScanUnit(t1, JSON.parse(t1), null, "stream");
    const u2 = buildResponseScanUnit(t2, JSON.parse(t2), null, "stream");
    expect(u1.text).toContain('{"a":');
    expect(u2.text).toContain("1}");
  });

  it("regression: tool_call arguments 含 U+200B → invisible-unicode-scan 判定 finding", () => {
    const text = JSON.stringify({
      model: "m",
      choices: [{
        message: {
          content: null,
          tool_calls: [{ id: "c", type: "function", function: { name: "run", arguments: '{"cmd":"echo\u200bhi"}' } }],
        },
        finish_reason: "tool_calls",
      }],
    });
    const u = buildResponseScanUnit(text, JSON.parse(text), "m", "non-stream");
    const r = invisibleUnicodeScanNonStream(u);
    expect(r.verdict).toBe("finding");
    expect(r.evidence[0]!.rule_id).toBe("invisible-unicode");
    expect(r.evidence[0]!.offsets!.length).toBeGreaterThan(0);
  });

  it("legacy function_call.arguments 也进入 text", () => {
    const text = JSON.stringify({
      choices: [{ message: { content: null, function_call: { name: "run", arguments: '{"x":"LEGACYINJ"}' } } }],
    });
    const u = buildResponseScanUnit(text, JSON.parse(text), null, "non-stream");
    expect(u.text).toContain("LEGACYINJ");
  });

  it("arguments 为对象形态（非标准网关直发）→ 序列化后入 text，不得静默丢载荷", () => {
    // PWR1-B-m5：协议规定 arguments 是字符串，但 typeof 过滤会把对象形态整条丢回"载体丢失"缺陷类
    const text = JSON.stringify({
      choices: [{ message: { content: null, tool_calls: [{ function: { name: "run", arguments: { cmd: "OBJINJ" } } }] } }],
    });
    const u = buildResponseScanUnit(text, JSON.parse(text), null, "non-stream");
    expect(u.text).toContain("OBJINJ");
  });

  it("请求侧 messages[*].tool_calls arguments 进入 text", () => {
    const body = JSON.stringify({
      model: "m",
      messages: [{
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "run", arguments: '{"cmd":"REQINJ"}' } }],
      }],
    });
    const u = buildRequestScanUnit(body, JSON.parse(body), {}, "non-stream");
    expect(u.text).toContain("REQINJ");
  });
});

// 回归组 B（编码层绕过）：checker 只见解码后的 UTF-8 文本，而 JSON 里同一个字符有两种写法——
// 字面字符，或 `\uXXXX` 转义序列。原实现只匹配字面形态，于是攻击者只要**用转义写法书写**
// 就能整类绕过（而 JSON 是唯一传输编码，"用转义写法"是最省事的注入方式）。
// 修法：扫描单元**额外**投影一份"转义已还原"的文本，checker 对两份都扫。
//
// **判别力口径（PWR1-B-M2 处置）**：绕过载荷在 JSON **线路上**写作 `\\u200b`（双反斜杠），
// `JSON.parse` 后得到**字面** 6 字符 `\u200b`——这才是缺陷④的形态，只有 decodeEscapes 的
// 第二投影能抓到。单反斜杠的线路形态 `"hello\u200bworld"` 会被 JSON.parse 直接还原为真实
// 字符进 `text`，修复前的实现也能抓到——那是对照组，**不是**本回归组的判别对象。
describe("SL-09 gateway: 转义序列不得绕过 checker（编码层回归）", () => {
  // 线路双反斜杠（JS 源里四个反斜杠）→ parse 后 text 含字面转义 → decoded 投影命中
  const WIRE_ESC = { zwsp: "\\\\u200b", zwspUpper: "\\\\u200B", rtlOverride: "\\\\u202e", rtlUpper: "\\\\u202E", bom: "\\\\ufeff", bomUpper: "\\\\uFEFF" } as const;

  it("regression: 线路 \\\\u200b 双反斜杠写法 → text 存字面转义、decoded 命中、escaped finding", () => {
    const raw = `{"model":"m","messages":[{"role":"user","content":"hello${WIRE_ESC.zwsp}world"}]}`;
    const u = buildRequestScanUnit(raw, JSON.parse(raw), {}, "non-stream");
    // 前置事实：parse 后原始 text 里是 6 个字符的字面转义，**没有**真实隐形字符
    expect(u.text).toContain("\\u200b");
    expect(u.text).not.toContain("\u200B");
    expect(u.decoded).toBeDefined();
    expect(u.decoded).toContain("\u200B");
    const r = invisibleUnicodeScanNonStream(u);
    expect(r.verdict).toBe("finding");
    expect(r.evidence[0]!.rule_id).toBe("invisible-unicode-escaped");
    expect(r.evidence[0]!.offsets).toBeUndefined();
  });

  it("regression: 线路 \\\\u200b 双反斜杠（响应侧）→ finding", () => {
    const raw = `{"choices":[{"delta":{"content":"a${WIRE_ESC.zwsp}b"}}]}`;
    const u = buildResponseScanUnit(raw, JSON.parse(raw), null, "stream");
    const r = invisibleUnicodeScanNonStream(u);
    expect(r.verdict).toBe("finding");
    expect(r.evidence[0]!.rule_id).toBe("invisible-unicode-escaped");
  });

  it("regression: 线路双反斜杠的大写/小写十六进制均被识别", () => {
    for (const esc of Object.values(WIRE_ESC)) {
      const raw = `{"choices":[{"delta":{"content":"x${esc}y"}}]}`;
      const u = buildResponseScanUnit(raw, JSON.parse(raw), null, "stream");
      const r = invisibleUnicodeScanNonStream(u);
      expect(r.verdict, `escape ${esc} 应被检出`).toBe("finding");
      expect(r.evidence[0]!.rule_id, `escape ${esc} 应走 escaped 投影`).toBe("invisible-unicode-escaped");
    }
  });

  it("regression: 双反斜杠转义写法不得漏检 tool_call arguments（两组缺陷叠加）", () => {
    // 外层 JSON 串内再嵌一个 JSON 串（arguments 是字符串形态）。线路形态里内层的引号
    // 写作 `\"` 即一次反斜杠+引号（`\\\"` 三反斜杠在模板字面量里是冗余转义，oxlint 判 useless）。
    // 外层 JSON.parse 后 arguments 留字面 `a\\u200bb`（双反斜杠 zwsp 未被 parse 还原）
    // —— 恰是 decodeEscapes 最内层塌缩的适用面。
    const raw = `{"choices":[{"message":{"content":null,"tool_calls":[{"function":{"name":"run","arguments":"{\\"c\\":\\"a${WIRE_ESC.zwsp}b\\"}"}}]}}]}`;
    const u = buildResponseScanUnit(raw, JSON.parse(raw), null, "non-stream");
    const r = invisibleUnicodeScanNonStream(u);
    expect(r.verdict).toBe("finding");
    expect(r.evidence[0]!.rule_id).toBe("invisible-unicode-escaped");
    expect(u.text).toContain("run"); // tool_call 载体确已入单元（缺陷③回归仍成立）
  });

  it("regression: 双反斜杠转义写法不得漏检出站凭据", () => {
    // `sk-\u0061…`：凭据首字母用转义书写拆散朴素匹配；线路双反斜杠 → parse 后留字面转义，
    // 只有 decoded 投影能还原出 `sk-abcdef…` 形态（同一分支也验证 egress 不报伪 offsets）
    const raw = `{"messages":[{"role":"user","content":"sk-${WIRE_ESC.zwsp.replace("200b", "0061")}bcdefghijklmnopqrstuvwxyz"}]}`;
    const u = buildRequestScanUnit(raw, JSON.parse(raw), {}, "non-stream");
    const r = egressSecretScan(u);
    expect(r.verdict).toBe("finding");
    const sk = r.evidence.find((f) => f.rule_id === "openai-sk");
    expect(sk).toBeDefined();
    expect(sk!.offsets).toBeUndefined(); // 转义投影命中：无原始坐标可报
  });

  it("对照（修复前即绿，无判别力，仅作形态基准）：单反斜杠线路形态由 JSON.parse 直接还原", () => {
    const raw = '{"model":"m","messages":[{"role":"user","content":"hello\\u200bworld"}]}';
    const u = buildRequestScanUnit(raw, JSON.parse(raw), {}, "non-stream");
    expect(u.text).toContain("\u200B"); // parse 已还原为真实字符 → 走原始投影
    expect(u.decoded).toBeUndefined();
    const r = invisibleUnicodeScanNonStream(u);
    expect(r.evidence[0]!.rule_id).toBe("invisible-unicode");
  });

  it("对照：benign 文本（含普通反斜杠）不得因转义还原而误报", () => {
    const raw = '{"messages":[{"role":"user","content":"windows path C:\\\\Users\\\\me and \\\\n newline"}]}';
    const u = buildRequestScanUnit(raw, JSON.parse(raw), {}, "non-stream");
    expect(invisibleUnicodeScanNonStream(u).verdict).toBe("clean");
  });
});

// decodeEscapes 直测（PWR1-B-M2：此前该函数无任何直接单测，端到端组又未穿过其分支）。
describe("SL-09 gateway: decodeEscapes 直接单测", () => {
  it("\\uXXXX 还原为真实码点", () => {
    expect(decodeEscapes("a\\u200bb")).toBe("a\u200Bb");
  });
  it("\\u{XXXXX} 花括号形态还原", () => {
    expect(decodeEscapes("x\\u{1F600}y")).toBe("x\u{1F600}y");
  });
  it("\\xXX 还原", () => {
    expect(decodeEscapes("\\x41")).toBe("A");
  });
  it("多重反斜杠：最内层 \\uXXXX 总被还原，多余反斜杠留作字面（不构成绕过面）", () => {
    expect(decodeEscapes("\\\\u200b")).toBe("\\" + "\u200B");
    expect(decodeEscapes("\\\\\\u200b")).toBe("\\\\" + "\u200B");
  });
  it("代理对逐码元还原（拼接后恰为配对形态；v1 码点集全 BMP，成文边界）", () => {
    expect(decodeEscapes("\\uD83D\\uDE00")).toBe("\u{1F600}");
  });
  it("孤立代理码元：\\uXXXX 与 \\u{...} 两语法一律保留该码元（PWR3-B-m2）", () => {
    // 改前 `\u{d800}` 走 String.fromCodePoint 抛错被吞成空串，等于该字符从解码投影里**消失**；
    // 同一码元的 `\ud800` 式却保留 —— 语法差异即绕过面。两式现须逐字相同。
    expect(decodeEscapes("a\\u{d800}b")).toBe("a\uD800b");
    expect(decodeEscapes("a\\ud800b")).toBe("a\uD800b");
    expect(decodeEscapes("a\\u{d800}b")).toBe(decodeEscapes("a\\ud800b"));
  });
  it("超上限码点仍丢字（两式一致，非绕过面：0x110000 无对应字符）", () => {
    expect(decodeEscapes("a\\u{110000}b")).toBe("ab");
  });
  it("无转义序列 → 返回同一字符串引用（scanTexts 由此省略第二遍）", () => {
    const s = "no escapes here";
    expect(decodeEscapes(s)).toBe(s);
  });
  it("刻意不做通用 JSON 解转义：\\n / \\\" / \\\\ 原样保留", () => {
    expect(decodeEscapes("a\\nb")).toBe("a\\nb");
    expect(decodeEscapes('say \\"hi\\"')).toBe('say \\"hi\\"');
  });
  it("URL 编码排场外：%E2%80%8B 不还原（成文边界）", () => {
    expect(decodeEscapes("%E2%80%8B")).toBe("%E2%80%8B");
  });
});
