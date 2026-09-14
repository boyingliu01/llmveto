# R1 需求评审 — Round 1 共识报告

- **Sprint**: sprint-20260914-49 / Phase 2 DESIGN / delphi-review R1（需求评审）
- **评审对象**: `docs/issues/{1,2,3,4,5}-*.md` + `architecture.yaml` + `README.md`
- **评审范围**: v1 MVP 是否可冻结
- **专家团**: A=架构视角(g-deepseek-flash) / B=技术视角(g-glm-5.3-flash) / C=可行性视角(g-qwen3.8-flash)
- **Round 1 裁决**: A `REQUEST_CHANGES`(conf 8) / B `REQUEST_CHANGES`(conf 9) / C `REQUEST_CHANGES`(conf 8) → **一致 REQUEST_CHANGES**
- **原始报告**: `r1-expert-A.md`(154L) `r1-expert-B.md`(73L) `r1-expert-C.md`(83L)

## 1. 共识矩阵

命中数 = 三位专家中提出该问题的位数。**3/3 与 2/3 问题按最高级别归并后全部纳入零容忍处理清单**（delphi-review 纪律：Critical/Major 不可跳过、不可降级）。

| ID | 级别 | 命中 | 问题 | 提出者 |
|---|---|---|---|---|
| P-01 | Critical | 3/3 | 流式 `block`/`redact` 语义未定义，与"零缓冲立即转发"物理冲突；已转发字节不可收回 → fail-closed 在流式下无可满足定义 | A-C1 B-C1 C-C1 |
| P-02 | Critical | 3/3 | DESIGN"超预算→降级异步、绝不阻塞流"对安全类 checker 等价 fail-open，直接违反 REQ 目标#3；出站扫描与 TTFT 共用预算但请求侧口径为空白 | A-M3 B-C2 C-C2 |
| P-03 | Critical | 3/3 | "doctor 可证明 OpenCode 全部 provider 流量过闸"是不可证伪的全称命题（"全部"无枚举、流量级观测=审计缺口检测排在 v3，循环依赖） | A-C2 B-C3 C-C4 |
| P-04 | Critical | 3/3 | v1 硬验收依赖 v2/v3 交付物（evil-relay=v2、金丝雀=v2、per-checker 动作=v3）→ v1 验收当前不可执行 | A-C3 B-M3 C-C3 |
| P-05 | Critical | 3/3 | v1 残余风险登记表缺失：T2a(RCE)/T2b/T2d/T4a-d/P1/P2 全程零缓解；T1a 因金丝雀排 v2 而无任何检测 | A-C4+M2 B-M2 C-C5 |
| P-06 | Critical | 2/3 | `verdict` 与 `action` 两层术语在 TEST 契约#2/#3、DESIGN、architecture.yaml、ROADMAP 四处混用；fixture `expected.verdict: block` 破坏"checker 不做策略决策"不变量；`redact` 在流式上语义悬空 | B-M1 C-M3 (+A-M5) |
| P-07 | Critical | 1/3 | evidence store 在 v1 验收四条中零条目；哈希链安全属性被夸大（本机同权限对手可整链重写）；v1 无校验提供者 | B-C4 (+A-M4 C-M1) |
| P-08 | Major | 3/3 | evidence schema 字段清单未定义，却被声明为对外唯一消费接口（Gate LS） | A-m1 C-M5 (+B-M6) |
| P-09 | Major | 3/3 | checker 输入未定义（原始字节 / SSE 事件 data / 解析后 JSON），影响三个内容型 checker 正确性与 fixture 可复现性 | C-M6 (+C-M4 跨 chunk) |
| P-10 | Major | 1/3 | `invisible-unicode-scan` 跨 chunk 漏检：U+200B = `E2 80 8B` 可被 SSE chunk 边界切开，逐 chunk 独立扫描系统性漏检（与可测试性契约#2 冲突） | C-M4 |
| P-11 | Major | 2/3 | 检出率/误报率无量化门槛，"可用"与"回退阻断合并"均不可判定 | B-M4 C-M2 |
| P-12 | Major | 1/3 | `model-field-consistency` 只覆盖 T3a 的 label-mismatch 子集；REQ 自述实证"响应 model 字段无回写校验"恰说明真替换不改字段 → "v1 覆盖 T3a"主张不成立 | A-M2(部分) C-M5 |
| P-13 | Major | 1/3 | Delphi 接入是 v1 交付物但 v1 验收四条零覆盖 | B-M5 |
| P-14 | Major | 1/3 | 复用组件的许可/运行时成本未评估：gitleaks 规则"MIT"断言未核实；fpverify 引入 Python 测试运行时 | C-M7 |
| P-15 | Major | 2/3 | REQ 顶层目标全称量词"所有流量"与 v1 仅接入 2 客户端、TLS 拦截推 v3 不自洽，无分版本覆盖集合判据 | A-M1 (+C-C4) |
| P-16 | Minor | 3/3 | TEST 五件套/金丝雀专项/审计缺口未逐项标注版本归属 → CI 范围歧义 | A-m2 B-M3 C-m3 |
| P-17 | Minor | 2/3 | README 架构图把 TLS 拦截画进 v1 主路径，与 ROADMAP 排 v3 冲突；CLI 命令集三处不一致 | C-m1 C-m2 A-m3 |
| P-18 | Minor | 1/3 | v1 doctor 的"CA 信任"检查项空转（TLS 拦截属 v3） | B（doctor 职责，归并入 P-03） |
| P-19 | Minor | 1/3 | 证据链并发/崩溃/fsync 语义未声明 | A-m4 |
| P-20 | Minor | 1/3 | benign 语料"脱敏"流程与 evidence"全量留存"的隐私张力；全量留存本身构成 T1b 本地聚集风险 | C-m4 |
| P-21 | Minor | 1/3 | `OPENCODE_MODELS_URL` / `experimental.policies` 的配置责任方（网关 vs 用户手册）未指定 | C-m6 |
| P-22 | Minor | 1/3 | 单二进制分发与"兼容 Node ≥ 18"表述混用，runtime 支持承诺含糊 | C-m7 |

**统计**: Critical 归并 7 条（其中 5 条 3/3 命中），Major 7 条，Minor 8 条。共识度：3 位专家裁决完全一致，问题清单重叠率高（P-01~P-05 全 3/3）→ 属"结构性缺陷一致认定"，非意见分歧。

## 2. 三位专家一致肯定的部分（修订中必须保留）

1. 威胁编号体系（T1a…P2）在 REQ/DESIGN/TEST 三文档对齐且每条挂实证 → 可评审性基础
2. 理论边界诚实（"上游是否记录不可证伪、MIA 不可行"）
3. 可测试性契约前置固化（架构期锁死，不可事后补）+ `architecture.yaml` 用 import 边界把它变成机器可执行契约
4. 分期纪律（v1 过闸 → v2 验证加深 → v3 策略闭环）方向正确
5. "性能即安全属性"的对抗性论证（而非当普通 SLA）

## 3. 处置决议（本轮采纳的定案）

| ID | 处置 | 落点 |
|---|---|---|
| P-01/P-06 | 新增 **§裁决与动作语义**：`stream × non-stream × {allow,warn,redact,block}` 8 格行为矩阵；术语定案 checker 只产 `verdict ∈ {clean, finding, error}`，`action ∈ {allow,warn,redact,block}` 由策略引擎产出；`redact` 声明为 v3（流式不可执行） | REQ 新增节 + TEST 契约#2/#3 + DESIGN 组件2/3 + architecture.yaml 注释 |
| P-02 | 降级条款限定为**观测类**；安全类强制同步、**超时=deny**；性能预算拆为 3 条独立门（响应侧 TTFT 增量 / 请求侧端到端增量按 body 分档 / 扫描超时上限）+ 测量协议（基线、payload 包络、样本量、回退公式） | DESIGN §关键决策 + TEST §5 + ROADMAP v1 验收 |
| P-03/P-18 | "全部" → **受管配置封闭枚举**（适配器声明的清单为受版本控制契约）；验收拆为 a) 配置覆写断言 b) 探测过闸断言 c) 显式声明不覆盖旁路清单；doctor v1 仅输出 4 项确定性结论，CA 信任项标 `not-applicable@v1` | ROADMAP v1 验收 + DESIGN §验收/§防绕过 |
| P-04/P-16 | v1 自带 **`mock-upstream`（TS 声明式脚本回放）**，E2E 载体 = mock-upstream；evil-relay 限定为"v2 全量 9 对手 + 双矩阵"；五件套逐项标 `@v1/@v2/@v3` + v1 替代物 | TEST §2/§4/§5 + ROADMAP v1/v2 |
| P-05 | 新增 **§v1 残余风险登记表**（威胁 × v1 状态 × 缓解 × 缺口理由 × 计划期次 × 取证可得性），作为 v1 冻结件；README 增"v1 不能防什么" | REQ 新增节 + README |
| P-07/P-08/P-19/P-20 | evidence **信任边界声明**（链=内部一致性自检，不抵抗本机同权限整链重写）+ 崩溃/并发等级（单写者 + fsync best-effort + 尾行半行容忍）+ **v1 冻结字段表**（`evidence-version: 1`）+ `llmveto verify` 提入 v1 + v1 验收补第 5 条 | DESIGN 组件4 + TEST 契约#4 + ROADMAP |
| P-09/P-10 | 可测试性契约#2 升级为两态签名：非流式纯函数 `(unit) → {verdict, evidence}`；流式 `(window, chunk) → ({verdict, evidence}, newWindow)`，状态由 fixture 框架注入（保持可单测）；统一**解码后规范化 UTF-8 文本 + `sse_data` 字段抽取**为扫描单元，并强制跨 chunk 对抗样本进 fixture | TEST 契约#2/#3 + DESIGN 组件2 |
| P-11 | 量化门槛入 CI：fixture 检出率 100%（硬）；benign ≥50 条，告警类 FP ≤2%，阻断类 FP = 0（白名单豁免需逐条裁决）；回退公式 `p95_pr > p95_base × 1.2` 或绝对增量 >2ms → 阻断合并 | TEST §3 + ROADMAP v1 验收 |
| P-12 | checker 改名 `model-label-consistency`，登记能力边界=仅字段一致性（label-mismatch），真替换需 v2 指纹 | DESIGN 组件2 + REQ 登记表 + README |
| P-13 | v1 验收补 Delphi 条目（覆写→过闸 evidence 可观测→doctor 漂移样本） | ROADMAP v1 验收 |
| P-14 | fpverify 降级为**离线 fixture 生成器**（开发者机器跑一次，产出 YAML 入仓）→ CI 零 Python；gitleaks 许可改为 BUILD 前决策门（核实则复用规则，否则自建 top-N 高置信模式），落 `docs/licenses.md` | REUSE 表 + ROADMAP v1 前置门 |
| P-15 | REQ 目标#1 全称量词改为"分版本声明覆盖集合"；未接入客户端显式声明为未覆盖暴露面 | REQ §目标 |
| P-17/P-21/P-22 | README 架构图标期次；v1 CLI 冻结为 `start/stop/status/doctor/verify`（不为未实现命令留 stub）；`OPENCODE_MODELS_URL` 由适配器 `llmveto doctor --write-managed-config` 负责写入；runtime 承诺 = 代码仅用 Node stdlib API（禁 Bun-only），Bun 仅用于 compile | README + DESIGN + REQ |

## 4. 未纳入本轮的专家建议（附理由）

| 建议 | 提出者 | 不纳入理由 |
|---|---|---|
| 把"导出到第三方锚定/签名时间戳"提进某个具体期次 | C-M1 | v1/v2/v3 均无外部服务依赖预算；改为在 evidence 信任边界声明中**显式写"不抵抗本机整链重写"**，避免虚假承诺。若后续需要，走新 issue 立项 |
| 流式改为 1-chunk 缓冲窗口后再转发（换取真阻断） | A-C1 备选 | 与"零缓冲"决策的对抗性后果（用户因延迟绕过网关）冲突；本项目的威胁模型是"性能即安全"，故选"检测+终止流+不承诺撤回"而非引入缓冲。已在 P-01 矩阵中把该取舍写成明文承诺 |
| 增加响应注入扫描（T2b）进 v1 | C-C5 备选 | 无 FP 门槛的纯文本规则会在真实 agent 会话上大面积误报，反而破坏"告警可信"。v1 只做 evidence 留痕（可取证不可阻断） |

## 5. Round 2 计划

按 delphi-review 纪律，Round 1 全 REQUEST_CHANGES → 修复全部 Critical + 处理全部 Major 后**从 Round 2 起步复审**（不回 Round 1）。Round 2 输入 = 修订后文档 + 本文件 §3 处置决议，要求专家对每条处置给出 `resolved / partially_resolved / unresolved` 并重新裁决，目标共识 ≥91% 且 0 Critical / 0 Major。
