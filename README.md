# llmveto

本地 LLM 流量安全网关 daemon — 让 agent 与 LLM API 之间**经由已支持接入路径重定向的**流量可验证、可阻断、可审计。

> 背景：第三方中转站对 coding agent 构成系统性威胁（UCSB 实测 428 个中转站中 9 个向 tool-call 注入恶意代码；CISPA 实测 45.83% 端点模型指纹不过关）。
> 现有工具两极分化：观测型代理不验证不阻断，agent 执行防火墙看不见 LLM 流量。
> **llmveto 填补的空白 = LLM 流量层的确定性验证 + fail-closed 阻断。**

## v1 能做什么、不能做什么（必读）

| | v1（当前） |
|---|---|
| **提供** | 出站凭据拦截（T1b，`block`）· 隐形字符检测（T2c，非流式阻断 / 流式终止）· 模型**字段一致性**告警（T3a 子集）· 受管路径过闸 · 全量 evidence 留痕 + `llmveto verify` |
| **不提供** | 数据外泄检测（T1a，金丝雀属 v2）· tool-call 注入防护（T2a，RCE 级，v2）· 响应注入防护（T2b，v2）· 模型**真实性**证明（v2 指纹）· usage 对账（T4x，v2）· 旁路发现（v3）· TLS 拦截（v3） |
| **阻断粒度** | 流式响应已开始转发的字节**不可撤回**；v1 的流式阻断 = 终止流，不是吞掉字节 |

完整口径见 [REQ §v1 残余风险登记表](docs/issues/1-req-threat-model.md)。**装上网关 ≠ 已被保护**：未接入客户端的流量在 v1 完全不受管。

## 文档

| 文件 | 内容 |
|---|---|
| [docs/issues/1-req-threat-model.md](docs/issues/1-req-threat-model.md) | 原始需求与威胁模型（T1–T4 / P1–P2）+ **§裁决与动作语义**（verdict/action 术语、行为矩阵、evidence 信任边界）+ **§v1 残余风险登记表** |
| [docs/issues/2-design-v1.md](docs/issues/2-design-v1.md) | 架构设计 v1 — 反代核 + checker 注册表 + fail-closed 策略 + 扫描单元 + 三台性能门 |
| [docs/issues/3-reuse-list.md](docs/issues/3-reuse-list.md) | 复用与集成清单（含许可核实状态与运行时依赖） |
| [docs/issues/4-test-validation.md](docs/issues/4-test-validation.md) | 验证方案 — 可测试性契约 + 五件套（逐项 `@v1/@v2/@v3`）+ evidence 字段表 |
| [docs/issues/5-roadmap.md](docs/issues/5-roadmap.md) | v1/v2/v3 分期路线；**v1 验收条目的唯一权威清单** |
| [docs/delphi-panel.md](docs/delphi-panel.md) | 评审专家团配置（opencode + example-provider 三模型） |

## 架构（v1）

```
OpenCode / Delphi(XP-Gate)          ── v1 接入（baseURL / .delphi-config 覆写）
Claude Code / Codex / promptfoo     ── v2 接入
无法覆写 baseURL 的工具              ── v3 接入（HTTPS_PROXY + NODE_EXTRA_CA_CERTS TLS 拦截）
        │
        ▼  仅 v1/v2：loopback baseURL 反向代理（v1 不实现 TLS 拦截）
   [反代核] ──SSE tee 零缓冲──▶ 客户端
        │        ▲
        │        └── 流式命中违规 = 注入 error 事件 + 终止流（已转发字节不撤回）
        ▼
   [checker 注册表 verdict] → [策略引擎 action: allow/warn/block（redact 属 v3）] → upstream（TLS）
        │
        ▼
   evidence store（append-only JSONL + SHA-256 链；链只防意外损坏与廉价篡改，
   不抵抗本机同权限对手整链重写）  ← llmveto verify 校验
```

## 开发环境

要求：**Bun ≥ 1.1**（包管理 + 测试/编译驱动）、**Node ≥ 18**（测试运行环境）。

| 命令 | 用途 |
|---|---|
| `bun install` | 安装依赖 |
| `bun run test` | 全量测试（vitest on Node） |
| `bun run test:coverage` | 测试 + 覆盖率门禁（阈值 80%，CI 与 pre-commit 钩子使用） |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint` | oxlint |

> **测试跑 vitest，不跑 `bun test`**：全局 xp-gate pre-commit 钩子对 TypeScript 项目固定执行
> `npx vitest run --coverage <changed tests>`，并要求 `coverage/coverage-summary.json`。
> 统一用 vitest 可避免本地绿、提交红的分裂，同时顺带验证运行时的 Node 兼容性。

## 分发与 runtime 承诺（两个不同的承诺，勿混用）

- **官方分发**：`bun build --compile` 产出的单二进制，用户无需安装任何 runtime。
- **源码运行**：运行时代码**仅使用 Node 标准库 API**（`node:http` / `node:crypto` / Web Streams），**禁用 Bun-only API**；因此可用自带 Node ≥ 18 跑源码。CI 在 vitest（Node）上执行正是为了机器化保证这一约束。

## CLI

v1 冻结为 5 个命令（未实现的命令不留 stub）：

```bash
bun run src/cli/index.ts start      # 启动网关（loopback-only）
bun run src/cli/index.ts status     # 查看状态
bun run src/cli/index.ts stop       # 停止
bun run src/cli/index.ts doctor     # 受管配置枚举的覆写/漂移断言 + 端口连通 + --write-managed-config
bun run src/cli/index.ts verify     # evidence 链完整性 + schema 断言
```

`report`（计费对账）与 `canary rotate`（金丝雀轮换）属 v2。`doctor` 的 CA 信任检查项随 TLS 拦截（v3）才有意义，v1 输出 `not-applicable@v1` 而非"通过"。

## 状态

v1 MVP 开发中，见 [ROADMAP](docs/issues/5-roadmap.md)。需求/设计文档已通过 delphi-review R1 评审修订（`.sprint-state/review/r1-consensus.md`）。
