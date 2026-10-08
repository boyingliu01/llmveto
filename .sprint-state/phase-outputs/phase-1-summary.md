# Phase 1/6 PREP Summary — sprint-20261008-26（GitHub 开源发布）

> 2026-10-08。承接：v2a sprint（sprint-2026-09-27-01）PREP+DESIGN 已并入 main@bd4bb40（PR #8）；
> 本迭代 = 用户拍板的"最后一轮设计开发"，目标 GitHub 开源发布。

## 定位（用户 2026-10-08 拍板）

GitHub 开源、提供给开发人员**自用**的大模型投毒安全守门员，**暂不考虑对外销售**。

- 主优先级：安全、性能、可审计性、透明性
- 次优先级（发布门槛）：打包分发、文档、上游容错、安装部署易用性

## AUTO-ESTIMATE

**分类：complex**。依据：跨 6+ 领域（打包/文档/安装/上游容错/开源卫生/发布工作流），
含多个必须拍板的范围决策（见下），含用户侧外部交付义务（G-CANARY #E 录制）。

范围盘点（输入 DESIGN）：

| 领域 | 现状 | 本迭代动作（候选） |
|---|---|---|
| 打包分发 | Bun/Node CLI，`npm start`；VERSION 门 + sync-version.cjs 已有 | npm/npx 可执行形态 or GitHub Release 产物 —— 需拍板 |
| 文档 | docs/issues/（威胁模型/复用/验证/roadmap 冻结件）已在 | README + quickstart + 安装指南 —— 需写 |
| 安装易用性 | doctor 命令 + 受管配置写入已有 | 一键安装体验 + opencode/delphi 接入指南 |
| 上游容错 | T0 fail-closed 已缓解；无重试/备用上游（v2 运营面） | 实现重试/备用 vs 文档声明边界 —— 需拍板 |
| 开源卫生 | docs/licenses.md 已有（gitleaks BUSL 规避决策）；无 LICENSE 文件核实、无 SECURITY.md、无发布工作流 | LICENSE/SECURITY.md/发布 workflow —— 需补 |
| 透明/可审计 | evidence append-only 链 + verify CLI + 残余风险登记表 | 发布核对，预计收尾级 |
| 待裁量 | v2a BUILD（15 切片检测核心，G-CANARY #E 录制 0/10 为用户义务） | 并入本迭代 or 保持独立挂起 —— 需拍板 |

## 执行动作

1. Worktree 隔离：`.worktrees/sprint/sprint-2026-10-08-01`，分支 `sprint/2026-10-08-01`（基于 main@bd4bb40）
2. AUTO-ESTIMATE：complex（如上）
3. `npx xp-gate sprint-init --force`：xp-gate 登记处原活动 sprint 为 v2a（sprint-20260927-46，
   BUILD 未启动）——其冻结产物已全部并入 main，活动登记仅占用状态机，故 --force 退役；
   旧状态备份至 `.sprint-history/sprint-state-sprint-20260927-46-2026-10-08T12-20-11.json`。
   v2a 剩余 BUILD 的归宿（并入/独立/降期）在 DESIGN 拍板并登记 decisions.md。
4. `phase-transition 1 completed --render`：通过

## status / outputs / decisions / next

```
status: completed
outputs:
  - .worktrees/sprint/sprint-2026-10-08-01（worktree，分支 sprint/2026-10-08-01 @ bd4bb40）
  - .sprint-state/sprint-state.json（sprint-20261008-26）
  - .sprint-history/sprint-state-sprint-20260927-46-2026-10-08T12-20-11.json（v2a 状态备份）
decisions:
  - PREP-1：--force 退役 v2a 活动登记（冻结产物已并入 main；BUILD 归属留 DESIGN 拍板）
  - PREP-2：复杂级 = complex
next_phase_context:
  - 四个必拍板项：① v2a BUILD 并入与否（含 G-CANARY #E 录制阻塞关系）② 发布/分发形态
    ③ 上游容错深度 ④ 文档语言与覆盖面
  - 判据/门禁：R1 需求评审 + R2 设计评审（三专家、≥90% 共识）后冻结 specification.yaml
```
