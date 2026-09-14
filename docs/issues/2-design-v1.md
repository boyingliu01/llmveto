# [DESIGN] 架构设计 v1 — 反代核 + checker 注册表 + fail-closed 策略

> 来源: https://github.com/boyingliu01/llmveto/issues/2

## 定位

独立本地网关 daemon（不是 IDE 插件、不是 XP-Gate 模块）。任何 LLM 客户端通过标准重定向点接入；XP-Gate 是消费者（Delphi 调用走网关、质量门禁读取 evidence），不是宿主。

## 架构

```
OpenCode(主agent+subagents+skills) ─┐
Claude Code / Codex / Qoder ────────┤→ [反代核] → [checker 注册表] → [策略引擎] → upstream
Delphi(.delphi-config) ─────────────┤       │
promptfoo ──────────────────────────┘       ▼
                              evidence store (append-only JSONL + 哈希链)
```

### 组件

1. **反代核**：反向代理（baseURL 模式）+ TLS 拦截（CONNECT/HTTPS_PROXY 模式）双形态；SSE 流式 tee（零缓冲——客户端立即收字节，验证按 checker 声明同步/异步）；**单一脱敏咽喉点**（所有日志 sink 前统一脱敏）；upstream 端点配置注入（可测试性契约 #1）
2. **checker 注册表**：checker = 纯函数 `(请求/响应片段) → verdict + evidence`，声明同步/异步、作用于流式/非流式（可测试性契约 #2）。v1 内置：
   - `model-field-consistency`：响应 model 字段 vs 请求一致性（T3a）
   - `invisible-unicode-scan`：流式 chunk 扫 U+200B/U+FEFF/RTL override（T2c）
   - `egress-secret-scan`：出站密钥模式扫描（复用 gitleaks 规则，T1b）
   v2 增加：`thinking-signature-presence`（T3a 证伪）/ `tool-call-shape`（T2a）/ `usage-reconcile`（T4a）
3. **策略引擎**：每 checker 可配动作（allow/warn/redact/**block**）；block = fail-closed（对客户端返回错误 + 记 evidence）；全局配置优先于项目级配置（防仓库级劫持）
4. **evidence store**：append-only JSONL，SHA-256 链式哈希；含请求/响应元数据、checker verdicts、canary 状态、usage、时延
5. **CLI**：`llmveto start/stop/status`、`doctor`（配置漂移检测：客户端配置是否仍指向网关、CA 信任、端口连通）、`report`（计费对账/provider 健康趋势）、`canary rotate`

### 接入适配器（100% 流量覆盖的路径清单）

| 客户端 | 接入方式 |
|---|---|
| OpenCode | `provider.<id>.options.baseURL` 指向网关；`OPENCODE_MODELS_URL` 锁本地模型目录镜像 |
| Claude Code | `ANTHROPIC_BASE_URL` |
| Codex CLI | `~/.codex/config.toml` model_providers base_url |
| Delphi (XP-Gate) | `.delphi-config.json` endpoint 覆写 |
| promptfoo | baseURL 配置 |
| 无法覆写 baseURL 的工具 | `HTTPS_PROXY` + `NODE_EXTRA_CA_CERTS` TLS 拦截模式 |

### 关键决策

- 回环段（客户端→网关）HTTP 明文可接受（loopback-only 监听）；网关→upstream 必须 TLS
- **性能预算**：流式首字节增量 p95 < 5ms（tee 零缓冲）；checker 超预算 → 降级为异步记录+告警，绝不阻塞流——网关太慢会被用户绕过，性能即安全属性
- **fail-closed 语义**仅安全类 checker 适用；观测类失败降级为记录，不阻断
- **防绕过（best-effort，军备竞赛性质）**：doctor 配置漂移检测 + 审计缺口检测（会话声称有 LLM 工作但网关无对应流量 → 告警）；OpenCode 侧配合 `experimental.policies`（provider.use deny，全局优先）+ managed config
- 技术栈：TypeScript + Bun 运行时（兼容 Node ≥ 18）；单二进制分发目标

## 验收标准

- [ ] OpenCode 全部 provider 流量经网关（doctor 可证明）
- [ ] 每个 v1 checker 有正负 fixture 回归（见 TEST issue）
- [ ] block 路径 fail-closed 端到端演练通过
- [ ] 流式 TTFT 增量 p95 < 5ms

