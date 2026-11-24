# Phase 2/6 DESIGN 小结 — llmveto v2b-A

- Sprint `sprint-20261124-54` / 日期 2026-11-24
- 用户拍板：批准设计进 BUILD（DR-031）

## 产出

| 类别 | 文件 |
|---|---|
| 需求（定稿） | `.sprint-state/review/r1-requirements-r3draft.md`（21 REQ / 14 验收项） |
| 设计 | `docs/plans/2026-11-24-v2b-a-design.md`（D-01~D-09 + 15 切片） |
| 机读契约 | `specification.yaml`（SPEC-V2BA-001，21 REQ / 49 AC） |
| 切片 | `.sprint-state/slices-manifest.json`（15 切片，拓扑校验通过，21/21 REQ 覆盖） |
| 评审证据 | `r1-consensus.md`、`r1-consensus-r2.md`、`r2-consensus.md` |
| 面板 | `.delphi-config.json` + `.sprint-state/review/delphi-panel-v2b.md` |
| 决策 | DR-029 / DR-030 / DR-031 / DR-032 |
| 证据脚本 | `var/probes/scan-unit-probe.mjs`（gitignored，可复现 §1.1/§1.2 矩阵） |

## 评审统计（诚实版）

| 轮次 | 席位 | 结果 |
|---|---|---|
| R1 第 1 轮 | hy4std / hy4flash / hy4flash-free（space-bunny 两次超时） | 3/3 REQUEST_CHANGES |
| R1 第 2 轮 | hy4std（失败→hy4flash 补位）/ hy4flash / hy4flash-free | 3/3 REQUEST_CHANGES |
| R2 设计 | hy4std / hy4flash / space-bunny（超时缺位） | 2/2 REQUEST_CHANGES |

**没有一轮 APPROVED。** 设计与需求是**吸收全部 Critical/Major 后的版本**，而不是"通过评审的版本"。
这一点必须如实记录：`DELPHI-GATE` 的"≥90% APPROVED"在本 sprint **未达成**，用户以 DR-031 明确批准进 BUILD。

## 本轮最有价值的四次实测修正

1. **凭据出境未阻断**：`sk-` 探针经 `/claude/anthropic/v1/messages` 与 `/codex/openai/v1/responses` 得到 `warned` + HTTP 200。
2. **流式全空**：Responses 与 Anthropic 的 SSE 每帧投影为 `""`（Chat 对照正常）。
3. **识别规则会阻断目标流量**：特征键方案下三种真实请求全部判歧义 → 直接 fail-closed 会打死自己。
4. **覆盖判据缺 oracle**：`shape_partial_coverage` 只能由投影器自证，等于没有判据 → 改为协议声明清单 + 两轴判定。

## 交付形态

- 新增运行时依赖 `smol-toml@1.9.1`（BSD-3-Clause，零依赖），只用于**定位** Codex 配置键，不做 stringify。
- 15 切片：SL-01..SL-06 协议线（注册表/两种非流式/流式/两轴处置/路由），SL-07 分层声明，
  SL-08..SL-10 三个适配器，SL-11 doctor，SL-12 金丝雀边界，SL-13 四段全链 E2E，SL-14 审计与守卫，SL-15 文档。

## status

```
status: completed（DELPHI-GATE 未达 90% 共识，用户 DR-031 明确批准进 BUILD）
outputs: 见上表
decisions: DR-029, DR-030, DR-031, DR-032
next_phase_context:
  - ralph-loop 按 manifest 拓扑序执行 15 个切片
  - 每切片：RED → GREEN → REFACTOR，收尾跑全量 vitest + tsc --noEmit + xp-gate check --all
  - SL-01 必须先落地（Chat 对照锁），否则任何共享函数改动都没有回归基线
```
