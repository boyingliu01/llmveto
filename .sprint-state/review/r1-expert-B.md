# 独立评审报告

## 独立评审 - Expert B（技术视角）

评审对象：`docs/issues/1-req-threat-model.md`（下称 REQ）、`docs/issues/4-test-validation.md`（TEST）、`docs/issues/5-roadmap.md`（ROADMAP），参照 `2-design-v1.md`（DESIGN）、`3-reuse-list.md`、`architecture.yaml`。评审范围：v1 MVP 是否可冻结。

### 优点

1. **威胁模型有实证锚定**（REQ L15–27）：每条威胁 T1–T4/P1–P2 均附论文编号/执法案例/源码审计 commit，威胁编号被 TEST fixture schema（`threat: T3a`）和 DESIGN checker 映射一致引用，三份文档编号体系对齐，可追溯。
2. **理论边界诚实**（REQ L29）：明确“上游是否记录不可证伪、MIA 不可行”，把项目定位收缩为“可审计证据流”，避免了不可兑现的承诺。
3. **可测试性契约前置**（TEST L7–26）：“安全能力不可验证 = 不存在” + upstream 可注入、checker 纯函数、fixture schema、evidence schema 四条契约在架构期固化，`architecture.yaml` 明确 checkers 层不得依赖 gateway/evidence，纯函数不变量有规范性落点。
4. **分期纪律清晰**（ROADMAP L7）：v1 过闸、v2 加深验证、v3 策略闭环，每期有独立验收，复用清单（REUSE）明确“不整合 ai-guard/LiteLLM 作核心”的否定理由充分。
5. **性能即安全属性的自觉**（TEST L55、DESIGN L45）：把“网关太慢会被绕过”写成回归门，方向正确。

### 问题清单

#### Critical Issues（必须修复才能批准）

1. **流式场景下 `block`/`redact` 的确切语义未定义，且 fail-closed 承诺与“零缓冲 tee”+“超预算降级异步”自相矛盾** - 位置： REQ L47（目标#3 “fail-closed 不允许放行”）；DESIGN L21（“SSE 流式 tee 零缓冲——客户端立即收字节”）、L45（“checker 超预算 → 降级为异步记录+告警，**绝不阻塞流**”）；ROADMAP L16（“block 路径 fail-closed E2E 通过”）；TEST L23（fixture `verdict: block`） - 为何阻断： 零缓冲 tee 下恶意字节（如 chunk 37 中的 U+200B）在 checker 判定前已交付客户端，已转发字节不可收回。此时 “block = fail-closed（对客户端返回错误）” 对流式响应是什么：截断流？注入终止事件？仅记 evidence？三份文档均未定义。更严重的是 DESIGN L45 写明超预算 checker“降级为异步记录+告警，绝不阻塞流”——若适用于安全类 checker（如必须同步扫描请求体的 `egress-secret-scan`），则密钥在扫描完成前已发往上游，这正是 REQ L47 明文禁止的 fail-open。需求冻结前必须消除这个核心承诺的歧义，否则 v1 验收第 3 条不可判定 - 可判定的解决标准： (a) 按传输方向分别定义 block 语义（请求侧：转发前拦截并返回错误；流式响应侧：在“已转发字节不可回收”前提下给出唯一确定的截断行为定义）；(b) 明确安全类 checker 是否允许“超预算降级为异步放行”，若允许则 REQ 目标#3 措辞必须降格，若不允许则 DESIGN L45 必须限定为观测类 checker；(c) 每种定义均有对应 fixture（`transport: stream` 的 block 样本）写入验收 - 修复建议： 在 REQ 增加“verdict 动作语义”一节，逐 transport 逐方向定义；DESIGN 的性能降级条款与 REQ 目标#3 做显式一致性修订
2. **TTFT p95 < 5ms 预算与 `egress-secret-scan` 全量请求体扫描之间存在未量化的结构性冲突，且测量口径未定义** - 位置： DESIGN L45 / TEST L55 / ROADMAP L16（"TTFT 增量 p95 < 5ms"）；DESIGN L25（egress-secret-scan 复用 gitleaks 规则集，作用于出站请求）；REUSE L17（gitleaks 规则文件复用） - 为何阻断： 请求侧密钥扫描必须同步完成于转发前（扫描晚了秘密已出境），因此**必然**位于 TTFT 关键路径；agent 请求体（上下文/代码）常达数百 KB，gitleaks 规则集上百条正则的扫描耗时与体量正相关。而“TTFT **增量**”未定义基线（相对直连 upstream？相对无 checker 的网关？包含 upstream 网络时延吗？）、未定义测试请求体大小分布、未给出扫描吞吐要求。两条 v1 验收（性能门 + 密钥扫描）目前无法同时客观判定，且按 DESIGN L45 的降级逻辑会滑向 Critical #1 的 fail-open - 可判定的解决标准： 写明“增量”的测量口径（建议：同一 evil/mock upstream 下，网关开启 vs 旁路的客户端可观测 TTFT 差值，p95 样本量与请求体包络明确，如含 ≥X KB 典型 agent 载荷）；或将预算拆分为请求侧扫描预算与响应侧 tee 预算两条独立门 - 修复建议： 在 TEST #5 与 ROADMAP v1 验收中补测量口径与载荷包络两行；声明 egress-secret-scan 为“强制同步、不可异步降级”类 checker
3. **v1 第一验收条“OpenCode 全部 provider 流量过闸（doctor 可证明）”不可证明——doctor 是配置级检查，证明不了流量级命题，而流量级检测手段（审计缺口）排在 v3** - 位置： ROADMAP L16；DESIGN L47/L52（doctor = 配置漂移检测；“审计缺口检测”列入防绕过）；ROADMAP L31/L34（审计缺口检测与验收在 **v3**）；TEST L57（审计缺口检测测试） - 为何阻断： doctor 能证明“已配置的 provider 条目 baseURL 指向网关”，不能证明“全部流量过闸”——“全部”的枚举口径未定义（models.dev 动态目录 provider、子代理使用的 provider、自定义 fetch/插件流量、遥测是否算？），且没有任何 v1 手段能观测“未过闸的流量”（观测到未过闸流量正是 v3 的审计缺口检测）。用一个 v3 才具备的证明能力去背书 v1 的首要验收，属不可判定条目 - 可判定的解决标准： 二选一并写入文档：(a) 把验收降格为可判定命题——“doctor 对 OpenCode 配置中**枚举定义的** provider 全集（枚举来源写明：配置文件 + 模型目录快照）逐条断言 baseURL 指向网关，且经每条路径发出探测请求时网关 evidence 可观测到该请求”；或 (b) 承认 v1 只做配置级证明，把“流量级 100% 过闸”显式标注为 v3 验收 - 修复建议： 修订 ROADMAP L16 与 DESIGN L52 措辞，补枚举口径定义；TEST 补对应 doctor 断言字段
4. **v1 交付物 evidence store 没有任何验收标准，哈希链的安全属性未定义且 v1 无验证者——REQ 目标#4“可审计”在 v1 不可演示** - 位置： REQ L48（目标#4）；DESIGN L28（evidence store = append-only JSONL + SHA-256 链）；ROADMAP L12（v1 交付）与 L16（v1 验收四条中无 evidence 任何条目）；ROADMAP L33（evidence 消费方 Gate LS 在 v3）；TEST 全文（五件套无哈希链完整性测试） - 为何阻断： SHA-256 链提供的是**篡改可检测**而非**防篡改**：本机沦陷进程可整链重写，REQ 非目标（L56）只排除了“agent 自改配置绕过网关”，未声明“不抵抗本机沦陷者重写 evidence 链”。同时 v1 CLI（start/stop/status/doctor）没有任何命令能校验链完整性，evidence 的唯一消费方在 v3——即 v1 写出的证据链在 v1 内不可验证、不可消费，而 v1 验收对它零断言。headline 目标之一“全量审计留痕”成了不可测试的交付 - 可判定的解决标准： (a) v1 验收增加 evidence 条目：JSONL 结构断言（对齐 TEST 契约#4）、篡改单条记录→链校验必报的测试、append-only 行为测试（重启/崩溃后无覆盖写）；(b) REQ 非目标补一行“不防本机沦陷者重写证据链（链 = 事后篡改可检测）”；(c) 明确 v1 内链校验的提供方式（CLI 子命令或 doctor 项）或显式声明推迟到 v3 及其后果 - 修复建议： REQ/DESIGN 补属性声明，ROADMAP v1 验收补第 5 条 evidence 断言

#### Major Concerns（必须处理）

1. **verdict 与 action 的术语契约在两份规范文档中冲突，`redact` 语义悬空** - 位置： TEST L12/L23（checker 直接输出、fixture 期望 `verdict: block`，取值 allow/warn/redact/block）；architecture.yaml L24（“策略引擎：verdict → action”）与 DESIGN L27（“每 checker 可配动作”）；ROADMAP L30（per-checker 动作映射是 **v3**） - 为何阻断： TEST 的 fixture schema 是 CI 合并门（TEST L47），它期望的 `verdict` 到底是 checker 原生输出还是经策略引擎的最终动作？若是最终动作，则 v3 才有的 per-checker 动作配置被前置进了 v1 契约；若 checker 原生 verdict 就有 redact 取值，纯函数 checker（architecture.yaml L19 “不做策略决策”）返回 `redact` 意味着什么（改写哪些字节、谁执行改写、流式响应上如何改写）完全未定义。v1 验收“fixture 全绿”因此不可判定 - 可判定的解决标准： 术语表一句话定案：checker 输出 verdict 枚举（含其语义），policy 确定性映射到 action，fixture `expected` 字段指明断言的是哪一层；`redact` 给出可执行定义或 v1 从枚举中移除
2. **v1 残余风险暴露面未成文记录——v1 对 T1a/T2a/T2b/T2d/T3b/T4x/P1/P2 全部不设防，包括项目立项理由中最重的 RCE 级威胁 T2a** - 位置： REQ L21（T2a，9/428，远程代码执行）；DESIGN L26（tool-call-shape 属 v2）；REQ L52（“靠最小暴露+金丝雀缓解”，金丝雀在 v2，ROADMAP L21）；TEST L32（威胁样本库列了 T2a/T2b/T4a 但 v1 无对应 checker） - 为何阻断： 文档 nowhere 显式声明“v1 期间这些威胁原样穿透网关”。这造成双重问题：验收者无法核对“v1 声称防护的暴露面”是否与交付一致；用户在 v1 得到的实际是“模型字段一致性 + 隐形字符 + 凭据模式”三项告警能力，与 README 宣传的“系统性威胁防护”落差需被明确承认。金丝雀缺席时“防数据外泄”主张在 v1 仅剩凭据正则，T1a（prompt/上下文转售）零缓解——这一残余风险必须落纸 - 可判定的解决标准： 增加“v1 残余风险声明”章节：逐威胁编号列出 v1 状态（覆盖/部分/不覆盖+缓解手段+计划期数），作为冻结件一部分
3. **TEST 五件套与 ROADMAP 分期错位，v1 验收引用了 v2/v3 组件** - 位置： TEST L49–51（#4 E2E 以 evil-relay 为载体、#5 含金丝雀专项与审计缺口测试）；ROADMAP L24（evil-relay 模拟器是 v2）、L21（金丝雀 v2）、L31（审计缺口 v3）；ROADMAP L16（v1 验收含 “E2E 通过”）、TEST L63（CI 结构把 E2E/性能基准画进统一管线） - 为何阻断： v1 要跑的 E2E 用什么上游？TEST 契约#1 的 mock upstream 可以顶替 evil-relay 的部分职能，但文档未做此标注，导致 v1 验收第 3 条的字面依据指向一个 v2 交付物；同理 TEST #5 的四项回归中两项属 v2/v3，未标注哪些是 v1 每次 PR 必跑 - 可判定的解决标准： 五件套逐项标注所属分期与 v1 替代物（#4 → v1 用 mock upstream 跑 OpenCode/Delphi 全链路，evil-relay v2 升级替换；#5 → v1 仅 TTFT + 配置漂移两项）
4. **检出率/误报率无量化门槛，“可用”不可判定** - 位置： TEST L45–47（“统计每威胁类型检出率”“误报率：基线/白名单机制调优”，无任何阈值）；ROADMAP L16（“正负 fixture 全绿”仅指逐条期望匹配） - 为何阻断： fixture 全绿只能证明“样本库内可检出”，不构成对真实流量的检出/误报承诺；TEST L37 特别强调自录 benign 语料考核“误报率”，但没有门槛数字（多少 benign、FP ≤ ?%），CI 无从判红绿。安全产品的验收缺了 FP 门会导致“堵报即安全”的退化方向 - 可判定的解决标准： 写明 benign 语料最低规模与来源、误报率门（如 0 硬性 / 容许白名单豁免清单上限）、正样本检出率门（fixture 集内 100%）
5. **Delphi 接入是 v1 交付物但无任何验收条目** - 位置： ROADMAP L14（交付 “Delphi（.delphi-config endpoint 覆写）”）与 L16（验收仅提 OpenCode）；TEST L51（E2E 含 Delphi，但依赖 Major #3 所述 v2 evil-relay） - 为何阻断： v1 范围声明（本次评审对象）明确含 Delphi 接入，但“过闸验收、E2E、doctor 漂移检测”均未覆盖 Delphi 路径，交付无法判定完成 - 可判定的解决标准： v1 验收补 Delphi 条目：endpoint 覆写后流量过闸可观测 + doctor 对 .delphi-config 漂移的断言样本
6. **evidence schema 本体未定义，而它被声明为对外唯一消费接口** - 位置： TEST L26（契约#4 只说“结构化、断言可编程”）；DESIGN L28（仅列内容类别，且含 v1 尚不存在的 canary 状态字段）；ROADMAP L38（“消费接口 = evidence schema，见 TEST 契约#4”） - 为何阻断： XP-Gate/门禁集成被明文押在 evidence schema 上，但 schema 字段清单、必选/可选、版本化/演进策略（checker 增删时 schema 如何兼容）在全部文档中不存在；CI “直接查 JSONL 字段”无字段可查 - 可判定的解决标准： v1 冻结件附 schema v1 字段表（含 request/response 元数据、per-checker verdict、时间戳、链哈希字段），并声明字段增删的兼容规则

#### Minor Concerns（需要说明）

1. **v1 doctor 的 “CA 信任” 自检是空转项** - 位置： README CLI 节与 DESIGN L29（doctor 含 CA 信任检查）；ROADMAP L31（TLS 拦截模式属 v3） - 为何阻断（轻微）： v1 两条接入路径（OpenCode/Delphi）均为 baseURL 覆写，无 CA 依赖；v1 doctor 里的 CA 检查无对象 - 可判定的解决标准： 标注 CA 检查为 v3 生效项，v1 doctor 输出中显式 skip
2. **REQ L46 “先覆盖已知威胁类型” 措辞过强** - 位置： REQ 目标#2 - 为何阻断（轻微）： v1 实际覆盖 3/12+ 威胁编号，该句易被读作“已知威胁都覆盖” - 可判定的解决标准： 改为“优先覆盖 checker 注册表声明的已知威胁子集，见 ROADMAP 分期”
3. **“单一脱敏咽喉点”与 `redact` 动作两套“脱敏”机制关系未澄清** - 位置： ROADMAP L11/DESIGN L21（咽喉点：日志 sink 前脱敏）vs TEST L23/DESIGN L27（redact：响应动作） - 可判定的解决标准： 一句话区分两者作用对象（审计落盘脱敏 vs 转发流改写），避免实现期混用
4. **benign 负样本语料的交付时点未定** - 位置： TEST L37（“自录真实 agent 会话（脱敏后）”作为误报考核语料） - 可判定的解决标准： 标注该语料是否 v1 交付；若 v1 无 benign 语料，Major #4 的 FP 门则无从谈起，需联动声明

### 结论

需求的问题不在方向而在**可判定性**：四条 Critical 全部属于“写了验收但按现文无法客观判定/自相矛盾”——流式 block 语义（C1）、性能与扫描预算口径（C2）、“全部过闸”的可证明性（C3）、evidence 零验收（C4）。这些都是定义层面的修复，不需要重设计，但在修复前冻结会把矛盾传导进 R2 设计与 CI 契约（fixture schema 已被定为合并门）。裁定 REQUEST_CHANGES。

```json
{
  "expert_id": "B",
  "round": 1,
  "mode": "design",
  "verdict": "REQUEST_CHANGES",
  "confidence": 9,
  "critical_issues": [
    "C1 流式场景 block/redact 语义未定义：零缓冲 tee（DESIGN L21）下已转发字节不可回收，'block=fail-closed 返回错误'（DESIGN L27）对流式响应无定义；且 DESIGN L45 'checker 超预算降级为异步记录+告警，绝不阻塞流' 对安全类 checker（egress-secret-scan）等价 fail-open，直接违反 REQ 目标#3；v1 验收 'block 路径 fail-closed E2E 通过' 不可判定",
    "C2 TTFT 增量 p95<5ms 与 egress-secret-scan 全量请求体 gitleaks 扫描结构性冲突：请求侧扫描必须同步在转发前（必然在 TTFT 关键路径），但'增量'基线、测试请求体大小包络、扫描吞吐要求均未定义，两条 v1 验收无法同时客观判定",
    "C3 v1 首要验收 'OpenCode 全部 provider 流量过闸（doctor 可证明）' 不可证明：doctor 是配置级检查，'全部'枚举口径未定义，流量级观测能力（审计缺口检测）属 v3（ROADMAP L31/L34），用 v3 能力背书 v1 验收属循环依赖",
    "C4 v1 交付物 evidence store 零验收标准：SHA-256 链的属性未声明（篡改可检测而非防篡改，本机沦陷者可整链重写且不在 REQ 非目标内），v1 CLI 无链校验命令、消费方在 v3，REQ 目标#4 '全量审计留痕' 在 v1 不可演示不可测试"
  ],
  "major_concerns": [
    "M1 verdict/action 术语冲突：TEST fixture schema 让 checker 输出 allow/warn/redact/block（L12/L23），architecture.yaml L24 与 DESIGN L27 规定 policy 引擎做 verdict→action 映射且 per-checker 动作属 v3（ROADMAP L30）；redact 动作（改写哪些字节、流式如何执行）语义悬空，fixture 全绿不可判定",
    "M2 v1 残余风险暴露面未成文：T1a/T2a/T2b/T2d/T3b/T4x/P1/P2 在 v1 全部不设防（含 RCE 级 T2a），金丝雀 v2 缺席时'防数据外泄'仅剩凭据正则，T1a 零缓解；缺逐威胁 v1 状态声明章节",
    "M3 TEST 五件套与 ROADMAP 分期错位：#4 E2E 载体 evil-relay 是 v2 交付物（ROADMAP L24），#5 金丝雀 v2/审计缺口 v3，但 v1 验收引用 E2E 与性能回归；未标注五件套的 v1 子集与替代物（mock upstream）",
    "M4 检出率/误报率无量化门槛（TEST L45-47 只'统计'无阈值），benign 语料规模与来源未定，CI 无从判红绿，安全验收缺 FP 门",
    "M5 Delphi 接入为 v1 交付物但无任何验收条目（ROADMAP L16 验收仅覆盖 OpenCode；E2E 中的 Delphi 依赖 v2 evil-relay）",
    "M6 evidence schema 本体未定义（字段清单/必选项/版本化策略），但被 ROADMAP L38 声明为 XP-Gate 唯一消费接口；DESIGN L28 列出 v1 尚不存在的 canary 字段"
  ],
  "minor_concerns": [
    "m1 v1 doctor 的 'CA 信任' 自检空转：v1 仅 baseURL 覆写两路接入，TLS 拦截模式属 v3，应标注 v1 skip",
    "m2 REQ L46 '先覆盖已知威胁类型' 措辞过强，v1 实际覆盖 3 个威胁编号，易误读",
    "m3 '单一脱敏咽喉点'（日志 sink 脱敏）与 redact 动作（转发流改写）两套机制关系未澄清",
    "m4 benign 负样本语料（自录脱敏会话）的交付时点未标注，影响 M4 FP 门的可执行性"
  ]
}
```
