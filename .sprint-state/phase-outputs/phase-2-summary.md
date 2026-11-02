# Phase 2/6: DESIGN — Phase Summary

- **Sprint**: sprint-20260914-49
- **Branch**: sprint/2026-09-14-01
- **Completed at**: 2026-09-15
- **Duration**: 跨会话（2026-09-14 起始）

## Gate 通过状态

| 门禁 | 状态 | 证据 |
|---|---|---|
| R1 需求评审（威胁模型 / REQ 冻结） | ✅ APPROVED | `.sprint-state/review/requirements-reviewed.json` |
| 设计文档用户 APPROVAL | ✅ 用户批准（选「进入 BUILD（推荐）」） | `.sprint-state/decisions.md` |
| R2 delphi-review（≥ 91% 共识 + 零 Critical/Major） | ✅ APPROVED 100% | `.sprint-state/review/delphi-reviewed.json` (R1→R2→R3，Round 3 三专家全票 APPROVED_WITH_CONDITIONS) |
| BUILD-ENTRY-CONTRACT | ✅ 14 REQ ↔ 14 slice 一一覆盖，无缺口无孤儿；拓扑无环 | `specification.yaml` + `.sprint-state/slices-manifest.json` |

## 评审团（Delphi panel）

Provider：`example-provider` → `https://internal-gateway.invalid/redacted/v1`（OpenAI 兼容），凭据来自环境变量 `OPENCODE_EXAMPLE_API_KEY`（不落盘）。

| Expert | 视角 | agent | model |
|---|---|---|---|
| A | 架构 / 需求对齐 | `delphi-reviewer-architecture` | `example-provider/g-deepseek-flash` |
| B | 技术 / 实现正确性 | `delphi-reviewer-technical` | `example-provider/g-glm-5.3-flash` |
| C | 可行性 / 风险仲裁 | `delphi-reviewer-feasibility` | `example-provider/g-qwen3.8-flash` |

三家不同厂家，满足"≥ 2 家"与"禁三专家同厂"。调用约束与配置变更详见 `docs/delphi-panel.md`。

## 三轮评审收敛数据

| Round | Verdicts | Consensus | 新问题 (C/M/m) | Fix Commit |
|---|---|---|---|---|
| R1 | REQUEST_CHANGES × 3 | — | 7 / 7 / 8（共 22） | `2545042` |
| R2 | REQUEST_CHANGES × 2 + APPROVED_WITH_CONDITIONS | 86.4%（低于 91% 阈值） | 2 / 7 / 5 | `9af9633` |
| R3（聚焦复审） | APPROVED_WITH_CONDITIONS × 3 | **100%** | 0 / 1→0 / 0 | 提交前闭合 |

零容忍清单：全部 Critical/Major 均通过文档修订闭合，未使用降级跳过。

## 需求冻结关键决策（DR-005..DR-010 + DD-VETO-*）

- 术语两层：`verdict`(clean/finding/error) vs `action`(allow/warn/redact/block)；redact 移出 v1
- 受管配置封闭枚举 `MANAGED_CONFIG_IDS` 替换"全部流量过闸"不可证伪命题
- 零缓冲 + 终止流：流式已转发字节不可撤回；阻断粒度 = 响应级/流终止级；"零缓冲"精化为"≤1 chunk 瞬态持有窗口"
- mock-upstream 进 v1，evil-relay 归 v2；v1 验收不依赖 v2/v3
- evidence 信任边界：SHA-256 链不抗本机同权限整链重写；`llmveto verify` 提入 v1
- 三台独立性能门 G1/G2/G3；G3 按 body 分档；超时 = 拒绝
- v1 残余风险登记表 13 行威胁 × 6 列，显式登记未缓解面
- 扫描单元排除标准认证头（阻断类 FP=0 物理前提）；副作用（header 路径盲区）已登记 T1b

## 冻结件产物（Phase 3 输入）

| 类别 | 文件 | 说明 |
|---|---|---|
| 需求规范 | `specification.yaml` | 14 REQ + 58 AC + 10 DD + API 契约 + 非目标 + v1 残余风险镜像 |
| 构建切片 | `.sprint-state/slices-manifest.json` | 14 SL ↔ 14 REQ 一一映射，拓扑排序，per-slice verify 命令 |
| 权威文档 | `docs/issues/1..5-*.md` | REQ/DESIGN/REUSE/TEST/ROADMAP（v1 验收条目以 ROADMAP §v1 为唯一权威清单） |
| 分层契约 | `architecture.yaml` | 7 层：shared/checkers/policy/evidence/adapters/gateway/cli |
| 评审证据 | `.sprint-state/review/{r1,r2,r3}-consensus.md` + `{r1,r2,r3}-expert-{A,B,C}.md` | 三专家独立意见 + 共识矩阵 |
| 面板配置 | `docs/delphi-panel.md` | example-provider provider + 3 agent + mode=all 约束 |

## Phase 3 输入要点

- **ralph-loop 顺序**：按 slices-manifest 的 `depends_on` 拓扑序 dispatch subagent
- **每 slice 完成前必跑**：`npx vitest run` + `npx tsc --noEmit` + `npx xp-gate check --all`（回归门禁）
- **架构边界断言**：`tests/unit/architecture-boundaries.test.ts` 与 `architecture.yaml` 双重锁 checker 纯函数性
- **前置门 G-LIC / G-FP / G-BENCH** 必须先关（SL-01），否则范围会中途漂移
- **禁止 redact / 禁止 v2/v3 交付物出现在 v1 验收**（分期纪律）

## status

```
status: completed
outputs:
  - specification.yaml
  - .sprint-state/slices-manifest.json
  - .sprint-state/review/requirements-reviewed.json
  - .sprint-state/review/delphi-reviewed.json
  - .sprint-state/review/r1-consensus.md
  - .sprint-state/review/r2-consensus.md
  - .sprint-state/review/r3-consensus.md
  - docs/delphi-panel.md
decisions:
  - DR-005 规模 = complex
  - DR-006 范围 = 仅 v1 MVP
  - DR-007..DR-010 R1 冻结决策
  - 设计文档用户 APPROVAL（Phase 2 出口）
next_phase_context:
  - 14 slices 按拓扑序进入 ralph-loop
  - Phase 3 入口三门（GITHOOKS-GATE / DELPHI-GATE / BUILD-ENTRY-CONTRACT）全部已满足
```
