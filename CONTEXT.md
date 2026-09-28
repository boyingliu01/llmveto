# llmveto

本地 LLM 流量安全网关：把 agent 与中转站（relay）之间的每一次交互变成可审计、可统计验证的证据流，并在证据不足时拒绝放行。

## Language

### 裁决两层（不得混用）

**过闸**:
一次交互经由网关完成扫描与裁决的全过程。一条流量要么过闸、要么未过闸；不使用"全部流量过闸"这一全称说法，判定域是受管配置枚举内的路径。
_Avoid_: 拦截、过滤、清洗

**扫描单元（scan unit）**:
网关把流量切分后交给 checker 的那段 UTF-8 文本投影。checker 永远不接触 socket，也不自行解析 JSON。
_Avoid_: payload、缓冲、片段

**verdict**:
checker 的产出，取值 `clean | finding | error`。只描述"扫描结果"，不含任何策略结论。`error` 指扫描器自身失败，不是业务命中。
_Avoid_: 判定结果、block（那是 action）、命中（那是 finding）

**action**:
策略引擎的产出，取值 `allow | warn | redact | block`。由 `verdict → action` 的确定性映射得到。
_Avoid_: verdict、裁决结果

**安全类 checker**:
映射后能产出 `block` 的 checker。强制同步，禁止降级为异步放行，超时即 `error → block`。
_Avoid_: 关键 checker、硬 checker

**观测类 checker**:
映射后最多产出 `warn` 的 checker。超预算可降级为异步记录，降级时 `action_taken = degraded_observational`。
_Avoid_: 弱 checker、非安全 checker

**redact**:
改写**既有**内容以脱敏。因流式响应上物理不可执行（需改写已转发字节），属 v3 能力。
_Avoid_: 注入（注入不改动既有字节）、脱敏（脱敏是 `redactSink()` 的 sink 层行为，另一回事）

**注入（金丝雀注入）**:
在出站请求体末尾**新增**一段原本不存在的内容。不改动任何既有字节，因此不属于 `redact`，不受"改写属 v3"的限制。
_Avoid_: 改写、插桩

### 阻断的物理边界

**零缓冲**:
不持有 >1 个 chunk。正在被 checker 判定的那一个 chunk 存在 ≤1 chunk 的瞬态持有窗口，这是定义的一部分而非待修的缺陷。
_Avoid_: 流式直通、无缓冲

**终止流**:
流式响应命中违规后的唯一可用动作——注入一条 error 事件后关闭连接。它不是"撤回已发送的字节"，已送达字节不撤回、不可撤回。
_Avoid_: 阻断（在流式语境下说"阻断"须明确是终止流还是响应级拒绝）

**响应级拒绝**:
尚未向客户端转发任何字节时整体拒绝。对应非流式响应，以及流式中命中发生在首字节转发前。
_Avoid_: 阻断、掐断

**action_taken**:
evidence 里记录网关实际做了什么，是 `action` 落到传输层之后的结果形态（如 `blocked_before_forward` / `terminated_after_delivery`）。它属证据域，不是策略结论。
_Avoid_: action（那是策略层产出）、verdict

**观测类降级**:
观测类 checker 超预算时不阻塞流、只异步记录，对应 `action_taken = degraded_observational`。安全类 checker 无此路径。
_Avoid_: 跳过、fail-open

### 威胁与证据

**受管配置枚举（`MANAGED_CONFIG_IDS`）**:
每个接入客户端适配器导出的封闭清单，`doctor` 的遍历域。它把"流量是否被保护"替换成"枚举内每条路径是否过闸"这一可判定命题。
_Avoid_: 全部流量、所有客户端

**金丝雀（canary）**:
网关注入的一段随机唯一内容，用于在别处重新出现时证明上游留存并复用了上下文。
_Avoid_: 蜜罐（蜜罐凭据是被消费的诱饵，另一回事）、水印（水印是上游加给下级的）

**会话（session）**:
canary 的分配单位，由 session 键标识：优先取受管适配器写入的请求头，缺失时回退为「首条 user message 的 text parts 按 `len:text` 长度前缀串接」的摘要（非 text part 不计入，文本本身不做任何归一化）。有界活跃集合（数量 + TTL 二者先到为准）。
_Avoid_: 对话（那是客户端语义里的 conversation）、连接（HTTP keep-alive 与会话不同构）

**匹配域**:
当前活跃会话所持有 canary 的有界集合，是跨会话串流检测的判定范围。它有上界，因此"历史 prompt 全量留存以供匹配"不是本项目的实现选项。
_Avoid_: 索引、缓存库

**跨会话串流**:
A 会话注入的 canary 出现在 B 会话的响应里。这是 canary 唯一的命中形态；同一请求内的复述不算命中，因为它在 benign 场景下同样高频发生。
_Avoid_: 回流（歧义：既像串流又像外部泄露）、echo

**保留位**:
evidence 字段表中已冻结但恒为空值的字段。`canary` 字段即为保留位——它的存在不构成"已具备该能力"的证据。
_Avoid_: 预留字段（易与"将来会填"混用）

**取证可得性**:
某威胁未被判定、未阻断，但相关字段已原样写入 evidence，事后可人工对账。登记表中"部分（仅取证）"即此含义，不得写成"已缓解"。
_Avoid_: 已覆盖、已检测

**证伪信号**:
只证明"事情不该是这样"而不同时证明"是这样"的判定。`thinking-signature-presence` 属此类——它可以否决一次模型声称，但不能确认模型身份。
_Avoid_: 指纹（指纹要能正向确认，属 v2b 巡检）、校验

**双向自洽判定**:
只依赖同一交互的请求侧与响应侧字段互相比对，不引入外部能力表或配置。两个方向各自的失配都是 finding。
_Avoid_: 白名单校验、能力表

### 分期

**检测核心 / 运营面**:
v2 的两刀切分。检测核心（v2a）= 能被 evidence 与 CI 证明的判定能力；运营面（v2b）= 周期调度、出报告、多客户端覆写，与检测语义正交。
_Avoid_: 主功能 / 附属功能

**期次纪律**:
任一期的验收条目只能引用该期范围内的交付物。能力缺口写进残余风险登记表，不得靠"总体目标"含糊带过。
_Avoid_: 延后补齐（未登记的延后即违规）
