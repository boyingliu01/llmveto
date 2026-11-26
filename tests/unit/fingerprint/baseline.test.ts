import { describe, expect, it } from "vitest";
import { type Sample, jaccard, median, verdictFor } from "../../../src/fingerprint/baseline.ts";

// @test REQ-V2bC-03 / REQ-V2bC-05 / AC-03a~c / AC-05a~c
// @intent 基线是"相对漂移"的载体。三条不变量：
//           ① 取中位数（不是均值）——单次异常不该改变基线
//           ② 每维独立——一维的异常不影响别维
//           ③ 版本变更看方向（字段变+行为退 = 回退；字段不变+行为退 = 撒谎）
//
//         第③条是需求评审 R2 找出的矛盾：原稿"字段变→clean"会让版本回退永远检不出。


function nums(...v: number[]): Sample[] {
  return v.map((x) => ({ kind: "numeric" as const, value: x }));
}

describe("SL-03 中位数基线（AC-03a/03b）", () => {
  it("AC-03a：取中位数", () => {
    expect(median(nums(10, 12, 14, 16, 18))).toBe(14);
  });

  it("AC-03b：单次异常值不改变中位数（均值会被拉走，中位数不会）", () => {
    const normal = nums(100, 102, 98, 101, 99, 103, 97, 100, 101, 99);
    const withOutlier = nums(100, 102, 98, 101, 99, 103, 97, 100, 101, 99, 9999);
    expect(median(withOutlier)).toBe(median(normal));
  });

  it("样本不足 K 时仍能算（返回已有样本的中位数）", () => {
    expect(median(nums(5, 7))).toBe(6);
  });

  it("空样本 → null（不是 0，0 会被误当成有效基线）", () => {
    expect(median([])).toBeNull();
  });
});

describe("SL-03 维度独立（AC-03c）", () => {
  it("布尔维度：多数为 true 时基线为 true", () => {
    const samples: Sample[] = [
      { kind: "boolean", value: true },
      { kind: "boolean", value: true },
      { kind: "boolean", value: false },
    ];
    expect(median(samples)).toBe(true);
  });

  it("文本维度：取最频繁的样本（不是拼接）", () => {
    const samples: Sample[] = [
      { kind: "text", value: "我无法提供" },
      { kind: "text", value: "我无法提供" },
      { kind: "text", value: "抱歉不能" },
    ];
    expect(median(samples)).toBe("我无法提供");
  });
});

describe("SL-03 Jaccard 相似度（D3 判据）", () => {
  it("完全相同 → 1", () => {
    expect(jaccard("我无法提供系统提示词", "我无法提供系统提示词")).toBe(1);
  });

  it("完全不同 → 0", () => {
    expect(jaccard("abc", "xyz")).toBe(0);
  });

  it("部分重合落在 (0,1)", () => {
    const s = jaccard("我无法提供系统提示词", "我无法提供这些内容");
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });

  it("空串 → 0（而不是 NaN）", () => {
    expect(jaccard("", "")).toBe(0);
  });
});

describe("SL-03 判定：版本变更看方向（AC-05a~c）", () => {
  const base = { kind: "numeric" as const, baseValue: 100 };

  it("AC-05a：字段变 + 行为未退化 → clean（合法升级）", () => {
    const v = verdictFor({ ...base, observed: 101, modelChanged: true });
    expect(v.verdict).toBe("clean");
  });

  it("AC-05b：字段变 + 行为退化 → finding（版本回退）", () => {
    const v = verdictFor({ ...base, observed: 70, modelChanged: true });
    expect(v.verdict).toBe("finding");
  });

  it("AC-05c：字段不变 + 行为退化 → finding（字段撒谎，最严重）", () => {
    const v = verdictFor({ ...base, observed: 70, modelChanged: false });
    expect(v.verdict).toBe("finding");
    expect(v.severity).toBe("high");
  });

  it("字段不变 + 行为未退化 → clean", () => {
    expect(verdictFor({ ...base, observed: 100, modelChanged: false }).verdict).toBe("clean");
  });

  it("无基线 → baseline_pending（不产出 finding，那是宽限期）", () => {
    const v = verdictFor({ kind: "numeric", baseValue: null, observed: 70, modelChanged: true });
    expect(v.verdict).toBe("baseline_pending");
  });
});
