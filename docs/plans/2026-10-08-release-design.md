# GitHub 开源发布设计 v1（sprint-20261008-26 · R2 设计评审输入）

> 需求基线：[2026-10-08-release-requirements.md](2026-10-08-release-requirements.md) v2
> （R1 需求评审链第 2 轮三专家 APPROVED，consensus 1.0，requirements_hash `510273de…`）。
> 拍板记录：`.sprint-state/decisions.md` DR-001..DR-010——需求访谈拍板 DR-001..005 +
> 设计拍板项 DD-1..DD-11 闭环（DR-006..010，处置表见 §3）。
>
> 本文档把 7 条 REQ + 15 条 AC 具体化为 D-01..D-08 设计决策、S1..S8 切片预划分与发布执行序列。

## 1. 目标与非目标

**目标**：把 v1（0.2.0，全量测试 296 passed | 3 skipped、覆盖率四项 ≥84、v1 部署验收 6/6）
以**可发布态**交付——npm registry 转正 + GitHub Release 双通道 + 公开化前置处置全部就绪。
**真发布动作（visibility 翻转 / filter-repo 执行 / npm publish / GitHub Release）由用户确认后
扣扳机**（需求验收口径 3）——本迭代交付"能扣"的扳机与护栏，不代替用户扣。

**非目标**（承接需求 v2 逐条重申）：v2a BUILD 15 切片（DR-001 独立挂起）；上游重试/备用上游
（DR-003）；单二进制分发（bun --compile，v2 候选）；Docker/企业级分发；npm 包签名
（Sigstore/cosign）；社区运营机制建设。

**全局红线**：`src/` 零改动（REQ-REL-05 仅核对不触碰运行时面）。交付物落点：
package.json、`.github/workflows/`、`scripts/`（新 dev 工具）、README*.md、SECURITY.md、
CONTRIBUTING.md、CHANGELOG.md、CONTEXT.md（术语表）、docs/（runbook）、`.sprint-state/`。

## 2. 设计决策

### D-01 发布前置构建门链（REQ-REL-01 / AC-REL-01a）

新增跨平台 Node 脚本 `scripts/release-gate.mjs`（dev 工具，不入 npm `files` 包内容），
固化链序，任一步非零退出即阻断并打印首个失败步：

```
clean → install → build → test → typecheck → typecheck:dist
      → pack → install-tarball → smoke → publish-dry-run
```

| 步 | 命令 | 通过判据 |
|---|---|---|
| clean/install/build | `bun run clean && bun install && bun run build` | `dist/` 重生成为纯 ESM |
| test | `bun run test` | 不倒退 296 passed \| 3 skipped 基线 |
| typecheck | `bun run typecheck && bun run typecheck:dist` | 双 tsconfig 零错误 |
| pack | `npm pack` | tarball 生成；内容 = `files` 字段（DD-5：仅 dist + README.md + LICENSE） |
| install-tarball | `npm i -g <tarball>` | `llmveto --help` 可执行 |
| smoke | 见下 | 关键行清单全过 |
| publish-dry-run | `npm publish --dry-run` | 退出码 0 |

**smoke（纯 Node ≥18 判定）**：npm 的 bin shim 以 `node` 解释 `dist/` 产物——冒烟天然运行于
Node，与宿主机是否装有 Bun 无关；脚本显式断言 `node --version` ≥ 18 作为"纯 Node"形式化。
冒烟序列 env 隔离（`LLMVETO_PORT=0` ephemeral 端口 + `LLMVETO_STATE_DIR=<临时目录>`），
序列含 teardown（stop + 临时目录清理），保证无残留 daemon：

```
--help → start → status → verify → doctor → stop
```

**关键行清单**（AC-REL-01a 要求精确清单 BUILD 期随规格冻结；设计给出冻结候选）：

| 命令 | 判据（候选，BUILD 冻结定稿） |
|---|---|
| `--help` | 退出码 0；输出含 `Usage` 与全部命令名 |
| `start` | 退出码 0；输出含 `pid=` 与 `url=` |
| `status` | 输出含 `running pid=` |
| `verify` | 输出含 SHA-256 链完整判定 |
| `doctor` | 退出码 0 |
| `stop` | 退出码 0 |

**双层防跳过**（R-4：npm publish 不可撤销）：① `package.json`
`"prepublishOnly": "npm run release:gate"`——本地 publish 被门链自拦；② release.yml 显式逐步
执行同一链（CI 日志可见，失败即不 publish）。DD-9 双保险 = 本机门链冒烟（第一）+ release.yml
runner 冒烟（第二，D-02），不引入 Docker。

### D-02 release.yml（REQ-REL-01b / AC-REL-01b）

`.github/workflows/release.yml`（与 test.yml / bench.yml 同目录同风格）：

- **触发**：`push: tags: ["v[0-9]+.[0-9]+.[0-9]+"]` **且** `workflow_dispatch` 手动入口
- **runner**：`ubuntu-latest`；`permissions: contents: write`（创建 Release 的最小权限集；
  npm 认证走 `NODE_AUTH_TOKEN` env 注入，不落文件）
- **步骤**：checkout → setup-node 20 → setup-bun → 装依赖 → `bun run build` → `bun run test`
  → **dist 冒烟**（Node 解释，同 D-01 关键行清单）→ `npm publish` → `gh release create`
  （正文取 CHANGELOG 该版本节）
- **失败语义**：任一步红 → job 红 → 不 publish 不 Release（步骤顺序天然保证）。
  **部分失败 runbook**：publish 成功而 Release 步失败 → 手动补 `gh release create`（命令入
  S4 runbook）。**同 tag 重跑显式拒绝**：npm 侧同版本再 publish 报 `EPUBLISHCONFLICT`，
  GitHub 侧拒绝推已存在 tag——双保险，runbook 登记两种情形的判读与处置
- workflow 文件本身属公开面：不含任何内部端点/人名/凭据字面量（07d 扫描覆盖）

### D-03 package.json 元数据转正（REQ-REL-01）

- 移除 `"private": true`（ADR-0001"转为公开发布前须补齐发布流程与构建门"承诺的兑现点：
  构建门 = D-01，发布流程 = D-02 + D-07）
- 补：`repository`（`git+https://github.com/boyingliu01/llmveto.git`）、`homepage`（repo URL）、
  `bugs`（repo `/issues`）、`keywords`（候选：`llm` / `security` / `gateway` / `proxy` /
  `prompt-injection` / `ai-safety` / `audit`，BUILD 定稿）
- `license: MIT` 已有（实测）；`files` 保持 `["dist","README.md","LICENSE"]`（DD-5；
  README.zh-CN.md 属 GitHub 公开面，不入 npm 包）；`engines.node >=18` 已有
- 元数据改动与 D-06 版本定稿**同一提交**（Gate 0 中间态防护，AC-REL-06a）

### D-04 README 双语架构（REQ-REL-03 / DR-004 + DR-007）

- **`README.md` = English 全量**（GitHub 默认展示面）；**`README.zh-CN.md` = 中文全量镜像**
  （现 151 行中文版内容整体迁入）；两文件首行互链：`English | 简体中文`
- **章节结构冻结**（AC-REL-03a 核对基准）：以中文版章节清单为准——定位段 / 能力边界表 /
  快速开始 / 路径路由约定 / 环境变量表 / CLI 表 / 开发环境 / 分发与 runtime 承诺 / ADR 索引；
  英文版逐章对等，能力表 / 环境变量表 / CLI 表**行级核对**
- **术语对照表**（AC-REL-03b，设计期产出冻结）：落 `CONTEXT.md` 新增
  `## Glossary（受控词英文定译）` 节，覆盖 Language 节全部 25 个受控词：

| 受控词 | 英文定译 | Avoid（英文） |
|---|---|---|
| 过闸 | vetting | interception, filtering, sanitization |
| 扫描单元（scan unit） | scan unit | payload, buffer, fragment |
| verdict | verdict | judgment result, block, hit |
| action | action | verdict, ruling |
| 安全类 checker | security-class checker | critical checker, hard checker |
| 观测类 checker | observational checker | weak checker, non-security checker |
| redact | redact | injection, sink-level sanitization |
| 注入（金丝雀注入） | (canary) injection | rewrite, instrumentation |
| 零缓冲 | zero buffering | stream pass-through, unbuffered |
| 滚动窗口（ScanWindow） | rolling window (ScanWindow) | session buffer, global state |
| 终止流 | stream termination | block（不区分终止流/响应级拒绝时）, abort |
| 响应级拒绝 | response-level rejection | block, kill |
| action_taken | action_taken（evidence 字段保留原名不译） | action, verdict |
| 观测类降级 | observational degradation | skip, fail-open |
| 受管配置枚举（MANAGED_CONFIG_IDS） | managed-config enumeration (MANAGED_CONFIG_IDS) | all traffic, all clients |
| 金丝雀（canary） | canary | honeypot, watermark |
| 会话（session） | session | conversation, connection |
| 匹配域 | match domain | index, cache store |
| 跨会话串流 | cross-session spill | backflow, echo, cross-session streaming |
| 保留位 | reserved slot | reserved field |
| 取证可得性 | forensic availability | covered, detected |
| 证伪信号 | refutation signal | fingerprint, verification |
| 双向自洽判定 | bidirectional self-consistency check | allowlist validation, capability table |
| 检测核心 / 运营面 | detection core / operations plane | main feature, auxiliary feature |
| 期次纪律 | cohort discipline | unregistered deferral |

- **同步机制**（DD-2，R-2 处置）：中文为技术口径基准（docs/issues 中文冻结件为准）；
  双文件**同 PR 同改**；PR 检查单含"章节清单对等 + 三表行级核对"人工项；**不建 CI 机器核对**
  ——设计取舍：单人维护项目上机器核对的实现/误报成本高于其拦截价值，漂移控制靠
  "基准明确 + 同 PR 同改 + 检查单"，评审可挑战

### D-05 开源卫生件（REQ-REL-04 / DR-009）

- **语言**：SECURITY.md / CONTRIBUTING.md / CHANGELOG.md = **英文**——公开社区面与 DD-10
  主方向一致；docs/issues 技术冻结件保持中文不动（新披露决策，随 DR-010 一并记录）
- **SECURITY.md**：支持版本表（0.2.x = supported）；报告渠道 = **GitHub 私密漏洞报告**
  （Security Advisories，不公开邮箱）；承诺口径（DD-7 保守）：best-effort 响应、无 SLA、
  不承诺功能请求
- **CONTRIBUTING.md**：轻量——issues 优先；PR 接受口径（DD-6 保守）：接受，但须过**全量测试门
  + 覆盖率门（80%）+ 12 道 pre-commit 门 + Gate MW 走查链（证据绑 HEAD）**；开发环境
  Bun ≥ 1.1 + Node ≥ 18；常用命令 = package.json scripts 实况（test / typecheck / lint / build）
- **AC-REL-04a 核对基准逐条落地**：scripts 实况清单（13 条，见需求事实基线）+ pre-commit 12 门
  名称 + Gate MW + #367 对齐报告门——文中出现的每个门名/命令都必须与仓库实况一致，
  核对记录留档

### D-06 版本 / CHANGELOG / tag（REQ-REL-06 / DR-008）

- **0.2.0 直发**：VERSION 与 package.json 已一致（Gate 0 现状绿）；v1 验收 6/6 + 测试基线
  支撑，无 bump 必要
- **CHANGELOG.md 设立**（DD-1）：Keep a Changelog 轻量风，英文；首版 `[0.2.0] - <发布日>`
  概括 v1 能力（扫描/裁决/阻断/evidence 链/CLI），不逐 commit 罗列
- **tag**：`v0.2.0`，规则 `^v[0-9]+\.[0-9]+\.[0-9]+$`（AC-REL-06a 严格一致 = `v` + 同值）；
  版本若有改动 = package.json / VERSION / CHANGELOG **同一提交**
- **tag 保护**（DD-4，R-5）：GitHub ruleset 防删防移；repo 公开化后配置，操作口径写入发布
  runbook（公开化 checklist 项）——本迭代交付 runbook，不执行配置

### D-07 公开化前置检查（REQ-REL-07 / DR-006，阻断性时序第一）

本迭代交付 07a–07d 的**工具化与 runbook**（指令清单 + 核查脚本/清单 + 执行文档）；执行时点 =
本迭代全部切片 merge main **之后**、visibility 翻转**之前**，由用户确认执行（验收口径 3）。
执行时点后置的原因：DD-11 = A 案改写全库 SHA，本 sprint worktree 亦随之作废——必须 merge 后执行。

- **07a gitleaks**：`gitleaks git`（全历史）+ `gitleaks dir .`（工作区），本地一次性使用不入仓
  （与 docs/licenses.md"不捆绑 gitleaks"决议不冲突）；高置信发现 = 0 为过
- **07b 公开面核查**：核查清单核对 `git ls-files`——无 `.worktrees/`、无 evidence 产物、
  无 `.delphi-config.json` 等本地配置、无 `.sprint-history/`、`var/` 仅三件已评审工具
  （canary-split.ts / capture-proxy.ts / mock-relay.ts）；`.gitignore` 完备性清单留档
- **07c 内部端点处置（DD-11 = A 案 filter-repo 全量改写）**：
  - 对象 = 已识别 4 文件历史中出现 `https://internal-gateway.invalid/redacted` 的所有 blob
    （docs/delphi-panel.md、.sprint-state/g-canary-recording-spec.md、
    .sprint-state/phase-outputs/phase-2-summary.md、requirements-reviewed.json），
    替换为占位符 `https://internal-gateway.invalid/redacted`
  - 操作 = `git filter-repo --replace-text`，mirror clone 上执行 → force-push 覆盖 origin →
    **复跑 07a/07b** 验证改写后零残留（改写后复扫是过闸判据，不是可选项）
  - **代价处置（登记为义务，不隐瞒）**：① 全库新 SHA → 旧 SHA 绑定证据（走查链 /
    requirements-reviewed 的 head_commit）失效，**SHA 映射表留档**（pre/post 对照），
    公开前证据链以映射表为唯一桥接；② 全部本地 clone/worktree 作废重 clone；
    ③ GitHub PR/issue 引用的旧 SHA 成为悬链——接受该代价并登记，不做修复
  - runbook 含 Windows 环境执行路径（git-filter-repo 为 Python 工具，给出 WSL 与 Git-Bash
    二选一指令序列）
- **07d 提交信息扫描**：全历史 `git log` 扫内部人名/邮箱/域名/工单号口径；gitleaks 扫 diff
  不扫 message，此步独立执行；零处置项或已按口径处置

### D-08 上游容错边界登记（REQ-REL-05，零代码）

- 核对清单（双语 README 各一份，切片验收留档）：威胁模型 `docs/issues/1-req-threat-model.md`
  T0 行"fail-closed 已缓解" + README 分发承诺段"无重试/备用上游，属 v2 运营面"明示，逐点核对
- 英文定译候选：*"No retry or failover upstream. A failed upstream request is answered
  fail-closed (502 + audit record); upstream resilience is a v2 operations concern."*
- `src/` 零改动断言：切片验收含 `git diff <base> -- src/` 为空

## 3. 拍板项处置表（DD-1..DD-11 → DR-006..DR-010）

| DD | 处置 | 依据 |
|----|------|------|
| DD-1 | 设立 CHANGELOG.md；Keep a Changelog 轻量风；英文 | 锁默认 → DR-010 |
| DD-2 | 中文为技术口径基准；同 PR 同改 + PR 检查单人工核对；不建 CI 机器核对 | 锁默认 → DR-010 |
| DD-3 | 0.2.0 直发，tag v0.2.0 | 用户拍板 → DR-008 |
| DD-4 | ruleset 防删防移；公开化后配置；口径入 runbook，本迭代交付不执行 | 锁默认 → DR-010 |
| DD-5 | files 保持 `["dist","README.md","LICENSE"]`，不纳入 docs/ | 锁默认 → DR-010 |
| DD-6 | 保守：接受 issues/PR；PR 须过全量门禁与走查链；响应 best-effort 无 SLA | 用户拍板 → DR-009 |
| DD-7 | 保守：GitHub 私密漏洞报告；best-effort；不承诺功能请求 | 用户拍板 → DR-009 |
| DD-8 | 不加 SPDX 文件级头；LICENSE 文件足够 | 锁默认 → DR-010 |
| DD-9 | 双保险 = 本机门链 Node 冒烟 + release.yml runner 冒烟；不引 Docker | 锁默认 → DR-010 |
| DD-10 | README.md = 英文全量；README.zh-CN.md = 中文全量镜像 | 用户拍板 → DR-007 |
| DD-11 | A 案 filter-repo 全量改写 + SHA 映射登记 + 改写后复扫 | 用户拍板 → DR-006 |

**新披露设计决策**（随本设计一并生效，记录于 DR-010）：① SECURITY/CONTRIBUTING/CHANGELOG
= 英文（D-05）；② 术语对照表落 CONTEXT.md（D-04）；③ 门链脚本 scripts/release-gate.mjs +
prepublishOnly 双层防跳过（D-01）；④ 07c 占位符定 `https://internal-gateway.invalid/redacted`
（.invalid 保留域，无重指向风险）。

## 4. 发布执行序列（切片排序与扣扳机点）

```
[本迭代]  S1..S8 切片 → 全量门禁 → Gate MW 推送 → PR merge main
[用户确认] 07a–07d 前置检查执行（filter-repo 改写 + force-push + 改写后复扫）
[用户确认] visibility 翻转 public + DD-4 ruleset 配置
[用户确认] NPM_TOKEN secret 配置（R-1a 前置）→ tag v0.2.0 push
[自动]    release.yml → npm publish + GitHub Release
[核对]    npm 页面 + Release 页 + `npm i -g llmveto` 真装烟测
```

需求依赖时序 5 条 → 序列落位：REQ-REL-07 先于一切 public 动作（第 2 步）；REQ-REL-03 依赖
中文 README 冻结（S1..S8 内 S5 前置完成）；REQ-REL-01b 依赖 01a（S2 先于 S3）；
REQ-REL-06 版本同批（D-03+D-06 同一提交）；真发布 = 用户扣扳机（三处确认点显式标注）。

## 5. 风险处置映射

| 风险 | 设计承接 |
|---|---|
| R-1a NPM_TOKEN 配置（用户侧） | 执行序列第 4 步前置 + S4 runbook 指引 |
| R-1b npm 账号安全 | AC-REL-01c → S4 runbook（granular token / 2FA / 轮换）+ D-02 secret 注入 |
| R-2 双语漂移 | D-04 同步机制（基准 + 同 PR 同改 + 检查单） |
| R-3 工作流首跑才验证 | D-01 门链本地全链路演练固化（release:gate 可重复执行） |
| R-4 npm publish 不可撤销 | D-01 门链前置 + 双层防跳过 + dry-run 入链 |
| R-5 tag 可移可删 | DD-4 ruleset（D-06 + runbook） |
| R-6 内部端点历史残留 | D-07 filter-repo 改写 + 改写后复扫 |

## 6. 切片预划分（to-issues 输入）

| 切片 | 承载 | 内容 |
|---|---|---|
| S1 | REQ-REL-07 | 07a–07d 工具化：gitleaks 指令清单 + ls-files 核查清单 + filter-repo runbook（含 SHA 映射表模板 + 改写后复扫）+ 提交信息扫描指令 |
| S2 | REQ-REL-01a | `scripts/release-gate.mjs` 门链 + prepublishOnly 接线 + 关键行清单冻结 |
| S3 | REQ-REL-01b | `.github/workflows/release.yml`（依赖 S2 链成形） |
| S4 | REQ-REL-01c | 发布 runbook：granular token / 2FA / NPM_TOKEN / 轮换 / 部分失败 / 同 tag 拒绝 |
| S5 | REQ-REL-03 | README.md 英文全量 + README.zh-CN.md 迁入 + CONTEXT.md 术语对照表冻结 |
| S6 | REQ-REL-04 | SECURITY.md + CONTRIBUTING.md（核对基准逐条对齐实况） |
| S7 | REQ-REL-05 | 双语 README fail-closed 边界段 + 威胁模型 T0 核对清单（与 S5 同批落地） |
| S8 | REQ-REL-06 | CHANGELOG.md `[0.2.0]` + package.json 元数据转正 + VERSION 终版核对（D-03+D-06 同一提交） |

依赖：S2 → S3；S5 / S6 / S7 同批（README 面）；S8 收口（CHANGELOG 概括 S1–S7 交付）；
S1 工具先交付、执行在 merge 后（D-07 时序）。

## 7. 验收映射

AC-REL-01a → S2/D-01；01b → S3/D-02；01c → S4；02a → S3+S8（Release 正文取 CHANGELOG）；
03a/03b → S5/D-04；04a → S6/D-05；05a → S7/D-08；06a → S8/D-06；07a–07d → S1/D-07。
迭代级验收口径 3 条不变（AC 全 PASS / 门禁全绿 / 真发布动作 = 用户扣扳机）。
