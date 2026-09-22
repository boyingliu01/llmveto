import { describe, expect, it } from "vitest";
import { G1_LINE_RE, g2LineRe, g3LineRe } from "./runner-format.ts";

// @test REQ-VETO-013
// @intent 解析契约单测：行首锚定（R6-B4）与捕获组顺序 p50/p95/p99（R8-B-M3 共模块后两侧共用同一契约）。
//         样本行逐字取自各 runner 的实际输出格式（含小数位数），格式若漂移本测试先红。

describe("bench runner-format: 解析契约", () => {
  const g1Line = "G1 TTFT delta → p50=0.252ms p95=1.554ms p99=2.671ms PASS";

  it("G1：三组捕获为 p50/p95/p99 且与 toFixed(3) 位数兼容", () => {
    const m = G1_LINE_RE.exec(g1Line);
    expect(m?.slice(1)).toEqual(["0.252", "1.554", "2.671"]);
    expect([Number(m?.[1]), Number(m?.[2]), Number(m?.[3])].every(Number.isFinite)).toBe(true);
  });

  it("G1：行首锚定——前置了其他文本的行不匹配", () => {
    expect(G1_LINE_RE.exec(`$ ${g1Line}`)).toBeNull();
  });

  it("G2：8KB 档不误命中 128KB 行（R6-B4 的原始场景）", () => {
    const log = "G2 128KB → p50=1.11ms p95=2.22ms p99=3.33ms PASS";
    expect(g2LineRe(8).exec(log)).toBeNull();
    expect(g2LineRe(128).exec(log)?.slice(1)).toEqual(["1.11", "2.22", "3.33"]);
  });

  it("G2：多行日志中逐档各取自己的行", () => {
    const log = [
      "G2 8KB → p50=0.39ms p95=0.92ms p99=1.40ms PASS",
      "G2 64KB → p50=0.54ms p95=1.47ms p99=2.10ms PASS",
      "G2 512KB → p50=1.80ms p95=3.60ms p99=5.00ms PASS",
    ].join("\n");
    expect(g2LineRe(64).exec(log)?.slice(1)).toEqual(["0.54", "1.47", "2.10"]);
    expect(g2LineRe(512).exec(log)?.[1]).toBe("1.80");
  });

  it("G3：checker + 档位联合锚定；8KB 档不误命中 128KB 行", () => {
    const line = "G3 egress-secret-scan 512KB → p50=0.05 p95=0.09 p99=0.25 (g3=120ms) PASS";
    expect(g3LineRe("egress-secret-scan", 512).exec(line)?.slice(1)).toEqual(["0.05", "0.09", "0.25"]);
    const other = "G3 egress-secret-scan 128KB → p50=0.03 p95=0.05 p99=0.11 (g3=120ms) PASS";
    expect(g3LineRe("egress-secret-scan", 8).exec(other)).toBeNull();
  });

  it("契约不是数值校验：`1.2.3` 仍可匹配，NaN 由调用侧守卫 fail-loud", () => {
    const m = g2LineRe(8).exec("G2 8KB → p50=1.2.3ms p95=0.92ms p99=1.40ms PASS");
    expect(m?.[1]).toBe("1.2.3");
    expect(Number.isFinite(Number(m?.[1]))).toBe(false);
  });
});
