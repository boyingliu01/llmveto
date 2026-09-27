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
- **Choice**: **complex**（用户已确认，见 DR-005 的 AskUserQuestion 三项决策）
- **Rationale**: 绿地系统、6 个分层、流式零缓冲网络 I/O、密码学哈希链、daemon 生命周期、fail-closed 安全语义、p95<5ms 性能预算、正负 fixture 双矩阵、跨真实客户端 E2E
- **Timestamp**: 2026-09-14T11:22:00+08:00

## Decision DR-004
- **Phase**: 1/6 PREP
- **Question**: pre-commit Gate 6 要求架构约束文件，如何满足
- **Options**: (a) `.architecture-skip` 豁免文件；(b) `archlint init` 生成配置；(c) 生成配置 + 手写分层契约
- **Choice**: **(c)** — `.archlint.yaml`（异味检测配置）+ `architecture.yaml`（7 层依赖方向契约）
- **Rationale**: (a) 是绕过门禁，与项目"安全检查失败不放行"的立身原则自相矛盾，拒绝。(b) 只覆盖异味，不覆盖依赖方向；而"checker 必须是纯函数、不得 import 网关"是可测试性契约 #2，属核心不变量，需显式成文并在 BUILD 期由 `architecture-boundaries.test.ts` 断言执行
- **Timestamp**: 2026-09-14T11:23:00+08:00

## Decision DR-005
- **Phase**: 2/6 DESIGN（进入 Phase 2 前）
- **Question**: 规模分类 / 本期范围 / DESIGN 强度
- **Options**: 规模 {lightweight|standard|complex}；范围 {仅 v1 MVP | v1+v2 | 全量}；DESIGN {评审批准式 | 直接产出 spec}
- **Choice**: **complex** / **仅 v1 MVP** / **评审批准式**（三项均为用户选择的推荐项）
- **Rationale**: 用户显式确认；评审批准式要求 R1 需求评审 + R2 delphi-review 双通过后才进 BUILD
- **Timestamp**: 2026-09-14T14:05:00+08:00

## Decision DR-006 — 流式阻断语义：零缓冲 + 终止流（不引入缓冲窗口）
- **Phase**: 2/6 DESIGN / R1 修订
- **Question**: SSE 零缓冲与 fail-closed 阻断物理冲突时如何取舍（三专家 3/3 命中，P-01）
- **Options**: (a) 保留零缓冲，流式命中=终止流 + 明文声明"已转发字节不可撤回"；(b) 引入 1-chunk（或 N-chunk）缓冲窗口后再判定，换取真字节级阻断；(c) 流式路径不做阻断，仅告警
- **Choice**: **(a)**，并把该取舍写成 REQ §行为矩阵 场景 4 的明文承诺 + fixture `expected.observables` 可断言字段
- **Rationale**: 本项目威胁模型认定"网关变慢 → 用户绕过网关"是比"半截字节泄漏"更高概率的失效路径（性能即安全属性，DESIGN 原论证）。(c) 会让 T2c 的"可阻断"主张整体失效，与立项理由冲突。取舍必须成文而非隐含：v1 的"阻断"粒度是响应级不是字节级，且 agent 若在终止前已执行半截 tool-call 属未覆盖范围（登记表 T2a 行）
- **影响**: REQ §行为矩阵 / §`redact` 期次声明；TEST 契约 #3 `expected.observables`；ROADMAP v1 验收第 4 条
- **Timestamp**: 2026-09-14T15:10:00+08:00

## Decision DR-007 — 术语定案：verdict（checker）与 action（policy）两层分离
- **Phase**: 2/6 DESIGN / R1 修订
- **Question**: `verdict` 与 `action` 在 4 处文档混用同一枚举，fixture `expected.verdict: block` 与"checker 不做策略决策"不变量冲突（P-06）
- **Options**: (a) 统一为单层 verdict；(b) 两层分离：checker 出 `verdict ∈ clean|finding|error`，policy 出 `action ∈ allow|warn|redact|block`；(c) 保留混用但在 fixture 加注释
- **Choice**: **(b)**，并连带定案 `verdict=error → action=block`（fail-closed）、`redact` 移出 v1（流式物理不可执行）、v1 策略映射为**内置固定表**（可配置性属 v3）
- **Rationale**: (a) 会让 checkers 层承担策略知识，直接摧毁可测试性契约 #2 与 architecture.yaml 的 import 边界；(c) 无法消除 CI 断言歧义。ROADMAP 原文"v3 才有 per-checker 动作"与"v1 要求 block E2E"矛盾，故澄清为：v1 已有不可配置的 action 映射，v3 交付的是可配置化
- **Timestamp**: 2026-09-14T15:12:00+08:00

## Decision DR-008 — "全部流量过闸"降级为受管配置封闭枚举
- **Phase**: 2/6 DESIGN / R1 修订
- **Question**: v1 首要验收"doctor 可证明 OpenCode 全部 provider 流量过闸"是不可证伪全称命题（P-03，3/3 命中）
- **Options**: (a) 保留原文，靠 nightly 人工抽查；(b) 改为封闭枚举断言（配置覆写 + 探测过闸 + 旁路清单声明）；(c) 把流量级 100% 过闸整体推到 v3
- **Choice**: **(b)**：适配器必须导出 `MANAGED_CONFIG_IDS`（受版本控制契约），doctor 遍历该枚举逐条断言 + 每路径回放探测请求并在 evidence 中命中；同时 (c) 的一部分并入——文档明示"v1 不具备发现旁路的能力"（审计缺口检测属 v3）
- **Rationale**: 硬验收里写不可证伪命题等于没有门槛，且会永远"差一点达标"。封闭枚举把命题变成可 CI 断言的形式；枚举本身可版本化、可扩展，v2 新增客户端即新增枚举项，承诺强度与实际能力始终对齐
- **Timestamp**: 2026-09-14T15:15:00+08:00

## Decision DR-009 — v1 自带 mock-upstream，evil-relay 明确归 v2
- **Phase**: 2/6 DESIGN / R1 修订
- **Question**: v1 验收的 fixture/E2E 依赖 evil-relay（ROADMAP 排 v2）与金丝雀（v2）→ v1 无法独立验收（P-04，3/3 命中）
- **Options**: (a) evil-relay 提前进 v1；(b) v1 只做最小 mock-upstream，E2E 载体换成它，evil-relay 留 v2；(c) v1 取消 E2E 验收
- **Choice**: **(b)**：v1 交付纯 TS 声明式 `mock-upstream`（可按 fixture 逐 chunk 吐出、可注入自定义 chunk 边界以构造跨切分对抗样本）；evil-relay 定位为"v2 全量 9 对手 + 双矩阵"。(c) 不可接受——fail-closed 是项目立身主张，无 E2E 即未验证
- **Rationale**: (a) 会把 fpverify 的 Python 运行时与 docker 依赖拖进 v1 关键路径（见 REUSE 与 G-FP 门）。mock-upstream 同时解决了另一问题：跨 chunk 切分样本必须能**控制 chunk 边界**，evil-relay 作为整体模拟器不提供该粒度
- **Timestamp**: 2026-09-14T15:18:00+08:00

## Decision DR-010 — 安全类 checker 超时 = 拒绝，且性能预算拆为三台门
- **Phase**: 2/6 DESIGN / R1 修订
- **Question**: DESIGN 原"checker 超预算 → 降级异步、绝不阻塞流"对 `egress-secret-scan` 等价 fail-open，直接违反 REQ 目标#3；TTFT 口径不含请求侧扫描耗时（P-02，3/3 命中）
- **Options**: (a) 保留降级条款，靠文档提醒；(b) 区分安全类/观测类：安全类强制同步 + **超时=block**，观测类可降级；预算拆成 G1 TTFT / G2 请求侧增量（按 body 分档）/ G3 扫描超时三台独立门
- **Choice**: **(b)**，并定 G1 p95<5ms & p99<12ms、G2 ≤8KB:3ms / ≤64KB:10ms / ≤512KB:40ms、G3 50ms；实测不达标须走 ADR 修订并公开记录，禁止静默放宽
- **Rationale**: "安全检查失败不放行"是本项目区别于质量门禁 SKIP 语义的唯一硬差异，超时是失败的一种，不能例外。G2 阈值是**承诺值而非实测值**，故显式挂 G-BENCH 前置门逼 BUILD 期先实测——这一诚实标注本身是 R1 要求消除"不可证明承诺"的一部分
- **Timestamp**: 2026-09-14T15:20:00+08:00


## Decision DR-011 — v2 走完整 Sprint Flow（复杂级）
- **Phase**: 1/6 PREP / AUTO-ESTIMATE
- **Question**: AUTO-ESTIMATE 实测 18 处触点、跨 7 个 src 目录、新增 export >5、预估 >10 文件 / >500 LOC（超复杂阈值 2 倍），是否接受"复杂 → 完整 6 阶段"流程
- **Options**: (a) 接受复杂/完整流程；(b) 降级标准流程；(c) 先只跑 DESIGN 看完设计再定
- **Choice**: **(a)** 接受复杂 / 完整 Sprint Flow
- **Rationale**: 客观指标全部落在复杂区间，且 v2 触碰 evidence schema 冻结契约（见 DR-012），降级会低估回归面
- **Timestamp**: 2026-09-27T17:40:00+08:00

## Decision DR-012 — v2 拆两刀：v2a 检测核心 / v2b 运营面
- **Phase**: 1/6 PREP / 范围切分
- **Question**: roadmap §v2 有 7 条相互独立的交付线（4 checker、金丝雀、指纹巡检、计费对账+report、evil-relay 双矩阵 CI、3 个新接入、CI 化），超过单 sprint 常规预算，如何切
- **Options**: (a) 全量 v2 单 sprint；(b) 拆两刀 v2a 检测核心 + v2b 运营面；(c) 拆三刀只做 4 checker + 金丝雀
- **Choice**: **(b)** 拆两刀。本 sprint = **v2a**：evidence schema 扩版决策 + 4 个新 checker（thinking-signature-presence / tool-call-shape / usage-reconcile / fingerprint-probe）+ 金丝雀引擎与 `canary rotate` CLI + evil-relay 模拟器与双矩阵 CI 化。**v2b** 顺延：周期性指纹巡检 + provider 信任分、计费对账与 `report` CLI、Claude Code / Codex / promptfoo 接入扩展
- **Rationale**: v2a 的判据是"能被 evidence 与 CI 证明"——4 个 checker 与金丝雀都落在同一条过闸/取证链上，且共享同一处 schema 契约变更，拆开会造成 schema 改两次。v2b 三条线是纯运营面（巡检调度 / 出报告 / 多客户端覆写），与检测语义正交，可独立验收。v1 已有教训：走查在大批次文档上不收敛（见 [[r10-batch-pending]]），砍范围优于砍深度
- **Timestamp**: 2026-09-27T17:42:00+08:00
