# [ROADMAP] v1/v2/v3 分期路线

> 来源: https://github.com/boyingliu01/llmveto/issues/5
> 本文档已经过 delphi-review R1 修订（2026-09-14）。本文是 **v1 验收条目的唯一权威清单**（DESIGN 不再重复列举）。

## 总原则

v1 先保证**受管路径流量 100% 过闸**（哪怕验证逻辑最简），v2 加深验证能力，v3 闭环策略。每期有硬验收标准，达标才进下一期。

**分期纪律（R1 新增，用于消除"v1 验收引用 v2/v3 组件"）**：任何 v1 验收条目只能引用 v1 范围内的交付物；能力缺口必须写进 [REQ] §v1 残余风险登记表，而不是靠"总体目标"含糊带过。

## v1 — 流量覆盖优先（MVP）

### 交付

- 反代核（**仅 baseURL 形态**）：SSE tee 零缓冲 + 单一脱敏咽喉点 + upstream 配置注入 + 扫描单元规范化
- checker：`egress-secret-scan`（阻断）/ `invisible-unicode-scan`（跨 chunk 窗口）/ `model-label-consistency`（告警）
- 策略引擎：**内置固定 `verdict → action` 映射表**（不可由用户配置；可配置性属 v3）
- evidence store：append-only JSONL + SHA-256 链，`evidence_version: 1` 字段表冻结（TEST 契约 #4）
- **`llmveto verify`**：链完整性 + schema 断言（v1 必须有证据校验者，否则"可审计"不可演示）
- **`mock-upstream`**（纯 TS 声明式脚本回放）：v1 全部集成/E2E 的恶意上游载体
- 接入：OpenCode（provider baseURL + `OPENCODE_MODELS_URL`）+ Delphi（`.delphi-config` endpoint 覆写）；两者均由 `doctor --write-managed-config` 写入，并导出 `MANAGED_CONFIG_IDS` 封闭枚举
- CLI：`start` / `stop` / `status` / `doctor` / `verify`（无 stub）
- 威胁样本库：T1b/T2c/T3a(label-mismatch) 各 ≥3 正样本 + benign ≥50 条 + 跨 chunk 对抗样本
- 性能基准脚本：G1/G2/G3 三台门 + `bench/baseline.json`

### 前置决策门（BUILD 开始前必须关闭，否则 v1 范围会中途漂移）

| 门 | 内容 | 关闭条件 |
|---|---|---|
| G-LIC | gitleaks 规则集许可核实（REUSE 原写"MIT"未验证） | `docs/licenses.md` 记录逐文件许可结论；若不可合规复用 → 改为**自建 top-N 高置信凭据模式**（OpenAI `sk-…`、Anthropic `sk-ant-…`、GitHub `ghp_…`、PEM 私钥块、AWS AKIA…），并在 REQ 登记表 T1b 行标注覆盖面缩小 |
| G-FP | fpverify（Python）集成方式 | 定为**离线 fixture 生成器**（开发者机器跑一次，产出 YAML 入仓），CI 零 Python 依赖；不得把 Python 运行时引入 v1 测试栈 |
| G-BENCH | G1/G2 阈值可达成性 | 先建骨架基准实测；若实测超阈值 → 出 ADR 修订阈值并公开记录，禁止静默放宽 |

### 验收（v1 → v2 硬门槛，逐条可判定）

1. **受管路径过闸（可判定形式，替换原"全部 provider 流量过闸（doctor 可证明）"）**：
   - (a) **配置覆写断言**：`doctor` 遍历 `MANAGED_CONFIG_IDS` 全集，逐条断言其 endpoint/baseURL == 网关地址；任一不符即 `FAIL` 并输出条目 id。
   - (b) **探测过闸断言**：对枚举内每条路径回放 ≥1 条探测请求，evidence 中出现对应 `client` + `provider_id` 记录（时间窗口内）。
   - (c) **边界声明**：文档明示 v1 不覆盖的旁路清单（未接入客户端、SDK 内置端点、插件直连 fetch、遥测），且 v1 **不具备发现旁路的能力**。**v3 起提供"配置遗漏可见性"（`llmveto audit`），但那不是旁路检测** —— 它对比用户声明的 agent 列表与 evidence 里的流量，只回答"你可能忘了接入某个客户端"，见下方 v3 节的定位说明。
2. **Delphi 路径过闸**：`.delphi-config.json` 覆写后 Delphi 请求在 evidence 中 `client="delphi"` 可观测；doctor 对 `.delphi-config` 漂移有断言样本（此前 v1 验收零覆盖 Delphi）。
3. **checker 有效性门槛**：fixture 集内检出率 100%；benign ≥50 条上告警类 FP ≤2%、阻断类 FP = 0（判据见 TEST §3）。
4. **fail-closed 端到端**（载体 = mock-upstream，非 evil-relay）：请求侧阻断（零出境证明）+ 流式阻断（前 N-1 chunk 确实已送达 + `event: error` + 连接终止 + `terminated_after_delivery`）两条路径均通过；外加 G3 超时 → `block` 用例。
5. **evidence 可验证性**：`llmveto verify` 对正常链返回 `ok`；篡改任一中间记录必报 `first_bad_seq`；daemon 重启/崩溃后为纯追加、无覆盖写；schema 字段断言（TEST 契约 #4）全绿。
6. **性能三台门**：G1 `ttft_delta` **p95 < 5ms 且 p99 < 12ms**（对齐 DESIGN §性能预算，两值同为验收门）；G2 `request_gate_delta` 按 body 分档（≤8KB:3ms / ≤64KB:10ms / ≤512KB:40ms）达标；G3 扫描超时=block 用例见验收 #4。均按 TEST §5 测量协议在每 PR 运行并按 §3 回退公式判定；G-BENCH 须报告 G3 口径 p99（见 DESIGN §性能预算 慢环境登记条）。

> **v1 交付后仍存在的暴露面**以 [REQ] §v1 残余风险登记表为准（T1a/T2a/T2b/T2d/T3b/T3c/T4x 未缓解）。README 必须引用该表，禁止暗示"装上网关即被保护"。

## v2 — 验证加深

- checkers：`thinking-signature-presence` / `tool-call-shape`（T2a）/ `usage-reconcile`（T4a）/ `fingerprint-probe`（T3a 实质：模型真实性）
- 金丝雀引擎（TS 重实现 canari 逻辑）+ `canary rotate` CLI → **自此 T1a 才有阳性检测能力**
- 指纹巡检：集成 llm-fingerprint-detector，周期探针 + provider 信任分（fpverify 序贯检验判定）
- 计费对账报告（usage×官价 vs 中转账单差值）+ provider 健康监测（错误率/超时趋势）+ `report` CLI
- **evil-relay 模拟器 + 双矩阵 CI 全量落地**（v1 已由 mock-upstream 承担最小恶意上游职能）
- 接入扩展：Claude Code / Codex / promptfoo（各自补 `MANAGED_CONFIG_IDS` + doctor 断言）
  - **v2b-A 已交付（2026-11-24，SPEC-V2BA-001）**：三个客户端接入封闭枚举，`doctor` 报六态；
    同时补齐 Anthropic Messages 与 OpenAI Responses 两种线格式的投影（此前这两种格式的流量
    **几乎完全不可见**，凭据可径直出境）。能力边界见 `docs/protocol-capability-matrix.md`。
  - **v2b-B 顺延**：计费对账 `report` CLI（阻塞项：官价基准数据源空白）。
  - **v2b-C 顺延**：指纹巡检 + provider 信任分（阻塞项：`llm-fingerprint-detector` 许可未核实，
    且主动探针与"最小暴露"承诺冲突）。
- **验收**：TEST 五件套 `@v2` 项全部 CI 化；金丝雀回流告警 E2E 通过；T2a/T2b 在登记表中的状态由"未缓解"升为"部分/已缓解"（流式已转发字节的边界仍按 REQ §场景 4 承诺，不得回改）

### v2a 登记表加注（S-DOCS 同批订正：AC-V2a-15 / AC-V2a-16⑥⑦）

> 登记表本体 = [REQ] §v1 残余风险登记表；以下为逐字加注的 grep 落点，由 `tests/unit/doc-consistency.test.ts` 把守，措辞与需求文档 AC 行逐字一致。

- T2c 行"缺口理由"加注（AC-V2a-15）：tool-call 参数路径 v1 实际未覆盖，v2a 起覆盖
- T4a 行加注（AC-V2a-16⑥）：链内不落上游自报 `usage` / `cache_reported` 原值（契约 #4 可选位未实装），v2a 判定仅取 `ScanUnit.meta.usage`
- T2c 行能力边界加注（AC-V2a-16⑦）：流式命中在 v1 的 `findings[].offsets` 不可用（网关侧游标双重推进，§5 第四处），v2a 修复后方可作定位取证

## v3 — 策略闭环

- 策略引擎**可配置化**：per-checker `verdict → action` 用户可配（allow/warn/block）+ 全局配置 > 项目级优先级；**新增 `redact`**（非流式改写；流式仍不可执行）
- 防绕过强化：**配置遗漏可见性**（`llmveto audit`，见下方定位说明）+ 配置漂移 doctor 强化 + TLS 拦截模式（`NODE_EXTRA_CA_CERTS` 路线，覆盖无法覆写 baseURL 的客户端）

  > **定位澄清（2026-11-28，delphi 需求评审 R1 三席一致否决后的修订）**：
  > 本项原写作"审计缺口检测（自此才具备发现未过闸流量的能力）"，**该措辞已撤回**。
  >
  > 判据"会话声称有 LLM 工作但网关无流量"要求把网关外的会话与网关内流量对应起来。
  > 实测（2026-11-28）：本机无 `auditd`、无 eBPF 挂载点，**不存在可信遥测源**。
  > 任何基于 agent 日志/进程痕迹/用户自报的检测都可被绕过者规避——那是依赖攻击者配合的假安全。
  >
  > 因此本项降级为**配置遗漏可见性**：用户主动运行 `llmveto audit` 时，报告
  > "你声明在用的 agent 中，哪些在窗口内没有网关流量"。用例是"忘了接入"或"升级后配置漂移"，
  > **不是**防恶意绕过。README 与该行措辞必须同批订正，不得单独修改。
- LiteLLM custom guardrail 适配（企业部署形态，可选）
- XP-Gate Gate LS 对接（evidence 消费：Delphi 评审响应验证、提交来源证据；消费契约 = TEST 契约 #4 `evidence_version` 字段表）
- **验收**：配置漂移在门禁内必被检出；**配置遗漏可见性**（`llmveto audit`）端到端通过；TLS 拦截形态接入 1 个"无法覆写 baseURL"的真实客户端；REQ 目标#1 的覆盖集合扩展至 v3 声明范围

## 与消费方的关系（非本项目范围，仅接口约定）

- XP-Gate：Delphi 调用走网关（v1）；Gate LS 读 evidence（v3，消费接口 = TEST 契约 #4 的 `evidence_version: 1` 字段表）
- OpenCode 插件（可选）：`chat.headers` 注入审计 ID、`experimental.policies` 配合防绕过

## 评审修订记录

| 轮次 | 日期 | 本文档变更（问题 ID 见 `.sprint-state/review/r1-consensus.md`） |
|---|---|---|
| R1 | 2026-09-14 | 验收第 1 条由不可证伪全称命题改写为 (a)(b)(c) 可判定形式（P-03/P-18）；新增第 2 条 Delphi 验收（P-13）、第 5 条 evidence 验收（P-07）；v1 交付补 `verify` + `mock-upstream` + 封闭枚举，消除对 v2/v3 组件的依赖（P-04）；检出/误报/性能量化门槛入验收（P-11）；新增三张前置决策门 G-LIC/G-FP/G-BENCH（P-14/P-02）；v3 措辞澄清"可配置化 + redact 新增"，不再暗示 v3 才有 action（P-06）；总原则补分期纪律（P-04/P-15） |
## 优先级评估：auditd/eBPF vs 剩余 v3

### 结论

**auditd/eBPF 优先于剩余全部 v3 任务。**

### 技术依据（本轮实测）

| 验证项 | 结果 |
|---|---|
| 内核 audit 支持 | ✅ CONFIG_AUDIT=y / CONFIG_AUDITSYSCALL=y |
| auditd 包 | ✅ 可装（1:3.0.7-1ubuntu0.1） |
| 连接目标可区分 | ✅ /proc/net/tcp 能看到 8787（网关）vs 外部 |
| **/proc 轮询方案** | ❌ **致命缺陷**：短连接抓不到（实测连接关闭后立即消失） |

**因此 auditd 是必需的，不是可选的**：只有内核事件流能捕获短连接。
轮询 /proc 会漏掉大量真实请求，那会重演"假检测"的问题——看着在工作，实际漏报。

### 价值排序

| 任务 | 补的是什么 | 优先级 |
|---|---|---|
| **auditd 绕过检测** | **网关能否发现"没拦到的"** | **P0** |
| redact | 已经能拦的基础上做改写 | P2 |
| TLS 拦截 | 扩大覆盖范围 | P2 |
| LiteLLM 适配 | 企业形态 | P3 |
| Gate LS 对接 | 跨项目契约 | P3 |

理由：前四项都是在"已经能拦"之上做加法；auditd 补的是**"能不能发现没拦住"**的根。

### 用户画像支持

需求方明确说明使用者是"自己 + 关注信息安全的人"。这类用户：
- 接受 root 级系统配置
- 理解审计日志的价值
- 不会因为"要装 auditd"而放弃

### 但必须先验证的三个风险

1. **WSL2 兼容性**：auditd 与 AppArmor 已加载的环境可能冲突；systemd 下能否正常启动未验证
2. **日志量**：connect 级审计在高频会话下可能产生大量事件，需要过滤
3. **绕过者若有 root**：能改审计规则——但这与"有 root 就能卸载网关"同级，不构成额外威胁

### 建议路径

先做可行性验证（装 auditd → 加载 connect 规则 → 验证能抓到绕过 → 验证性能），
通过后再进入设计。不通过则明确关闭这条路。

### 绕过检测的最终结论（2026-11-28 实测）

三条技术路径全部评估完毕，**WSL2 上无一可行**：

| 路径 | 结果 | 依据 |
|---|---|---|
| agent 日志 / 用户自报 | ❌ 攻击者可控 | delphi 需求评审 R1 三席一致否决 |
| `/proc` 轮询连接 | ❌ 短连接漏报 | 实测：连接关闭后立即从快照消失 |
| auditd 内核审计 | ❌ **WSL2 内核不允许** | 实测：`sudo auditctl -s` → `Operation not permitted`（即使 root） |

实测细节见 issue #3 的验证结论评论。关键事实：
- auditd 包可装、配置解析通过、服务 enabled，但启动失败
- 启动失败根因 `Error setting audit daemon pid (Operation not permitted)`
- `/proc/self/loginuid` = `4294967295`（-1，audit 子系统未启用）
- 内核版本 `6.18.58.1-microsoft-standard-WSL2`

**因此「绕过检测」在本平台不做。** 这不是"不值得做"，是"当前平台做不到"。

对原生 Linux 用户，auditd 路径仍然可行；若将来有需求，应：
1. 用 `/proc/sys/kernel/osrelease` 检测平台（含 `microsoft` 判为 WSL）
2. 仅原生 Linux 启用审计功能
3. WSL2 上明确报"不可用"，**而不是静默降级成假检测**

当前已交付的 `llmveto audit`（v0.12.0）提供**配置遗漏可见性**，
明确不声称能检测恶意绕过。
