## 独立评审 - Expert C（可行性视角）

### 优点
1. **威胁模型有实证锚点**（`1-req-threat-model.md` §背景/威胁表）：T1–T4/P1–P2 每条都挂论文/取证事件，且 §理论边界 明确写出"不承诺检测训练使用、无法证伪上游记录"——需求文档少见的诚实。
2. **可测试性契约前置固化**（`4-test-validation.md` §可测试性契约）：upstream 注入、checker 纯函数、声明式 fixture schema、evidence 可编程断言——四条都是架构期锁死而非事后补，且 `architecture.yaml` 用 import 边界测试把"checker 纯函数"变成机器可执行契约，一致性良好。
3. **分期原则清晰且有硬门槛意识**（`5-roadmap.md` §总原则）："v1 先保证流量 100% 过闸（哪怕验证逻辑最简）"是正确的 MVP 取舍；每期验收写成可勾选清单。
4. **复用清单给出整合方式与不整合理由**（`3-reuse-list.md`）：gitleaks 规则复用、fpverify 对手直接作测试床、明确拒绝 LiteLLM 作核心层并给出 fail-open 理由——降低 v1 实现风险。

### 问题清单

#### Critical Issues（必须修复才能批准）

1. **流式场景下 `block` / `redact` 语义未定义，与"SSE tee 零缓冲"物理冲突** — 位置: `2-design-v1.md` §组件1+§策略引擎+§关键决策；`4-test-validation.md` fixture #3（示例即 `transport: stream` + `verdict: block`）；`5-roadmap.md` v1 验收"block 路径 fail-closed E2E" — 为何阻断: 零缓冲意味着违规字节在 checker 判定前已送达客户端，字节不可收回。需求没有定义：(a) 流中途检出违规时是断开连接、还是仅记 evidence？(b) 断开后客户端已收到的半截恶意 tool-call 是否仍会被 agent 执行——若是，v1 对 T2c/T2a 类流式攻击的"可阻断"主张为假；(c) `redact` 在流上根本无法执行（已转发），但 verdict/action 枚举照样列出它，且 v1 三个 checker 无一能施加 redact。TEST 契约 #3 的 fixture schema 会把这个歧义固化成测试断言标准。 — 可判定的解决标准: REQ/DESIGN 中出现一段规范文本，按 `transport ∈ {stream, non-stream} × action ∈ {allow,warn,redact,block}` 8 格矩阵逐格定义网关对客户端的确切行为（含 HTTP 状态/断连时机/evidence 字段）；fixture schema 增加"流式 block 的可观测预期结果"字段；存在对应 E2E 测试。 — 修复建议: 明确 v1 流式 block = "检测到即终止响应流 + 返回错误事件 + evidence 标记 partial_response"，并在 REQ §目标3 加限定语"阻断粒度=响应级，流式已开始字节不承诺撤回"。

2. **"egress-secret-scan 出站扫完整请求体"与 TTFT p95 < 5ms 共用同一预算但测量口径未划清；超时降级条款直接击穿 fail-closed** — 位置: `5-roadmap.md` v1 验收行（TTFT < 5ms 与 3 checker 同列）；`2-design-v1.md` §关键决策"checker 超预算 → 降级为异步记录+告警，绝不阻塞流"；§组件1"反向代理模式 + TLS 拦截双形态" — 为何阻断: 出站扫描必须在请求发往 upstream **之前**完成（否则泄密已发生），这是对**请求**的同步门禁；而 DESIGN 的降级条款写的是"绝不阻塞**流**"——读者无法判断 egress-secret-scan 超时到底放行（fail-open，违背 REQ §目标3"安全检查失败不允许放行"）还是阻断。同时全文档无一个非流式指标：大上下文 agent 请求体（数十至数百 KB）过 gitleaks 规则集的往返延迟、吞吐开销均未量化，5ms 只覆盖流式首字节，出站扫描预算是空白。若 gate 还叠加 TLS MITM 形态，CPU 加解密成本同样无预算。 — 可判定的解决标准: 需求中新增两条独立可测预算：(a) 非流式请求端到端增量（p95，按请求体大小分档，如 ≤64KB / ≤512KB）；(b) egress-secret-scan 单请求超时上限及超时后的确定性行为（建议 deny）；性能回归脚本输出这两项数字并在 CI 阻断。 — 修复建议: 把"绝不阻塞流"改写为仅约束**入站响应流**的异步 checker；出站请求检查单独定义"超时=阻断"。

3. **v1 验收依赖 v2 才交付的 evil-relay 模拟器，分期矛盾** — 位置: `5-roadmap.md` v1 验收（"3 个 checker 正负 fixture 全绿；block 路径 fail-closed E2E 通过"）vs v2 条目（"evil-relay 模拟器 + 双矩阵 CI 全量落地"）；`4-test-validation.md` §4（E2E 演练定义为"OpenCode + Delphi **穿 evil-relay** 全链路"）、§可测试性契约 #1（恶意响应需 mock upstream） — 为何阻断: TEST issue 把五件套整体作为验证方案，其中检出矩阵/E2E 的上游就是 evil-relay；按 ROADMAP 它在 v2 才"全量落地"。那么 v1 的"fixture 全绿"和"fail-closed E2E"用什么喂恶意响应、在哪个环境跑，两份文档给出互斥答案。这是冻结后会直接导致 v1 验收无法执行的歧义。 — 可判定的解决标准: ROADMAP v1 条目显式列入 v1 所需的最小 mock upstream（或 evil-relay 子集），并把 v1 验收措辞改为指向该子集；或 TEST issue §4 标注"E2E 演练属 v2"。 — 修复建议: 将 fpverify 9 对手的 Python 运行时引入 Bun/Node 主导的本机 daemon 测试栈还有跨语言集成成本（见 Major #7），更应提前摊开说明。

4. **"doctor 可证明 OpenCode 全部 provider 流量过闸"不可证** — 位置: `5-roadmap.md` v1 验收第一条；`2-design-v1.md` §验收标准第一条；§防绕过（best-effort、审计缺口检测列在 v3"强化"） — 为何阻断: "全部"要求穷举 OpenCode 的流量出口（provider options、MODELS_URL、subagent/skill 独立配置、插件直连 fetch、非 OpenAI 兼容 SDK 等），doctor 只能做正向探测（已知 provider 配置是否指向网关），无法证明不存在旁路；且 OpenCode 版本升级随时新增旁路。REQ §目标1 用的是"通过各客户端的标准重定点接入"（尽力而为语义），验收却写成"可证明全部"，二者强度不一致。把不可证伪的命题写进硬验收 = 冻结一份永远"差一点达标"的标准。 — 可判定的解决标准: 验收改写为封闭枚举形式："doctor 遍历 `adapters/opencode` 配置文件中声明的 provider 白名单 ⊆ 网关近 N 分钟观测到的 host:port 集合，且对每个已配置 provider 至少回放 1 条测试请求并在 evidence 中命中"；白名单文件本身成为受版本控制的契约。 — 修复建议: 同时在 REQ 中承认 best-effort 覆盖边界（哪些旁路 v1 明知不覆盖）。

5. **威胁暴露面未在 v1 登记：T2a/T2b/T2d/T4x/P1/P2 全程无缓解，T1a 仅剩哈希链** — 位置: `1-req-threat-model.md` 威胁表 vs `5-roadmap.md` v1 条目（仅 T3a/T2c/T1b 三个 checker）；`2-design-v1.md` §组件2（T2a 的 tool-call-shape 排 v2） — 为何阻断: v1 期间 RCE 级威胁（T2a，UCSB 实证 9/428）、响应注入（T2b）、条件投递（T2d）、usage 造假（T4a-d）、目录投毒/配置劫持（P1/P2）均无任何检测；金丝雀（T1a 唯一阳性检测手段）排 v2。三份文档没有任何一处**显式承认并记录**"v1 部署即处于上述未缓解暴露面"及其残余风险声明。安全项目的需求文档缺 risk register，等于让用户误以为装上网关即被保护。 — 可判定的解决标准: REQ 或 ROADMAP 新增一张表：威胁编号 × v1 缓解状态（已缓解/部分/未缓解）× 未缓解理由 × 计划期次，作为 v1 冻结的一部分。 — 修复建议: 顺带说明 evidence store 能否对 T4x/P1 提供最小可用观测（如 usage 字段落盘供人工对账），把"完全未缓解"降为"可取证不可阻断"。

#### Major Concerns（必须处理）

1. **evidence 哈希链防不住本机篡改，append-only 在本机不可强制** — 位置: `1-req-threat-model.md` §目标4"全量审计留痕…事后取证"；`2-design-v1.md` §组件4；`5-roadmap.md` v1 条目 — 问题: 攻击者 P2（配置劫持）与"沦陷 agent"本身就运行在同一用户账户下：可删除整个日志文件重置链、可在写入前 hook 进程、Windows 上文件句柄打开期间 append-only 属性基本无效。哈希链只防"编辑中间记录"，不防整链替换。需求把"取证"能力建立在 v1 无外部锚定（无远程Witness/签名时间戳，那些都没排期）的链上。 — 可判定的解决标准: REQ 明确 evidence 完整性威胁模型到"本机同权限攻击者可抹除全部证据，链仅保证未抹除部分的内部一致性"，或将"导出到第三方锚定"提进某个具体期次。

2. **v1"防数据外泄"主张实际只剩 egress-secret-scan 单腿，且其检出率无量化门槛** — 位置: `1-req-threat-model.md` §目标、§非目标（金丝雀被写为缓解手段但排在 v2）；`4-test-validation.md` §3"基线/白名单机制调优"（无数值） — 问题: T1a（记录/转售）v1 完全无检测手段；T1b 仅靠静态密钥模式，agent 上下文中非模式化秘密（自写 token、内网 URL、客户数据）一律漏过。双矩阵只写"统计检出率/误报率"，没有最低通过线，CI"回退阻断合并"无从判定回退基线是什么。 — 可判定的解决标准: 每个 v1 checker 给出正样本检出率下限与 benign 误报率上限的具体数值并进 CI 门禁。

3. **verdict 与 action 两层概念混用，fixture 契约二义** — 位置: `4-test-validation.md` 契约#2（checker 输出"verdict"取值 allow/warn/redact/block）与契约#3（expected.verdict 同枚举）vs `2-design-v1.md` §组件3（策略引擎将每 checker 的 verdict **映射**为 action）— 问题: 若 action 可按 checker 配置，则同一 checker 输出 `block` verdict 在不同策略下产生不同动作；fixture 的 expected 到底断言纯函数输出还是最终动作？TEST 契约声称"checker = 纯函数、可独立单测"，但 fixture 又绑定 `checker: model-field-consistency` + transport，语义上是集成层断言。冻结前必须统一术语（建议：checker 输出 finding/severity，policy 产出 action，fixture 分别有两层断言字段）。

4. **`invisible-unicode-scan` 的跨 chunk 检测前提未写入需求** — 位置: `2-design-v1.md` §组件2（"流式 chunk 扫 U+200B/U+FEFF"）— 问题: UTF-8 多字节码点可被 SSE chunk 边界切开（U+200B = E2 80 8B），逐 chunk 独立扫描会系统性漏检；同理隐形字符可跨 chunk 拆分排列。需求要么规定"解码后字节流连续扫描"这一正确性前提，要么 fixture 必须包含 split-across-chunk 对抗样本作为检出标准。

5. **`model-field-consistency` 的对照基线缺失，检出率上限被高估** — 位置: `2-design-v1.md` §组件2；`1-req-threat-model.md` §背景（"model_mapping 静默替换且响应 model 字段无回写校验"——即恶意站恰恰会伪造一致的 model 字段）— 问题: 该 checker 只能抓"忘改字段"的低级对手；swap/pin/filter 类对手（fpverify 已有现成样本）返回一致字段即可绕过。需求把它列为 T3a 的 v1 缓解，属于"声称能做到但实际做不到"。指纹真检测在 v2。 — 可判定的解决标准: 在威胁登记表中写明该 checker 的检测能力边界（仅字段一致性，非模型真实性）。

6. **SSE 分片下的内容型扫描正确性前提未定义** — 位置: `2-design-v1.md` §组件2（隐形字符扫描作用于流）— 问题: JSON 字符串值内的 U+200B 在 SSE 传输中可能被转义为 `\u200b` 字面量或被 chunk 切开，需求未规定 checker 收到的是原始字节、解码后的事件 data、还是解析后的 JSON 字段——这决定三种内容型检查的正确性与 fixture 的可复现性，属于可测试性契约层面的缺口。

7. **复用组件的运行时/许可证成本未评估** — 位置: `3-reuse-list.md`（fpverify `sim/adversaries.py` 作测试床 = 向以 Bun/Node 为主的工程引入 Python 测试运行时；gitleaks 规则集许可需核对——Go 工具生态常见 AGPL/BUSL 与文中"MIT"断言不符，规则文件版权边界要逐条确认）；`5-roadmap.md` v1 验收"TTFT p95 < 5ms"无测量方法学（基准环境、噪声容差、CI 共享 runner 抖动、回退阈值多少算回退）。 — 可判定的解决标准: REUSE 清单每项补"许可核实结论 + 运行时依赖"列；ROADMAP 补性能测量协议（固定机型/预热/重复次数/判定公式）。

#### Minor Concerns（需要说明）

1. **README 架构图把 TLS 拦截画进 v1 主路径**（README §架构；`2-design-v1.md` §组件1"双形态"）vs `5-roadmap.md` 把"TLS 拦截模式"明确排 v3 — 应标注反代核 v1 仅 baseURL 形态，避免设计文档与路线图互相拉扯。
2. **CLI 表面三处不一致**：README CLI 列表（start/stop/status/doctor）、DESIGN §组件5（含 report/canary rotate）、ROADMAP v1（仅 4 个）——v1 冻结时应声明哪些命令 stub、哪些不存在。
3. **TEST §5 把 canary 专项、审计缺口检测写进通用验证清单**，但两者分别是 v2/v3 交付物，未标期次——CI 范围歧义。
4. **benign 语料"真实 agent 会话脱敏"**（TEST §1）：脱敏流程与 evidence 保留原文的关系未定义，与 §目标4"全量审计留痕"存在张力（全量留存本身构成 T1b 的本地聚集风险）。
5. **evidence schema 字段仅在 DESIGN §组件4 散列举**（元数据/verdicts/canary 状态/usage/时延），无字段名/类型/必填性定义；TEST 契约#4 与 ROADMAP §消费方关系都把 Gate LS 消费接口等同于该 schema，schema 不进冻结基线则下游集成无契约可依。
6. **OpenCode 接入细节归属不明**：`OPENCODE_MODELS_URL` 锁定与 `experimental.policies`（DESIGN §接入表/§防绕过）是网关负责的适配器行为还是用户手工配置步骤，v1 验收不覆盖它就无法判定。
7. **单二进制分发（DESIGN §关键决策）与 Bun compile 的 Node ≥ 18 兼容性表述混用**——README 开发环境一节已部分澄清，但需求侧"兼容 Node ≥ 18"含义（测试运行环境 vs 支持用户自带 runtime）仍含糊。

```json
{
  "expert_id": "C",
  "round": 1,
  "mode": "design",
  "verdict": "REQUEST_CHANGES",
  "confidence": 8,
  "critical_issues": [
    "流式场景下 block/redact 语义未定义：SSE tee 零缓冲与 fail-closed 阻断并存时已转发字节不可收回，TEST fixture schema（transport:stream + verdict:block）将歧义固化为验收标准",
    "出站完整请求体过 gitleaks 与 TTFT p95<5ms 共用预算但无独立测量口径；'checker 超预算→异步降级绝不阻塞'条款使 egress-secret-scan 超时行为 fail-open，与 REQ 目标3 fail-closed 直接矛盾",
    "v1 验收（fixture 全绿/fail-closed E2E）依赖 evil-relay 模拟器与五件套，但 ROADMAP 将其排入 v2；TEST §4 E2E 定义即以 evil-relay 为上游——分期自相矛盾，v1 验收当前不可执行",
    "'doctor 可证明 OpenCode 全部 provider 流量过闸'为不可证伪的全称命题：'全部'无封闭枚举来源，旁路无法穷举，硬验收标准不可客观判定",
    "T2a/T2b/T2d/T4a-d/P1/P2 在 v1 全程零缓解、T1a 因金丝雀排 v2 而无检测，三份文档均未显式登记 v1 残余暴露面，用户会误判已获保护"
  ],
  "major_concerns": [
    "evidence 哈希链不能防本机同权限攻击者整链删除/重置，'事后取证'主张在 v1 无外部锚定条件下被夸大",
    "v1 防外泄主张仅靠 egress-secret-scan 单腿，非模式化秘密漏检；双矩阵无检出率/误报率数值门槛，CI 门禁不可判定",
    "verdict（checker 输出）与 action（策略映射）两层概念在 TEST 契约#2/#3 与 DESIGN 策略引擎间混用，fixture expected 断言对象二义",
    "invisible-unicode-scan 未规定跨 chunk/UTF-8 码点切分的检测前提，逐 chunk 扫描会系统性漏检",
    "model-field-consistency 仅校验字段一致性，恶意站回写一致 model 字段即绕过（背景章节自己指出该实证），T3a 覆盖面被高估",
    "SSE 分片下内容型扫描的输入定义（原始字节/事件 data/解析后 JSON）缺失，影响三个 checker 正确性与 fixture 可复现性",
    "fpverify 测试床引入 Python 运行时、gitleaks 规则许可' MIT'断言未核实、TTFT 基准无测量协议与回退判定公式"
  ],
  "minor_concerns": [
    "README 架构图含 TLS 拦截路径，与 ROADMAP 将其排 v3 冲突",
    "CLI 命令集合在 README/DESIGN/ROADMAP 三处不一致（report/canary rotate 归属期次不明）",
    "TEST §5 金丝雀专项与审计缺口检测未标 v2/v3 期次，CI 范围歧义",
    "benign 语料脱敏流程与 evidence 全量留存之间的隐私张力未说明",
    "evidence schema 字段/类型/必填性未定义即作为 Gate LS 消费契约引用",
    "OPENCODE_MODELS_URL 与 experimental.policies 的配置责任方（网关 vs 用户手册）未指定",
    "单二进制分发与'兼容 Node ≥ 18'的表述混用，runtime 支持承诺含糊"
  ]
}
```
