import { describe, expect, it } from "vitest";
import { BENCH_ESTIMATOR, BENCH_REPEATS, BENCH_SAMPLING, medianOf, minOf } from "./repeat.ts";

// @test REQ-VETO-013
// @intent 降噪口径（docs/adr/0002 补遗二）：record 与 check 双侧共用的 N、判定估计量（min）
//         与人读中心量（median）。噪声呈双峰时中位数会"按模式抽签"（本机实测同码假红
//         base 1.34 vs pr 2.01），故判定用最小值；这些测试是"基准与 PR 同分布"的唯一保证点。

describe("BENCH_REPEATS / BENCH_SAMPLING (录制口径常量)", () => {
  it("N 为不小于 5 的整数：min 是单一顺序统计量，N 太小两侧会抽到不同的谷底", () => {
    expect(Number.isInteger(BENCH_REPEATS)).toBe(true);
    expect(BENCH_REPEATS).toBeGreaterThanOrEqual(5);
  });

  it("判定估计量为 min；BENCH_SAMPLING 是二者的单一真相源（写入基准 _repeats/_estimator）", () => {
    expect(BENCH_ESTIMATOR).toBe("min");
    expect(BENCH_SAMPLING).toEqual({ repeats: BENCH_REPEATS, estimator: BENCH_ESTIMATOR });
  });
});

describe("minOf (判定估计量)", () => {
  it("取最小值（干扰只抬高成本 → 最小值最接近真成本）", () => {
    expect(minOf([2.23, 1.31, 1.9, 1.34, 1.26])).toBe(1.26);
    expect(minOf([29.79, 29.36, 29.8, 30.63, 29.67])).toBe(29.36);
  });

  it("单元素与负增量（配对差可为负）不失真", () => {
    expect(minOf([0.42])).toBe(0.42);
    expect(minOf([-0.3, 0.1, 0.9])).toBe(-0.3);
  });

  it("假红免疫：慢模式占多数的采样集里，最小值仍落在快模式", () => {
    // 本机实测的检查侧形态：3 次慢模式 + 2 次快模式 → 中位数落慢侧（判定会假红），最小值落快侧
    const prSamples = [2.01, 2.14, 1.08, 1.04, 2.06];
    expect(medianOf(prSamples)).toBe(2.01);
    expect(minOf(prSamples)).toBe(1.04);
  });

  it("空样本集是调用方错误 → 抛出（不得静默返回 Infinity 进入判定）", () => {
    expect(() => minOf([])).toThrow(/empty/);
  });
});

describe("medianOf (仅人读，不参与判定)", () => {
  it("奇数样本 → 中间值", () => {
    expect(medianOf([0.6, 1.83, 2.33])).toBe(1.83);
    expect(medianOf([1.88, 1.64, 2.33, 1.7, 1.9])).toBe(1.88);
  });

  it("偶数样本不抛错（口径固定为奇数 N，此处只保证不炸）", () => {
    expect(Number.isFinite(medianOf([1, 2, 3, 4]))).toBe(true);
  });

  it("空样本集 → 抛出", () => {
    expect(() => medianOf([])).toThrow(/empty/);
  });
});
