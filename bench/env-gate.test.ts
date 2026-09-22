import { describe, expect, it } from "vitest";
import { environmentMatches, isCiCalibrated, samplingMatches, type BenchEnvironment } from "./env-gate.ts";
import { BENCH_SAMPLING } from "./repeat.ts";

// @test REQ-VETO-013
// @intent 环境门：仅当基准 _environment 与当前环境（os/arch/ci）三字段全等才判定可比；
//         缺标记 / 畸形 / 任一字段不同 → 不可比（SKIP 的判据，见 docs/adr/0002 补遗）。

const current: BenchEnvironment = { os: "linux", arch: "x64", ci: true };

describe("environmentMatches (相对回归门环境前置)", () => {
  it("三字段全等 → 可比", () => {
    expect(environmentMatches({ os: "linux", arch: "x64", ci: true }, current)).toEqual({ comparable: true, reason: "" });
  });

  it("os 不同（Windows 占位 vs ubuntu CI）→ 不可比，reason 指明双方", () => {
    const r = environmentMatches({ os: "win32", arch: "x64", ci: false }, current);
    expect(r.comparable).toBe(false);
    expect(r.reason).toContain("win32-x64-local");
    expect(r.reason).toContain("linux-x64-ci");
  });

  it("arch 不同 → 不可比", () => {
    expect(environmentMatches({ os: "linux", arch: "arm64", ci: true }, current).comparable).toBe(false);
  });

  it("ci 标记不同（本地录制 vs CI 采样）→ 不可比（权威基准只认 CI 录制）", () => {
    const r = environmentMatches({ os: "linux", arch: "x64", ci: false }, current);
    expect(r.comparable).toBe(false);
    expect(r.reason).toContain("mismatch");
  });

  it("缺 _environment（schema < 3 旧基准）→ 不可比 + 提示重录", () => {
    for (const v of [undefined, null, "win32-x64", []]) {
      const r = environmentMatches(v, current);
      expect(r.comparable).toBe(false);
      expect(r.reason).toContain("re-record");
    }
  });

  it("_environment 字段畸形（类型错）→ 不可比 + 提示重录", () => {
    expect(environmentMatches({ os: "linux", arch: "x64", ci: "true" }, current).comparable).toBe(false);
    expect(environmentMatches({ os: 1, arch: "x64", ci: true }, current).comparable).toBe(false);
  });

  it("带首尾空白 / 空串的 os·arch → 归为畸形而非环境不匹配（R6-C2 判据统一，R10R1-A-N1/B-2/C-m4）", () => {
    // _estimator 侧的畸形/不匹配分类（R6-C2）此前未覆盖 os/arch：`" linux "` 会被报成 "environment
    // mismatch"，把"该重录"的数据问题误导成"换个环境跑"。两侧现共用 isVerbatimMarker。
    // 分类只改文案指向，不改判定：两类皆不可比（SKIP），逐字严格比对不因分类放宽。
    const forms: unknown[] = [
      { os: " linux", arch: "x64", ci: true },
      { os: "\tlinux", arch: "x64", ci: true },
      { os: "linux", arch: " x64", ci: true },
      { os: "", arch: "x64", ci: true },
      { os: "linux", arch: "  ", ci: true },
    ];
    for (const v of forms) {
      const r = environmentMatches(v, current);
      expect(r.comparable).toBe(false);
      expect(r.reason).toContain("malformed");
      expect(r.reason).not.toContain("mismatch");
    }
  });

  it("真实环境差异仍报 mismatch（畸形分类不得把可比性判据放宽成放行）", () => {
    const r = environmentMatches({ os: "linux ", arch: "x64", ci: true }, { os: "linux", arch: "x64", ci: true });
    expect(r.comparable).toBe(false);
    expect(r.reason).toContain("malformed");
    const real = environmentMatches({ os: "win32", arch: "x64", ci: true }, current);
    expect(real.reason).toContain("mismatch");
  });
});

describe("isCiCalibrated (SKIP 措辞分支用，不参与可比性判定)", () => {
  it("CI 录制标记 → true；本地录制 → false", () => {
    expect(isCiCalibrated({ os: "linux", arch: "x64", ci: true })).toBe(true);
    expect(isCiCalibrated({ os: "win32", arch: "x64", ci: false })).toBe(false);
  });

  it("缺标记 / 畸形 → false（与不可比判定一致，不误报为 CI 权威）", () => {
    for (const v of [undefined, null, "linux-x64-ci", [], { ci: "true" }, { os: "linux" }]) {
      expect(isCiCalibrated(v)).toBe(false);
    }
  });
});

describe("samplingMatches (录制口径前置，docs/adr/0002 补遗二)", () => {
  it("_repeats/_estimator 与当前门口径一致 → 可比", () => {
    expect(samplingMatches(BENCH_SAMPLING.repeats, BENCH_SAMPLING.estimator, BENCH_SAMPLING)).toEqual({
      comparable: true,
      reason: "",
    });
  });

  it("畸形 _repeats（缺标记 / 非整数 / 非有限数）→ 不可比 + 提示重录", () => {
    // NaN / ±Infinity（R6-B1）的 typeof 同为 number，靠 Number.isInteger 挡下——无此守卫即静默放行。
    for (const r of [undefined, null, "3", [], {}, 0, -1, 1.5, NaN, Infinity, -Infinity]) {
      const res = samplingMatches(r, BENCH_SAMPLING.estimator, BENCH_SAMPLING);
      expect(res.comparable).toBe(false);
      expect(res.reason).toContain("re-record");
    }
  });

  it("缺 _estimator 标记 / 标记畸形 → 不可比 + 提示重录", () => {
    for (const e of [undefined, null, "", "  ", 7, [], {}]) {
      const res = samplingMatches(BENCH_SAMPLING.repeats, e, BENCH_SAMPLING);
      expect(res.comparable).toBe(false);
      expect(res.reason).toContain("re-record");
    }
  });

  it("带首尾空白的估计量 → 归为畸形而非口径不匹配（R6-C2；两侧皆不可比，分类只影响文案指向）", () => {
    // 修复前：`" min "` 逃过 `trim() === ""` 畸形判据，落到严格逐字比对，reason 打成
    // "sampling procedure mismatch: baseline= min  … vs gate=min …"（肉眼近乎全等，误导为口径差异）。
    for (const e of [" min ", "min ", " min", "\tmin"]) {
      const res = samplingMatches(BENCH_SAMPLING.repeats, e, BENCH_SAMPLING);
      expect(res.comparable).toBe(false);
      expect(res.reason).toContain("malformed");
      expect(res.reason).not.toContain("mismatch");
    }
  });

  it("N 漂移（同名估计量、不同次数）→ 不可比，reason 指明双方", () => {
    const res = samplingMatches(BENCH_SAMPLING.repeats + 2, BENCH_SAMPLING.estimator, BENCH_SAMPLING);
    expect(res.comparable).toBe(false);
    expect(res.reason).toContain(`baseline=${BENCH_SAMPLING.estimator} of ${BENCH_SAMPLING.repeats + 2}`);
    expect(res.reason).toContain(`gate=${BENCH_SAMPLING.estimator} of ${BENCH_SAMPLING.repeats}`);
  });

  it("统计量漂移（同 N、median 基准 vs min 门）→ 不可比（双峰下中位会按模式抽签，两者不同分布）", () => {
    const res = samplingMatches(BENCH_SAMPLING.repeats, "median", BENCH_SAMPLING);
    expect(res.comparable).toBe(false);
    expect(res.reason).toContain("median");
    expect(res.reason).toContain("min");
  });
});
