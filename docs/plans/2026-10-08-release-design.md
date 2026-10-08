# GitHub 开源发布设计 v2（sprint-20261008-26 · R2 设计评审交换轮输入）

> 需求基线：[2026-10-08-release-requirements.md](2026-10-08-release-requirements.md) v2
> （R1 需求评审链第 2 轮三专家 APPROVED，consensus 1.0，requirements_hash `510273de…`）。
> 拍板记录：`.sprint-state/decisions.md` DR-001..DR-011（DR-006..010 = DD-1..DD-11 闭环；
> DR-011 = 本设计 R1 评审处置）。
>
> **v1 → v2 修订**：吸收 R1 设计评审三专家（A APPROVED 8 / B REQUEST_CHANGES 8 /
> C REQUEST_CHANGES 8）全部 3 Critical + 8 Major + 13 Minor。要点：冒烟判据按 CLI 实况冻结
> （CLI 无 `--help`、干净环境 doctor 必漂移两处修正）、"纯 Node"判定改为 PATH 剥离 Bun、
> 门链 teardown 化、release.yml 显式复用单一真源、publish 幂等、filter-repo 三段式 +
> message 改写轮、双语轻量机器核对。逐条处置见 §8。

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
| install-tarball | `npm i -g <tarball>` | 装入成功（冒烟前置） |
| smoke | 见下 | 冻结判据表全过 |
| publish-dry-run | `npm publish --dry-run` | 退出码 0 |

**门禁负担核对**（R1 T-13）：oxlint 范围 = `src tests`、typecheck 范围 = 两个 tsconfig（TS 工程）——
`scripts/release-gate.mjs` 为独立 .mjs dev 工具，不扩大任何既有门的面；S2 验收含此项核对留档。

**冒烟判据（R1 T-07/T-08/F-MIN-01：本次冻结，依据 = `src/cli/index.ts` 实况，BUILD 期以
结构化断言常量内置 `release-gate.mjs`，不再有"候选"态）**：

| # | 命令 | env | 冻结断言（退出码 + contains 锚定串） |
|---|---|---|---|
| 1 | `llmveto`（无参） | — | exit 2 且 stderr 含 `valid: start, stop, status, doctor, verify`（二进制加载 + Node 解释证明；**CLI 无 `--help` 命令**，v1 设计此节按实况修正） |
| 2 | `llmveto status`（启动前） | STATE_DIR=临时目录 | exit 1 且 stdout 含 `not running` |
| 3 | `llmveto start` | `LLMVETO_PORT=0`、STATE_DIR=临时目录 | exit 0 且 stdout 含 `gateway started in background (pid=` |
| 4 | `llmveto status`（启动后） | 同上 | exit 0 且 stdout 含 `running pid=` 与 `url=http://127.0.0.1:` |
| 5 | `llmveto verify` | 同上 | exit 0 且 stdout 含 `ok: ` 与 `records verified` |
| 6 | `llmveto doctor` | `LLMVETO_GATEWAY_URL`=读自 gateway.url；`LLMVETO_OPENCODE_CONFIG`/`LLMVETO_DELPHI_CONFIG` 指向预写的受控配置副本 | exit 0 且 stdout 含 `[PASS] doctor.evidence-chain: chain ok (` 与 `[PASS] doctor.port-reachable`（**干净环境受管配置缺失必漂移**，故 doctor 前必须预写两份受管配置——v1 设计此节按实况修正） |
| 7 | `llmveto stop` | 同上 | exit 0 且 stdout 含 `stop: signal sent` |
| 8 | teardown 复核 | — | `llmveto status` → exit 1 且 stdout 含 `not running`（daemon 无残留） |

**"纯 Node ≥18"判定（R1 T-02 修正）**：npm bin shim 以 `node` 解释 `dist/` 产物仅证明解释器，
不证伪 dist 对 Bun runtime 的隐式依赖。冻结判定 = 冒烟子进程 env 构造受控 PATH——**剥离含
`bun` 可执行文件的目录**，并断言 `bun` 在冒烟环境中不可达（where/which 失败）；全序列在该
PATH 下通过才判定"纯 Node ≥18 运行成立"。同时断言 `node --version` ≥ 18。D-02 runner 冒烟
同用此判定（第二保险），不引入 Docker（DD-9）。

**teardown（R1 T-01 修正）**：install-tarball / smoke / publish-dry-run 三段整体包 try/finally——
finally 依序执行 daemon stop（pid 文件存在即调）、`npm rm -g llmveto`（按 tarball 装入名）、
临时 STATE_DIR 删除；链中任一步失败同样走 finally，保证门链失败不留全局包与常驻进程。

**防跳过定位（R1 T-03/A-MC-01 修正）**：单一真源 = `scripts/release-gate.mjs`（`package.json`
接线为 `release:gate`）。**权威门 = release.yml 显式步 `npm run release:gate`**（CI 日志可见，
不依赖 npm 生命周期钩子）；`"prepublishOnly": "npm run release:gate"` 仅为本地纵深防御——
npm 层 `--ignore-scripts` 可绕过属已知边界，**关闭方式 = publish token 仅存 GitHub secret、
本地不持有**（AC-REL-01c 承载）：本地直 publish 无凭据可行，绕过面自然消失。runbook 登记该口径。

### D-02 release.yml（REQ-REL-01b / AC-REL-01b）

`.github/workflows/release.yml`（与 test.yml / bench.yml 同目录同风格）：

- **触发**：`push: tags: ["v[0-9]+.[0-9]+.[0-9]+"]` **且** `workflow_dispatch` 手动入口
- **runner**：`ubuntu-latest`；`permissions: contents: write`（创建 Release 的最小权限集；
  npm 认证走 `NODE_AUTH_TOKEN` env 注入，不落文件）
- **步骤**：checkout → setup-node 20 → setup-bun → 装依赖 → `bun run build` → `bun run test`
  → `npm run release:gate`（**显式门链步**：pack / install-tarball / smoke（PATH 剥离 Bun）/
  publish-dry-run，单一真源复用 D-01）→ `npm publish`（幂等前置：`npm view llmveto@<version>`
  已存在则跳过 publish 步）→ `gh release create`（正文取 CHANGELOG 该版本节）
- **失败语义**：任一步红 → job 红 → 不 publish 不 Release（步骤顺序天然保证）
- **同 tag 重跑语义（R1 T-04 修正，替换 v1 的"显式拒绝"表述）**：
  ① 同 SHA tag 重复 push = GitHub 静默 no-op，不触发 workflow（登记为预期行为，非拒绝）；
  ② `workflow_dispatch` 同 tag 重跑 = **补建 Release 的合法入口**——publish 步被幂等前置跳过
  （registry 已有该版本），仅补 `gh release create`；若 registry 无该版本而强发重复内容，
  npm 侧 `EPUBLISHCONFLICT` 兜底报错
  ③ runbook 情形表覆盖：publish 成功而 Release 步失败 → workflow_dispatch 补建；
  **publish 成功后真装烟测失败（F-MAJ-01 新增）→ 决策树**：安全缺陷 = 立即
  `npm deprecate` + 72h unpublish 窗口内 unpublish + issue 公告；非安全缺陷 = `npm deprecate`
  + 补丁版本 0.2.1 修复后重走门链（决策树全文入 S4 runbook）
- workflow 文件本身属公开面：不含任何内部端点/人名/凭据字面量（07d 扫描覆盖）

### D-03 package.json 元数据转正（REQ-REL-01）

- 移除 `"private": true`（ADR-0001"转为公开发布前须补齐发布流程与构建门"承诺的兑现点：
  构建门 = D-01，发布流程 = D-02 + D-07）
- 补：`repository`（`git+https://github.com/boyingliu01/llmveto.git`）、`homepage`（repo URL）、
  `bugs`（repo `/issues`）、`keywords`（候选：`llm` / `security` / `gateway` / `proxy` /
  `prompt-injection` / `ai-safety` / `audit`，BUILD 定稿）
- `license: MIT` 已有（实测）；`files` 保持 `["dist","README.md","LICENSE"]`（DD-5；
  README.zh-CN.md 属 GitHub 公开面，不入 npm 包）；`engines.node >=18` 已有
- 元数据改动与 VERSION 终版核对（0.2.0 不动）**同一提交**（Gate 0 中间态防护，AC-REL-06a）；
  该提交随 S2 落地（R1 T-11 修订：元数据转正移出 S8）

### D-04 README 双语架构（REQ-REL-03 / DR-004 + DR-007）

- **`README.md` = English 全量**（GitHub 默认展示面）；**`README.zh-CN.md` = 中文全量镜像**
  （现 151 行中文版内容整体迁入）；两文件首行互链：`English | 简体中文`
- **章节结构冻结**（AC-REL-03a 核对基准）：以中文版章节清单为准——定位段 / 能力边界表 /
  快速开始 / 路径路由约定 / 环境变量表 / CLI 表 / 开发环境 / 分发与 runtime 承诺 / ADR 索引；
  英文版逐章对等，能力表 / 环境变量表 / CLI 表**行级核对**
- **迁入自检（R1 A-MN-03 新增）**：README.zh-CN.md 迁入交付物含"迁移前后章节标题序列 diff = 0"
  自检记录——迁入不改结构，基准不被迁移动作本身破坏
- **术语对照表**（AC-REL-03b，设计期产出冻结）：落 `CONTEXT.md` 新增
  `## Glossary（受控词英文定译）` 节，覆盖 Language 节全部受控词（R1 T-09：追加 evidence 行，
  保留原名不译）：

| 受控词 | 英文定译 | Avoid（英文） |
|---|---|---|
| 过闸 | vetting | interception, filtering, sanitization（注：avoid 指不得用这些词**指称"过闸"概念**，非禁用其一般义） |
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
| evidence | evidence（审计证据链，保留原名不译） | log, trace |

- **同步机制（R1 T-10/F-MAJ-02 处置：DD-2 口径由"纯人工"修订为"轻量机器核对 + 人工行级"）**：
  中文为技术口径基准（docs/issues 中文冻结件为准）；双文件**同 PR 同改**；
  **`scripts/check-readme-parity.mjs`（S5 交付）自动比对中英 README 章节标题序列 + 三表行数**，
  作为 PR 检查单机器前置项；行级内容对等仍为人工核对项。CI 不再新建核对门（parity 脚本
  以 PR 检查单 + 本地可执行形态交付，不挂 CI workflow——成本/误报与单人项目节奏的取舍，
  评审可挑战）

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
  概括 v1 能力（扫描/裁决/阻断/evidence 链/CLI），不逐 commit 罗列；**S8 仅承载 CHANGELOG
  收口**（R1 T-11 修订：收口在 S1–S7 定稿之后，元数据已随 S2 落地，消除同切片时序冲突）
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
  （canary-split.ts / capture-proxy.ts / mock-relay.ts）；`.gitignore` 完备性清单留档。
  **`.sprint-state/` 处置声明（R1 T-12 新增）**：保留为公开审计面（透明性优先级），
  但必须先过 07c 端点改写 + 07a 复扫（其含已识别端点实例）；不接受"顺手删除"——
  审计链完整性优先于面面俱到的干净
- **07c 内部端点处置（DD-11 = A 案 filter-repo 全量改写；R1 F-CRIT-01/A-MN-01/T-05/T-06
  处置：三段式 + 范围声明 + 改写后闭环）**：
  - **前置确认（A-MN-01）**：`git log -p --all | grep -F internal-gateway.invalid` 全历史扫描，
    确认替换对象集合 = 已识别 4 文件且无未知文件（docs/delphi-panel.md、
    .sprint-state/g-canary-recording-spec.md、.sprint-state/phase-outputs/phase-2-summary.md、
    requirements-reviewed.json）；扫描结果与替换清单一并留档
  - **范围声明（T-06）**：`--replace-text` 只改 blob，**不改 commit/tag message**——
    message 侧归 07d；07d 若扫出 message 命中端点 → runbook 追加 `--replace-message` 改写轮
    （同 runbook 指令序列），直至双侧复扫归零
  - **三段式（F-CRIT-01）**：
    1. **备份**（回滚锚点）：`git bundle create llmveto-pre-rewrite.bundle --all`（全历史快照，
       改写不可逆的唯一恢复源）
    2. **预演**：mirror clone 内执行 `git filter-repo --replace-text`（端点 → 占位符
       `https://internal-gateway.invalid/redacted`，.invalid 保留域无重指向风险），
       产出改写前后差异报告，**人工审查通过才进入第 3 段**；原仓全程未被触碰
    3. **执行**：force-push 覆盖 origin → 复跑 07a（blob）/ 07b（工作区）/ 07d（message）
       三重复扫，**零残留为过闸判据，非可选项**
  - **改写后闭环（T-05 新增）**：改写只动历史不动工作树内容 → 改写后 main 复跑全量测试门
    （预期全绿，作留档证据）；sprint 证据链（走查 / requirements-reviewed 的 head_commit）
    以 **SHA 映射表**（pre/post 对照，随 runbook 留档）桥接，**不重做评审**——评审对象内容
    零变化，仅历史锚点迁移；GitHub PR/issue 引用的旧 SHA 成为悬链——接受并登记，不做修复
  - runbook 含 Windows 环境执行路径（git-filter-repo 为 Python 工具，给出 WSL 与 Git-Bash
    二选一指令序列）
- **07d 提交信息扫描**：全历史 `git log` 扫内部人名/邮箱/域名/工单号口径（**对象明含
  commit 与 tag message**，与 07c 范围声明互补）；零处置项或已按口径处置

### D-08 上游容错边界登记（REQ-REL-05，零代码）

- 核对清单（双语 README 各一份，切片验收留档）：威胁模型 `docs/issues/1-req-threat-model.md`
  T0 行"fail-closed 已缓解" + README 分发承诺段"无重试/备用上游，属 v2 运营面"明示，逐点核对
- 英文定译候选：*"No retry or failover upstream. A failed upstream request is answered
  fail-closed (502 + audit record); upstream resilience is a v2 operations concern."*
- `src/` 零改动断言：切片验收含 `git diff <base> -- src/` 为空

## 3. 拍板项处置表（DD-1..DD-11 → DR-006..DR-011）

| DD | 处置 | 依据 |
|----|------|------|
| DD-1 | 设立 CHANGELOG.md；Keep a Changelog 轻量风；英文 | 锁默认 → DR-010 |
| DD-2 | 中文为技术口径基准；同 PR 同改；**轻量机器核对（check-readme-parity.mjs：章节序列+表行数）+ 人工行级核对**；不挂新 CI 门 | 锁默认（R1 修订）→ DR-010/DR-011 |
| DD-3 | 0.2.0 直发，tag v0.2.0 | 用户拍板 → DR-008 |
| DD-4 | ruleset 防删防移；公开化后配置；口径入 runbook，本迭代交付不执行 | 锁默认 → DR-010 |
| DD-5 | files 保持 `["dist","README.md","LICENSE"]`，不纳入 docs/ | 锁默认 → DR-010 |
| DD-6 | 保守：接受 issues/PR；PR 须过全量门禁与走查链；响应 best-effort 无 SLA | 用户拍板 → DR-009 |
| DD-7 | 保守：GitHub 私密漏洞报告；best-effort；不承诺功能请求 | 用户拍板 → DR-009 |
| DD-8 | 不加 SPDX 文件级头；LICENSE 文件足够 | 锁默认 → DR-010 |
| DD-9 | 双保险 = 本机门链 Node 冒烟（PATH 剥离 Bun）+ release.yml runner 冒烟；不引 Docker | 锁默认 → DR-010 |
| DD-10 | README.md = 英文全量；README.zh-CN.md = 中文全量镜像 | 用户拍板 → DR-007 |
| DD-11 | A 案 filter-repo 全量改写（三段式）+ SHA 映射登记 + 三重复扫 | 用户拍板 → DR-006 |

**新披露设计决策**（记录于 DR-010，R1 评审未推翻）：① SECURITY/CONTRIBUTING/CHANGELOG
= 英文（D-05）；② 术语对照表落 CONTEXT.md（D-04）；③ 单一真源门链脚本 scripts/release-gate.mjs
（权威门 = release.yml 显式步，prepublishOnly = 本地纵深，publish token 不落本地 = 绕过面关闭，
D-01）；④ 07c 占位符定 `https://internal-gateway.invalid/redacted`。

## 4. 发布执行序列（切片排序与扣扳机点）

```
[本迭代]  S1..S8 切片 → 全量门禁 → Gate MW 推送 → PR merge main
[用户确认] 07a–07d 前置检查执行（bundle 备份 → 预演审查 → 改写 + force-push + 三重复扫）
[用户确认] visibility 翻转 public + DD-4 ruleset 配置
[用户确认] NPM_TOKEN secret 配置（R-1a 前置）→ tag v0.2.0 push
[自动]    release.yml（release:gate 显式步）→ npm publish（幂等）+ GitHub Release
[核对]    npm 页面 + Release 页 + `npm i -g llmveto` 真装烟测（失败 → D-02 决策树）
```

需求依赖时序 5 条 → 序列落位：REQ-REL-07 先于一切 public 动作（第 2 步）；REQ-REL-03 依赖
中文 README 冻结（S1..S8 内 S5 前置完成）；REQ-REL-01b 依赖 01a（S2 先于 S3）；
REQ-REL-06 版本同批（D-03+D-06 同一提交约束）；真发布 = 用户扣扳机（三处确认点显式标注）。

## 5. 风险处置映射

| 风险 | 设计承接 |
|---|---|
| R-1a NPM_TOKEN 配置（用户侧） | 执行序列第 4 步前置 + S4 runbook 指引 |
| R-1b npm 账号安全 | AC-REL-01c → S4 runbook（granular token / 2FA / 轮换；token 仅存 secret）+ D-02 secret 注入 |
| R-2 双语漂移 | D-04 同步机制（基准 + 同 PR 同改 + parity 脚本 + 人工行级） |
| R-3 工作流首跑才验证 | D-01 门链本地全链路演练固化（release:gate 可重复执行） |
| R-4 npm publish 不可撤销 | D-01 门链前置 + 单一真源权威门 + token 不落本地 + dry-run 入链 |
| R-5 tag 可移可删 | DD-4 ruleset（D-06 + runbook） |
| R-6 内部端点历史残留 | D-07 filter-repo 三段式改写 + 三重复扫 |

## 6. 切片预划分（to-issues 输入）

| 切片 | 承载 | 内容 |
|---|---|---|
| S1 | REQ-REL-07 | 07a–07d 工具化：gitleaks 指令清单 + ls-files 核查清单（含 `.sprint-state/` 处置声明）+ filter-repo **三段式 runbook**（bundle 备份 / 预演审查 / 执行 + 三重复扫 + `--replace-message` 追加轮）+ 全历史 grep 前置确认 + SHA 映射表模板 + 提交信息扫描指令 |
| S2 | REQ-REL-01a | `scripts/release-gate.mjs` 门链（**冒烟判据表冻结内置 + PATH 剥离 Bun + try/finally teardown**）+ prepublishOnly 接线 + **package.json 元数据转正（D-03 同批提交）** + scripts/ 门禁负担核对留档 |
| S3 | REQ-REL-01b | `.github/workflows/release.yml`（**显式 `npm run release:gate` 步 + publish 幂等前置**；依赖 S2） |
| S4 | REQ-REL-01c | 发布 runbook：granular token / 2FA / NPM_TOKEN / 轮换 / 情形表（部分失败补建 + 同 tag 三情形 + **发布后烟测失败决策树**） |
| S5 | REQ-REL-03 | README.md 英文全量 + README.zh-CN.md 迁入（**章节 diff=0 自检**）+ CONTEXT.md 术语对照表冻结（含 evidence 行）+ **`scripts/check-readme-parity.mjs`** |
| S6 | REQ-REL-04 | SECURITY.md + CONTRIBUTING.md（核对基准逐条对齐实况） |
| S7 | REQ-REL-05 | 双语 README fail-closed 边界段 + 威胁模型 T0 核对清单（**依赖 S5 结构冻结，串行在后**） |
| S8 | REQ-REL-06 | CHANGELOG.md `[0.2.0]` 收口（依赖 S1–S7 定稿；元数据已随 S2） |

依赖：S2 → S3；**S5 → S7 串行**（R1 A-MN-02），S6 可与 S5/S7 并行；S8 收口；
S1 工具先交付、执行在 merge 后（D-07 时序）。

## 7. 验收映射

AC-REL-01a → S2/D-01；01b → S3/D-02；01c → S4；02a → S3+S8（Release 正文取 CHANGELOG）；
03a/03b → S5/D-04；04a → S6/D-05；05a → S7/D-08；06a → S2+S8/D-03+D-06；07a–07d → S1/D-07。
迭代级验收口径 3 条不变（AC 全 PASS / 门禁全绿 / 真发布动作 = 用户扣扳机）。

## 8. R1 设计评审处置台账（v1 → v2 逐条）

| 来源 | 条目 | 处置 | 落点 |
|---|---|---|---|
| B | T-01 CRIT 门链无 teardown | try/finally：stop daemon + `npm rm -g` + 临时目录清理 | D-01 teardown / S2 |
| B | T-02 CRIT "纯 Node"判定不成立 | 受控 PATH 剥离 Bun + `bun` 不可达断言 + node ≥18 断言 | D-01 / D-02 / S2 |
| C | F-CRIT-01 filter-repo 无回滚锚点 | 三段式：bundle 备份 → mirror clone 预演人工审查 → 执行；原仓全程不触碰 | D-07 / S1 |
| A | A-MC-01 release.yml 依赖隐式钩子 | release.yml 显式 `npm run release:gate` 步（单一真源） | D-02 / S3 |
| B | T-03 prepublishOnly 可绕 + 双链漂移 | 单一真源 + 权威门=CI 显式步 + token 不落本地关闭绕过面 | D-01/D-02/S4 |
| B | T-04 同 tag 重跑判据不成立 | 三情形语义表（no-op 触发不发生 / dispatch=补建 + publish 幂等前置 / EPUBLISHCONFLICT 兜底） | D-02 / S3/S4 |
| B | T-05 改写后证据链未闭环 | 改写后全量测试门复跑留档 + SHA 映射表桥接 + 不重做评审声明 | D-07 / S1 |
| B | T-06 复扫不含 message | 范围声明（blob vs message）+ `--replace-message` 追加轮 + 三重复扫 | D-07 / S1 |
| B | T-07 关键行清单未冻结 | 按实况冻结 8 行判据表（CLI 无 `--help`、doctor 需预写受管配置两处修正） | D-01 / S2 |
| B | T-08 verify 判据不可机器判定 | 冻结 contains 锚定串 `ok: ` + `records verified` | D-01 |
| C | F-MAJ-01 发布后验证失败无处置 | 决策树：安全缺陷 deprecate+unpublish+公告 / 非安全 deprecate+0.2.1 | D-02 / S4 |
| C | F-MAJ-02 双语无自动化辅助 | check-readme-parity.mjs（章节序列 + 表行数）+ 人工行级 | D-04 / S5 |
| A | A-MN-01 替换对象无完整性确认 | 全历史 grep 前置确认 + 结果留档 | D-07 / S1 |
| A | A-MN-02 S5/S6/S7 同批语义模糊 | S5 → S7 串行、S6 并行 | §6 |
| A | A-MN-03 迁入可能破坏章节基准 | 迁入自检：章节标题序列 diff=0 留档 | D-04 / S5 |
| B | T-09 术语表 evidence 缺失 + avoid 歧义 | 术语表追加 evidence 行 + vetting avoid 注释澄清 | D-04 |
| B | T-10 同步无客观证据 | parity 脚本机器前置（并入 F-MAJ-02 处置） | D-04 / S5 |
| B | T-11 S8 时序冲突 | 元数据转正移入 S2；S8 仅 CHANGELOG 收口 | D-03/D-06/§6 |
| B | T-12 `.sprint-state/` 处置未声明 | 处置声明：保留为公开审计面，先过 07c+07a | D-07 / S1 |
| B | T-13 scripts/ 门禁负担 | 核对：oxlint/tsconfig 均不含 scripts/，不扩面；S2 验收留档 | D-01 / S2 |
| C | F-MIN-01 断言未代码化 | 冻结判据以结构化断言常量内置 release-gate.mjs | D-01 / S2 |
