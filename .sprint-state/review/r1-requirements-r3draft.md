# llmveto v2b-A 需求陈述（R1 Round 2 修订版）

- Sprint: `sprint-20261124-54` / 分支 `sprint/2026-11-24-01`
- 上级文档: `docs/issues/1-req-threat-model.md`（REQ）、`2-design-v1.md`（DESIGN）、`4-test-validation.md`（TEST）、`5-roadmap.md`（ROADMAP）、`CONTEXT.md`
- 范围来源：DR-029（只做 v2b-A 线）、DR-030（评审面板）
- 本版修订依据：`.sprint-state/review/r1-consensus.md`（R1 三席一致 `REQUEST_CHANGES`，9 条三席共同命中 + 各席独有条目，全部处置见 §7）

## 0. 本版最重要的一句话

> **v2b-A 的真实内容不是"多配三个客户端"，而是"让网关看得懂另外两种线上格式，并且在看不懂时说出来"。**

三个客户端用到**两种新线格式**（Anthropic Messages、OpenAI Responses）与一种网关已认识的格式（OpenAI Chat Completions，promptfoo 可走它）。
若只写适配器把 baseURL 指过来，网关会显示"已过闸"、evidence 有记录、counters 在涨，
但扫描到的文本几乎是空的——**这是本项目最忌讳的失效形态：看起来在保护，实际什么都没扫。**

本版新增的实测证据把它从"担忧"提升为"已复现的漏洞"：

```
POST /claude/anthropic/v1/messages (body 含 sk- 形态凭据) -> HTTP 200, action_taken="warned"
POST /codex/openai/v1/responses    (body 含 sk- 形态凭据) -> HTTP 200, action_taken="warned"
```

`egress-secret-scan` 是阻断类，命中应 `blocked_before_forward`。实测是 `warned` 且请求已转发——
**凭据从未进入扫描单元**。R1 评审后补测，详见 `r1-consensus.md` §第二轮评审前补出的入口层实测。

## 1. 实测基线（2026-11-24，本机量出）

### 1.1 三种线上格式 × 非流式投影覆盖

用 `dist/gateway/scan-unit.js` 直接喂真实形态 body，断言关键载荷是否进入 `unit.text`：

| 载荷 | Chat Completions（对照；**promptfoo 走此路即为低风险对照项**） | Anthropic Messages（Claude Code） | Responses（Codex） |
|---|---|---|---|
| 用户文本 | ✅ `messages[].content` | ✅ text part | ❌ `input[]` 不认 |
| 系统提示 | ✅ `messages[].role="system"` 与顶层 `system`（字符串） | ❌ `system` 为**块数组**时不认 | ❌ `instructions` 不认 |
| 工具调用参数 | ✅ `tool_calls[].function.arguments` | ❌ `tool_use.input` 是**对象** | ❌ `function_call.arguments` 不认 |
| 工具返回 | ✅ `role:"tool"` 的 content | ❌ `tool_result.content` 不认 | ❌ `function_call_output.output` 不认 |
| 助手正文（响应） | ✅ `choices[].message.content` | ❌ 响应在 `content[]`，不在 `choices` | ❌ `output[].content[].output_text` 不认 |
| `tools[]` 声明 | ✅ | ✅ | ✅ |
| 响应 `model` / `usage` | ✅ | ✅（字段名不同） | ✅ |

### 1.2 三种线上格式 × **流式**投影覆盖（R1 后补测，三席 CRITICAL）

| 流式帧形态 | 单帧扫描投影 | 扫描可见 |
|---|---|---|
| Responses `{type:"response.output_text.delta", delta}` | `""` | ❌ |
| Anthropic `{type:"content_block_delta", delta:{type:"text_delta", text}}` | `""` | ❌ |
| Anthropic `{type:"content_block_delta", delta:{type:"input_json_delta", partial_json}}` | `""` | ❌ |
| Responses `{type:"response.function_call_arguments.delta", delta}` 与 `…done` 汇总帧 | `""` | ❌ |
| Chat `{choices:[{delta:{content}}]}`（对照） | `"PROBE-CHAT-TOKEN"` | ✅ |

**流式是默认形态，非流式才是特例**（Claude Code 与 Codex 默认 stream）。

### 1.3 这不是"新客户端才有的问题"，是**已有能力的静默失效**

- `opencode/anthropic` 自 v1 起就在 `CANARY_MANAGED_ROUTES` 与 `MANAGED_CONFIG_IDS` 中，但按 1.1/1.2，
  它的 `system` 块、`tool_use.input`、`tool_result` 与**整个响应**都不进扫描单元。本机当前 0 条该路由流量，
  所以一直没被发现。
- 因此 Anthropic Messages 的缺口属**申报能力与实际能力不符**，REQ-11 单独认领存量审计。

### 1.4 三个客户端的真实配置形态（各家官方文档原文核对）

| 客户端 | 受管字段 | 协议 | 备注 |
|---|---|---|---|
| Claude Code | `~/.claude/settings.json` 的 `env.ANTHROPIC_BASE_URL`；凭据变量 `env.ANTHROPIC_AUTH_TOKEN` | `POST {base}/v1/messages`（含 `?beta=true`） | settings 的 `env` 覆盖 shell 同名变量 |
| Codex | `~/.codex/config.toml` 的 `model_providers.<id>.base_url` + `wire_api` | `wire_api="responses"` 是唯一支持值 | `base_url` 已含 `/v1` |
| promptfoo | 项目配置 `promptfooconfig.yaml` 的 `providers[].config.apiBaseUrl` | OpenAI 兼容（Chat 或 Responses） | 不可用 `apiHost`（只拼 `https://<host>/v1`） |

**本机三个客户端均未安装**，故：字段只能以文档为准（REQ-12 交付可追溯表），且**不得**声称做过真实客户端 E2E。

### 1.5 入口层（R1 后补测）

`startGateway` 对 `<gw>/<client>/<provider>/<rest>` 是路径直通：`/claude/anthropic/v1/messages` 与
`/codex/openai/v1/responses` 均能到达上游并落 evidence。**入口能接住，但接住不等于扫到**（见 §0）。
两个 `/v1` 字面量在 OpenAI 与 Anthropic 协议下含义相同，故路由前缀统一用一个无歧义的保留段（DESIGN 定值）。

## 2. 范围内需求（17 条）

### 地基：协议线覆盖

| ID | 需求 |
|---|---|
| REQ-V2bA-00 | **入口到投影全链**：受管路由的请求必须由网关入口接住、按**原始 body** 交给协议识别与投影、并原样转发上游；本要求覆盖「路由前缀解析 → 协议识别 → 投影 → 转发」四段，投影函数单测通过**不构成**本条的满足证据 |
| REQ-V2bA-01 | **Responses 协议线覆盖（非流式 + 流式）**：`input[]`（`input_text` / `function_call.arguments` / `function_call_output.output`，`input` 可为字符串或数组）、`instructions`、`output[]`（`output_text` / `function_call.arguments`）；流式识别 `response.output_text.delta`、`response.function_call_arguments.delta`（及 `…done` 汇总帧） |
| REQ-V2bA-02 | **Anthropic Messages 协议线覆盖（非流式 + 流式）**：`system` 可为字符串或**块数组**（取块内 `text`，忽略 `cache_control`）；`tool_use.input`（对象 → 规范化 JSON 文本）、`tool_result.content`（字符串或块数组）；响应 `content[]` 的 `text` 与 `tool_use.input`；流式识别 `content_block_delta` 的 `text_delta.text` 与 `input_json_delta.partial_json` |
| REQ-V2bA-03 | **协议形态识别（路由权威）**：识别以路由前缀为权威（`WIRE_ROUTE_PREFIXES`），内容吻合只在无权威前缀时使用；`recognize()` 只有 `known(format)` / `unknown` 两个取值。**禁止**让 chat 与 anthropic 的"特征键"互相竞争——二者在"`messages` + 纯文本"上结构相同，竞争必然误判并触发 fail-closed |
| REQ-V2bA-04 | **协议抽象（数据驱动）**：以「线格式 × 路由约定」两维注册表实现 `recognize` / `projectRequest` / `projectResponse`（含流式），**不得**用类继承；Chat 分支只允许"加分支"，既有 Chat 投影行为逐字节不变 |
| REQ-V2bA-04b | **路由前缀归属与透传**：三个新协议线的路由前缀必须是网关保留段（不得与 `v1`/`api` 或既有客户端名冲突），且 `<prefix>/<provider>/<rest>` 下的 `rest`（含 `/v1/messages`、`/v1/responses`、`?beta=true` 查询串）必须原样到达上游 |
| REQ-V2bA-05 | **offsets 口径**：凡投影文本在原 body 中不存在对应字节（如对象规范化 JSON、块数组拼接），必须显式标注为"派生文本"，其 offsets **不得**被当成原文位置使用；且必须以对照测试证明 Chat 形态的 offsets 语义未变 |

### 接入：三个适配器

| ID | 需求 |
|---|---|
| REQ-V2bA-06 | **Claude Code 适配器**：受管项 = `env.ANTHROPIC_BASE_URL`（**不含**凭据变量）；写入目标 `~/.claude/settings.json`；base 路径落 `<gw>/claude/<provider>`；凭据处置（`ANTHROPIC_AUTH_TOKEN`）必须显式声明为"不纳管"并说明后果 |
| REQ-V2bA-07 | **Codex 适配器（TOML 定点编辑）**：受管项 = `model_providers.<id>.base_url` 与 `model_providers.<id>.wire_api`（**两键都算目标键**）；`<id>` 为固定保留值；写回后除目标键外**逐字节相同**（含注释、键序、CRLF）；写回语义：provider 块缺失则**创建**（新增行不参与逐字节判据）；同一文件出现多处同形目标键则**拒绝写入**并报错 |
| REQ-V2bA-08a | **写盘原语复用与备份**：三个适配器的 JSON 写路径**复用** v1 既有原语 `src/adapters/config-io.ts` 的 `writeJsonConfig`（`mkdirSync` 递归建父目录 + 整文件覆写）与 `applyManagedPatch`，不重复实现；Codex 的 TOML 写路径**不**复用（语义不同），但必须同样保证失败时不留下半截文件（先写临时文件再 rename），并在覆盖已存在文件前保留一份 `<path>.bak` 备份 |
| REQ-V2bA-08 | **promptfoo 适配器**：受管项 = `providers[].config.apiBaseUrl`；配置文件定位顺序与"管理哪个 provider"必须可判定；**默认只报告漂移，写入需显式 opt-in**（项目文件进版本库） |
| REQ-V2bA-09 | **`doctor` 封闭枚举扩展与六态报告**：状态取值为**封闭六态** `not_installed` / `not_configured` / `drift` / `coverage_missing` / `coverage_unknown` / `write_failed`，逐条可区分并定义退出码——`not_installed`/`not_configured` → 不影响退出码（0）；`drift`/`coverage_missing`/`coverage_unknown`/`write_failed` → 退出码 1；`coverage_missing` 与 `coverage_unknown` 均退出码 1，输出前缀分别标 `[FAIL]` 与 `[DEGRADED]` 以示区分 |
| REQ-V2bA-10 | **线格式覆盖判定**：`doctor` 须判定"该客户端所用线格式在本网关是否有扫描覆盖"，结果映射到 REQ-09 的 `coverage_missing` / `coverage_unknown`；线格式**无法确定**时输出 `coverage_unknown`（六态中的一等状态），**不得**折算成 `coverage_missing` 或通过 |

### 取证与边界

| ID | 需求 |
|---|---|
| REQ-V2bA-11 | **存量受管路由覆盖审计**：对 `CANARY_MANAGED_ROUTES` ∪ `MANAGED_CONFIG_IDS` 既有条目做一次覆盖复审，产出"每条路由 × 每种线格式 × 是否可见"的审计表，不得只在新增项上开工 |
| REQ-V2bA-12 | **字段来源可追溯表**：每个受管字段必须有「字段路径 ↔ 官方文档 URL ↔ 核对日期 ↔ 文档原文摘录」，作为交付物与验收项 |
| REQ-V2bA-13 | **金丝雀边界**：非 Chat 形态**显式不注入**，且必须（a）`inject_skipped` 成为 evidence 可查询事实；（b）书面列出因此失去的检测能力；（c）残余风险登记到 `docs/KNOWN-ISSUES.md` |
| REQ-V2bA-14 | **可观测码与覆盖判定两轴**：`reason` 封闭枚举四值 `shape_unrecognized` / `shape_known_empty` / `shape_partial_coverage` / `inject_skipped`。判定分**两轴**：轴1 识别（`known`/`unknown`）；轴2 覆盖——由协议声明的 `CoverageSpec` 清单在**原始 body** 上求 `present`、由投影器逐路径上报 `handled`，二者差集决定结果：`full`（`present` 非空且差集为空，不写 reason）/ `partial`（差集非空，**与文本量无关**）/ `vacuous`（`present` 为空）。响应侧同样跑两轴，流式心跳帧在投影前分流、不计入 `present` |

| REQ-V2bA-15 | **未识别与覆盖不足的处置（受管路由 fail-closed）**：轴1 `unknown` → `shape_unrecognized` → **block**；轴2 `vacuous` → `shape_known_empty` → **block**；轴2 `partial` → `shape_partial_coverage` → **block**；`full` 不写 reason、正常判定。非受管路由：同样写 reason，但不阻断（覆盖降级）。**任何情况都不得出现"静默 allowed 且无 reason"** |
| REQ-V2bA-15a | **部分覆盖的守卫**：`shape_partial_coverage` 的定义见 REQ-14 轴2；本需求额外要求它**永久为 0**——BUILD 结束、以及每次 SHIP 前，该码在本机真实语料与全部合成语料上的计数必须为 0，并由 `doc-consistency` 持续断言（不得只在 BUILD 末统计一次） |
| REQ-V2bA-16 | **端到端验收判据升级**：判定"真过闸"的唯一依据是「扫描单元命中已知探针文本 + evidence 记录」，**不得**以"evidence 有 client/provider_id"作为通过依据 |
| REQ-V2bA-17 | **文档与登记表同批订正**：ROADMAP §v2、REQ 残余风险登记表（含既有 `opencode/anthropic` 能力声明订正）、README / README.zh-CN、FAQ、`docs/licenses.md`（新增 `smol-toml`：精确版本 `1.9.1`、许可 BSD-3-Clause、零运行时依赖，逐项写进台账并纳入 §5.11 验收）、`docs/KNOWN-ISSUES.md` 同批，并由 `doc-consistency` 断言把守 |

## 3. 范围内排除

| 排除项 | 理由 |
|---|---|
| v2b-B / v2b-C | DR-029 |
| ACP 客户端（trae / codebuddy） | P0-3 已登记为架构边界 |
| TLS 拦截、`redact`、策略可配置化 | v3 |
| 真实安装客户端的 E2E | 三客户端均未安装；以"真实 adapter 产物 + mock 上游 + 探针文本命中"替代，登记为残余 |
| 全形态金丝雀六分支注入 | REQ-13 显式不注入并登记 |
| 保留注释的 TOML 重写器 | 本 sprint 用定点编辑；重写器留 v3 备选 |

## 4. 决策（R1 后已定值，标注修订依据）

| # | 议题 | **定值** | 依据 |
|---|---|---|---|
| D1 | Codex TOML 写回 | **定点编辑**（解析仅用于定位，行级精确替换）；目标键集合 = `{base_url, wire_api}`；写回判据是"除目标键外逐字节相同"，漂移判据是"解析后比值"——**两套判据不得混用**；provider 块缺失 = create（新增块，逐字节判据对新增行豁免）；多处同形键 = 拒绝写入并报错 | 三席一致；C-MAJOR-4 |
| D2 | promptfoo 受管语义 | **项目级受管 + 默认只报告**：文件定位顺序 `LLMVETO_PROMPTFOO_CONFIG` env → cwd 的 `promptfooconfig.{yaml,yml}`；受管 provider 以稳定标识（provider id 或 `config` 中声明的 key）而非数组下标；`--write-managed-config` 需 **`--include-project-config` 显式 opt-in** 才写项目文件；`apiHost` / 环境变量等替代配置识别为 `unmanaged` 并标 `[WARN]`，不计为漂移 | A/B/C 一致 |
| D3 | 未识别形态处置 | **受管路由默认 fail-closed**：`known_but_empty` → `reason=shape_known_empty` → **block**；`unknown` → `reason=shape_unrecognized` → **block**（R1 共识「改为条件式 fail-closed」，采纳 B 席限定版：仅**受管路由**阻断，非受管路径记覆盖降级不阻断，以免把非受管流量一并打死）。本 sprint **不**交付配置面（可把它改成不阻断的开关属 v3）；**(c) 判 clean 在任何情况下都不可接受** | R1 共识处置原则 + B CRITICAL-2 |
| D3a | **识别器失效语义（取代"预留未度量失败路径"）** | 识别器**不得**抛异常，更不得"抛异常后被当成 checker error 静默映射成 block"。识别结果是**数据**：`known` + 投影三件套，或 `unknown` / `known_but_empty` + 稳定码。特征键：Chat=`messages`；Responses=`input` / `output` / `instructions`；Anthropic=`messages` + 顶层 `system` 或 `max_tokens`，且无 `choices`。**歧义即 unknown**。已知输入由 §5.2 正样本钉死。**不留任何"识别器坏掉就阻断全部流量"的无度量失败路径**——那是比漏扫更快的用户流失路径（与 2026-11-24 期 T2a 事故同源） |
| D4 | 金丝雀注入 | **仅 Chat 形态保留现状**；非 Chat 显式不注入 → REQ-13 的三项落地（可观测 + 失去的能力清单 + 残余风险登记） | 三席一致 |
| D5 | 协议抽象 | **数据驱动注册表**，每协议提供 `recognize` / `projectRequest` / `projectResponse` **三件套**（响应侧对称，因为最严重的两个缺口都在响应侧）；只服务这三个已经定死的客户端，**不做投机抽象** | A/B/C 一致 |

## 5. 验收判定的形态（供 TEST 细化）

> 下文小节号 `§5.1`…`§5.14` 是**字面量**，§7 的落点列按它们 grep。

> 每一条都给出"能变红"的构造方式。只断言"能跑通"的条目不算验收。

§5.1 **入口到投影全链（REQ-00）**：由真实 adapter 产物构造请求，经真实 `startGateway` + mock 上游发一次，断言（a）上游收到的 body 与客户端发出的**逐字节相同**（含查询串）；（b）扫描单元 `unit.text` 命中探针文本。**只断言 (a) 或只断言 evidence 有记录都不通过。**
§5.2 **投影正负样本**：§1.1 / §1.2 矩阵**每一格**一组正样本（必须进入 `unit.text`），并配 Chat 形态**对照样本**作为独立回归门（Chat 投影与 offsets 逐字节不变）。§1.2 中 `response.function_call_arguments.delta`、`…done` 两格必须有独立样本。
§5.3 **反向探针**：移除任一新增投影分支 → 对应正样本必须变红。
§5.4 **阻断类端到端（最高优先级）**：`sk-` 形态探针必须放在**当前为 ❌ 的字段**（Anthropic：`system` 块数组 / `tool_use.input` / `tool_result` / 响应 `content`；Responses：`input[]` / `instructions` / `function_call.arguments` / `function_call_output` / 响应 `output[]`），经三种协议线各发一次 → 必须 `blocked_before_forward` 且上游收到 0 次请求。**不得放进 `messages[].content` 这类当前已 ✅ 的字段**，否则修复前就可能通过，证明不了缺口已补。
§5.5 **识别三态 + 投影完成性**：构造四类 body 并断言 `reason` 与 `action_taken`——① `unknown`（受管路由 → `block` / `reason=shape_unrecognized`；非受管 → 覆盖降级）；② `known_but_empty`（受管路由 → `block` / `reason=shape_known_empty`）；③ `projected` 且零文本（`input: []`、`messages: []`）→ **不写 reason**、正常判定；④ `projected` 且含文本（纯工具调用、`tool_result` 载荷）→ **不写 reason**、正常判定，且**必须**能命中其中载荷的探针。③④ 与 ①② 的判据是"投影器是否覆盖适用字段"，**不是**"文本是否为空"。
§5.6 **适配器**：`applyManagedConfig` → 读回 → `detectDrift` 为空；手工改一处 → 漂移含该条目 id；**未安装客户端** → doctor 报"没装"而非"配错"。
§5.7 **Codex 定点编辑**：写回后除目标键（`base_url` + `wire_api`）外逐字节相同（含注释、键序、CRLF）；无 provider 块时**创建**新块（新增行豁免逐字节判据）；多处同形键**拒绝写入**并报错。
§5.8 **promptfoo 默认不写**：未加 opt-in 时项目文件 mtime 与内容不变。
§5.9 **路由透传（REQ-04b）**：`/v1/messages?beta=true` 与 `/v1/responses` 到达上游时路径与查询串完整。
§5.10 **金丝雀边界（REQ-13）**：(a) 非 Chat 形态下 evidence 顶层出现 `inject_skipped`；(b) 失去能力清单存在于交付文档且被 `doc-consistency` 引用；(c) `KNOWN-ISSUES.md` 有对应条目。
§5.11 **可追溯表（REQ-12）**：表存在、字段路径可 grep、含文档 URL 与核对日期、被 `doc-consistency` 断言引用；**依赖元数据（`smol-toml` 版本 / 许可 / 运行时依赖数）同表覆盖**。
§5.12 **存量审计表（REQ-11）**：列出每条既有受管路由的线格式与可见性。
§5.13 **部分覆盖码（REQ-15a）**：构造"协议已知、但某已知载荷字段未被投影器覆盖"的 body → 必须出现 `reason=shape_partial_coverage`；且 BUILD 结束时该码在本机真实语料上计数为 0。
§5.14 **识别器举证强度（R8-b，DR-031 后取代观察模式）**：正样本矩阵**按特征形态逐条覆盖**（`input` 字符串/数组、两代 Responses 形态、`system` 字符串/块数组、流式各帧各一条）+ 每条配"差一个特征键"的负样本。**并且必须包含"跨格式相似性"对：`messages` + 纯文本（Claude 无 system 与 Chat 完全相同）、带块数组 `system` 的 Claude、带 `max_tokens` 的标准 Chat——这三条在路由权威下必须各归各类、且**全部不得**判 `unknown`。

## 6. 风险

| ID | 风险 | 处置 |
|---|---|---|
| R1 | 协议形态演进（Responses 已有两代形态并存） | 按特征键识别；未知形态走 REQ-03/15 的显式降级 |
| R2 | 新投影改变 offsets 语义 | REQ-05 显式标注派生文本；Chat 对照逐字节不变 |
| R3 | 触碰共享函数会破坏既有 Anthropic 路由行为 | **先写对照测试锁现状**，再改共享函数（顺序是硬约束） |
| R4 | 三客户端未安装，验收止于产物 + mock 上游 | 登记残余；UAT 由用户真实客户端复核 |
| R5 | TOML 定点编辑易写成脆弱正则 | 解析定位 + 行级替换 + "往返逐字节相同"作为唯一判据 |
| R6 | 非 Chat 形态不注入金丝雀 → T1a 覆盖变窄 | REQ-13 三项落地 + KNOWN-ISSUES 登记 |
| R7 | 已部署实例存在 Anthropic 路由的 "false clean" 历史证据 | REQ-11 审计表 + REQ-17 能力声明订正 |
| R8 | 受管路由上 `unknown` 改为 fail-closed 后，**识别器误判会阻断正常流量**（与 2026-11-24 期 T2a 事故同源） | **本机 1916 条真实 evidence 几乎全是 Chat，对两种新格式没有证明力**（R1-R2 第三席指出），因此不能只靠它。三条并用：(a) 本机真实语料只用于证明"Chat 流量的误判率为 0"（防回归）；(b) 两种新格式的识别正确性由**合成正样本矩阵**保证——每种格式的每种特征形态（`input` 字符串/数组、两代 Responses 形态、`system` 字符串/块数组、流式各帧）各一条正样本 + 一条"差一个特征键"的负样本；(c) **【DR-031 用户拍板：改为直接 fail-closed】** 不采用观察模式。风险改由 (b) 独立承担并**提高强度**：每种特征形态各一条正样本 + 一条"差一个特征键"的负样本；"歧义即 unknown"须有构造性用例；本机真实语料只证 Chat 零误判、**不得外推**；BUILD 期间本版本产品**不得接管用户日常流量**（systemd 跑的是 main 的 dist，sprint 产物只在测试进程内运行） |

## 8. 修订历史

| 轮次 | 改了什么 |
|---|---|
| R1 初稿 | 10 条 REQ，5 个待拍板决策 |
| R1 第 2 版（`r1-requirements-r2draft.md` 同源） | 三席一致 `REQUEST_CHANGES` 后：补流式覆盖、端到端判据升级、D3 改 fail-closed、offsets 口径、promptfoo 语义、存量审计、可追溯表、D1 边界、`inject_skipped` 落地 |
| R1 第 2 轮（两席 + 一席补位） | 两席一致 `REQUEST_CHANGES`：指出 §7 多条"声称处置但正文无落点"、D3 与 REQ-15 方向相反、doctor 五态封闭性、探针放错字段 |
| R1 第 3 版（本版） | 加 §7 落点列（可按 grep 核对）；doctor 改**封闭六态**+退出码；§5 给字面量小节号；**§5.4 探针必须放 ❌ 字段**；**REQ-14 豁免判据改为"投影器完成性"**（消掉与 REQ-15 的直接矛盾）；新增 **REQ-15a 部分覆盖码**；**R8 改用三条并用**（真实语料只证 Chat 零误判 + 合成正样本矩阵 + 观察模式上线） |
| R1 第 4 版（对应 `var/delphi-v2b/r1r2/expert-A3.md` 之后） | 第三席 CRITICAL（豁免与 fail-closed 互相矛盾、探针同一条目双重结论）已由第 3 版吸收；本版追加 `§5.13` / `§5.14` 两条验收 |
