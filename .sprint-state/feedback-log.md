# Phase 4/6: VERIFY — Feedback Log

- **Sprint**: sprint-20261008-26（GitHub 开源发布）
- **Branch**: sprint/2026-10-08-01
- **Review window**: Phase 4（2026-10-09）
- **Panel**: delphi-review --mode code-walkthrough（example-provider-flash profile：g-qwen3.8-flash / g-deepseek-flash / local-qwen3.8-27b 三模型 distinct）

## 走查方法

Phase 2 已完成 R1（需求评审 Round 2 100%）+ R2（设计评审 Round 2 100%，delphi-reviewed.json），design freeze 已锁。
Phase 4 走查对象 = 发布面**可执行工件**（scripts/release-gate.mjs / release.yml / check-readme-parity.mjs / package.json / CHANGELOG.md）；
文档交付物（README 双语 / CONTEXT Glossary / SECURITY / CONTRIBUTING / publishing.md / runbook / boundary-checklist）以切片核对记录 + parity 脚本机器面承载，不走查全文（卷包体积纪律：31,214 B，C 槽 131072 窗口内）。

1. delphi code-walkthrough 三轮（R1 全员 → 处置 → R2 全员 → 处置 → R3 最终立场 3/3 APPROVED，consensus 1.0）
2. 处置后全量 release:gate 本机重跑 ×2（a5e0057 / 2d27c0c 树）全绿
3. #367 test-specification-alignment 刷新（SPEC-REL-001 重映射，score 98.5 PASS）
4. `npx xp-gate check --all`

共识记录：[review/rel-cw-consensus.md](review/rel-cw-consensus.md)；状态：[code-walkthrough-reviewed.json](../code-walkthrough-reviewed.json)

## Findings（13 条发现 → 全部处置）

### FB-REL-001 · Critical · ARCH-C-01 dispatch 发布后门（已闭合）

- **症状**：workflow_dispatch 触发时 GITHUB_REF_TYPE=branch，registry 无该版本时 E404 分支直接 `npm publish` —— 任意分支可绕过 tag 校验发包
- **处置**：publish 步加显式 tag-only 门（非 tag 触发即跳过 publish，dispatch 仅保留补建 Release 语义）；对齐 AC-REL-01b 情形②
- **落点**：release.yml；fix a5e0057；R2/R3 两轮确认闭合

### FB-REL-002 · Critical · C-C-01 EPUBLISHCONFLICT 无兜底（已闭合）

- **症状**：npm view 与 publish 之间并发竞态命中 EPUBLISHCONFLICT 时硬失败，违背 AC-REL-01b "EPUBLISHCONFLICT 兜底" / publishing.md §2 情形⑤
- **处置**：publish 包裹三分支（成功 / EPUBLISHCONFLICT→按已发布跳过 / 其他 fail-closed）
- **落点**：release.yml；fix a5e0057

### FB-REL-003 · Major · T-R2-01 seed fetch 无超时（已闭合）

- **症状**：seedEvidenceRecord 裸 fetch 无超时，daemon 挂起时 gate 无限阻塞而非 fail-closed，与 run() 每步超时纪律不一致
- **处置**：`AbortSignal.timeout(30_000)` + try/catch fail-closed
- **落点**：release-gate.mjs；fix 2d27c0c

### FB-REL-004 · Major · T-R2-02 副本↔detectDrift "无机器校验"（反驳成立 + 诊断注采纳）

- **反驳**：smoke row 6 以**真 detectDrift** 对副本执行，doctor.config-drift 失配即 exit 1 → 门红（src/cli/index.ts:246-249），演进失配 = 大声失败非静默；"适配器导出常量"修法需改 src/，违反 AC-REL-05a 冻结
- **采纳残余**：managedConfigCopies 注释写明机器校验面与诊断起点；src/ 解冻后前移为构建期校验（后续项，B 角自评"维持现状可接受"）
- **落点**：release-gate.mjs 注释；2d27c0c

### FB-REL-005 · Major · C-M-01 CI bun 剥离失效（反驳成立）

- **反驳**：hasBunExecutable 非 Windows 检查裸名 `bun`（release-gate.mjs:83-89），对 setup-bun 安装位 $HOME/.bun/bin 同样生效；本机（bun 在 PATH）全链绿灯 = 同一过滤逻辑实测。B 角 R2 接受反驳

### FB-REL-006 · Major · C-M-02 engines.bun 冲突纯 Node 承诺（反驳成立）

- **反驳**：npm 仅检查 engines.node/npm，未知引擎键被忽略（无告警无阻断）；engines.bun 正确表达贡献者要求（CONTRIBUTING 已载 Bun ≥ 1.1 + Node ≥ 18）。B 角 R2 接受反驳

### Minors（7 条，全采纳或登记）

ARCH-M-01 防递归两层职责注释澄清（a5e0057）；C-N-01 parity 两表维护约定（a5e0057）；ARCH-N-01 解析约束声明（a5e0057）；C-N-02 vitest 格式漂移提示（a5e0057）；T-R2-03 npm 版本依赖注记（2d27c0c）；T-R2-04 teardown --ignore-scripts（2d27c0c）；ARCH-N-02/T-R3-N-01 残留登记（rel-cw-consensus.md，均不阻断）

## 残留（R3 共识后）

- Critical 0 / Major 0 / Minor 2（ARCH-N-02：Release 步错误定位弱化——现实现已有空节 fail-closed 守卫；T-R3-N-01：构建期校验前移属 src/ 解冻后后续项）

## 判定语义声明

release.yml 的 CI 触发语义本地不可真触发：验证 = 三轮三专家静态评审 + Gate 12 YAML 门；真实验证时点 = 用户 tag v0.2.0 push（specification.yaml constraints.user_trigger_points 冻结项），不宣称"已验证"。
