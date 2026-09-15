import { defineConfig } from "vitest/config";

/**
 * vitest 是本项目唯一测试运行器（不是 bun test）。
 * 原因：全局 xp-gate pre-commit 钩子对 TypeScript 项目固定执行
 * `npx vitest run --coverage <changed test files>`，并要求 coverage/coverage-summary.json。
 * 测试跑在 Node 上，顺带验证设计要求的 "兼容 Node >= 18"。
 *
 * all: false + 不设 include —— 仅对"实际被测试运行加载"的文件计数；
 * 全局钩子做 smart-selection（只跑 changed tests）时，分母不会包含未触及文件，
 * 避免局部测试跌破 80% 阈值而误伤。全量门禁（CI 中 `bun run test:coverage`）
 * 通过 `COVERAGE_ALL=1` 显式打开 all + include src/**\/*.ts，覆盖到所有源码。
 */
const COVERAGE_ALL = process.env.COVERAGE_ALL === "1";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      all: COVERAGE_ALL,
      ...(COVERAGE_ALL ? { include: ["src/**/*.ts"] } : {}),
      exclude: ["src/**/*.d.ts", "src/**/types.ts", "**/*.test.ts", "**/*.spec.ts"],
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
