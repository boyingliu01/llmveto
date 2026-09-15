import { defineConfig } from "vitest/config";

/**
 * vitest 是本项目唯一测试运行器（不是 bun test）。
 * 原因：全局 xp-gate pre-commit 钩子对 TypeScript 项目固定执行
 * `npx vitest run --coverage <changed test files>`，并要求 coverage/coverage-summary.json。
 * 测试跑在 Node 上，顺带验证设计要求的 "兼容 Node >= 18"。
 *
 * 双模式覆盖：
 *   - 默认（钩子 smart-selection）：all=false，不 apply thresholds；仅统计触及文件；
 *     避免"新加一个 e2e test 未覆盖 policy 边界 → 80% 硬阈值误伤"。
 *   - CI 全量（COVERAGE_ALL=1）：all=true + include src/**\/*.ts + 应用 80% 阈值。
 *     这是本仓库真正的覆盖率门禁。
 */
const COVERAGE_ALL = process.env.COVERAGE_ALL === "1";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "bench/**/*.test.ts"],
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
      ...(COVERAGE_ALL
        ? {
            thresholds: {
              lines: 80,
              functions: 80,
              branches: 80,
              statements: 80,
            },
          }
        : {}),
    },
  },
});
