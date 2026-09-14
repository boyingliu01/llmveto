# [TEST] 验证方案 — 可测试性契约 + evil-relay 验证五件套

> 来源: https://github.com/boyingliu01/llmveto/issues/4

## 原则

安全能力不可验证 = 不存在。验证方案独立成文（VALIDATION.md），但以下可测试性契约必须在架构设计期固化——**可测试性无法事后补**。

## 可测试性契约（进架构，见 DESIGN issue）

1. **upstream 可替换**：网关上游端点为配置注入接口，测试时可指向 mock 服务器喂任意（恶意）响应
2. **checker = 纯函数**：输入请求/响应片段，输出 verdict + evidence；可独立单测、可表驱动
3. **fixture schema（声明式）**：

```yaml
id: T3a-model-swap-01
threat: T3a            # 威胁类型编号（对齐 REQ issue 威胁模型）
transport: stream      # stream | non-stream
upstream_response:     # 恶意上游返回的内容（喂给 mock upstream）
  ...
expected:
  checker: model-field-consistency
  verdict: block       # allow | warn | redact | block
```

4. **evidence schema**：审计记录结构化，断言可编程（CI 直接查 JSONL 字段）

## 验证五件套

### 1. 威胁样本库

每个威胁类型（T1b/T2a/T2b/T2c/T3a/T4a/T4b…）≥3 个正样本 + benign 语料库作负样本。来源：

- UCSB 论文公开的 payload 模式（tool-call 注入、依赖定向）
- hub.linux.do 中转站取证事件复现（隐形字符 U+200B/FEFF 指纹、trace:UUID 跨会话追踪、max_tokens 20→300 篡改）
- fpverify 9 种对手响应（swap/quantize/cache/filter 等）
- 自录真实 agent 会话（脱敏后作 benign 负样本——误报率考核）

### 2. evil-relay 模拟器

本地恶意中转模拟器（docker 一键起）：复用 fpverify `sim/adversaries.py` 9 对手 + 自补 T2 类（tool-call 注入、第 N 次请求条件投递、隐形字符水印、假缓存字段）。所有集成测试/E2E 的上游。

### 3. 双矩阵回归（CI 强制）

- **检出矩阵**：正样本 × checker → 预期 verdict；统计每威胁类型检出率
- **误报矩阵**：benign 语料全量过 checker → 误报率；基线/白名单机制调优
- **合并门槛**：新增 checker 必须携带正负 fixture，否则 PR 不合并

### 4. 端到端演练

OpenCode + Delphi 穿 evil-relay 全链路：告警/阻断/审计落盘/doctor 漂移检测逐项断言。

### 5. 性能与防绕过回归

- 流式 TTFT 增量 p95 < 5ms（每次 PR 跑基准，回退阻断合并——网关太慢会被用户绕过，性能即安全属性）
- 配置漂移检测测试（客户端配置被改走 → doctor 必须报）
- 审计缺口检测测试（声称有 LLM 工作、网关无流量 → 必须告警）
- 金丝雀专项：注入位置覆盖（system/tool/RAG 区）+ 回流告警 E2E + 轮换验证

## CI 结构

```
单测（checker 表驱动） → 集成（网关 × mock upstream × fixture 集） → E2E（nightly：真实 OpenCode/Delphi × evil-relay） → 性能基准（每 PR）
```

