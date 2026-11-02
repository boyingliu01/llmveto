import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SESSION_KEY_HEADER, deriveSessionKey } from "../../../src/canary/session-key.ts";

// @test REQ-V2a-11
// @intent canary 会话键派生判定面（D-06 / §4.3 / AC-V2a-17 单元级）：头优先（trim 非空即用）、
//         缺头回退 = sha256(首条 user text parts 按 `${len}:${text}` 串接) hex 前 16 字符、
//         拼接歧义消解、非 text part 不计入、空集确定性锚、文本零归一化。
//         期望值用独立 oracle（测试内按 §4.3 公式重算 sha16，非 import 实现）钉死精确构造。
// @covers AC-V2a-17

const NO_HEADERS: Record<string, string> = {};

/** §4.3 摘要输入构造的独立 oracle：sha256(input) hex 前 16 字符（摘要输入由各用例按公式显式给出）。 */
function sha16(digestInput: string): string {
  return createHash("sha256").update(digestInput, "utf8").digest("hex").slice(0, 16);
}

function chatBody(messages: readonly unknown[]): string {
  return JSON.stringify({ model: "test-model", messages });
}

const userText = (content: unknown): unknown => ({ role: "user", content });
const textPart = (text: string): unknown => ({ type: "text", text });
const imagePart = (url: string): unknown => ({ type: "image_url", image_url: { url } });
const parts = (...p: readonly unknown[]): unknown => [...p];

describe("SL-06 deriveSessionKey（REQ-V2a-11 / D-06，AC-V2a-17）", () => {
  it("头名钉死：SESSION_KEY_HEADER = x-llmveto-session-id（D-06 定案；AC-V2a-17 字面 x-llveto-session 是占位名，订正归 SL-15）", () => {
    expect(SESSION_KEY_HEADER).toBe("x-llmveto-session-id");
  });

  describe("头优先族（trim 非空即用）", () => {
    it("非空头即用作会话键；两侧空白的值 trim 后使用（' sess ' 与 'sess' 同键，防空白漂移分裂会话）；头优先于 body", () => {
      const body = chatBody([userText("hi")]);
      expect(deriveSessionKey({ [SESSION_KEY_HEADER]: "sess-A" }, body)).toBe("sess-A");
      expect(deriveSessionKey({ [SESSION_KEY_HEADER]: "  sess-B  " }, body)).toBe("sess-B");
      expect(deriveSessionKey({ [SESSION_KEY_HEADER]: "sess-A" }, chatBody([userText("别的对话")]))).toBe("sess-A");
    });

    it("AC-V2a-17：带 x-llmveto-session-id 的两个会话 → 键不同", () => {
      const body = chatBody([userText("hi")]);
      expect(deriveSessionKey({ [SESSION_KEY_HEADER]: "sess-A" }, body)).not.toBe(
        deriveSessionKey({ [SESSION_KEY_HEADER]: "sess-B" }, body),
      );
    });

    it("AC-V2a-17：同会话两次请求 → 键相同（纯函数同输入恒同输出）", () => {
      const body = chatBody([userText("hi")]);
      const first = deriveSessionKey({ [SESSION_KEY_HEADER]: "sess-A" }, body);
      expect(deriveSessionKey({ [SESSION_KEY_HEADER]: "sess-A" }, body)).toBe(first);
    });

    it("空白 / 空串 / 缺失头 → 一律回退（trim 非空才即用），与显式无头同键", () => {
      const fallback = deriveSessionKey(NO_HEADERS, chatBody([userText("hi")]));
      expect(deriveSessionKey({ [SESSION_KEY_HEADER]: "   " }, chatBody([userText("hi")]))).toBe(fallback);
      expect(deriveSessionKey({ [SESSION_KEY_HEADER]: "" }, chatBody([userText("hi")]))).toBe(fallback);
      expect(deriveSessionKey({}, chatBody([userText("hi")]))).toBe(fallback);
    });
  });

  describe("回退族（缺头 → sha256(len:text 串接首条 user text parts) 前 16 字符）", () => {
    it("单 text part：摘要输入逐字钉死 = `5:hello`（§4.3 公式 oracle），且为 16 字符 hex", () => {
      const key = deriveSessionKey(NO_HEADERS, chatBody([userText("hello")]));
      expect(key).toBe(sha16("5:hello"));
      expect(key).toMatch(/^[0-9a-f]{16}$/);
    });

    it("AC-V2a-17：回退键同对话恒定 —— 对话增长（首条 user 不变）多次请求键不变", () => {
      const short = chatBody([userText("hello"), { role: "assistant", content: "hi" }]);
      const grown = chatBody([userText("hello"), { role: "assistant", content: "hi" }, userText("again?")]);
      expect(deriveSessionKey(NO_HEADERS, short)).toBe(deriveSessionKey(NO_HEADERS, grown));
    });

    it("AC-V2a-17 拼接歧义：[\"ab\",\"c\"] → `2:ab1:c` ≠ [\"a\",\"bc\"] → `1:a2:bc`（长度前缀生效；无分隔实现会在此失败）", () => {
      const abC = deriveSessionKey(NO_HEADERS, chatBody([userText(parts(textPart("ab"), textPart("c")))]));
      const aBc = deriveSessionKey(NO_HEADERS, chatBody([userText(parts(textPart("a"), textPart("bc")))]));
      expect(abC).toBe(sha16("2:ab1:c"));
      expect(aBc).toBe(sha16("1:a2:bc"));
      expect(abC).not.toBe(aBc);
    });

    it("content 为字符串视为单 part：\"hello\" ≡ [{type:\"text\",text:\"hello\"}]", () => {
      const asString = deriveSessionKey(NO_HEADERS, chatBody([userText("hello")]));
      const asParts = deriveSessionKey(NO_HEADERS, chatBody([userText(parts(textPart("hello")))]));
      expect(asString).toBe(asParts);
    });

    it("取首条 user 而非末条：[user A, user B] 的键 = [user A] 的键 ≠ [user B] 的键", () => {
      const both = deriveSessionKey(NO_HEADERS, chatBody([userText("first"), userText("second")]));
      expect(both).toBe(deriveSessionKey(NO_HEADERS, chatBody([userText("first")])));
      expect(both).not.toBe(deriveSessionKey(NO_HEADERS, chatBody([userText("second")])));
    });

    it("非 text part 不计入摘要输入：text part 旁的图像 part 不改键", () => {
      const withImage = deriveSessionKey(NO_HEADERS, chatBody([userText(parts(textPart("hello"), imagePart("u")))]));
      const textOnly = deriveSessionKey(NO_HEADERS, chatBody([userText(parts(textPart("hello")))]));
      expect(withImage).toBe(textOnly);
    });

    it("零归一化：大小写 / 首尾空白参与摘要（不 NFKC、不折叠、不裁剪）", () => {
      const base = deriveSessionKey(NO_HEADERS, chatBody([userText("hello")]));
      expect(deriveSessionKey(NO_HEADERS, chatBody([userText("Hello")]))).not.toBe(base);
      expect(deriveSessionKey(NO_HEADERS, chatBody([userText("hello ")]))).not.toBe(base);
    });
  });

  describe("空集确定性族（无 user / user 无 text part / body 不可解析）", () => {
    it("无 user message（system+tool only）→ 确定性锚键 = sha256(\"0:\") 前 16 字符（行为钉死；该场景注入落分支 6，键是否被用属网关侧 SL-07）", () => {
      const body = chatBody([{ role: "system", content: "sys" }, { role: "tool", content: "res" }]);
      expect(deriveSessionKey(NO_HEADERS, body)).toBe(sha16("0:"));
      expect(deriveSessionKey(NO_HEADERS, body)).toBe(deriveSessionKey(NO_HEADERS, body));
    });

    it("图像-only user（无 text part）走空集一致路径：键 = 锚键（§7 P4 第⑥条漏检族：仅图像不同的会话共享键 → 串流漏检，不得写成已检测）", () => {
      const imageOnly = chatBody([userText(parts(imagePart("a")))]);
      const noUser = chatBody([{ role: "system", content: "sys" }]);
      expect(deriveSessionKey(NO_HEADERS, imageOnly)).toBe(sha16("0:"));
      expect(deriveSessionKey(NO_HEADERS, imageOnly)).toBe(deriveSessionKey(NO_HEADERS, noUser));
    });

    it("body 不可解析 / 根非对象 / messages 缺失或非数组 → 空集锚键（不抛、确定性）", () => {
      expect(deriveSessionKey(NO_HEADERS, "{not-json")).toBe(sha16("0:"));
      expect(deriveSessionKey(NO_HEADERS, "[]")).toBe(sha16("0:"));
      expect(deriveSessionKey(NO_HEADERS, JSON.stringify({ model: "m" }))).toBe(sha16("0:"));
      expect(deriveSessionKey(NO_HEADERS, JSON.stringify({ messages: "nope" }))).toBe(sha16("0:"));
    });
  });

  describe("负样本族（共享键 → 共享 canary → 串流漏检；§7 P4 已登记代价，注释指向登记行，不写成已检测）", () => {
    it("AC-V2a-17：首条 prompt 逐字节相同的两会话（缺头）共享键", () => {
      const s1 = chatBody([userText("same prompt"), userText("tail-1")]);
      const s2 = chatBody([userText("same prompt"), userText("tail-2")]);
      expect(deriveSessionKey(NO_HEADERS, s1)).toBe(deriveSessionKey(NO_HEADERS, s2));
    });
  });
});
