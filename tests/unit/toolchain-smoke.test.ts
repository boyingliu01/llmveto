import { describe, expect, test } from "vitest";

/**
 * 工具链冒烟测试：确认 vitest / Node crypto 可用。
 * 真实测试随 v1 checker 落地（见 docs/issues/4-test-validation.md）。
 *
 * @intent 工具链就绪自检——SHA-256 原语在 Node ≥18 可用，
 *         防止"测试基建坏了但套件仍显示全绿"的假信号。
 */
describe("toolchain smoke", () => {
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
