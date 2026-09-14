# [REUSE] 复用与集成清单 — 竞对分析结论（不从头造轮子）

> 来源: https://github.com/boyingliu01/llmveto/issues/3
> 本文档已经过 delphi-review R1 修订（2026-09-14）：每项补"许可核实状态 + 运行时依赖 + 期次"，并把 Python 依赖逐出 v1 测试栈。

## 原则

不从头造轮子：转发/捕获/指纹等已有成熟实现的能力直接整合或吸收；自建增量只做"无人做"的部分（确定性验证管线 + checker 注册表 + fail-closed 策略 + 证据链）。

**许可与运行时纪律（R1 新增）**：任何"复用"在写入 v1 代码前必须先在 `docs/licenses.md` 落一条**已核实**的结论（不是"看起来是 MIT"）。未核实 = 不自建依赖、不引入运行时，改走"离线生成产物入仓"路线。

## 已确认可整合的轮子

| 能力 | 项目 | 期次 | 许可核实 | 运行时依赖 | 整合方式 |
|---|---|---|---|---|---|
| 模型指纹检测（T3a 实质） | [llm-fingerprint-detector](https://github.com/ToseaAI/llm-fingerprint-detector)（TS 零依赖） | **v2** | ⚠️ 待核实（BUILD 前） | 无（TS） | npm 依赖集成 → 封装为 `fingerprint-probe` checker；自带 11 个模型参考库与 CI 退出码；抗过滤改写探针、split-half 自洽检查。**v1 不含**：v1 的 `model-label-consistency` 只做字段一致性，不证明模型真实性（见 REQ 登记表 T3a 行） |
| 恶意中转对手样本 | [fpverify](https://github.com/Mohamed7415/fpverify) `sim/adversaries.py` | **离线工具（非 CI 依赖）** | ⚠️ 待核实 | **Python（仅开发者机器）** | **不引入 Python 运行时到测试栈**：作为离线 fixture 生成器跑一次，9 种对手（honest/drift/quantized/swap/pin/filter_en/true_random/cache/partial_mimic）产出为 YAML 响应样本入仓 `tests/fixtures/adversarial/`；CI 只消费 YAML + mock-upstream |
| 序贯检验思想 | fpverify e-process（FPR≤1%，任意停机点有效） | v2 | n/a（思想） | 无 | 指纹巡检的统计判定方法（连续低频审计优于固定样本重复检验） |
| prompt 金丝雀 | [canari-llm](https://pypi.org/project/canari-llm/)（Python） | **v2** | ⚠️ 待核实 | 无（TS 重实现） | 逻辑重实现吸收（TS ~200 行）：高熵 token 生成 + 子串匹配 + 注册表 + 轮换 + 告警；构造上零误报。**v1 无金丝雀 → T1a 零检测**（REQ 登记表） |
| egress 密钥规则 | [gitleaks](https://github.com/gitleaks/gitleaks) 规则集 | **v1** | ❌ **未核实**（原"MIT"断言无出处；gitleaks 仓库曾长期使用 BUSL，规则文件许可需逐文件确认） | 无（仅取规则数据） | 走 ROADMAP **G-LIC 前置门**：核实通过 → 规则文件转换进 checker；不通过 → **自建 top-N 高置信凭据模式**（OpenAI `sk-…` / Anthropic `sk-ant-…` / GitHub `ghp_…` / PEM 私钥块 / AWS `AKIA…`），并在 REQ 登记表 T1b 行标注覆盖面缩小 |
| slopsquatting/执行防线 | [nah](https://github.com/manuelschipper/nah) + [airlock](https://github.com/cjaston/airlock) | 文档 | 不需要（不引代码） | 无 | **不整合进网关**（不同执行点：tool 调用层 vs 流量层）；作为平面 B 外围选件写入部署文档（v1 部署文档必须写，因为 v1 不缓解 T2a） |
| 凭据蜜罐 | [snare](https://github.com/peg/snare)（Go） | 文档 + 配套 | 不需要 | 独立进程 | 独立部署配套，写进部署指南；其 `openai`/`anthropic` BASE_URL 型蜜罐与网关天然协同（可部分补偿 v1 的 T1a 检测缺失，但不计入 v1 验收） |
| 企业形态 | LiteLLM custom guardrail | v3 可选 | ⚠️ 待核实 | 重（DB） | checker 包适配其接口，非核心路径 |

## 架构思想借鉴（不引代码，无许可成本）

- cctrace：TLS + tee 零缓冲转发 + **单一脱敏咽喉点**（所有 sink 前统一脱敏）+ 一方主机才解密的范围模型 → **v1 只吸收 tee 零缓冲与脱敏咽喉点；TLS 解密范围模型属 v3**
- claude-tap：forward/reverse 双模式（baseURL 客户端走反向代理，其余走 HTTPS_PROXY+CA）→ v1 仅 reverse/baseURL 模式
- fpverify：指纹是条件分布（model × channel × protocol），参考基线必须同协议采集（v2 巡检设计约束）
- llm-verify：证据不足时 fail-closed 判决（探针失败不产生 clean verdict）→ **v1 采纳**：`verdict=error → action=block`，且扫描超时必须 block（见 DESIGN §性能预算与降级规则）

## 明确不整合（及理由）

- **ai-guard 核心**：用 LLM 异步审计存在信任悖论（审计流量本身可能被投毒）；无确定性检查、无 fail-closed
- **LiteLLM 作核心转发层**：依赖重（DB）、DB-less 时预算 fail-open；自建薄反代 ~1-2k LOC 可控
- 观测型代理代码（cctrace/argus/claude-tap）：照抄架构思想，不引依赖
- 账号路由/计费面板类功能：非目标（见 REQ issue）

## 命名查重记录（2026-09-10，gh api search/repositories in:name）

- 已占用排除：llmgate（×4，且 LLMGates.com 本身是中转站）、gatehouse（agent 秘密保险库）、verigate（OAuth）、relay 系（拥挤）、watchgate/modelgate/veriguard/llmfence/llmvet/vetgate/agentgate/llmwatch/agentveto 均占用
- **llmveto / llmborder / vetogate / llmlock 零冲突，选定 llmveto**

## 评审修订记录

| 轮次 | 日期 | 本文档变更（问题 ID 见 `.sprint-state/review/r1-consensus.md`） |
|---|---|---|
| R1 | 2026-09-14 | 表格补"期次 / 许可核实状态 / 运行时依赖"三列（P-14）；gitleaks "MIT" 断言降级为未核实并挂 G-LIC 门 + 自建回退方案（P-14）；fpverify 由"测试床直接复用"改为离线 fixture 生成器，逐出 CI（P-14/P-04）；指纹检测与金丝雀明确标注 v1 不含（P-05/P-12）；架构借鉴条目标注 v1/v3 吸收边界（P-17） |

