# [ROADMAP] v1/v2/v3 分期路线

> 来源: https://github.com/boyingliu01/llmveto/issues/5

## 总原则

v1 先保证**流量 100% 过闸**（哪怕验证逻辑最简），v2 加深验证能力，v3 闭环策略。每期有硬验收标准，达标才进下一期。

## v1 — 流量覆盖优先（MVP）

- 反代核：反向代理模式 + SSE tee 零缓冲 + 单一脱敏咽喉点 + upstream 配置注入
- evidence store：append-only JSONL + SHA-256 哈希链
- checkers：`model-field-consistency` / `invisible-unicode-scan` / `egress-secret-scan`（gitleaks 规则）
- 接入：OpenCode（provider baseURL）+ Delphi（.delphi-config endpoint 覆写）
- CLI：`start/stop/status/doctor`
- **验收**：OpenCode 全部 provider 流量过闸（doctor 可证明）；3 个 checker 正负 fixture 全绿；block 路径 fail-closed E2E 通过；TTFT 增量 p95 < 5ms

## v2 — 验证加深

- checkers：`thinking-signature-presence` / `tool-call-shape` / `usage-reconcile`
- 金丝雀引擎（TS 重实现 canari 逻辑）+ `canary rotate` CLI
- 指纹巡检：集成 llm-fingerprint-detector，周期探针 + provider 信任分（fpverify 序贯检验判定）
- 计费对账报告（usage×官价 vs 中转账单差值）+ provider 健康监测（错误率/超时趋势）
- evil-relay 模拟器 + 双矩阵 CI 全量落地
- 接入扩展：Claude Code / Codex / promptfoo
- **验收**：TEST issue 五件套全部 CI 化；金丝雀回流告警 E2E 通过

## v3 — 策略闭环

- 策略引擎完善：per-checker verdict 动作（allow/warn/redact/block）、全局配置 > 项目级优先级
- 防绕过强化：审计缺口检测 + 配置漂移 doctor 强化 + TLS 拦截模式（NODE_EXTRA_CA_CERTS 路线，覆盖无法覆写 baseURL 的客户端）
- LiteLLM custom guardrail 适配（企业部署形态，可选）
- XP-Gate Gate LS 对接（evidence 消费：Delphi 评审响应验证、提交来源证据）
- **验收**：配置漂移在门禁内必被检出；审计缺口告警端到端通过

## 与消费方的关系（非本项目范围，仅接口约定）

- XP-Gate：Delphi 调用走网关；Gate LS 读 evidence（消费接口 = evidence schema，见 TEST 契约 #4）
- OpenCode 插件（可选）：`chat.headers` 注入审计 ID、`experimental.policies` 配合防绕过

