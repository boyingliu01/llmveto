# Phase 6/6: CLOSE — 收尾记录（sprint-20261008-26）

## Sprint-state 备份声明

`.sprint-state/` 本迭代即为**仓库内已跟踪路径**（随 PR #9 / CLOSE PR 入 main@…）——worktree 清理不会丢失任何 sprint 证据；var/delphi-r11/* 执行原始输出（main 仓未跟踪 scratch）按惯例不入库，共识记录已内联关键执行事实（checks / 裁决 / 模型 ID）。

## #369 返工指标（rework metrics）

| 返工源 | 数量 | 说明 |
|---|---|---|
| Delphi 走查轮次 | 3 轮（预算 5） | R1: 2C+3M+4m（含 B 角协议失败全员重跑 1 次）；R2: 2M+4m；R3: 收敛 |
| 走查驱动修复提交 | 2 | a5e0057（R1 处置）、2d27c0c（R2 处置） |
| BUILD 期返工 | 1 类 | DD-5 README.zh-CN.md 随包不可排除（npm 11 工具链现实），白名单修订 b7b7ac4 |
| DESIGN 期残留 Minor 落点 | 3 | 内嵌对应切片验收（slices-manifest notes） |

## Emergent issues（迭代中发现的新事项）

1. **EI-01**：npm 11 自动收录 README* 变体（files 白名单/.npmignore/取反均不可排除）→ 工具链现实已写入 release-gate 注释 + DD-5 修订；npm 大版本升级须复核。
2. **EI-02**：xp-gate sprint-audit 读取 `.sprint-state/phase-outputs/test-alignment-report.json`（非顶层副本）→ 本迭代两副本同步更新；后续 sprint 应只维护 phase-outputs 副本或让审计读顶层。
3. **EI-03**：Gate MW 证据文件绑 push HEAD + 1h 有效期 → 走查后如有任何提交（含纯文档）需以 provenance 字段声明 reviewed 树→HEAD 的 delta（本迭代做法，已在 phase-5 summary 记录）。
4. **EI-04（后续技术债）**：T-R3-N-01 —— src/ 解冻后由适配器导出受管字段常量供 release-gate 导入，把 smoke row 6 的运行时校验前移为构建期校验。

## 用户触发点（CLOSE 后仍开放，均待用户确认执行）

1. 07a-07d 公开化前置检查（merge 后、flip 前；runbook = docs/release/publication-runbook.md）
2. repo visibility 翻转 public + DD-4 tag ruleset 配置
3. NPM_TOKEN 入 GitHub secret → tag `v0.2.0` push（release.yml 全链真触发）

## USER ACCEPTANCE

- 状态：**待用户手动验收**（禁止自动化代办）
- 验收材料：本文件 + phase-1..5 summaries + [rel-cw-consensus.md](review/rel-cw-consensus.md) + PR #9
