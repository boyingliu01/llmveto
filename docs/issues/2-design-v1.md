# [DESIGN] 架构设计 v1 — 反代核 + checker 注册表 + fail-closed 策略

> 来源: https://github.com/boyingliu01/llmveto/issues/2
> 本文档已经过 delphi-review R1 修订（2026-09-14）。术语定义（`verdict` / `action` / 行为矩阵）以 [REQ] §裁决与动作语义 为唯一权威来源，本文不重复定义、只说明如何落地。

## 定位

独立本地网关 daemon（不是 IDE 插件、不是 XP-Gate 模块）。任何 LLM 客户端通过标准重定向点接入；XP-Gate 是消费者（Delphi 调用走网关、质量门禁读取 evidence），不是宿主。

## 架构

```
OpenCode(主agent+subagents+skills) ─┐
Delphi/XP-Gate(.delphi-config) ─────┤→ [反代核] → [checker 注册表] → [策略引擎] → upstream
                                    │       │
  ── v2 接入 ───────────────────────┤       ▼
  Claude Code / Codex / promptfoo   │   evidence store (append-only JSONL + 哈希链)
                                    │       ▲
  ── v3 接入（未覆盖期不承诺过闸）──┘       │
  无法覆写 baseURL 的工具 → HTTPS_PROXY   [llmveto verify]（v1 即交付链校验）
  + NODE_EXTRA_CA_CERTS TLS 拦截
```

> **期次标注**：v1 反代核**只有 baseURL 反向代理形态**。TLS 拦截（CONNECT/HTTPS_PROXY + CA）为 v3 交付物，v1 不实现、不监听；对应地 TLS/CA 信任**不在 `doctor` v1 检查项枚举内**（见 §组件 5 的 doctor 检查项封闭清单，避免"检查项空转"）。

### 组件

1. **反代核**（v1 形态 = baseURL 反向代理）：SSE 流式 tee（零缓冲——客户端立即收字节；per-chunk 先扫描后转发语义见 §关键决策）；**单一脱敏咽喉点**（所有日志 sink 前统一脱敏，见 §脱敏与留痕范围）；upstream 端点配置注入（可测试性契约 #1）；扫描单元规范化（见 §扫描单元定义）。**流式阻断的对外可观测契约**：命中已转发 N chunk 后，反代核向客户端注入单条 SSE 事件 `event: error` + `data: {"error":{"code":"llmveto:veto-mid-stream","delivered_chunks":N}}` 后关闭连接（这是面向客户端的冻结契约，与 evidence 侧 `action_taken=terminated_after_delivery` 对应）。v3 增加：TLS 拦截形态。
2. **checker 注册表**：checker 分两态签名（可测试性契约 #2，见 TEST issue），声明同步/异步、作用于流式/非流式。v1 内置三个：
   - `model-label-consistency`：响应 `model` 字段 vs 请求 `model` 字段的一致性（T3a 的 **label-mismatch 子集**）。**能力边界**：对"定向替换模型但回写一致字段"的对手无效（该情形恰是背景实证所述）；模型真实性证明属 v2 `fingerprint-probe`。v1 默认动作 `warn`。
   - `invisible-unicode-scan`：隐形字符扫描（U+200B/U+200C/U+200D/U+FEFF/RTL override U+202E/U+2066-2069），**跨 chunk 滚动窗口**（U+200B 的 UTF-8 编码 `E2 80 8B` 可被 chunk 边界切开 → 逐 chunk 独立扫描会系统性漏检，故窗口必须携带未完成多字节序列与跨 chunk 字符游标）。同步执行，不引入缓冲。
   - `egress-secret-scan`：出站请求体凭据模式扫描（复用/重实现 gitleaks 规则，T1b）。**强制同步 + 位于转发前 + 不可降级为异步 + 超时=block**（见 §性能预算与降级规则）。
   - v2 增加：`thinking-signature-presence`（T3a 证伪）/ `tool-call-shape`（T2a）/ `usage-reconcile`（T4a）
3. **策略引擎**：`verdict → action` 的**确定性映射表**。v1 = 内置固定表（每 checker 一行，用户不可配置）；v3 = 可配置动作 + 全局配置 > 项目级配置（防仓库级劫持）。action 语义与 transport 组合的完整行为见 REQ §行为矩阵；`redact` 为 v3 能力，v1 不可达。
4. **evidence store**：append-only JSONL + SHA-256 链式哈希；字段表见 TEST 契约 #4（v1 冻结）；信任边界与崩溃/并发等级见 REQ §evidence 信任边界；`llmveto verify` 为 v1 交付的校验提供者。
5. **CLI**：v1 冻结为 5 个命令 —— `start` / `stop` / `status` / `doctor` / `verify`（证据链校验 + JSONL schema 断言）。`report`（计费对账/provider 健康趋势）与 `canary rotate` 属 v2，**v1 不注册 stub**（未实现的命令比缺失的命令更有害）。
   - **`doctor` v1 检查项 = 冻结封闭枚举（本清单为唯一权威，README 引用之）**：① 受管配置覆写/漂移断言（遍历 `MANAGED_CONFIG_IDS`）；② 网关端口连通（`127.0.0.1` 监听探活）；③ `--write-managed-config` 写入托管配置（`experimental.policies` 写入失败仅告警）；④ evidence 链 `verify` 可跑通。**TLS/CA 信任检查项不在 v1 doctor 检查集内**（v1 不实现 TLS 拦截，放一个恒 `not-applicable` 的检查项 = 检查项空转，故 v1 直接不注册；该检查项随 TLS 拦截能力于 v3 一并引入）。

### 扫描单元定义（可测试性前置，v1 冻结）

> 立节理由：不规定 checker 收到什么，三个内容型 checker 的正确性与 fixture 可复现性都无法成立。

网关把流量切分为**扫描单元（scan unit）**后交给 checker，checker 永远不接触 socket：

| 方向 | 单元 | 内容 |
|---|---|---|
| 请求 | `request_body` | 已解析 JSON 的规范化文本投影：`messages[*].content`、`tools[*]`、`system`、`extra_headers` 的拼接（不可解析时为原始 body 文本）。**`extra_headers` = 排除认证类头后的自定义头集合**：`Authorization`、`x-api-key`、`api-key`、`x-goog-api-key`、`Proxy-Authorization` 及 `Cookie` 一律不进扫描单元（其值天然是高置信凭据模式，若入扫描则 benign 流量必然命中，阻断类 FP=0 不可达——见 TEST §3 强制 benign 认证头 fixture） |
| 响应 非流式 | `response_body` | 已解析 JSON 的 `choices[*].message.content` + `tool_calls[*].arguments` 拼接 |
| 响应 流式 | `sse_event` | 每个 SSE 事件 `data:` 字段解析后的 `choices[0].delta.content` / `delta.tool_calls[].arguments` 文本；解析失败的事件按原始 `data` 文本传递并置 `malformed: true` |

- **一律为 UTF-8 解码后的文本**（不是字节缓冲、不是原始 socket 分片）。字节级检查（如未决多字节序列）由流式窗口的 `pendingBytes` 状态承载（字段名对齐 TEST 契约 #2 `ScanWindow.pendingBytes`），对 checker 透明。
- 结构性字段（`model`、`usage`、`finish_reason`）由反代核解析后作为 `meta` 随单元传入，因此 `model-label-consistency` 不必自行解析 JSON。

### 接入适配器与受管配置清单

v1 只实现 OpenCode 与 Delphi 两个适配器。**每个适配器必须导出 `MANAGED_CONFIG_IDS: readonly string[]`（受管配置封闭枚举）**，该清单是受版本控制的契约，`doctor` 的遍历域由它决定——从而把"全部流量过闸"这一不可证伪命题替换为"枚举内每条路径过闸"的可判定命题（详见 ROADMAP v1 验收）。

| 客户端 | 接入方式 | 期次 | 由谁写入 |
|---|---|---|---|
| OpenCode | `provider.<id>.options.baseURL` 指向网关；`OPENCODE_MODELS_URL` 锁本地模型目录镜像 | v1 | **网关**：`llmveto doctor --write-managed-config`（用户手工步骤仅为可选复核） |
| Delphi (XP-Gate) | `.delphi-config.json` endpoint 覆写 | v1 | **网关**：同上 |
| Claude Code | `ANTHROPIC_BASE_URL` | v2 | 网关 |
| Codex CLI | `~/.codex/config.toml` `model_providers.*.base_url` | v2 | 网关 |
| promptfoo | baseURL 配置 | v2 | 网关 |
| 无法覆写 baseURL 的工具 | `HTTPS_PROXY` + `NODE_EXTRA_CA_CERTS` TLS 拦截 | v3 | 网关 + 部署文档 |

`experimental.policies`（provider.use deny）为 OpenCode 侧配合项：v1 由 `--write-managed-config` 尝试写入，**写入失败仅降级为 doctor 告警**，不作为 v1 验收前置（不把第三方客户端行为写成硬门槛）。

### 性能预算与降级规则

> 立节理由：TTFT 是**响应**指标，出站扫描发生在**请求**转发前，不进 TTFT。两条验收共用一个未定义的口径会导致"扫描很慢但 TTFT 全绿"。

三条**互相独立**的门（测量协议见 TEST §5，全部为相对基线的**增量**）：

| 门 | 定义 | v1 阈值 | 载体 |
|---|---|---|---|
| G1 `ttft_delta` | 流式响应首字节到达时延增量（网关启用 vs 网关旁路，同 mock upstream） | p95 < 5ms 且 p99 < 12ms | 响应侧 tee + 同步 checker 窗口 |
| G2 `request_gate_delta` | 请求侧端到端增量（收到客户端请求 → 发出 upstream 请求），**含 `egress-secret-scan` 全量扫描** | body ≤ 8KB：p95 < 3ms；≤ 64KB：p95 < 10ms；≤ 512KB：p95 < 40ms | 出站扫描门禁 |
| G3 `checker_timeout` | 单 checker 在安全类作用路径上的执行上限，**按 body 分档**（每档 ≥ 对应 G2 p95 的 3 倍余量，防慢机正常大请求即触发超时阻断） | `egress-secret-scan`：body ≤8KB→20ms / ≤64KB→50ms / ≤512KB→120ms | 超时行为 |

**降级规则（区分安全类 / 观测类，消除原"绝不阻塞流"歧义）**：

- **安全类 checker**（按 action 属性圈定 = v1 中映射为 `block` 的 checker 集合：`egress-secret-scan`（请求侧）+ `invisible-unicode-scan`（响应侧））：强制同步，**禁止**降级为异步放行；超各自预算 → 判 `verdict=error` → 按 REQ §术语定案映射为 `action=block`（超时=拒绝），evidence `reason="checker_timeout"`。`egress-secret-scan` 走 G3 body 分档预算；`invisible-unicode-scan` 走**每 chunk 门预算**（单 chunk 扫描 p95 计入 G1，不设独立 G3 硬超时——因其作用于响应流，超时语义即"该 chunk 未在 G1 预算内返回"，命中即按 `error→block` 终止流）。
- **观测类 checker**（v1 = 无；v2 起的 usage 落盘、provider 健康监测等）：超预算可降级为异步记录 + 告警，不阻塞流。
- G1/G2 阈值为 v1 冻结承诺值；若 BUILD 期基准实测无法满足，**必须走 ADR 修订并公开记录**，禁止静默放宽。
- **G2/G3 交叠判定口径（回应"合法慢扫描落在两门之间"）**：G2 是**统计门**（p95，衡量整体回归，超阈=性能回退，进回退阻断合并流程但不阻断单笔请求）；G3 是**单笔硬超时门**（单 checker 单次执行上限，超阈=`verdict=error`→`block`）。一次扫描若耗时落在 [G2 p95, G3) 区间：它是 G2 意义上的回退信号（计入基准、可能触发 PR 回退告警），但**不是** G3 超时，请求仍正常放行——两门口径独立，不互相覆盖。
- **慢环境已知运行时行为（登记，不粉饰）**：在远慢于 CI 基准的开发机上，接近 G3 上限的大请求可能被超时判定为 `block`。G-BENCH 前置门**必须报告 G3 口径的 p99（非仅 p95）**，且 512KB 档须满足 `p99_scan < G3 × 0.6`，否则按 ADR 同步上调 G3 分档值——把"超时阻断率"作为可测量、有退出条件的验收项，而非假设不存在。

### 关键决策

- 回环段（客户端→网关）HTTP 明文可接受（loopback-only 监听，且监听地址硬绑 `127.0.0.1`，禁 0.0.0.0）；网关→upstream 必须 TLS
- **零缓冲优先于字节级阻断**：流式命中违规时终止流而非缓冲后判定，理由与明文承诺见 REQ §行为矩阵 场景 4。
- **块级阻塞语义定案（回应"零缓冲 vs 同步 checker 是否矛盾"）**：反代核对每个到达的 SSE chunk 执行**同一事件循环 tick 内**的"先扫描、后转发"——即 chunk N 必须先过同步窗口 checker，通过后立即 tee 给客户端，checker 未过则不转发该 chunk 并终止流。**这不是缓冲整段响应**（不持有 chunk N+1 及以后、不等待流结束），故仍是"零缓冲"；精确说，零缓冲指**不持有 >1 个 chunk**，而"当前正被 checker 判定的这一个 chunk"存在 **≤1 chunk 的瞬态持有窗口**（G1 度量的正是这道 per-chunk 门的增量）——实现者不得把该瞬态窗口当 bug 消除，也不得反向放宽成整段缓冲。据此：
  - **场景 3（首字节转发前命中）可达** ⟺ 命中发生在 chunk 1 且 checker 在 tee chunk 1 前返回 → 未转发任何字节 → `response_delivered.delivered_chunks=0`，等同场景 2。
  - **场景 4（已转发 N chunk 后命中）**：`delivered_chunks` 为命中前已成功 tee 的 chunk 数（N ≥ 1）；"已转发字节不可撤回"即指这 N 个已过门的 chunk。
  - fixture 的 `delivered_chunks: N` 断言因此是"实现是否被悄悄异步化/缓冲整段"的探测器：若实现改为异步扫描后再转发，N 会异常增大，被该断言抓住。
- **fail-closed 语义**仅安全类 checker 适用（含超时）；观测类失败降级为记录，不阻断
- **防绕过（best-effort，军备竞赛性质）**：v1 = `doctor` 配置漂移检测（遍历域 = 受管配置封闭枚举）；v3 = 审计缺口检测（会话声称有 LLM 工作但网关无对应流量 → 告警）。**v1 不具备发现旁路的能力**，此点写入 REQ 登记表 P2 行，不得在文档中暗示 v1 已覆盖
- 技术栈：TypeScript + Bun（开发/打包）；**运行时代码仅使用 Node 标准库 API**（`node:http` / `node:crypto` / Web Streams），禁 Bun-only API → 因此"兼容 Node ≥ 18"的含义是"用户可用自带 Node ≥18 运行源码，官方分发为 Bun compile 单二进制"，二者不是同一承诺（见 README §分发）
- 单一脱敏咽喉点：所有 sink（evidence / stdout / 未来的 report）在写入前经同一 `redactSink()`；禁止各组件自行打印请求体

### 脱敏与留痕范围（回应"全量留存本身构成 T1b 本地聚集风险"）

| sink | v1 默认内容 | 开关 |
|---|---|---|
| evidence 记录 | 元数据 + verdict/action + 命中偏移 + `sha256(body)`；**不默认存明文 body** | `evidence.body_capture = metadata_only`（默认）/ `redacted` / `full` |
| stdout / status | 仅摘要，无 body | 无 |
| benign 语料库（测试用，入仓） | 录制会话经 `redactSink()` + 人工复核；密钥/个人信息必须为占位符 | 由 fixture reviewer 把关 |

`body_capture=full` 时 evidence 含明文提示词，等同在本地重建中转站的暴露面 → 文档须标注风险并提示加密卷/备份策略责任在用户。

## 验收标准

v1 验收条目以 [ROADMAP] §v1 为唯一权威清单（六条 + 前置门），本文不再重复列举，以免两处措辞漂移（R1 中"DESIGN 验收四条 vs ROADMAP 验收四条"即为同一门槛的两个不一致版本）。

## 评审修订记录

| 轮次 | 日期 | 本文档变更（问题 ID 见 `.sprint-state/review/r1-consensus.md`） |
|---|---|---|
| R1 | 2026-09-14 | 架构图标 TLS 拦截期次（P-17）；新增 §扫描单元定义（P-09/P-10）；新增 §性能预算与降级规则三台门 + 安全类超时=block（P-02）；策略引擎改为 v1 固定映射表、v3 为可配置（P-04/P-06）；`model-field-consistency` → `model-label-consistency` 并声明能力边界（P-12）；evidence 补信任边界与 v1 校验者 `verify`（P-07/P-08/P-19）；CLI 冻结 5 命令、去 stub（P-17）；新增受管配置封闭枚举与配置责任方（P-03/P-21）；新增 §脱敏与留痕范围（P-20）；§验收 改为单一权威来源（P-04）；runtime 承诺澄清（P-22） |
