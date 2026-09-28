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

## Decision DR-012a — 订正 DR-012 的 v2a checker 清单（fingerprint-probe 移出）
- **Phase**: 2/6 DESIGN / R1 访谈 Q5
- **Question**: DR-012 把 `fingerprint-probe` 写进 v2a 的 4 个新 checker。它该留在 v2a 还是并入 v2b 巡检
- **Options**: (i) 留 v2a；(ii) 移出 v2a，与 v2b 周期性巡检合并
- **Choice**: **(ii)** 移出。v2a 新增 checker 实为 **4 个**：`tool-call-shape` / `thinking-signature-presence` / `usage-reconcile` / `canary-return-scan`（§4.1 分类归属总表为准）
- **Rationale**: `fingerprint-probe` 的判定内核是序贯检验，其消费者是 v2b 的周期巡检与 provider 信任分；单独在 v2a 落地等于交付一个无消费者的探测器。且"探针"要求网关主动向上游发已知 prompt，与 T1a 的"最小暴露"承诺顶牛。ROADMAP §v2 原列 5 类，减此项后与 §4.1 四行一致
- **Timestamp**: 2026-09-28T08:00:00+08:00

## Decision DR-013 — 金丝雀不扩 evidence schema，命中写成 findings 条目
- **Phase**: 2/6 DESIGN / R1 访谈 Q1
- **Question**: canary 命中要不要给 evidence 加字段？TEST 契约 #4 的 `evidence_version: 1` 字段表已冻结，`src/evidence/schema.ts` 里 `canary` 恒 `null`（AC-VETO-007-05）
- **Options**: (a) 加 `canary` 字段并升 `evidence_version`；(b) 同 version 下形状分叉；(c) 不动 schema，命中落 `findings[]`（`checker:"canary-return-scan"`, `rule_id:"canary-<id>"`），`canary` 字段永久恒 `null` 成为**保留位**，轮换状态入 state 目录不进链
- **Choice**: **(c)**
- **Rationale**: (a) 会让同一 `evidence_version` 下新旧链字段形状不同，v3 的 Gate LS 要背双版本断言；(b) 直接破坏"版本号即形状契约"。(c) 的代价是"有 canary 字段但没有内容"的观感误导，故必须把它显式定义为**保留位**并写进 CONTEXT.md，防止后来者拿字段存在当能力证据
- **Timestamp**: 2026-09-28T08:02:00+08:00

## Decision DR-014 — canary 由网关注入，位置固定末条 message 尾部，按 session 轮换
- **Phase**: 2/6 DESIGN / R1 访谈 Q2
- **Question**: 谁注入、注入在哪、多久换
- **Options**: (a) 网关注入 + 末条 message content 尾部 + session 级轮换；(b) 注入 `system`；(c) 客户端自管
- **Choice**: **(a)**，不碰 `system`
- **Rationale**: `system` 是对话的语义骨架且常被上游单独处理，注入它等于改变请求的类别；末条尾部是纯追加，可用"既有字节逐字节不变"证伪。(c) 把防护能力交给被防护对象，与网关定位矛盾。注入是**新增**字节，因此不属于 `redact`、不受"改写属 v3"的限制——这条区分写进 CONTEXT.md 防混用
- **Timestamp**: 2026-09-28T08:04:00+08:00

## Decision DR-015 — 金丝雀只做跨会话串流，单请求内复述判为不命中
- **Phase**: 2/6 DESIGN / R1 访谈 Q3
- **Question**: canary 命中形态是什么？同一请求里模型复述 canary 算不算
- **Options**: (a) 只做跨会话串流，匹配域为有界的最近 N 个活跃 session；(b) 也算单请求复述
- **Choice**: **(a)**，N=64 / TTL 24h（先到为准）
- **Rationale**: 单请求内复述在 benign 场景下同样高频发生（模型回显用户输入），把它算命中会直接摧毁"告警可信"。匹配域必须有上界，否则网关在本机攒出一座可匹配的历史 prompt 库，把 T1a 的防护变成 T1a 的暴露面——这是新增 P4 登记行的由来
- **Timestamp**: 2026-09-28T08:06:00+08:00

## Decision DR-016 — T2b 移出 v2 验收并订正 ROADMAP，拒绝无 FP 门槛的文本规则
- **Phase**: 2/6 DESIGN / R1 访谈 Q4
- **Question**: ROADMAP:57 要求 v2 结束时 T2b 状态提升，但 §v2 交付清单里没有任何检测 T2b 的组件——验收条目引用了不存在的交付物
- **Options**: (i) 订正 ROADMAP，T2b 期次 v2→v3；(ii) 塞一条响应侧文本规则 checker 凑验收
- **Choice**: **(i)** 订正文档
- **Rationale**: (ii) 正是 v1 R1 已否决过的做法：没有 FP 门槛的注入文本规则会把误报变成常态告警疲劳。v1 的纪律是"验收条目只能引用本期交付物"（期次纪律），宁可改文档也不造空转检查项
- **Timestamp**: 2026-09-28T08:08:00+08:00

## Decision DR-017 — 响应扫描单元补齐 tool-call 参数，并回头订正 REQ 登记表
- **Phase**: 2/6 DESIGN / R1 访谈 Q6（v1 规格—实现背离）
- **Question**: DESIGN §扫描单元定义宣称响应侧含 `tool_calls[*].arguments`，实测 `buildResponseScanUnit` 从不提取，`tool_calls` 在 `src/` 与 `tests/` 出现 0 次 ⇒ 阻断类 checker 宣称覆盖而实际未覆盖，v1 验收第 3 条"检出率 100%"是在不覆盖该扫描面的 fixture 集上达成的
- **Options**: (a) 修公共扫描单元 + 订正 REQ 登记表 T2c 行；(b) 只在 v2a 新 checker 内部自行解析 tool_calls；(c) 视为已知限制不处理
- **Choice**: **(a)**
- **Rationale**: (b) 会让"扫描单元覆盖面"这件事在各 checker 里重复实现一遍，正是 v1 定 §扫描单元定义 想消除的分叉源。(c) 不可接受——已转发的漏检声明必须回到登记表，否则残余风险表在说谎。附带代价：v1 的验收表述需要公开订正（AC-V2a-15/16 把守）
- **Timestamp**: 2026-09-28T08:10:00+08:00

## Decision DR-018 — 流式 tool_call 参数累积按 ScanWindow 语义延伸，出 ADR-0003 + G-WINDOW 门
- **Phase**: 2/6 DESIGN / R1 访谈 Q7
- **Question**: `tool-call-shape` 要判 `arguments` 的 JSON 完整性，必须跨 chunk 累积；这与冻结的"零缓冲 = 不持有 >1 chunk"定义顶牛
- **Options**: (a) 当作 `ScanWindow` 既有语义延伸（未闭合 `arguments` 与未决 UTF-8 尾字节同类，由 `ScanWindow.extra` 承载），定义文字不改只加注脚；(b) 放宽零缓冲定义；(c) 只在完成帧判定，放弃流式检出
- **Choice**: **(a)**
- **Rationale**: (b) 破坏 v1 对客户端的对外承诺（已转发字节不可撤回）；(c) 让攻击者用"把违规藏在流中段"就能绕过。(a) 之所以不是自欺：`ScanWindow` 本来的定义就是"当前判定单元不完整"的暂存态，UTF-8 未决尾字节已在 v1 如此处理。但 (a) 引入了新的资源上界与内存风险，故必须**显式入 §2 范围 + 新门 G-WINDOW + AC-V2a-14 + ADR-0003 公开记录**，不得静默放宽——这正是 R1 Round 1 的 A-CRIT1 抓出来的治理缺口
- **Timestamp**: 2026-09-28T08:12:00+08:00

## Decision DR-019 — checker 分级：2 安全类 + 2 观测类
- **Phase**: 2/6 DESIGN / R1 访谈（分类归属）
- **Question**: v2a 四个新 checker 各自映射为 `block` 还是 `warn`
- **Options**: (a) 全安全类；(b) 全观测类；(c) 分级：`tool-call-shape` + `canary-return-scan` 安全类，`thinking-signature-presence` + `usage-reconcile` 观测类
- **Choice**: **(c)**
- **Rationale**: `thinking-signature-presence` 是**证伪信号**（能否决声称，不能确认身份），`usage-reconcile` 只有本地估算误差带——两者都不足以承担阻断的代价，误报即伤人。前两者判据是确定性的（未声明工具 / 非法结构 / 别的会话的串出现），可以 block。这也是 `degraded_observational` 枚举自 v1 占位后在 v2a 首次可达的来源（AC-V2a-11）
- **Timestamp**: 2026-09-28T08:14:00+08:00

## Decision DR-020: 实装 TEST 契约 #4 的可选 `reason` 位，并把 v1 背离由一处登记为三处

- 日期：2026-09-28
- 阶段：Phase 2 / R1 Round 5 批准后自查
- 决策：v2a 实装 `EvidenceRecord` 的**可选** `reason` 顶层位（契约 #4 早有其行、必填列为 ❌，v1 实现整体缺席），`CheckerResult.reason` 联合扩为四值（新增 `window_overflow`），并修 `flattenFindings` 使 error 裁决同时产出 `findings[]` 内 `verdict="error"` 条目；`REQUIRED_FIELDS` 26 项必填表不变。`registry_unavailable` / `inject_skipped` 只进该描述位、**不进** `findings[]` 裁决位。
- 备选与否决：(a) 只借 `findings[].rule_id` 承载——否决，因契约的 `findings` 项无 reason 语义且 error 分支现状 `evidence: []`，等于把"哪个 checker 因何阻断"写成一条业务命中，混淆 verdict 语义；(b) 新增顶层必填字段——否决，破 DR-013 的"不动 schema"且需要 `evidence_version` 升版；(c) 不修、只把 AC 措辞降级为"不断言 reason"——否决，那等于用改测试来迁就实现，正撞本项目"禁止静默放宽"的纪律。
- 连带：`docs/plans/2026-09-27-v2a-requirements.md` §5 由"一处背离"扩为三处（第三处 = fail-closed 的 error→block 在链上不留 per-checker 痕迹，是 v1 验收"超时=拒绝"在取证面的真实缺口）；新增 REQ-V2a-12/13/14、AC-V2a-23/24；文档订正由四处升为六处（AC-V2a-16）。`usage` / `cache_reported` 与 `latency` 四元组 **v2a 不实装**，但必须在契约文本与 REQ 登记表留下可 grep 的背离记录。
- 未决与复核义务：本决策发生在 Round 5 给出 3/3 APPROVED **之后**，5 轮预算已用尽，故 §5 三处背离版本文**未经评审轮独立确认**；Phase 4 的测试-规格对齐报告与 code-walkthrough 必须把 §4.5 双层落点、§5 第二/第三处列为专门复核项。详见该文档 §14.4。

## Decision DR-021: 流式窗口按 checkerId 分持、游标由网关权威推进一次（第四处 v1 背离）

- 日期：2026-09-28
- 阶段：Phase 2 / Step 3 设计文档定位接缝时的自查
- 决策：网关为每个有状态流式 checker 各持一份 `ScanWindow`（`pendingBytes`/`cursor` 为网关侧共享事实，`extra` 为 checker 私有且跨片保留）；`cursor` 由网关以 `unit.text.length` **推进且只推进一次**，checker 回传的 `cursor` 被忽略、回传的 `extra` 被保留。TEST 契约 #2 的两态签名与 checker 侧实现、既有 fixture **均不改**。已落链的失真 `offsets` 不回填不重算，只在 REQ 登记表 T2c 行标注能力边界。
- 触发事实：`core.ts:97` 在进 checker 循环前先加一次 `unit.text.length`（checker 内部再加一次 → 每片双重推进），且重建 `nextWindow` 时丢弃 `extra`。三片流式实测：隐形字符真实全局偏移 22 / 33，链上 `offsets` 报 **49 / 71**。既有 `tests/unit/checkers/invisible-unicode-scan.test.ts:50-69` 把窗口语义钉死却一直绿，因为它直接调 checker、绕过网关；网关路径对 `offsets` 零断言。
- 备选与否决：(a) 串行共享单窗口 + 要求每个 checker 记得透传 `extra`——否决，正确性寄托在礼貌上，且 offsets 依赖调用顺序；(b) 改契约 #2 让 checker 不回传 cursor——否决，破 v1 冻结的可测试性契约，本项目明写该契约"不可事后补"；(c) tool-call 累积窗口另立于网关侧——否决，与 ADR-0003 冲突且出现两套跨片状态口径；(d) 保留缺陷只改 AC 措辞——否决，test-follows-implementation，撞"禁止静默放宽"。
- 连带：`docs/plans/2026-09-27-v2a-requirements.md` §5 由三处背离扩为**四处**；新增 REQ-V2a-15、AC-V2a-25、AC-V2a-26；文档订正点数由六处升为**七处**（AC-V2a-16⑦，T2c 行能力边界加注）。ADR-0005 承载形态与否决理由。
- 必要性（不是可选清洁）：`tool-call-shape` 是第二个有状态流式 checker，窗口不跨片存活 ⇒ ADR-0003 的 256 KiB 单笔上界与 AC-V2a-14 的"总留存字节"无可信计量点 ⇒ G-WINDOW 关不掉。本条不实现，已批准需求失去可判定性。
- 未决与复核义务：与 DR-020 同形——本决策发生在 Round 5 给出 3/3 APPROVED **之后**，5 轮预算已用尽，故 **REQ-V2a-15 / AC-V2a-25 / AC-V2a-26 未经任何评审轮独立确认**；Phase 4 必须与 §4.5 双层落点、§5 第二/第三处并列专门复核。影响面限于取证（`offsets`），不改 `verdict`/`action`，故不构成 v1 验收回退、不触发 G1/G2/G3 阈值修订。详见该文档 §14.5。

## Decision DR-022: 设计文档 Step 4 批准 + 17 个拍板项锁定默认值（Step 6 batch 决策记录）

- 日期：2026-09-29
- 阶段：Phase 2 / Step 4 HARD-GATE（兼作 Step 6 的批量决策产物，见"路由说明"）
- 决策：用户批准 `docs/plans/2026-09-27-v2a-design.md`——候选 **A（网关编排 + `src/canary/**` 新域）**、D-01~D-14 全部 14 项设计决策，以及 §8 的 **17 个拍板项全部按文档默认值锁定**：§10.1 十项（控制通道=loopback HTTP、§4.2 定值维持、回退键 sha256 前 16 字符、13 对手仅 nightly、发 `0.2.0`、verify 兼容采纳 R4 F-MINOR1 显式流程改判、文档订正单独 S-DOCS slice、nightly 30min/4-way、G-RELAY 分支 pending、session 头名复用 `x-llmveto-session-id`）+ 新增 #A~#G（`request_body_sha256` 记注入后体 / 离线轮换标记文件 / 无声明 tools 漏检登记 §7 P4⑦ / doctor 封闭枚举 4→6 / G-CANARY 录制来源待用户提供 / LOC 修正 1500/1900/120 / offsets 钉 UTF-16 code-unit）。
- 触发事实：Step 5 路由读取 sprint-state 发现 `auto_estimate` 只有 `"complex"`、无显式 `change_type` 字段，按路由表"缺失 → 标准路径（Step 6 batch-grill-me）"。但 Step 4 的批准问题本身已按 batch-grill-me 的形态交付（编号列全 + 每项推荐答案 + 用户一轮确认），再次执行等于把同一批问题重问一遍。
- 路由说明：本条即 Step 6 的批量决策产物——frontier 已空（设计 §8 无未决分支），用户确认"批准，全部按默认"；差异仅在确认发生在 Step 4 的门上而非独立的 Step 6 会话。R2（Step 7）不受影响，照跑。
- 连带：需求文档同批订正三处（§4.3 唯一写者行 #B、§7 P4 第⑦条 #C、AC-V2a-25 计量单位 #G），均标注"设计批准 2026-09-29"并经用户直接批准，非代理放宽；#D（doctor 枚举 4→6）与 #A（sha 语义）不改正文，属 BUILD 期实现 + `doc-consistency` 断言域；设计文档状态行更新为 APPROVED（Step 7 未跑）。
- 未决与复核义务：**批准不替代评审**。设计文档及其依据的 §14.4/§14.5 增补义务仍无独立评审读者；Step 7 R2 必须把"D-03 窄化 §4.3 许可 / D-04 sha 语义 / D-09 首次接门的可用性风险 / D-12 无声明漏检 / LOC +111% 偏差"列为优先核查面。#E（G-CANARY 的 10 条真实会话录制）仍待用户提供，G-CANARY 关闭前不得注入上线。
