# llmveto v2b-A 需求陈述（R1 Round 2 修订版）

- Sprint: `sprint-20261124-54` / 分支 `sprint/2026-11-24-01`
- 上级文档: `docs/issues/1-req-threat-model.md`（REQ）、`2-design-v1.md`（DESIGN）、`4-test-validation.md`（TEST）、`5-roadmap.md`（ROADMAP）、`CONTEXT.md`
- 范围来源：DR-029（只做 v2b-A 线）、DR-030（评审面板）
- 本版修订依据：`.sprint-state/review/r1-consensus.md`（R1 三席一致 `REQUEST_CHANGES`，9 条三席共同命中 + 各席独有条目，全部处置见 §7）

## 0. 本版最重要的一句话

> **v2b-A 的真实内容不是"多配三个客户端"，而是"让网关看得懂另外两种线上格式，并且在看不懂时说出来"。**

三个客户端把流量编码成三种线上格式，网关当前只认识一种（OpenAI Chat Completions）。
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

| 载荷 | Chat Completions（对照） | Anthropic Messages（Claude Code） | Responses（Codex） |
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
| REQ-V2bA-01 | **Responses 协议线覆盖（非流式 + 流式）**：`input[]`（`input_text` / `function_call.arguments` / `function_call_output.output`，`input` 可为字符串或数组）、`instructions`、`output[]`（`output_text` / `function_call.arguments`）；流式识别 `response.output_text.delta`、`response.function_call_arguments.delta`（及 `…done` 汇总帧） |
| REQ-V2bA-02 | **Anthropic Messages 协议线覆盖（非流式 + 流式）**：`system` 可为字符串或**块数组**（取块内 `text`，忽略 `cache_control`）；`tool_use.input`（对象 → 规范化 JSON 文本）、`tool_result.content`（字符串或块数组）；响应 `content[]` 的 `text` 与 `tool_use.input`；流式识别 `content_block_delta` 的 `text_delta.text` 与 `input_json_delta.partial_json` |
| REQ-V2bA-03 | **协议形态识别与三态结果**：`recognize()` 输出 `known` / `unknown` / `known_but_empty` 三态为一等结果；**禁止**把"未知"或"已知但零文本"静默记为 clean |
| REQ-V2bA-04 | **协议抽象（数据驱动）**：以「线格式 × 路由约定」两维注册表实现 `recognize` / `projectRequest` / `projectResponse`（含流式），**不得**用类继承；Chat 分支只允许"加分支"，既有 Chat 投影行为逐字节不变 |
| REQ-V2bA-05 | **offsets 口径**：凡投影文本在原 body 中不存在对应字节（如对象规范化 JSON、块数组拼接），必须显式标注为"派生文本"，其 offsets **不得**被当成原文位置使用；且必须以对照测试证明 Chat 形态的 offsets 语义未变 |

### 接入：三个适配器

| ID | 需求 |
|---|---|
| REQ-V2bA-06 | **Claude Code 适配器**：受管项 = `env.ANTHROPIC_BASE_URL`（**不含**凭据变量）；写入目标 `~/.claude/settings.json`；base 路径落 `<gw>/claude/<provider>`；凭据处置（`ANTHROPIC_AUTH_TOKEN`）必须显式声明为"不纳管"并说明后果 |
| REQ-V2bA-07 | **Codex 适配器（TOML 定点编辑）**：受管项 = `model_providers.<id>.base_url` 与 `model_providers.<id>.wire_api`（**两键都算目标键**）；`<id>` 为固定保留值；写回后除目标键外**逐字节相同**（含注释、键序、CRLF）；provider 块缺失走 create-or-fail 的**显式**语义，多处同形键**拒绝写入** |
| REQ-V2bA-08 | **promptfoo 适配器**：受管项 = `providers[].config.apiBaseUrl`；配置文件定位顺序与"管理哪个 provider"必须可判定；**默认只报告漂移，写入需显式 opt-in**（项目文件进版本库） |
| REQ-V2bA-09 | **`doctor` 封闭枚举扩展与五态报告**：`没装` / `没配` / `配错（漂移）` / `线格式无覆盖` / `写失败` 五态可区分，并定义退出码 |
| REQ-V2bA-10 | **线格式覆盖判定**：`doctor` 须判定"该客户端所用线格式在本网关是否有扫描覆盖"；当该客户端的线格式**无法确定**时输出"未知"，**不得**输出"已覆盖" |

### 取证与边界

| ID | 需求 |
|---|---|
| REQ-V2bA-11 | **存量受管路由覆盖审计**：对 `CANARY_MANAGED_ROUTES` ∪ `MANAGED_CONFIG_IDS` 既有条目做一次覆盖复审，产出"每条路由 × 每种线格式 × 是否可见"的审计表，不得只在新增项上开工 |
| REQ-V2bA-12 | **字段来源可追溯表**：每个受管字段必须有「字段路径 ↔ 官方文档 URL ↔ 核对日期 ↔ 文档原文摘录」，作为交付物与验收项 |
| REQ-V2bA-13 | **金丝雀边界**：非 Chat 形态**显式不注入**，且必须（a）`inject_skipped` 成为 evidence 可查询事实；（b）书面列出因此失去的检测能力；（c）残余风险登记到 `docs/KNOWN-ISSUES.md` |
| REQ-V2bA-14 | **可观测码（`reason`）**：新增的覆盖降级与识别态必须使用**稳定机器可读码**（有限枚举），与 `registry_unavailable` 等既有码并列；且必须豁免**合法空请求**（纯工具调用、`input: []`、字段存在但为空）以免告警疲劳 |
| REQ-V2bA-15 | **未知形态的处置分权**：受管路由上的 `unknown` 形态按**显式策略**处置（见 D3 定值）；"已知但零文本"按异常处置（不得降级放行）；任何情况都不得出现"静默 allowed 且无 reason" |
| REQ-V2bA-16 | **端到端验收判据升级**：判定"真过闸"的唯一依据是「扫描单元命中已知探针文本 + evidence 记录」，**不得**以"evidence 有 client/provider_id"作为通过依据 |
| REQ-V2bA-17 | **文档与登记表同批订正**：ROADMAP §v2、REQ 残余风险登记表（含既有 `opencode/anthropic` 能力声明订正）、README / README.zh-CN、FAQ、`docs/licenses.md`（新增 `smol-toml`）、`docs/KNOWN-ISSUES.md` 同批，并由 `doc-consistency` 断言把守 |

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
| D3 | 未识别形态处置 | **分权**：`known_but_empty` → **视为异常**，落 `reason=shape_known_empty` 且**不得**判 clean（按覆盖降级处置并由 doctor 暴露）；`unknown` → 受管路由上默认 `reason=shape_unrecognized` 的**覆盖降级**（非阻断），且必须同时满足：码可统计、doctor 可查、并有可配置的 fail-closed 开关（本 sprint 只交付开关位与默认值，不交付配置面——配置面属 v3）；**(c) 判 clean 在任何情况下都不可接受** | C 的硬化版；B 的限定版；二者取交集 |
| D4 | 金丝雀注入 | **仅 Chat 形态保留现状**；非 Chat 显式不注入 → REQ-13 的三项落地（可观测 + 失去的能力清单 + 残余风险登记） | 三席一致 |
| D5 | 协议抽象 | **数据驱动注册表**，每协议提供 `recognize` / `projectRequest` / `projectResponse` **三件套**（响应侧对称，因为最严重的两个缺口都在响应侧）；只服务这三个已经定死的客户端，**不做投机抽象** | A/B/C 一致 |

## 5. 验收判定的形态（供 TEST 细化）

1. **投影正负样本**：§1.1 / §1.2 矩阵每一格一组正样本（必须进入 `unit.text`），并配 Chat 形态**对照样本**作为独立回归门（Chat 投影与 offsets 逐字节不变）。
2. **反向探针**：移除任一新增投影分支 → 对应正样本必须变红。仅断言"能扫到"不算验收。
3. **阻断类端到端（最高优先级）**：`sk-` 形态探针经三种协议线各发一次 → 必须 `blocked_before_forward`，且上游收到 0 次请求。当前 Anthropic / Responses 实测为 `warned` + HTTP 200，此断言现在就是红的。
4. **识别三态**：构造 `unknown`、`known_but_empty`、合法空请求三类 body，断言各自的 `reason` 码与 `action_taken`。
5. **适配器**：`applyManagedConfig` → 读回 → `detectDrift` 为空；手工改一处 → 漂移须含该条目 id；**未安装客户端** → doctor 报 `没装` 而非 `配错`。
6. **Codex 定点编辑**：写回后除目标键外逐字节相同（含注释、键序、CRLF）；新安装（无 provider 块）走 create；多处同形键拒绝写入。
7. **promptfoo 默认不写**：未加 opt-in 时项目文件 mtime 与内容不变。
8. **可追溯表**：REQ-12 的表必须存在、字段路径可 grep、且被 `doc-consistency` 断言引用。
9. **存量审计表（REQ-11）**：必须列出每条既有受管路由的线格式与可见性。

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

## 7. R1 评审意见逐条处置

| R1 条目 | 席位 | 处置 |
|---|---|---|
| 流式/SSE 覆盖缺失 | A/B/C 三席 | → REQ-01/02 纳入流式；本文 §1.2 补实测（三帧投影 `""`）；验收 §5.1 |
| 端到端判据 = 假过闸 | A CRITICAL-1 / B / C | → REQ-16；§5.3 升级为"凭据必须 blocked_before_forward" |
| D3 未知形态可武器化 | B CRITICAL-2 / A MAJOR-1 / C MAJOR-3 | → D3 分权 + REQ-15 + REQ-14 稳定码 |
| offsets 无定义无验收 | A/B/C | → REQ-05 + §5.1 |
| promptfoo 项目级语义 | A/B/C | → D2：默认只报告 + opt-in 写入 + 稳定标识 |
| 存量 `opencode/anthropic` 申报不符 | A/B/C | → REQ-11 审计 + REQ-17 订正 |
| 可追溯落点悬空 | A/B/C | → REQ-12 + §5.8 |
| D1 边界未定义 | A/B/C | → D1 定值（两键 / 插入 / 多处拒绝 / 两套判据） |
| D4 后果未落地 | A/B/C | → REQ-13 三项 |
| **入口/路由/body 透传层缺失** | A CRITICAL-2 | → §1.5 实测（入口可直通）+ §5.3 端到端；REQ-01/02 明确"入口到投影"全链 |
| `ANTHROPIC_AUTH_TOKEN` 凭据语义 | A MAJOR-2 | → REQ-06 显式"不纳管 + 说明后果" |
| 矩阵 `system` 形态写错 | A MINOR-1 | → §1.1 已改为 `messages[].role="system"` 与顶层字符串并列 |
| 实为两种新格式 + promptfoo 未进矩阵 | A MAJOR-5 / C MINOR-3 | → §0、§1.1/§1.2 表述订正；promptfoo 明确标为"复用 Chat、低风险对照项" |
| REQ-08 输出确定性错误结论 | B CRITICAL-3 | → REQ-10 无法确定时报"未知" |
| `reason` 需区分字段不存在/为空 | B MINOR | → REQ-14 豁免合法空请求 |
| 报告五态与退出码 | B MAJOR | → REQ-09 |
| 纯工具调用等合法空请求 | C MAJOR-3 | → REQ-14 |
| 写配置的原子写/备份 | B MINOR | → DESIGN 沿用 v1 `config-io` 既有原语（原子写），本文注明不重复实现 |
| smol-toml 锁版本与许可 | B MINOR | → REQ-17 + `docs/licenses.md`（BSD-3-Clause，零运行时依赖，`1.9.1` 精确版本） |
| "端口径"用词含混 | B MINOR | → 改为"线格式覆盖判定"（REQ-10） |
