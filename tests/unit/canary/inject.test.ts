import { describe, expect, it } from "vitest";
import { inject, type InjectResult } from "../../../src/canary/inject.ts";
import { REASON_VOCAB } from "../../../src/evidence/schema.ts";

// @test REQ-V2a-11
// @intent inject 六分支判定面（§4.4 逐字 / AC-V2a-07 + AC-V2a-18 单元级）：每分支 ≥1 例参数化，
//         断言对象逐字取 §4.4 右列"不变式落点"该行写法（不得用统一"末条前缀比对"套全部分支）；
//         注入分支共断 canary 在 B′ 中恰出现一次（唯一 k 判据的可执行形态）；分支 6 断言
//         injected=false + skip_reason="inject_skipped"（∈ evidence REASON_VOCAB）+ 原串一字节不动。
//         meta.canary_injected / status 计数 / 顶层 reason 接线 / 语义孪生两趟对照属网关级（SL-07），
//         本判定面不产出 meta。
// @covers AC-V2a-07（单元级）, AC-V2a-18（单元级）

/** 显式 27 字符固定 canary（AC-V2a-07 定值 27 字符的同形固定串；本切片只消费传入串，不依赖默认熵）。 */
const CANARY = "llmveto-canary-abcdef012345";

interface ParsedBody {
  messages: Array<Record<string, unknown>>;
  model?: string;
  stream?: boolean;
  tools?: unknown[];
  system?: string;
}

const textPart = (text: string): { type: string; text: string } => ({ type: "text", text });
const imagePart = (url: string): { type: string; image_url: { url: string } } => ({
  type: "image_url",
  image_url: { url },
});

function countOccurrences(haystack: string, needle: string): number {
  let n = 0;
  for (let i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + needle.length)) n += 1;
  return n;
}

function injectedBody(r: InjectResult): string {
  if (!r.injected) throw new Error(`expected injected=true, got skip_reason=${String(r.skip_reason)}`);
  return r.body;
}

function skippedOf(r: InjectResult): { body: string; skip_reason: string } {
  if (r.injected) throw new Error("expected injected=false");
  return { body: r.body, skip_reason: r.skip_reason };
}

/** §4.4 分支 1~5 参数化用例：verify(original, out) 逐字实现该行右列"不变式落点"。 */
interface InjectedCase {
  readonly branch: 1 | 2 | 3 | 4 | 5;
  readonly name: string;
  readonly body: string;
  readonly verify: (original: string, out: string) => void;
}

const INJECTED_CASES: readonly InjectedCase[] = [
  {
    branch: 1,
    name: "content 非空字符串 → 尾部追加：content' 以 content 为前缀，且 len(content') − len(content) = 27",
    body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "hello" }] }),
    verify: (original, out) => {
      const before = (JSON.parse(original) as ParsedBody).messages[0]!;
      const after = (JSON.parse(out) as ParsedBody).messages[0]!;
      expect(after.content).toBe((before.content as string) + CANARY); // 前缀判据（含精确值）
      expect((after.content as string).length - (before.content as string).length).toBe(27); // 长度差判据
    },
  },
  {
    branch: 2,
    name: "parts 数组且含 text part → 追加到最后一个 text part：parts' 与 parts 等长且逐 index 相等，仅该 text part 满足前缀 + 长度差判据",
    body: JSON.stringify({
      model: "m",
      messages: [{ role: "user", content: [textPart("p1"), imagePart("img"), textPart("p2")] }],
    }),
    verify: (original, out) => {
      const before = (JSON.parse(original) as ParsedBody).messages[0]!.content as unknown[];
      const after = (JSON.parse(out) as ParsedBody).messages[0]!.content as unknown[];
      expect(after).toHaveLength(before.length); // 等长
      expect(after[0]).toEqual(before[0]); // 逐 index 相等（首个 text part 不动）
      expect(after[1]).toEqual(before[1]); // 逐 index 相等（图像 part 不动）
      const lastBefore = (before[2] as { text: string }).text;
      const lastAfter = (after[2] as { text: string }).text;
      expect(lastAfter).toBe(lastBefore + CANARY); // 仅最后一个 text part：前缀判据
      expect(lastAfter.length - lastBefore.length).toBe(27); // 长度差判据
    },
  },
  {
    branch: 3,
    name: "parts 数组但无 text part（纯图像）→ 数组末尾新增只含 canary 的 text part：parts'[0..n−1] 逐字节相等、len(parts') = len(parts) + 1、新增元素的 text 恰为 canary",
    body: JSON.stringify({ model: "m", messages: [{ role: "user", content: [imagePart("img1"), imagePart("img2")] }] }),
    verify: (original, out) => {
      const before = (JSON.parse(original) as ParsedBody).messages[0]!.content as unknown[];
      const after = (JSON.parse(out) as ParsedBody).messages[0]!.content as unknown[];
      expect(after).toHaveLength(before.length + 1); // len(parts') = len(parts) + 1
      expect(after.slice(0, before.length)).toEqual(before); // parts'[0..n−1] 逐字节相等
      expect(after[before.length]).toEqual({ type: "text", text: CANARY }); // 新增元素的 text 恰为 canary
    },
  },
  {
    branch: 4,
    name: "content 为空字符串 → 置为只含 canary 的文本：前置断言原值确为 \"\"（非空即不属本分支）；结果 content' 恰等于 canary",
    body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "" }] }),
    verify: (original, out) => {
      expect((JSON.parse(original) as ParsedBody).messages[0]!.content).toBe(""); // 前置断言
      expect((JSON.parse(out) as ParsedBody).messages[0]!.content).toBe(CANARY); // content' 恰等于 canary
    },
  },
  {
    branch: 4,
    name: "content 字段缺失 → 置为只含 canary 的文本：前置断言字段缺失；结果 content' 恰等于 canary",
    body: JSON.stringify({ model: "m", messages: [{ role: "user" }] }),
    verify: (original, out) => {
      expect("content" in (JSON.parse(original) as ParsedBody).messages[0]!).toBe(false); // 前置断言：缺失
      expect((JSON.parse(out) as ParsedBody).messages[0]!.content).toBe(CANARY); // content' 恰等于 canary
    },
  },
  {
    branch: 5,
    name: "末条 role=\"tool\" → 回溯最近 role=\"user\"（user content 非空字符串 → 按分支 1）：其后所有 message（含末条 tool）逐字节不变、顶层非 messages 字段（model/stream/tools/system）不变",
    body: JSON.stringify({
      model: "m",
      stream: false,
      system: "sys",
      tools: [{ type: "function", function: { name: "f" } }],
      messages: [{ role: "user", content: "hello" }, { role: "assistant", content: "ok" }, { role: "tool", content: "res" }],
    }),
    verify: (original, out) => {
      const b = JSON.parse(original) as ParsedBody;
      const a = JSON.parse(out) as ParsedBody;
      const before = b.messages[0]!.content as string;
      expect(a.messages[0]!.content).toBe(before + CANARY); // 注入点 message 按分支 1 判据：前缀
      expect((a.messages[0]!.content as string).length - before.length).toBe(27); // 长度差
      expect(a.messages.slice(1)).toEqual(b.messages.slice(1)); // 其后所有 message 逐字节不变（JSON 值级；字符串格式规范化不属违例，R2 A-MAJ1）
      expect(a.model).toBe(b.model); // 顶层非 messages 字段不变
      expect(a.stream).toBe(b.stream);
      expect(a.system).toBe(b.system);
      expect(a.tools).toEqual(b.tools);
    },
  },
  {
    branch: 5,
    name: "末条 role=\"tool\"、最近 user 为 parts 数组 → 按分支 2 分派（追加到最后一个 text part）：其后 message 不变",
    body: JSON.stringify({
      model: "m",
      messages: [{ role: "user", content: [textPart("p1"), imagePart("img")] }, { role: "assistant", content: "ok" }, { role: "tool", content: "res" }],
    }),
    verify: (original, out) => {
      const b = JSON.parse(original) as ParsedBody;
      const a = JSON.parse(out) as ParsedBody;
      const after = a.messages[0]!.content as unknown[];
      expect(after).toHaveLength(2); // 分支 2 判据：等长
      expect(after[0]).toEqual(textPart("p1" + CANARY)); // 最后一个 text part（index 0）被追加——图像 part 在其后也不改变"最后一个 text part"语义
      expect(after[1]).toEqual(imagePart("img")); // 图像 part 不动
      expect(a.messages.slice(1)).toEqual(b.messages.slice(1)); // 其后所有 message 逐字节不变
    },
  },
];

const SKIPPED_CASES: readonly { name: string; body: string }[] = [
  { name: "body 不可解析为 JSON（截断）", body: '{"model":"m","messages":[{"role":"user"' },
  { name: "根非对象（数组）", body: "[]" },
  { name: "合法 JSON 但缺 messages 字段（AC-V2a-18 B_skip 形态）", body: JSON.stringify({ model: "m" }) },
  { name: "messages 非数组", body: JSON.stringify({ model: "m", messages: "nope" }) },
  { name: "messages 为空数组", body: JSON.stringify({ model: "m", messages: [] }) },
  {
    name: "整请求无 user message（system+tool only；分支 5 回溯落空 → 分支 6）",
    body: JSON.stringify({ model: "m", messages: [{ role: "system", content: "sys" }, { role: "tool", content: "res" }] }),
  },
  {
    name: "content 形态表外（null）：§4.4 表未定义形态 → 不可安置不注入（实现决策，见 inject.ts 文件头）",
    body: JSON.stringify({ model: "m", messages: [{ role: "user", content: null }] }),
  },
  { name: "注入点 message 非对象（messages 元素为字符串）", body: JSON.stringify({ model: "m", messages: ["junk"] }) },
];

describe("SL-06 inject 六分支（REQ-V2a-11 §4.4 / AC-V2a-07·18 单元级）", () => {
  it("fixture 前置：canary 固定串恰 27 字符（AC-V2a-07 定值，长度差断言的确定期望值来源）", () => {
    expect(CANARY).toHaveLength(27);
  });

  describe("分支 1~5（注入发生）——逐行右列判据 + canary 恰出现一次（唯一 k 判据）", () => {
    for (const c of INJECTED_CASES) {
      it(`分支 ${c.branch}：${c.name}`, () => {
        const r = inject(c.body, CANARY);
        expect(r.injected).toBe(true); // meta.canary_injected=true 的单元级对应位（网关 meta 下传属 SL-07）
        const out = injectedBody(r);
        expect(countOccurrences(out, CANARY)).toBe(1); // 唯一 k 判据的可执行形态：canary 在 B′ 中恰出现一次
        c.verify(c.body, out);
      });
    }
  });

  it("分支 1/4 边界：content 为空白字符串（非空）→ 走分支 1 追加，不属分支 4（非空即不属本分支）", () => {
    const body = JSON.stringify({ messages: [{ role: "user", content: " " }] });
    const out = JSON.parse(injectedBody(inject(body, CANARY))) as ParsedBody;
    expect(out.messages[0]!.content).toBe(" " + CANARY); // 分支 1 判据：前缀 + 长度差 27
    expect((out.messages[0]!.content as string).length - 1).toBe(27);
  });

  describe("分支 6（不注入；AC-V2a-18 单元级）", () => {
    for (const c of SKIPPED_CASES) {
      it(`分支 6：${c.name} → injected=false + skip_reason="inject_skipped" + 原串一字节不动`, () => {
        const r = inject(c.body, CANARY);
        const s = skippedOf(r);
        expect(s.skip_reason).toBe("inject_skipped"); // 顶层 reason=inject_skipped 的取值来源（词表对齐见下）
        expect(s.body).toBe(c.body); // 无注入即无改写：原样返回，一字节不动
      });
    }

    it("skip_reason 取值 ∈ evidence REASON_VOCAB（§4.5 六值词表；跨层对齐由测试钉死，canary 层禁 import evidence）", () => {
      expect(REASON_VOCAB).toContain("inject_skipped");
      const r = inject("{not-json", CANARY);
      expect(REASON_VOCAB).toContain(skippedOf(r).skip_reason);
    });
  });

  it("注入结果不含 skip_reason 键（整键缺席语义，exactOptionalPropertyTypes：skip_reason 仅 injected=false 时存在）", () => {
    const r = inject(JSON.stringify({ messages: [{ role: "user", content: "x" }] }), CANARY);
    expect(r.injected).toBe(true);
    expect("skip_reason" in r).toBe(false);
  });
});
