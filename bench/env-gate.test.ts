import { describe, expect, it } from "vitest";
import { environmentMatches, isCiCalibrated, type BenchEnvironment } from "./env-gate.ts";

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
