/**
 * llmveto — 模块入口占位。
 *
 * v1 各子模块（gateway / checkers / policy / evidence / adapters / cli）在此聚合导出。
 * 分层与依赖方向契约见 architecture.yaml，组件职责见 docs/issues/2-design-v1.md。
 */
export const MODULES = [
  "gateway",
  "checkers",
  "policy",
  "evidence",
  "adapters",
  "cli",
] as const;
