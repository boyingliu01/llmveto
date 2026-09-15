# [REQ] 原始需求与威胁模型 — 为什么需要 llmveto

> 来源: https://github.com/boyingliu01/llmveto/issues/1

## 背景

Agentic Coding 场景下，第三方 LLM API 中转站（relay/reseller）对 agent 构成系统性安全威胁，2025-2026 年已有大规模实证：

- **UCSB《Your Agent Is Mine》**（arXiv:2604.08407）：实测 428 个中转站——9 个向 tool-call 注入恶意代码、17 个触碰蜜罐凭据、1 个盗走加密货币；存在条件投递（第 50 次请求才触发、仅对 YOLO 自动执行模式+Rust/Go 项目触发）
- **CISPA《Real Money, Fake Models》**（arXiv:2603.01919）：24 个端点 45.83% 模型指纹不过关（收旗舰模型的钱跑低档模型），187 篇学术论文因此结论失真
- **执法**：上海刑拘首案（非法经营罪）、中央网信办"清朗"查处 4Stoken、NSA/CISA/FBI AA26-251A 联合公告点名 "transfer stations"
- **CacheTracer**（arXiv:2608.20732）：实测 7 层转售链共享 prefix-cache，任一上游可读取 prompt
- **源码审计**（one-api @8df4a267 / new-api @bdef1175）：中转站天然逐 chunk 解析全部流量；`model_mapping` 静默替换模型且响应 model 字段无回写校验；恶意 fork 造投毒中转的边际成本≈0

## 威胁模型

| 编号 | 威胁 | 实证 |
|---|---|---|
| T1a | prompt/代码/上下文被记录、转售 | 17/428 触碰蜜罐凭据 |
| T1b | 凭据窃取（API key/.env/OAuth） | agent 工具读到的密钥会进入上下文 |
| T2a | tool-call 篡改/恶意代码注入 | 9/428，可远程代码执行 |
| T2b | 响应夹带 prompt 注入 | UCSB 响应侧筛查可检出 89% |
| T2c | 隐形字符追踪水印（U+200B/trace UUID） | hub.linux.do 中转站取证事件 |
| T2d | 条件投递（潜伏触发） | 第 50 次请求才触发 |
| T3a/b/c | 模型偷换/量化降级/路由波动 | 45.83% 指纹不过关 |
| T4a/b/c/d | usage 虚报/假缓存/隐藏系统提示/倍率操纵 | 站长自曝"保障 SLA 的全是注水大户" |
| P1/P2 | 模型目录投毒/配置劫持绕过 | one-api 架构证明可行 |

**理论边界（明确不承诺）**：检测"数据是否被用于训练"统计上不可行（MIA 接近随机）；"上游是否记录"无法证伪，只能靠金丝雀回流做阳性检测。本项目定位是**把每次交互变成可审计、可统计验证的证据流**，等待上游 provider-signed envelope 治本方案。

> **v1 边界细化**：金丝雀引擎排 v2，因此 **v1 对 T1a 无任何检测能力**（详见 §v1 残余风险登记表）。本文"验证所需三件单件"中的金丝雀在 v1 **不在流量路径上**，不得据本节推断 v1 已具备外泄检测。

## 为什么是本项目（市场空白）

GitHub 同类项目两极分化（2026-09 调研，详见 [REUSE] issue）：

- **观测型本地代理**（cctrace/argus/claude-tap/ai-guard 等 7 个）：看得见流量但**不验证、不阻断**；ai-guard 用 LLM 异步审计存在信任悖论（审计流量本身可能被投毒）
- **Agent 执行防火墙**（nah/airlock/AgentShield/nixis）：拦 tool 调用但**看不见 LLM 流量**
- **模型真实性检测**（llm-fingerprint-detector/fpverify 等）：单件成熟但只是离线 CLI，不在流量路径上

**空白 = LLM 流量层的确定性验证 + fail-closed 阻断。** 验证所需三件单件（指纹检测/金丝雀/usage 对账）都有成熟实现，缺的是组装到流量路径上并强制执行。**期次归属**：v1 组装的是"字段一致性 + 隐形字符 + 出站凭据模式"三项最简检查 + 过闸 + evidence 留痕；指纹检测与金丝雀在 v2，usage 对账在 v2/v3（见 ROADMAP 与 §v1 残余风险登记表）。

## 目标

在开发者本机运行一个安全网关 daemon，使 agent 与 LLM API 之间**经由已支持接入路径重定向的**流量：

1. **受管路径全量过闸**：覆盖集合按版本声明（v1 = OpenCode + XP-Gate Delphi；v2 += Claude Code / Codex / promptfoo；v3 += HTTPS_PROXY+CA TLS 拦截以覆盖无法覆写 baseURL 的客户端）。**不使用"所有流量"这一全称承诺**：未接入客户端的流量在对应期次内属未覆盖暴露面，须在 §v1 残余风险登记表中登记。判定方法见 ROADMAP「受管配置封闭枚举」。
2. **逐请求确定性验证**：checker 注册表，可插拔扩充，先覆盖已知威胁类型；每个 checker 的检测能力边界须成文（不默认"已挂编号即已覆盖"）
3. **违规可阻断**：fail-closed 策略（区别于质量门禁的 SKIP 语义——安全检查失败或**超时**均不允许放行）。可阻断性的物理前提见下节 §裁决与动作语义：流式响应已开始转发的字节不可撤回，故 v1 的"阻断"粒度是**响应级**（未开始转发时整体拒绝）或**流终止级**（已开始转发时注入 error 事件后关闭连接）而非**字节级**。
4. **全量审计留痕**：append-only 证据链，支撑门禁集成/计费对账/事后取证。其信任边界为"防意外损坏与单条改写，**不抵抗本机同权限对手整链重写**"（见 §裁决与动作语义 · evidence 信任边界）。

## 裁决与动作语义（v1 冻结件）

> 立节理由：本项目的对抗性是"已转发字节不可收回"，若不逐格定义，"fail-closed 阻断"在流式下就是一个无可满足定义的承诺。

### 术语定案（两层，不得混用）

| 层 | 产出 | 取值 | 归属 |
|---|---|---|---|
| checker（纯函数） | `verdict` | `clean` \| `finding` \| `error`（扫描器自身失败） | `src/checkers/**`，不做策略决策 |
| 策略引擎 | `action` | `allow` \| `warn` \| `redact` \| `block` | `src/policy/**`，确定性映射 `verdict → action` |

- checker **不再**输出 `block`/`redact`（历史文档中的 `expected.verdict: block` 属术语污染，已在 TEST issue 修正为 `expected.verdict` + `expected.action` 双断言）。
- `verdict=error` 一律按 fail-closed 处理：安全类 checker 的 `error` 映射为 `block`（证据不足不产生 clean 判决，见 REUSE §llm-verify 借鉴）。
- **v1 策略映射为内置固定表**（每 checker 一行，不可由用户配置）；v3 交付的是**可配置动作 + 全局>项目级优先级**，不是"v3 才有 action"。

### v1 内置策略映射

| checker | 作用侧 | 同步性 | v1 `finding → action` |
|---|---|---|---|
| `egress-secret-scan` | 请求 | 强制同步，不可降级 | `block` |
| `model-label-consistency` | 响应（首块/完成块） | 同步预检 | `warn` + evidence（v2 起可配 block） |
| `invisible-unicode-scan` | 响应（流式/非流式） | 同步（滚动窗口，零缓冲） | 非流式 `block`；流式 `block`=终止流 |

### 行为矩阵（transport × action，网关对客户端的确切效果）

| # | 场景 | `allow` | `warn` | `redact` | `block` |
|---|---|---|---|---|---|
| 1 | 请求侧（非流式，转发前） | 原样转发 | 转发 + evidence 告警 | **v3**：改写命中字段后转发 | 不转发 upstream；返回 `502 llmveto:rejected`；evidence `action_taken=blocked_before_forward` |
| 2 | 响应侧 非流式 | 原样返回 | 返回 + evidence 告警 | **v3**：整体缓冲后改写返回 | 不返回响应体；返回 `502`；evidence `action_taken=blocked_before_deliver` |
| 3 | 响应侧 流式，命中发生在**首字节转发前** | 原样 | 原样 + evidence | **v3** | 等同场景 2（尚未有字节外泄） |
| 4 | 响应侧 流式，命中发生在**已转发 N 个 chunk 后** | 继续 | 继续 + evidence + `response_delivered.partial=true` | **v3（流式不可执行，见下）** | **终止响应流**：注入 `event: error` + `data:{"error":{"code":"llmveto:veto-mid-stream","delivered_chunks":N}}`（载荷形状以 DESIGN §组件1 为唯一权威）后关闭连接；evidence `action_taken=terminated_after_delivery` + `response_delivered:{partial:true,delivered_chunks:N}` |

**场景 4 的明文承诺（不粉饰）**：
- 已送达客户端的字节**不撤回、不可撤回**；v1 不承诺"客户端未接触到任何恶意内容"。
- v1 承诺的可验证效果是：(a) 违规内容不再继续流入 agent 的 tool-call 解析路径（流被终止，`finish_reason` 非 `stop`）；(b) evidence 中该响应被标记 `response_delivered.partial=true` + 命中偏移，供 `llmveto verify` 与人工取证。
- 若 agent 已在终止前执行了半截 tool-call，该后果属 v1 未覆盖范围（登记在 §v1 残余风险登记表 T2a 行）。
- 选择"零缓冲 + 终止流"而非"1-chunk 缓冲窗口 + 真阻断"的理由：本项目的威胁模型认定"网关变慢 → 用户绕过网关"是比"半截字节泄漏"更高概率的失效路径（性能即安全属性）。此取舍为 ADR 级决策，Round 2 复审需确认其成立。

### `redact` 的期次声明

`redact` 在流式响应上物理不可执行（需改写已转发字节），且 v1 三个 checker 无一能施加 redact。**`redact` 自 v1 交付范围移出**，声明为 v3 能力（配合策略引擎完善），仅保留在 action 枚举中作为前向兼容位。v1 的任何 fixture / 测试 / 验收均不得断言 `redact`。

### evidence 信任边界与完整性等级

| 属性 | v1 保证 | v1 **不**保证 |
|---|---|---|
| 单条记录被改写 / 中间记录被删除 | ✅ SHA-256 链可检测（`llmveto verify` 报 first_bad_seq） | — |
| 整链删除或重置（本机同权限对手） | ❌ | ✅ 不提供任何保证（无外部锚定、无签名时间戳，且均未排期） |
| 崩溃 / 并发写 | 单写者模型（daemon 内唯一追加协程）；每批追加后 `fsync` best-effort；崩溃残留只可能是**末行半行**，读取方按"末行解析失败即丢弃"处理 | 不承诺多进程并发追加安全；不承诺断电零丢失 |
| 外部锚定（远程 witness / RFC3161） | ❌ 未排期 | 若需要走新 issue 立项 |

**信任声明（须原样出现在 README 与 docs）**：evidence 链的对抗对象是"意外损坏与廉价篡改"，不是"能读写你磁盘的进程"。声称"防篡改"即为过度承诺。

## v1 残余风险登记表（冻结件）

> 立节理由：安全项目缺 risk register，等于让用户以为装上网关即被保护。本表与 ROADMAP v1 验收同级冻结。
> 状态取值：`已缓解` / `部分`（仅检测或仅取证）/ `未缓解`。"取证"= v1 把相关字段原样写入 evidence，可事后人工对账，但不做判定、不阻断。

| 威胁 | v1 状态 | v1 缓解手段 | 缺口理由 | 计划期次 | v1 取证可得性 |
|---|---|---|---|---|---|
| T1a prompt/上下文被记录转售 | **未缓解** | 无（金丝雀在 v2） | 金丝雀引擎排 v2；v1 无任何阳性检测手段 | v2 | `request_body_sha256`（仅证明发过该字节序列；默认 `metadata_only` 无原文不可读，亦无法证明"对方是否留存"） |
| T1b 凭据窃取 | 部分 | `egress-secret-scan`（**G-LIC 决议后** v1 采**自建 top-5 高置信凭据模式**：OpenAI `sk-…` / Anthropic `sk-ant-…` / GitHub `ghp_…` / AWS `AKIA…` / PEM 私钥块；阻断。gitleaks BUSL 许可不通过 → 覆盖面缩小至上述 5 类，见 `docs/licenses.md`） | 仅覆盖**模式化**5 类凭据；自写 token / 内网 URL / 客户数据 / 变形 base64-hex 一律漏检。**另：为达致阻断类 FP=0，标准认证头（`Authorization`/`x-api-key`/`api-key`/`x-goog-api-key`/`Proxy-Authorization`/`Cookie`）被排除出扫描单元（DESIGN §扫描单元定义）→ 夹带/伪装在这些头里的额外凭据或追踪水印亦成 v1 扫描盲区（header 路径与 body 路径为两个独立缺口）。自定义头仍进扫描单元，凭据藏自定义头仍会被扫** | v2（+自定义模式库 + 归一化） | 命中/放行事件落 evidence（`findings[].rule_id` + `action_taken`；命中处明文受 `body_capture` 约束） |
| T2a tool-call 篡改/恶意代码注入 | **未缓解** | 无（`tool-call-shape` 排 v2） | v1 不解析 tool-call 结构；流式已转发字节不可撤回 → 即便 v2 检出也无法阻止 agent 执行已收到的半截调用 | v2 | `response_body_sha256`（明文留存仅当 `body_capture≠metadata_only`，默认无明文，事后不可读回内容） |
| T2b 响应夹带 prompt 注入 | **未缓解** | 无 | v1 拒绝引入无 FP 门槛的文本规则（大面积误报会摧毁"告警可信"） | v2 | 同上（`response_body_sha256`，默认无明文） |
| T2c 隐形字符水印 | 部分 | `invisible-unicode-scan`（跨 chunk 滚动窗口；非流式 block / 流式终止流） | 归一化（NFKC 后同形）与自定义 PUA 编码变体不覆盖 | v2 扩展码点集 | `findings[].offsets`（命中偏移，码点为偏移处字节的派生值）；命中处样本明文受 `body_capture` 约束 |
| T2d 条件投递（潜伏触发） | **未缓解** | 无 | v1 checker 全部为单请求作用域，无跨请求状态 | v2+（会话级统计） | 按 session 聚合的请求计数在 evidence 中 |
| T3a 模型偷换 | **部分（弱）** | `model-label-consistency`：仅比对响应 `model` 字段与请求是否一致 | **只抓"忘改字段"的低级对手**；实证背景（`model_mapping` 静默替换且响应字段无回写校验）恰说明真替换会返回一致字段 → 本 checker 对定向替换无效 | v2 指纹巡检（`fingerprint-probe`） | 字段值 + 不一致事件 |
| T3b 量化降级 | 未缓解 | 无 | 需指纹/探针，不在 v1 | v2 | 无 |
| T3c 路由波动 | 未缓解 | 无 | 需跨请求观测 + provider 信任分 | v2 | 无 |
| T4a/b/c/d usage 虚报/假缓存/隐藏系统提示/倍率操纵 | 未缓解（仅取证） | 无判定逻辑 | 对账需官价基准与计费口径，属 v2 计费对账 | v2 | `usage` / `cache` 字段原样落 evidence，供人工对账 |
| P1 模型目录投毒 | 部分 | `OPENCODE_MODELS_URL` 锁本地模型目录镜像（由 `llmveto doctor --write-managed-config` 负责写入，非用户手工步骤） | 只把上游目录注入移出实时路径，不校验镜像内容真伪 | v2 | doctor 配置快照哈希（v1 仅输出至 `doctor` 结果，不入 evidence 链；@v2 计划登记字段） |
| P2 配置劫持绕过 | best-effort 部分 | 全局配置 > 项目级配置（v1 内置硬编码优先级）+ `doctor` 配置漂移检测（限定于受管配置封闭枚举） | 流量级"未过闸观测"（审计缺口检测）排 v3 → v1 **无法发现旁路** | v3 | `doctor` 结果输出至 CLI（exit code + 条目 id），v1 不写 evidence 记录 |
| P3 evidence 明文本地聚集（缓解手段自身派生面） | 部分 | `body_capture` 默认 `metadata_only`（仅哈希，明文不落盘）+ 单一 `redactSink()` 咽喉点 | 若用户主动开启 `full` 模式，evidence 文件本身成为凭据/上下文的本地聚集目标（T1b 的静态变体）；v1 无静态加密 | v2（静态加密/权限模板评估） | 文件权限依赖 OS；v1 不承诺 evidence-at-rest 机密性 |

**v1 部署者须知的三句话**：

1. v1 提供的是"凭据出境拦截 + 隐形字符拦截/终止流 + 模型字段一致性告警 + 全量留痕"。
2. v1 **不提供**：外泄检测（T1a）、tool-call 注入防护（T2a，RCE 级）、响应注入防护（T2b）、模型真实性证明（T3a 的实质）、usage 对账（T4x）、旁路检测。
3. v1 的"阻断"在流式响应上是**终止流**，不是**撤回字节**。

## 非目标

- 不阻止上游记录/训练数据（理论不可行）；缓解手段是"最小暴露 + 金丝雀检测"，且**金丝雀在 v2** → v1 对此威胁零检测（见 §v1 残余风险登记表 T1a 行）
- 不做模型路由/账号池/计费系统（那是中转站的事，本项目是它的对立面）
- 不做通用 WAF/杀毒；范围限于 LLM API 流量
- 不承诺检出所有条件投递（持续监测提高攻击成本，非根除）
- 不防"完全沦陷的 agent 自改配置绕过网关"（best-effort 防绕过，见 DESIGN）
- **不防本机同权限对手抹除/重写证据链**（链仅提供内部一致性自检，见 §evidence 信任边界）
- **不承诺流式已转发字节的撤回**（阻断粒度=响应级）
- v1 不做 `redact`（流式物理不可执行，见 §`redact` 的期次声明）

## 评审修订记录

| 轮次 | 日期 | 输入 | 本文档变更 |
|---|---|---|---|
| R1 | 2026-09-14 | delphi-review Round 1（三专家一致 REQUEST_CHANGES，见 `.sprint-state/review/r1-consensus.md`） | 目标#1 全称量词降级（P-15）；新增 §裁决与动作语义（P-01/P-06/P-07）；新增 §v1 残余风险登记表（P-05）；理论边界与"三件单件"补期次归属（P-05/A-C4）；非目标补三条硬边界（P-07/P-01） |


## 关联 issue

- 架构设计：[DESIGN] 架构设计 v1
- 复用与集成清单：[REUSE] 复用与集成清单
- 验证方案：[TEST] 验证方案
- 路线图：[ROADMAP] v1/v2/v3 分期路线

