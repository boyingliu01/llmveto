import { describe, expect, it } from "vitest";
import { isAuthHeader, buildRequestScanUnit, buildResponseScanUnit } from "../../../src/gateway/scan-unit.ts";
import { encodeVetoEvent, parseSseFrames, tryParseJson } from "../../../src/gateway/sse-tee.ts";
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
describe("SL-09 gateway: 转义序列不得绕过 checker（编码层回归）", () => {
  it("regression: \\u200b 转义写法 → invisible-unicode-scan 判定 finding", () => {
    // 注意：这是**原始 JSON 文本**里写着反斜杠-u-2-0-0-b 六个字符，未经 JSON.parse 还原
    const raw = '{"model":"m","messages":[{"role":"user","content":"hello\\u200bworld"}]}';
    const u = buildRequestScanUnit(raw, JSON.parse(raw), {}, "non-stream");
    const r = invisibleUnicodeScanNonStream(u);
    expect(r.verdict).toBe("finding");
    expect(r.evidence[0]!.rule_id).toBe("invisible-unicode");
  });

  it("regression: \\u200b 转义写法（响应侧）→ finding", () => {
    const raw = '{"choices":[{"delta":{"content":"a\\u200bb"}}]}';
    const u = buildResponseScanUnit(raw, JSON.parse(raw), null, "stream");
    expect(invisibleUnicodeScanNonStream(u).verdict).toBe("finding");
  });

  it("regression: 转义写法的大写/小写十六进制均被识别", () => {
    for (const esc of ["\\u200b", "\\u200B", "\\u202e", "\\u202E", "\\ufeff", "\\uFEFF"]) {
      const raw = `{"choices":[{"delta":{"content":"x${esc}y"}}]}`;
      const u = buildResponseScanUnit(raw, JSON.parse(raw), null, "stream");
      expect(invisibleUnicodeScanNonStream(u).verdict, `escape ${esc} 应被检出`).toBe("finding");
    }
  });

  it("regression: \\u200b 转义写法不得漏检 tool_call arguments（两组缺陷叠加）", () => {
    const raw = '{"choices":[{"message":{"content":null,"tool_calls":[{"function":{"name":"run","arguments":"{\\"c\\":\\"a\\u200bb\\"}"}}]}}]}';
    const u = buildResponseScanUnit(raw, JSON.parse(raw), null, "non-stream");
    expect(invisibleUnicodeScanNonStream(u).verdict).toBe("finding");
  });

  it("regression: 转义写法不得漏检出站凭据", () => {
    // `sk-` 本身无需转义，但攻击者可用转义写任意字符以规避朴素匹配；此处验证
    // 凭据规则在"转义还原后"的文本上仍工作（用转义书写的一个字符构造 sk- 形态）
    const raw = '{"messages":[{"role":"user","content":"sk-\\u0061bcdefghijklmnopqrstuvwxyz"}]}';
    const u = buildRequestScanUnit(raw, JSON.parse(raw), {}, "non-stream");
    expect(egressSecretScan(u).verdict).toBe("finding");
  });

  it("对照：benign 文本（含普通反斜杠）不得因转义还原而误报", () => {
    const raw = '{"messages":[{"role":"user","content":"windows path C:\\\\Users\\\\me and \\\\n newline"}]}';
    const u = buildRequestScanUnit(raw, JSON.parse(raw), {}, "non-stream");
    expect(invisibleUnicodeScanNonStream(u).verdict).toBe("clean");
  });
});
