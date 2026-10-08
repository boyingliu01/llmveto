# Phase 2/6 DESIGN — Phase Summary（sprint-20261008-26 GitHub 开源发布）

status: completed
outputs:
  - docs/plans/2026-10-08-release-requirements.md（v2，R1 需求链 3/3 APPROVED）
  - docs/plans/2026-10-08-release-design.md（v2，R2 设计链 3/3 APPROVED，§8 处置台账 21 行）
  - specification.yaml（SPEC-REL-001，7 REQ / 13 AC，冒烟判据按 CLI 实况冻结）
  - .sprint-state/slices-manifest.json（8 切片 RL-01..RL-08 + 两道 build entry gates）
  - .sprint-state/phase-outputs/requirements-reviewed.json（requirements_hash 510273de…）
  - .sprint-state/delphi-reviewed.json（design APPROVED，Round 2/5，consensus 100%）
  - .sprint-state/review/rel-r1-requirements-consensus.md + rel-design-r2-consensus.md
  - .sprint-state/decisions.md（DR-001..DR-011）
decisions:
  - DR-001 v2a BUILD 独立挂起；DR-002 npm+GitHub Release 双通道；DR-003 fail-closed 现状+登记
  - DR-004 双语完整（用户）；DR-005 xp-gate --force 退役 v2a 登记
  - DR-006 filter-repo 全量改写（用户）；DR-007 README.md=英文（用户）；DR-008 0.2.0 直发（用户）
  - DR-009 保守承诺（用户）；DR-010 锁默认批披露（DD-1/2/4/5/8/9 + 4 项新披露）
  - DR-011 设计 R1 评审 3C+9M+9m 逐条处置落 v2（评审 A=APPROVED 8 / B=C=REQUEST_CHANGES 8）
next_phase_context:
  - BUILD 入口契约已就绪：slices-manifest schema 合法、8 切片 ↔ 7 REQ 双向映射（RL-02 承载 REQ-REL-01a
    与元数据转正同批提交；RL-08 依赖全部前序切片）
  - 全局红线：src/ 零改动；验证形态以脚本/runbook/清单留档为主（规格 test_coverage_requirements 已按实情标注）
  - 两处按实况修正勿在 BUILD 走样：CLI 无 --help（冒烟第 1 步 = 无参调用 exit 2 + valid 清单）；
    doctor 冒烟前必须预写受管配置副本（干净环境必漂移）
  - R2 设计评审残留 5 Minor 的处置已内嵌对应切片验收（parity 复审触发 → RL-05/06；受管配置副本
    最小字段集 → RL-02；npm view 失败 fail-closed → RL-03/04）
  - 用户侧前置（SHIP 前完成即可）：NPM_TOKEN secret 配置（R-1a）；真发布扣扳机点 ×3（前置检查执行 /
    visibility 翻转 / tag push）全部用户确认后执行
  - 需求 evidence 的 head_commit 随 HEAD 演进按"对齐刷新 + 语义注"先例维护（xp-gate 审计为
    工作树对 HEAD 严格相等：刷新须在 transition 前未提交态完成，随 state 变更同批提交）
