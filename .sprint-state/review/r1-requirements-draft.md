# llmveto v2b-A 需求陈述 — 多客户端接入（Claude Code / Codex / promptfoo）

- Sprint: `sprint-20261124-54` / 分支 `sprint/2026-11-24-01`
- 上级文档: `docs/issues/1-req-threat-model.md`（REQ）、`2-design-v1.md`（DESIGN）、`4-test-validation.md`（TEST）、`5-roadmap.md`（ROADMAP）、`CONTEXT.md`（领域术语）
- 本文只声明 v2b-A 增量。术语与裁决/动作语义以 REQ 原文为准，本文不重复定义。
- 范围来源：DR-029（只做 v2b 线 A）、DR-012（v2b = 运营面三线）；DR-030（评审面板）

## 0. 本版最重要的一句话

> **v2b-A 的真实内容不是"多配三个客户端"，而是"让网关看得懂另外三种协议线格式"。**

三个客户端各自把流量编码成**三种不同的线上格式**，而网关当前的扫描单元只认识其中一种
（OpenAI Chat Completions）。如果只写适配器把 baseURL 指过来，网关会**显示它们已过闸、日志里
有记录、counters 在涨**，但实际扫描到的文本几乎是空的。这是本项目最忌讳的失效形态：
**看起来在保护，实际什么都没扫**（与 2026-11-23 发现的"detect-secrets 缺 baseline 静默不执行"
同类）。

## 1. 实测基线（2026-11-24，全部在本机量出，不是推断）

### 1.1 三种线上格式 × 扫描单元覆盖矩阵

用 `dist/gateway/scan-unit.js` 直接喂真实形态的 body，断言各关键字段是否进入 `unit.text`：

| 载荷 | Chat Completions（对照） | Anthropic Messages（Claude Code） | Responses（Codex） |
|---|---|---|---|
| 用户文本 | ✅ `messages[].content` | ✅ `messages[]` 的 text part | ❌ `input[]` 不认 |
| 系统提示 | ✅ `system`（字符串） | ❌ `system` 是**块数组** | ❌ `instructions` 不认 |
| 工具调用参数 | ✅ `tool_calls[].function.arguments` | ❌ `tool_use.input` 是**对象** | ❌ `output[]/input[]` 的 `function_call.arguments` 不认 |
| 工具返回 | ✅ `role:"tool"` 的 content | ❌ `tool_result.content` 不认 | ❌ `function_call_output.output` 不认 |
| 助手正文（响应） | ✅ `choices[].message.content` | ❌ **响应整段为 `content[]`，不在 `choices` 里** | ❌ `output[].content[].output_text` 不认 |
| 请求侧 `tool` 声明 | ✅ `tools[]` | ✅ `tools[]` | ✅ `tools[]` |
| 响应 `model` 字段 | ✅ | ✅ | ✅ |
| 响应 `usage` 字段 | ✅ | ✅（`input_tokens`/`output_tokens`，字段名不同） | ✅ |

**实测原始输出**（`node` 直跑，2026-11-24）：

```
Responses 请求 text = "[{\"type\":\"function\",\"name\":\"shell\",\"parameters\":{…}}]"
  → 只有 tools 进了扫描单元；用户文本 / instructions / function_call 参数 / 工具返回 全为 false
Responses 响应 text = ""
  → 整个响应投影为空字符串
Anthropic 请求：用户文本 true；system 块数组 false；tool_use.input false；tool_result false
Anthropic 响应 text = ""
Chat Completions（对照）：四个探针全部 true
```

### 1.2 这不是"新客户端才有的问题"，是**已有能力的静默失效**

- `opencode/openai` 走 Chat Completions（本机实测 1496 条 `allowed` 记录）→ **扫描有效**。
- `opencode/anthropic` 自 v1 起就在 `CANARY_MANAGED_ROUTES` 与 `MANAGED_CONFIG_IDS` 里，但按
  1.1 实测，它的 `system` 块、`tool_use.input`、`tool_result` 与**整个响应正文**都不进扫描单元。
  本机当前未用它（0 条 evidence），所以**一直没被发现**。
- 结论：Anthropic Messages 的覆盖缺口属**申报能力与实际能力不符**，不只是新功能缺失。

### 1.3 三个客户端的真实配置形态（来自各家官方文档，均已拉取原文核对）

| 客户端 | 受管字段 | 协议 | 备注 |
|---|---|---|---|
| Claude Code | `~/.claude/settings.json` 的 `env.ANTHROPIC_BASE_URL`（+ 凭据变量 `ANTHROPIC_AUTH_TOKEN`） | `POST {base}/v1/messages`（+ `?beta=true`） | 官方 settings 参考原文示例即此写法；setting 里的 `env` 覆盖 shell 同名变量 |
| Codex | `~/.codex/config.toml` 的 `model_providers.<id>.base_url` 与 `wire_api` | `wire_api = "responses"` 是**唯一支持值**（官方 config-reference 原文） | `base_url` 已含 `/v1` |
| promptfoo | 项目配置 `promptfooconfig.yaml` 的 `providers[].config.apiBaseUrl` | OpenAI 兼容（Chat Completions / Responses 皆可） | 不可用 `apiHost`（它只拼 `https://<host>/v1`）；`apiBaseUrl` 含 `/v1` 前缀 |

**本机实测前提**：三个客户端**都没装**（`~/.claude.json`、`~/.claude/`、`~/.codex/`、promptfoo 配置与
CLI 全不存在）。因此适配器字段**只能**以文档为准，验收必须提供"字段 ↔ 文档 URL ↔ 核对日期"
的可追溯落点，且**不得**声称做过真实客户端端到端验证。

## 2. 范围内需求

| ID | 需求 | 类别 |
|---|---|---|
| REQ-V2bA-01 | **协议线格式覆盖（Responses）**：`buildRequestScanUnit` / `buildResponseScanUnit` 识别 OpenAI Responses 形态，把 `input[]`（含 `input_text` / `function_call.arguments` / `function_call_output.output`）、`instructions`、`output[]`（含 `output_text` / `function_call.arguments`）纳入文本投影 | 地基（协议） |
| REQ-V2bA-02 | **协议线格式覆盖（Anthropic Messages）**：`system` 支持**块数组**（取其中 `text`），`tool_use.input`（对象 → 规范化 JSON 文本）、`tool_result.content`、响应 `content[]`（`text` / `tool_use.input`）纳入文本投影 | 地基（协议） |
| REQ-V2bA-03 | **协议线识别与「未识别」的可观测性**：扫描单元记录识别到的协议形态；当请求/响应主体在**已知形态下找不到任何可扫文本**时，必须成为可观测事实（evidence 顶层 `reason`），**不得**静默判 clean 并落 `allowed` | 地基（防"假过闸"） |
| REQ-V2bA-04 | **Claude Code 适配器**：导出 `MANAGED_CONFIG_IDS`、`buildPatch`/`detectDrift`/`readCurrentConfig`/`applyManagedConfig`，写入目标为 `env.ANTHROPIC_BASE_URL`；路径落 `<gw>/claude/<provider>`，避开保留段 | 接入 |
| REQ-V2bA-05 | **Codex 适配器（TOML）**：读写 `~/.codex/config.toml`，受管项 = `model_providers.<id>.base_url`，并把 `wire_api` 显式钉为 `responses`；写回策略必须**不破坏用户其它配置**（含注释） | 接入 |
| REQ-V2bA-06 | **promptfoo 适配器**：受管项 = 项目配置 `providers[].config.apiBaseUrl`；文件定位与"无从下手"的语义必须明确定义（promptfoo 配置是**项目级**，不是用户级） | 接入 |
| REQ-V2bA-07 | **`doctor` 封闭枚举扩展**：三个新适配器加入遍历域，`--write-managed-config` 与漂移断言对三者生效；未安装客户端时报告必须**可解释**（区分"没装"与"配错了"） | 接入 |
| REQ-V2bA-08 | **端口径的过闸可达性**：三个客户端是否真正可被保护，取决于网关是否按对应协议**能扫**——`doctor` 须对"该客户端使用的线格式在本网关是否有扫描覆盖"给出可判定项 | 接入 |
| REQ-V2bA-09 | **金丝雀注入与串流检测的适用边界**：Responses / Anthropic 形态下的注入点定义，或**显式声明不注入并说明后果** | 接入 |
| REQ-V2bA-10 | **文档与登记表订正**：ROADMAP §v2、REQ 残余风险登记表、README/README.zh-CN、FAQ、`docs/licenses.md`（新增 smol-toml）同批订正，且由 `doc-consistency` 断言把守 | 文档 |

## 3. 范围内排除

| 排除项 | 归属 / 理由 |
|---|---|
| v2b-B 计费对账 `report` CLI | DR-029：官价基准数据源空白；契约 #4 `usage`/`cache_reported` 未实装 |
| v2b-C 指纹巡检 + provider 信任分 | DR-029：许可未核实；探针与最小暴露承诺冲突 |
| ACP 类客户端（trae / codebuddy）接入 | P0-3 已登记为架构边界（无可覆写 baseURL，走 `/v2/chat/…` 自带路径） |
| TLS 拦截（覆盖无法覆写 baseURL 的客户端） | v3 |
| `redact` / 策略可配置化 | v3 |
| 端到端行为测试"真实安装的客户端" | 本机三个客户端均未安装；以"真实 adapter 产物驱动探针"替代，并用真实客户端存档的方式作可选复核 |

## 4. 待 DESIGN 拍板的决策点

| # | 议题 | 候选 | 本文倾向（待评审确认） |
|---|---|---|---|
| D1 | Codex TOML 写回策略 | (a) 全量 parse→stringify（丢注释）；(b) **定点编辑**（只改目标键，其余字节不动）；(c) 引入保留注释的 crate 重写器 | **(b)**：注释丢失是"静默丢用户注意力"，定点编辑可把不变式写成"除目标键外逐字节相同"，可测 |
| D2 | promptfoo "受管配置"的语义 | (a) 当作项目级受管文件（需 cwd 或 env 指定）；(b) 不写文件，只做覆盖判定与报告 | **(a) + 显式 cwd 约定**：不定义 cwd 时"受管"无从谈起 |
| D3 | 未识别协议形态的处置 | (a) 判 `error → block`（fail-closed）；(b) 记为覆盖降级（同 `registry_unavailable`）；(c) 判 clean | **(b)**：阻断正常流量会把人赶离网关（与"性能即安全"同源）；但**必须**落链可查 |
| D4 | 金丝雀注入在 Responses / Anthropic 形态 | (a) 三种形态都实现六分支注入；(b) 仅 Chat Completions 注入，其余显式记录 `inject_skipped` | 待评审：建议 **Chat 形态保留现状 + 其余显式不注入并登记**，不把本 sprint 撑成第二次 canary 改造 |
| D5 | 三个适配器是否共用一个"协议线"抽象 | (a) 各写各的；(b) 提取 `Protocol` 维度（线格式 × 路由约定） | **(b)**：1.1 的矩阵说明"客户端"与"线格式"是两维，混写会在第四个客户端加入时再崩一次 |

## 5. 验收判定的形态（供 TEST 细化）

1. **协议覆盖**：对 1.1 矩阵的每一格写正样本（必须进入 `unit.text`）与**对照样本**（Chat 形态保持原行为，防回归）。
2. **反向探针**：把新加的投影分支移除 → 对应正样本必须变红。仅断言"能扫到"不算验收。
3. **适配器**：`applyManagedConfig` → 读回 → `detectDrift` 为空；手工改一处 → 漂移须含该条目 id。
4. **Codex 定点编辑**：写回后除目标键外**逐字节相同**（含注释与键序）。
5. **过闸**：由真实 adapter 产物驱动探测请求，evidence 中出现对应 `client` + `provider_id`。
6. **未识别形态**：构造一个形态未知但含凭据的 body → 必须可见（不得 silent `allowed` 而无任何 reason）。

## 6. 风险

| ID | 风险 | 处置 |
|---|---|---|
| R1 | 协议形态会演进（Responses 已有 `input`/`output` 两代形态并存） | 识别器按"特征键"判定，未知形态走 REQ-03 的可观测降级 |
| R2 | 三种形态的文本投影**顺序与分隔符**会改变 offsets 语义 | 新增分支必须与既有 `offsets` 口径一致，且**不得改变** Chat 形态的既有投影（存量 evidence 已冻结） |
| R3 | Anthropic 协议改造会触碰**已有**能力（opencode/anthropic 路由），可能破坏既有测试 | 先写对照测试锁定 Chat 形态现状，再改共享函数 |
| R4 | 三个客户端未安装，验收只到"产物 + mock 上游"层 | 登记为残余；UAT 阶段以用户真实客户端复核 |
| R5 | TOML 定点编辑易写成脆弱正则 | 解析用于**定位**，替换用行级精确匹配，并用"往返逐字节相同"作为唯一判据 |
