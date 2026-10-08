# 依赖许可核实台账（G-LIC 前置门）

> 关闭条件：v1 引入任何外部数据/代码前，本文件必须存在**已核实**的许可结论。
> 未核实 = 不引入运行时依赖，改走"离线生成产物入仓"路线。

## 复用条目逐项结论

| # | 能力 | 项目 | 上游许可 | 核实来源 | v1 结论 | 处置 |
|---|---|---|---|---|---|---|
| 1 | egress 凭据规则集 | gitleaks | BUSL-1.1（自 2023 起） | [gitleaks/LICENSE](https://github.com/gitleaks/gitleaks/blob/master/LICENSE) | ❌ **不合规**：BUSL 非 OSI 认证，商用改动条款需律师审 | **走 G-LIC 回退路径**：自建 top-N 高置信凭据模式（见下），REQ 登记表 T1b 行标注覆盖面缩小 |
| 2 | 模型指纹检测 | llm-fingerprint-detector | 待核实（BUILD 前） | — | **v2 才使用**，v1 不引入 | v2 前完成核实；不阻塞 v1 |
| 3 | 恶意对手样本生成 | fpverify | **MIT**（2026-09-29 核实，见下「v2a G-RELAY 结论」节） | [fpverify/LICENSE](https://github.com/Mohamed7415/fpverify/blob/main/LICENSE) | **v1 用作离线 fixture 生成器**（不入 CI 依赖），YAML 产物入仓 | v1 只需 YAML 数据形态；**v2a G-RELAY 已闭合：可复用**（见下） |
| 4 | prompt 金丝雀 | canari-llm | PyPI 待核实 | — | v2 TS 重实现，不引依赖 | 不阻塞 v1 |
| 5 | 凭据蜜罐 | snare | Go, MIT (README 声明) | — | 文档级引用，不整合代码 | 无许可成本 |
| 6 | 观测型代理架构 | cctrace / argus / claude-tap | 各自 README | — | 思想借鉴，不引代码 | 无许可成本 |

## 回退方案：自建 top-N 高置信凭据模式

G-LIC 不通过后采用。模式列表（写死在 `src/checkers/egress-secret-scan.ts`）：

| Rule ID | 目标 | 正则（简化，实际见代码） | 来源 |
|---|---|---|---|
| `openai-sk` | OpenAI API key | `sk-[A-Za-z0-9]{20,}` | 公开文档格式 |
| `anthropic-sk-ant` | Anthropic API key | `sk-ant-[A-Za-z0-9_-]{20,}` | 公开文档格式 |
| `github-ghp` | GitHub personal access token | `ghp_[A-Za-z0-9]{36}` | 公开文档格式 |
| `aws-akia` | AWS Access Key ID | `AKIA[0-9A-Z]{16}` | 公开文档格式 |
| `pem-private-key` | PEM 私钥块 | `-----BEGIN [A-Z ]*PRIVATE KEY-----` | PEM 标准 |

覆盖面缩小声明（同步落入 REQ 登记表 T1b 行）：

- 只覆盖上述 **5 类模式化凭据**；
- 自写 token / 内网 URL / 客户数据 / 变形 base64/hex **一律漏检**；
- v2 计划扩展自定义模式库。

## 判定与留痕

- 判定日期：2026-09-15
- 判定人：Sprint orchestrator
- 依据：DESIGN §组件2 与 REUSE §egress 密钥规则 行了了可查

## v2a G-RELAY 结论（2026-09-29）

- 对象：fpverify（https://github.com/Mohamed7415/fpverify），复用面 = `sim/adversaries.py` 的 9 对手（honest / drift / quantized / swap / pin / filter_en / true_random / cache / partial_mimic）**行为语义**。
- 许可：**MIT** —— 版权行 `Copyright (c) 2026 Mohamed7415 and fpverify contributors`。
- 核实方式：GitHub API `repos/Mohamed7415/fpverify`（`license.spdx_id = MIT`）+ LICENSE 原文逐行核对，核实日期 2026-09-29。
- 结论：**可复用** → SL-13 `estimate.chosen = "reusable"`：fpverify 9 对手行为移植为 TS 对手模板 + 自补 4 类 T2 对手（合计 13，对齐设计 §8.3 清单）；not_reusable 分支（按论文自建 + README 覆盖面声明）不触发。
- 义务与边界：
  - 移植产物（对手模板及派生 fixture）随仓库分发时须保留上游 MIT 归属——版权行 + 本节链接；
  - 移植的是行为语义与对抗策略，**非运行时依赖**：零 Python 约束（REUSE §fpverify）不变；
  - 自补 4 类 T2 对手为原创，无上游许可义务。
- 判定人：Sprint orchestrator（Phase 3 BUILD 第一切片前，manifest `build_entry_gates.G-RELAY`）
