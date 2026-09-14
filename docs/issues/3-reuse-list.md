# [REUSE] 复用与集成清单 — 竞对分析结论（不从头造轮子）

> 来源: https://github.com/boyingliu01/llmveto/issues/3

## 原则

不从头造轮子：转发/捕获/指纹等已有成熟实现的能力直接整合或吸收；自建增量只做"无人做"的部分（确定性验证管线 + checker 注册表 + fail-closed 策略 + 证据链）。

## 已确认可整合的轮子

| 能力 | 项目 | 整合方式 |
|---|---|---|
| 模型指纹检测（T3a） | [llm-fingerprint-detector](https://github.com/ToseaAI/llm-fingerprint-detector)（TS 零依赖） | **npm 依赖集成** → 封装为 `fingerprint-probe` checker；自带 11 个模型参考库与 CI 退出码；抗过滤改写探针、split-half 自洽检查 |
| 恶意中转模拟器 | [fpverify](https://github.com/Mohamed7415/fpverify) `sim/adversaries.py` | **测试床直接复用**：9 种对手（honest/drift/quantized/swap/pin/filter_en/true_random/cache/partial_mimic），补 T2 类攻击 |
| 序贯检验思想 | fpverify e-process（FPR≤1%，任意停机点有效） | 指纹巡检的统计判定方法（连续低频审计优于固定样本重复检验） |
| prompt 金丝雀 | [canari-llm](https://pypi.org/project/canari-llm/)（Python） | **逻辑重实现吸收**（TS ~200 行）：高熵 token 生成 + 子串匹配 + 注册表 + 轮换 + 告警；构造上零误报 |
| egress 密钥规则 | [gitleaks](https://github.com/gitleaks/gitleaks) 规则集 | 规则文件复用（MIT），格式转换到 checker |
| slopsquatting/执行防线 | [nah](https://github.com/manuelschipper/nah) + [airlock](https://github.com/cjaston/airlock) | **不整合进网关**（不同执行点：tool 调用层 vs 流量层）；作为平面 B 外围选件写入部署文档 |
| 凭据蜜罐 | [snare](https://github.com/peg/snare)（Go） | **独立部署配套**，写进部署指南；其 `openai`/`anthropic` BASE_URL 型蜜罐与网关天然协同 |
| 企业形态 | LiteLLM custom guardrail | v3 可选：checker 包适配其接口，非核心路径 |

## 架构思想借鉴（不引代码）

- cctrace：TLS + tee 零缓冲转发 + **单一脱敏咽喉点**（所有 sink 前统一脱敏）+ 一方主机才解密的范围模型
- claude-tap：forward/reverse 双模式（baseURL 客户端走反向代理，其余走 HTTPS_PROXY+CA）
- fpverify：指纹是条件分布（model × channel × protocol），参考基线必须同协议采集
- llm-verify：证据不足时 fail-closed 判决（探针失败不产生 clean verdict）

## 明确不整合（及理由）

- **ai-guard 核心**：用 LLM 异步审计存在信任悖论（审计流量本身可能被投毒）；无确定性检查、无 fail-closed
- **LiteLLM 作核心转发层**：依赖重（DB）、DB-less 时预算 fail-open；自建薄反代 ~1-2k LOC 可控
- 观测型代理代码（cctrace/argus/claude-tap）：照抄架构思想，不引依赖
- 账号路由/计费面板类功能：非目标（见 REQ issue）

## 命名查重记录（2026-09-10，gh api search/repositories in:name）

- 已占用排除：llmgate（×4，且 LLMGates.com 本身是中转站）、gatehouse（agent 秘密保险库）、verigate（OAuth）、relay 系（拥挤）、watchgate/modelgate/veriguard/llmfence/llmvet/vetgate/agentgate/llmwatch/agentveto 均占用
- **llmveto / llmborder / vetogate / llmlock 零冲突，选定 llmveto**

