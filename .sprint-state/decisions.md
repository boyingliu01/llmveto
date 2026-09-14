# Sprint Decisions — sprint-20260914-49

## Decision DR-001
- **Phase**: 1/6 PREP
- **Question**: 测试运行器选 vitest 还是 bun test（DESIGN issue 写的技术栈是 "TypeScript + Bun"）
- **Options**: (a) `bun test`；(b) vitest（+ `@vitest/coverage-v8`）；(c) 双跑
- **Choice**: **(b) vitest**；Bun 退居包管理 + daemon 运行时 + 单二进制编译目标
- **Rationale**: 全局 xp-gate pre-commit 钩子对 TypeScript 项目固定执行 `npx vitest run --coverage`，并读取 `coverage/coverage-summary.json` 判 80% 阈值——用 `bun test` 会本地绿、提交红（首次提交即被此因阻断）。附带收益：测试跑在真实 Node 上，直接验证"兼容 Node ≥ 18"这条设计约束；因此运行时代码必须以 Node API（`node:http`/`node:crypto`/Web Streams）为准，Bun-only API 禁用
- **Timestamp**: 2026-09-14T11:20:00+08:00

## Decision DR-002
- **Phase**: 1/6 PREP
- **Question**: 保护分支 main 上如何隔离 sprint 工作
- **Options**: (a) `git worktree` 隔离；(b) in-place 分支；(c) `--no-isolate`
- **Choice**: **(b) in-place 分支** `sprint/2026-09-14-01`
- **Rationale**: 仓库零提交（unborn HEAD），`git worktree add` 无 base commit 可用而失败。分支本身仍满足隔离意图：main 未被写入任何提交，sprint 全部工作经 PR 首次合入 main
- **Timestamp**: 2026-09-14T11:21:00+08:00

## Decision DR-003
- **Phase**: 1/6 PREP
- **Question**: AUTO-ESTIMATE 规模分类
- **Options**: lightweight / standard / complex
- **Choice**: **complex**（待用户确认，见 PREP 规模确认决策点）
- **Rationale**: 绿地系统、6 个分层、流式零缓冲网络 I/O、密码学哈希链、daemon 生命周期、fail-closed 安全语义、p95<5ms 性能预算、正负 fixture 双矩阵、跨真实客户端 E2E
- **Timestamp**: 2026-09-14T11:22:00+08:00

## Decision DR-004
- **Phase**: 1/6 PREP
- **Question**: pre-commit Gate 6 要求架构约束文件，如何满足
- **Options**: (a) `.architecture-skip` 豁免文件；(b) `archlint init` 生成配置；(c) 生成配置 + 手写分层契约
- **Choice**: **(c)** — `.archlint.yaml`（异味检测配置）+ `architecture.yaml`（7 层依赖方向契约）
- **Rationale**: (a) 是绕过门禁，与项目"安全检查失败不放行"的立身原则自相矛盾，拒绝。(b) 只覆盖异味，不覆盖依赖方向；而"checker 必须是纯函数、不得 import 网关"是可测试性契约 #2，属核心不变量，需显式成文并在 BUILD 期由 `architecture-boundaries.test.ts` 断言执行
- **Timestamp**: 2026-09-14T11:23:00+08:00
