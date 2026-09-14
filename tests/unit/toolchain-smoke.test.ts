import { describe, expect, test } from "vitest";
import { MODULES } from "../../src/index.js";

/**
 * 工具链冒烟测试：确认 vitest / Node crypto / 模块骨架可用。
 * 真实测试随 v1 checker 落地（见 docs/issues/4-test-validation.md）。
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
