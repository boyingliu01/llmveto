import { defineConfig } from "vitest/config";

/**
 * vitest 是本项目唯一测试运行器（不是 bun test）。
 * 原因：全局 xp-gate pre-commit 钩子对 TypeScript 项目固定执行
 * `npx vitest run --coverage <changed test files>`，并要求 coverage/coverage-summary.json。
 * 测试跑在 Node 上，顺带验证设计要求的 "兼容 Node >= 18"。
 *
 * all: false —— 钩子按变更文件做选择性测试（partial run），若把未被测文件计入分母，
 * 部分运行必然跌破阈值而误伤；开启后 80% 门禁作用于测试实际触及的代码。
 * 全量门禁请用 `bun run test:coverage`（CI 中执行）。
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      all: false,
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/**/types.ts"],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "./coverage",
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
