import { describe, expect, it } from "vitest";
import { decodeEscapes, isAuthHeader, buildRequestScanUnit, buildResponseScanUnit } from "../../../src/gateway/scan-unit.ts";
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
