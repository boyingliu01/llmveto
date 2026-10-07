import { describe, expect, it } from "vitest";
import {
  invisibleUnicodeScanNonStream,
  invisibleUnicodeScanStream,
  INVISIBLE_UNICODE_SCAN_SPEC,
} from "../../../src/checkers/invisible-unicode-scan.ts";
import type { ScanUnit, ScanWindow } from "../../../src/shared/types.ts";

// @test REQ-VETO-004
// @intent T2c 隐形 Unicode 扫描：跨 chunk 滚动窗口纯函数验证。
// @covers AC-VETO-004-01 AC-VETO-004-02 AC-VETO-004-03 AC-VETO-004-04

const unit = (text: string, over: Partial<ScanUnit> = {}): ScanUnit => ({
  direction: "response",
  transport: "non-stream",
  text,
  meta: {},
  ...over,
});

const initialWindow = (): ScanWindow => ({
  pendingBytes: new Uint8Array(0),
  cursor: 0,
});

describe("SL-03 invisible-unicode-scan (REQ-VETO-004)", () => {
  // AC-VETO-004-01：单码点检出
  it("AC-01 检出 U+200B / U+200C / U+200D / U+FEFF / U+202E / U+2066-2069", () => {
    const codepoints = ["\u200B", "\u200C", "\u200D", "\uFEFF", "\u202E", "\u2066", "\u2067", "\u2068", "\u2069"];
    for (const cp of codepoints) {
      const r = invisibleUnicodeScanNonStream(unit(`hello${cp}world`));
      expect(r.verdict, `codepoint U+${cp.codePointAt(0)?.toString(16)}`).toBe("finding");
      expect(r.evidence[0]?.offsets).toEqual([5]);
      expect(r.evidence[0]?.threat).toBe("T2c");
      expect(r.evidence[0]?.checker).toBe("invisible-unicode-scan");
    }
  });

  it("AC-01 clean 路径：普通 ASCII + 中文均无 finding", () => {
    const r = invisibleUnicodeScanNonStream(unit("hello 世界 123 !@#"));
    expect(r.verdict).toBe("clean");
    expect(r.evidence).toEqual([]);
  });

  it("AC-01 空文本 → clean", () => {
    expect(invisibleUnicodeScanNonStream(unit("")).verdict).toBe("clean");
  });

  // AC-VETO-004-02：跨 chunk cursor 偏移
  it("AC-02 流式跨 chunk：cursor 全局偏移正确", () => {
    let w = initialWindow();
    const c1 = unit("hel"); // 0..2
    const c2 = unit("lo\u200B"); // 3..5, U+200B 在 index 5
    const c3 = unit("wor"); // 6..8

    const [r1, w1] = invisibleUnicodeScanStream(w, c1);
    expect(r1.verdict).toBe("clean");
    expect(w1.cursor).toBe(3);

    const [r2, w2] = invisibleUnicodeScanStream(w1, c2);
    expect(r2.verdict).toBe("finding");
    // 全局偏移：w1.cursor(3) + chunk内index(2) = 5
    expect(r2.evidence[0]?.offsets).toEqual([5]);
    expect(w2.cursor).toBe(6);

    const [r3, w3] = invisibleUnicodeScanStream(w2, c3);
    expect(r3.verdict).toBe("clean");
    expect(w3.cursor).toBe(9);
  });

  it("AC-02 纯函数：同输入两次调用输出严格相同（AC-VETO-003-04 精神）", () => {
    const u = unit("a\u200Bb\u200Cc");
    const r1 = invisibleUnicodeScanNonStream(u);
    const r2 = invisibleUnicodeScanNonStream(u);
    expect(r1).toEqual(r2);
    // regex lastIndex 未污染
    const r3 = invisibleUnicodeScanNonStream(u);
    expect(r3).toEqual(r1);
  });

  // 每个 finding 打包 offsets（同 checker 一次执行只产 1 条 finding）
  it("多个隐形字符 → 单一 finding 含所有 offsets", () => {
    const r = invisibleUnicodeScanNonStream(unit("a\u200Bb\u200Cc\uFEFFd"));
    expect(r.evidence).toHaveLength(1);
    expect(r.evidence[0]?.offsets).toEqual([1, 3, 5]);
  });

  // 多投影扫描（编码层对抗，73e28fa 修复面；offsets 剔除为 PWR1-B-M1 处置）
  it("多投影：原始文本无字面隐形字符但转义还原投影命中 → escaped finding 不报 offsets", () => {
    const r = invisibleUnicodeScanNonStream(unit("hello \\u200Bworld", { decoded: "hello \u200Bworld" }));
    expect(r.verdict).toBe("finding");
    expect(r.evidence).toHaveLength(1);
    expect(r.evidence[0]?.rule_id).toBe("invisible-unicode-escaped");
    // 用例标题声称"不报 offsets"，就必须把这条断言钉住（还原文本坐标不得冒充原始坐标）
    expect(r.evidence[0]?.offsets).toBeUndefined();
    expect("offsets" in (r.evidence[0] ?? {})).toBe(false);
  });

  it("多投影：原始投影已命中时以原始 offsets 为准（转义投影不降级为 escaped）", () => {
    const r = invisibleUnicodeScanNonStream(unit("a\u200Bb", { decoded: "a\u200Bb \\u2066x" }));
    expect(r.verdict).toBe("finding");
    expect(r.evidence[0]?.rule_id).toBe("invisible-unicode");
    expect(r.evidence[0]?.offsets).toEqual([1]);
  });

  it("多投影：decoded 与 text 相同 → 视作单投影，不重复报", () => {
    const r = invisibleUnicodeScanNonStream(unit("clean text", { decoded: "clean text" }));
    expect(r.verdict).toBe("clean");
  });

  // Spec 声明完整性（供 policy 注册表使用）
  it("INVISIBLE_UNICODE_SCAN_SPEC 元数据：response-side / synchronous / safetyClass=true", () => {
    expect(INVISIBLE_UNICODE_SCAN_SPEC.id).toBe("invisible-unicode-scan");
    expect(INVISIBLE_UNICODE_SCAN_SPEC.side).toBe("response");
    expect(INVISIBLE_UNICODE_SCAN_SPEC.synchronous).toBe(true);
    expect(INVISIBLE_UNICODE_SCAN_SPEC.safetyClass).toBe(true);
    expect(INVISIBLE_UNICODE_SCAN_SPEC.runNonStream).toBe(invisibleUnicodeScanNonStream);
    expect(INVISIBLE_UNICODE_SCAN_SPEC.runStream).toBe(invisibleUnicodeScanStream);
  });
});
