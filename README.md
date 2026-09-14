# llmveto

本地 LLM 流量安全网关 daemon — 让 agent 与 LLM API 之间的**所有**流量可验证、可阻断、可审计。

> 背景：第三方中转站对 coding agent 构成系统性威胁（UCSB 实测 428 个中转站中 9 个向 tool-call 注入恶意代码；CISPA 实测 45.83% 端点模型指纹不过关）。
> 现有工具两极分化：观测型代理不验证不阻断，agent 执行防火墙看不见 LLM 流量。
> **llmveto 填补的空白 = LLM 流量层的确定性验证 + fail-closed 阻断。**

## 文档

| 文件 | 内容 |
|---|---|
| [docs/issues/1-req-threat-model.md](docs/issues/1-req-threat-model.md) | 原始需求与威胁模型（T1–T4 / P1–P2） |
| [docs/issues/2-design-v1.md](docs/issues/2-design-v1.md) | 架构设计 v1 — 反代核 + checker 注册表 + fail-closed 策略 |
| [docs/issues/3-reuse-list.md](docs/issues/3-reuse-list.md) | 复用与集成清单（不从头造轮子） |
| [docs/issues/4-test-validation.md](docs/issues/4-test-validation.md) | 验证方案 — 可测试性契约 + evil-relay 五件套 |
| [docs/issues/5-roadmap.md](docs/issues/5-roadmap.md) | v1/v2/v3 分期路线与硬验收门槛 |

## 架构（v1）

```
OpenCode / Claude Code / Codex / Delphi / promptfoo
        │  baseURL 覆写（或 HTTPS_PROXY + CA 拦截）
        ▼
   [反代核] ──SSE tee 零缓冲──▶ 客户端
        │
        ▼
   [checker 注册表] → [策略引擎 allow/warn/redact/block] → upstream（TLS）
        │
        ▼
   evidence store（append-only JSONL + SHA-256 哈希链）
```

## 开发环境

要求：**Bun ≥ 1.1**（包管理 + daemon 运行时 + 单二进制编译）、**Node ≥ 18**（测试运行环境）。

| 命令 | 用途 |
|---|---|
| `bun install` | 安装依赖 |
| `bun run test` | 全量测试（vitest on Node） |
| `bun run test:coverage` | 测试 + 覆盖率门禁（阈值 80%，CI 与 pre-commit 钩子使用） |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint` | oxlint |

> **测试跑 vitest，不跑 `bun test`**：全局 xp-gate pre-commit 钩子对 TypeScript 项目固定执行
> `npx vitest run --coverage <changed tests>`，并要求 `coverage/coverage-summary.json`。
> 统一用 vitest 可避免本地绿、提交红的分裂，同时顺带验证"兼容 Node ≥ 18"这条设计约束。

## CLI

```bash
bun run src/cli/index.ts start      # 启动网关
bun run src/cli/index.ts status     # 查看状态
bun run src/cli/index.ts stop       # 停止
bun run src/cli/index.ts doctor     # 配置漂移 / 端口 / CA 自检
```

## 状态

v1 MVP 开发中，见 [ROADMAP](docs/issues/5-roadmap.md)。
