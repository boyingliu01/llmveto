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

## 分发与 runtime 承诺（两个不同的承诺，勿混用）

- **npm/CLI 分发（已交付；本地 link，不经 npm registry）**：`bun run build` 用 `tsc` 产出纯 ESM 的 `dist/`，`package.json` `bin.llmveto` 指向 `dist/cli/index.js`；本地 clone 后 `npm link` 得 `llmveto` 命令，用**自带 Node ≥ 18** 即可运行（详见 [ADR-0001](docs/adr/0001-node-runtime-distribution.md)）。
  `package.json` 保持 `"private": true` 是**有意设置**：v1 不发布到 npm registry（`npm publish` 被 npm 阻断属预期），`npm link` 与本地使用不受影响；转为公开发布前须补齐发布流程与构建门（ADR-0001）。
- **源码运行（开发态）**：`bun run src/cli/index.ts …` 直接跑 `.ts`（Bun 原生）。运行时代码**仅使用 Node 标准库 API**（`node:http` / `node:crypto` / Web Streams），**禁用 Bun-only API**；CI 在 vitest（Node）上执行正是为机器化保证这一约束。
- **单二进制分发（未交付，不在 v1 承诺内）**：`bun build --compile` 打包为免 runtime 的单文件分属 v2 路线候选，v1 不提供该产物、不承诺命令名。

> ⚠️ `.ts` 源码不是 Node 可直接运行的分发物（`.ts` 说明符 / 参数属性 / `import.meta.main` 三处不兼容）——分发必须走 `dist/`，见 ADR-0001。

## 快速开始（安装 · 部署 · 试用）

```bash
# 1) 构建分发物并链接出 llmveto 命令（也可直接用 bun 跑源码，见下）
bun install
bun run build && npm link        # 之后可直接 `llmveto <cmd>`；开发态亦可用 `bun run llmveto <cmd>`

# 2) 配置上游 + 启动后台守护进程（loopback-only，默认 127.0.0.1:8787）
export LLMVETO_UPSTREAM_BASE_URL=https://api.openai.com   # catch-all；或用 LLMVETO_UPSTREAMS 走路由表
llmveto start                    # 派生后台 daemon，立即返回；pid/url/evidence 落在 state 目录

# 3) 让受管客户端的流量经网关（写真实配置文件 baseURL → 网关路由路径）
llmveto doctor --write-managed-config   # 把 OpenCode/Delphi 的受管项指向 http://127.0.0.1:8787/<client>/<provider>
llmveto status                          # running pid=… url=…（真实探活，僵尸 pid 文件会被识别为 not running）

# 4) 试用后审计留痕 + 停止
llmveto verify                          # 校验 evidence SHA-256 链完整性
llmveto stop
```

**路径路由约定**：客户端打 `POST /<client>/<provider>/v1/chat/completions`，网关据此推导 `client`+`provider_id` 身份，再按 `LLMVETO_UPSTREAMS`（JSON 表，键 `"client/provider"` 或 `"client/*"`）解析目标 upstream；未命中回落 `LLMVETO_UPSTREAM_BASE_URL`（catch-all）；皆无则 **fail-closed 返回 502 `llmveto:no-upstream-route`**，不转发。

**环境变量**：

| 变量 | 作用 |
|---|---|
| `LLMVETO_PORT` | 监听端口，默认 `8787`；设 `0` 抢占 ephemeral 端口（实际地址写入 `gateway.url`） |
| `LLMVETO_STATE_DIR` | pid/url/evidence 目录，默认 `~/.llmveto` |
| `LLMVETO_UPSTREAM_BASE_URL` | catch-all 上游 base URL |
| `LLMVETO_UPSTREAMS` | 路径路由表（JSON 对象）；解析失败 → 启动即 fail-fast |
| `LLMVETO_MODELS_SNAPSHOT` | OpenCode 模型目录快照文件；设置后 `GET /opencode/models` 本地伺服（锁定 models URL，P1 缓解） |
| `LLMVETO_GATEWAY_URL` | `doctor` 探活/漂移基准地址，默认 `http://127.0.0.1:8787` |
| `LLMVETO_OPENCODE_CONFIG` / `LLMVETO_DELPHI_CONFIG` | 覆写受管配置文件位置（默认落各客户端真实路径） |

## 开发环境

要求：**Bun ≥ 1.1**（包管理 + 测试/编译驱动）、**Node ≥ 18**（测试运行环境 + 分发物运行）。

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

## CLI

v1 冻结为 5 个命令（未实现的命令不留 stub）。分发物为 `dist/cli/index.js`（`llmveto`）；开发态用 `bun run llmveto <cmd>` 或 `bun run src/cli/index.ts <cmd>`：

```bash
llmveto start      # 启动网关（loopback-only，后台 daemon；开发态：bun run src/cli/index.ts start）
llmveto status     # 查看状态（真实探活，僵尸 pid 文件识别为 not running）
llmveto stop       # 停止后台 daemon
llmveto doctor     # 受管配置枚举的覆写/漂移断言 + 端口连通 + evidence 链；--write-managed-config 写真实配置
llmveto verify     # evidence 链完整性 + schema 断言
```

`report`（计费对账）与 `canary rotate`（金丝雀轮换）属 v2。`doctor` 的 v1 检查项为**封闭枚举**（受管配置覆写/漂移断言 + 端口连通 + `--write-managed-config` + evidence 链可验证），权威清单见 DESIGN §组件 5；TLS/CA 信任检查项随 TLS 拦截能力（v3）才引入，**v1 不注册该检查项**（不放恒空的检查项）。

## 状态

v1 产品外壳已补齐（M1–M3）：真实路径路由、adapters 真实读写配置 + doctor 真漂移、可移植 dist 分发（ADR-0001）、后台 daemon 生命周期、CLI 黑盒冒烟 + daemon 生命周期 E2E。安全内核（反代核 / checker / fail-closed / evidence 链）自 v0.1 即真实。版本 `0.2.0`。详见 [ROADMAP](docs/issues/5-roadmap.md)。
