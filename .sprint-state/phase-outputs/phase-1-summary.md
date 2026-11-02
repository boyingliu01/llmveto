# Phase 1/6 PREP 小结 — llmveto v2a

- Sprint: `sprint-20260927-46` / 分支 `sprint/2026-09-27-01`（自 `main` @ `d5b9be8` 切出）
- Worktree: `.worktrees/sprint/sprint-2026-09-27-01`（`.worktrees/` 已在 .gitignore）
- 日期: 2026-09-27

## 隔离

| 项 | 结果 |
|---|---|
| 启动分支 | `main`（保护分支）→ 强制 worktree 隔离 |
| Sprint lock | 无活跃锁，新建 |
| 依赖安装 | `bun install` → 59 包 / 1.5s |
| 基线验证 | `bun run test` → 34 文件 / **277 passed, 3 skipped** / 9.77s 全绿 |

## AUTO-ESTIMATE（实测指标，非主观判断）

变更类型：**新增功能**。判定：**[复杂]**。

| 指标 | 实测值 | 阈值档位 |
|---|---|---|
| 触点引用 | 18 处（checker registry / policy mapping / evidence schema / CLI / `MANAGED_CONFIG_IDS` 9 站点 / 矩阵测试 / CI） | >10 → 复杂 |
| 跨模块 | 7 个 src 目录（shared, checkers, policy, evidence, adapters, gateway, cli）+ 预计新增 3 个域 | 3+ → 复杂 |
| 循环依赖 | 无（architecture.yaml 单向分层，archlinter Gate 6 + `tests/unit/architecture-boundaries.test.ts` 双重断言） | 正常 |
| Public API | 现有 91 个 `^export`；v2a 预计新增 >5 | 高影响 |
| 测试面 | 现有 34 个测试文件 / 277 用例；bench 12 脚本 | 工作量大 |
| 预估规模 | >10 文件、>500 LOC | 超阈值 2 倍 |

总分 9（ref 3 + 跨模块 3 + 循环 0 + API 2 + 测试 1）→ 复杂（7+）。

## 范围决策（DR-011 / DR-012）

**v2 拆两刀**，本 sprint 只做 **v2a 检测核心**：

纳入 v2a：
1. evidence schema `canary` 字段的扩版决策（前置决策门，见下）
2. 4 个新 checker：`thinking-signature-presence` / `tool-call-shape`（T2a）/ `usage-reconcile`（T4a）/ `fingerprint-probe`（T3a 实质）
3. 金丝雀引擎（TS 重实现）+ `canary rotate` CLI → 自此 T1a 才有阳性检测能力
4. evil-relay 模拟器 + 双矩阵 CI 全量落地

顺延 v2b（运营面，与检测语义正交）：
- 周期性指纹巡检 + provider 信任分（fpverify 序贯检验）
- 计费对账报告 + `report` CLI + provider 健康监测
- Claude Code / Codex / promptfoo 接入扩展（各自补 `MANAGED_CONFIG_IDS` + doctor 断言）

v2a 的切分判据：**能被 evidence 与 CI 证明**。四条纳入项共享同一处 schema 契约变更，再拆会导致 schema 改两次。

## 风险登记（带入 Phase 2）

| ID | 风险 | Phase 2 处置 |
|---|---|---|
| R-PRE-1 | **冻结契约冲突**：`src/evidence/schema.ts:52` 有 `canary: null` 占位字段，TEST 契约 #4 冻结 `evidence_version: 1` 字段表（含 `canary`、`action_taken` 含 `degraded_observational` @v2）。金丝雀落地必然改 schema → README / `llmveto verify` / v3 消费方（XP-Gate Gate LS）都引用该字段表 | 列为**前置决策门**，在 R1 之前关闭：定"字段表原地扩版"还是"`evidence_version: 2` + verify 双版本兼容"，禁止静默改 |
| R-PRE-2 | **CI 缺口**：`.github/workflows` 仅有 `bench.yml`，无测试/五件套 CI 门。v2 验收要求"TEST 五件套 `@v2` 项全部 CI 化"属新增基础设施 | Phase 2 须明确 CI 交付物形状与验收可判定形式 |
| R-PRE-3 | **知识库过期**：SearchKnowledge 条目仍称 `src/adapters`、`src/cli`、`src/shared` 为空占位（v1 实现前快照）。已实测 23 个源文件 / 2024 行 | Phase 2/3 以代码为准，勿采信知识库的"未实现"结论 |
| R-PRE-4 | **走查不收敛前例**：v1 记录 Delphi 走查在大批次文档上不收敛、轮次预算用尽（见 project memory `r10-batch-pending`、`delphi-expert-nondeterminism`） | 已用"拆两刀"砍范围而非砍深度；R2 卷包控制在 v2a 四条线内 |

## 输出物

- `.sprint-state/sprint-state.json`（由 `xp-gate sprint-init` 生成，含 isolation）
- `.sprint-state/decisions.md` ← DR-011、DR-012
- `.sprint-state/phase-outputs/phase-1-summary.md`（本文件）
- 旧 v1 状态备份：`.sprint-history/sprint-state-sprint-20260914-49-*.json`

## next_phase_context

- 流程级别：复杂 / 完整 6 阶段
- Phase 2 入口：先关 R-PRE-1（schema 扩版）前置决策门，再走 grill-with-docs → R1
- v2a 验收对标 roadmap §v2：T2a/T2b 在 REQ 登记表中由"未缓解"升为"部分/已缓解"；流式已转发字节的边界按 REQ §场景 4 承诺不得回改
