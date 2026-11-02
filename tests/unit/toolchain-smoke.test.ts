import { describe, expect, test } from "vitest";
import { MODULES } from "../../src/index.js";

/**
 * 工具链冒烟测试：确认 vitest / Node crypto / 模块骨架可用。
 * 真实测试随 v1 checker 落地（见 docs/issues/4-test-validation.md）。
 *
 * @intent 工具链就绪自检——模块聚合面可导入、SHA-256 原语在 Node ≥18 可用，
 *         防止"测试基建坏了但套件仍显示全绿"的假信号。
 */
describe("toolchain smoke", () => {
  test("module skeleton exposes v1 component list", () => {
    expect(MODULES).toContain("gateway");
    expect(MODULES).toContain("checkers");
    expect(MODULES).toContain("policy");
    expect(MODULES).toContain("evidence");
  });

  test("SHA-256 primitive required by evidence hash chain is available on Node", async () => {
    const digest = new Uint8Array(
      await globalThis.crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode("llmveto"),
      ),
    );
    expect(digest.length).toBe(32);
  });
});
