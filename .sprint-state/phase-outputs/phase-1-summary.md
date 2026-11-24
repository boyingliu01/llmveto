# Phase 1/6 PREP 小结 — llmveto v2b 线 A（多客户端接入）

- Sprint: `sprint-20261124-54` / 分支 `sprint/2026-11-24-01`（自 `main` @ `38c3a1a` 切出）
- Worktree: `.worktrees/sprint/sprint-2026-11-24-01`（`.worktrees/` 已在 `.gitignore`）
- 日期: 2026-11-24
- 用户拍板：范围 = **只做 v2b 线 A**（DR-029）；delphi 面板**先修好再进 DESIGN**（DR-030）

## 1. 隔离

| 项 | 结果 |
|---|---|
| 启动分支 | `main`（保护分支）→ worktree 强制隔离 |
| Sprint lock | 无活跃锁（v2a 的 sprint-state 已 completed），新建 `.sprint-state/sprint.lock` |
| 依赖安装 | `bun install --frozen-lockfile` → 72 包 |
| archlint 补丁 | `node scripts/patch-archlint-musl.mjs`（glibc 2.35 限制，见 AGENTS.md） |
| **基线验证** | `bun run test` → 62 files passed / 1 skipped，**706 passed / 52 skipped**；`bun run build` 后复跑一致 |
| 基线门禁 | `xp-gate check --all` → **10 passed / 9 skipped / 19 total**（与 v2a 关闭时一致） |

### 基线踩坑（已记入 feedback-log）

**裸跑 `bun run test` 有 2 个失败，且只在新 worktree 里出现**：`tests/unit/canary-replay.test.ts`
的两个用例 import `dist/` 产物（ADR-0001 的 `scripts/canary-replay.mjs` 用纯 JS 直接 import `dist/`），
而新 worktree 的 `dist/` 是 gitignored 的空目录。**先 `bun run build` 再跑测试即全绿。**
`test.yml` 的 CI 顺序里没有独立的 build 步，但 release 链有，故 CI 不受影响；本地验证必须记住这一步。

## 2. AUTO-ESTIMATE（实测指标）

变更类型：**新增功能**（三个新适配器 + 受管枚举扩展 + 探测收敛）。

| 指标 | 实测值 | 阈值档位 |
|---|---|---|
| 触点引用 | `MANAGED_CONFIG_IDS` / `Adapter` / `adapter` 在 `src`+`tests`+`testkit` 共 **97 处** | >10 → 复杂 |
| 跨模块 | `src/adapters`、`src/cli`、`src/gateway` + `tests/unit`、`tests/integration`、`tests/e2e` 共 **6 个目录** | 3+ → 复杂 |
| 循环依赖 | 无。`architecture.yaml` 的 adapters 层 `allowed_imports: [shared, adapters]` 是叶子层，新增适配器不会引入新边 | 正常 |
| Public API | `src/adapters` 现有 **14 个 `^export`**（config-io 7 + index 3 + opencode 2 + delphi 2），预计 +6~9 | >5 → 高影响 |
| 测试面 | 适配器相关测试 6 个文件（unit×3、integration×1、e2e×2），新增预计 6~8 个 | 工作量大 |

总分：引用 3 + 跨模块 3 + 循环 0 + API 2 + 测试 1 = **9 → 复杂（完整 6 阶段）**
（与 v2a 同为复杂，但触点面小一个量级：v2a 是 18 处/7 目录，本次 97 处但集中在适配器一处编队点。）

## 3. 范围

**纳入（v2b-A）**：Claude Code / Codex / promptfoo 三个客户端接入
`MANAGED_CONFIG_IDS` 封闭枚举 + `doctor --write-managed-config` 写入 + 漂移断言 + 由**真实 adapter 产物**
驱动的过闸探测（evidence 里出现对应 `client` 与 `provider_id`）。

**排除（顺延）**：
- v2b-B 计费对账 `report` CLI（阻塞项：官价基准数据源空白 + 契约 #4 `usage`/`cache_reported` 未实装）
- v2b-C 指纹巡检 + provider 信任分（阻塞项：`llm-fingerprint-detector` 许可未核实；探针与最小暴露承诺冲突）
- v3 一切（策略可配置化、`redact`、TLS 拦截、审计缺口检测）

## 4. 进 DESIGN 前必须带着走的事实（本轮实测，直接影响需求措辞）

| # | 事实 | 对 DESIGN 的含义 |
|---|---|---|
| F1 | 本机**三个客户端都没装**：`~/.claude.json`、`~/.claude/`、`~/.codex/`、promptfoo 配置与 CLI 全不存在 | 适配器字段格式**只能**来自上游官方文档，不能来自本机实测配置；验收必须给出"文档 ↔ 配置字段"的可追溯落点 |
| F2 | 网关只认 `<gw>/<client>/<provider>/...` 两段路由（`parseRoute`）；`/v1`、`/api` 是保留段 | 三个新适配器的 baseURL 必须落到两段形态，且要避开 `/v1` 保留段 |
| F3 | Codex 已只支持 `wire_api = "responses"`（官方 config-reference 原文：`responses` is the only supported value）；网关只扫 `messages`/`choices` | Codex 过闸的真正风险是**扫描单元覆盖 `input`/`output` 形态**，不是配置写入 |
| F4 | Codex 的 base_url 按 Responses 语义**已含 `/v1`**；网关 `joinUpstream` 只在 rest 以 `/v1` 开头时去重 | 路由拼接存在双重 `/v1` 风险，需在 DESIGN 定裁决 |
| F5 | promptfoo 的 baseURL 优先级是 `apiHost` → `apiBaseUrl` → 端点环境变量；`apiHost` 只拼 `https://<host>/v1` | promptfoo **必须**用 `apiBaseUrl`（带协议+端口+自定义路径），用 `apiHost` 会被强制成 https |
| F6 | Claude Code 的覆写落在 `~/.claude/settings.json` 的 `env.ANTHROPIC_BASE_URL`（官方 settings 参考原文示例）；`~/.claude.json` 是另一类全局配置 | 适配器要改的是 `settings.json`，不是 `~/.claude.json` |
| F7 | CodeBuddy/ACP 类客户端**没有可覆写的 base URL**（本机已量到 `CODEBUDDY_BASE_URL` 存在但请求路径是自带 `/v2/chat/…`） | 属 P0-3 已登记的架构边界，**不在本线 A 范围**，不得声称"接入了 codebuddy" |
| F8 | Codex 的 `model_providers.<id>` 是 **TOML 表**，现有适配器只有 JSON I/O（`config-io.ts`） | 需要新增一个最小 TOML 写入面（或先在 DESIGN 决定是否引入依赖），这是本 sprint 唯一的**技术不确定点** |

## 5. 风险登记（带入 Phase 2）

| ID | 风险 | Phase 2 处置 |
|---|---|---|
| R-PRE-1 | **F1 无本机实测客户端**：适配器字段只能按文档写，客户端版本演进会让字段漂移 | 设计里给出"字段来源 URL + 读取到的日期"的记录位；doctor 对缺失/不可解析一律报全漂移（沿用 v1 既有语义），不静默 |
| R-PRE-2 | **F8 TOML**：Codex 配置是 TOML，现有 I/O 是 JSON | 列为 DESIGN 前置决策门，不许在 BUILD 期临时选路 |
| R-PRE-3 | F3/F4 的**协议形态**（Responses vs Chat Completions）可能让"配好了但不被扫描" | 验收必须包含"探测请求经网关真实过闸并落 evidence"，配置写入本身不算交付 |
| R-PRE-4 | 三个客户端都未安装 → **没有真实客户端的端到端证明** | 与 v2a 的 OpenCode/Delphi 不同（那两个本机有真实配置）；UAT 需用户参与或明确登记为残余 |
| R-PRE-5 | 评审面板三席的真实厂商不可证（DR-030） | 评审记录逐席写明命令行；结论异常同质时按"可能是同一模型"复核 |

## 6. 输出物

- `.sprint-state/sprint-state.json`（`xp-gate sprint-init --force`，旧 v2a 状态已备份到 `.sprint-history/`）
- `.sprint-state/decisions.md` ← DR-029、DR-030
- `.delphi-config.json`（gitignored）+ `.sprint-state/review/delphi-panel-v2b.md`
- `.sprint-state/phase-outputs/phase-1-summary.md`（本文件）

## status

```
status: completed
outputs:
  - .sprint-state/sprint-state.json
  - .sprint-state/decisions.md (DR-029, DR-030)
  - .delphi-config.json
  - .sprint-state/review/delphi-panel-v2b.md
  - .sprint-state/phase-outputs/phase-1-summary.md
decisions:
  - DR-029 范围 = 只做 v2b-A
  - DR-030 评审面板 = CodeBuddy 三席（hy4std / hy4flash / space-bunny）
next_phase_context:
  - 规模 = 复杂 / 完整 6 阶段
  - Phase 2 入口：先关 R-PRE-2（Codex TOML I/O），再走 grill-with-docs → R1 → 设计 → R2
  - F1~F8 是需求措辞的直接依据，不得凭记忆改写
```
