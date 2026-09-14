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

## 为什么是本项目（市场空白）

GitHub 同类项目两极分化（2026-09 调研，详见 [REUSE] issue）：

- **观测型本地代理**（cctrace/argus/claude-tap/ai-guard 等 7 个）：看得见流量但**不验证、不阻断**；ai-guard 用 LLM 异步审计存在信任悖论（审计流量本身可能被投毒）
- **Agent 执行防火墙**（nah/airlock/AgentShield/nixis）：拦 tool 调用但**看不见 LLM 流量**
- **模型真实性检测**（llm-fingerprint-detector/fpverify 等）：单件成熟但只是离线 CLI，不在流量路径上

**空白 = LLM 流量层的确定性验证 + fail-closed 阻断。** 验证所需三件单件（指纹检测/金丝雀/usage 对账）都有成熟实现，缺的是组装到流量路径上并强制执行。

## 目标

在开发者本机运行一个安全网关 daemon，使 agent 与 LLM API 之间的**所有**流量：

1. **全量过闸**：通过各客户端的 baseURL/proxy 标准重定点接入（OpenCode/Claude Code/Codex/Delphi/promptfoo）
2. **逐请求确定性验证**：checker 注册表，可插拔扩充，先覆盖已知威胁类型
3. **违规可阻断**：fail-closed 策略（区别于质量门禁的 SKIP 语义——安全检查失败不允许放行）
4. **全量审计留痕**：append-only 证据链，支撑门禁集成/计费对账/事后取证

## 非目标

- 不阻止上游记录/训练数据（理论不可行；靠最小暴露 + 金丝雀检测缓解）
- 不做模型路由/账号池/计费系统（那是中转站的事，本项目是它的对立面）
- 不做通用 WAF/杀毒；范围限于 LLM API 流量
- 不承诺检出所有条件投递（持续监测提高攻击成本，非根除）
- 不防"完全沦陷的 agent 自改配置绕过网关"（best-effort 防绕过，见 DESIGN）

## 关联 issue

- 架构设计：[DESIGN] 架构设计 v1
- 复用与集成清单：[REUSE] 复用与集成清单
- 验证方案：[TEST] 验证方案
- 路线图：[ROADMAP] v1/v2/v3 分期路线

