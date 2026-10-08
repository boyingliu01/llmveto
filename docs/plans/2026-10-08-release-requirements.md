# GitHub 开源发布需求陈述 v2（sprint-20261008-26 · R1 修订版，R2 评审输入）

> v1 → v2 修订：吸收 R1 三专家 GAPS_FOUND 全部缺口（敏感信息扫描 / npm 凭据安全 / tag 保护 /
> AC 判据客观化 / 维护模式 / 依赖显式化）。修订对照见 §修订对照表。
>
> 迭代目标：把 llmveto v1（已验证的本地 LLM 流量安全网关 MVP，全量测试 296 passed | 3 skipped、
> 覆盖率四项 ≥84、v1 部署验收 6/6 PASS）以开源形态发布到 **GitHub（public）+ npm registry**，
> 供开发人员自用。定位（用户 2026-10-08 拍板）：开发人员**自用**的大模型投毒安全守门员，
> **不考虑对外销售**。特性优先级：安全、性能、可审计性、透明性为主；打包分发、文档、上游容错、
> 安装部署易用性也需关注。

## 干系人决策（已拍板，见 .sprint-state/decisions.md DR-001..005）

| # | 决策 |
|---|---|
| DR-001 | v2a BUILD（15 切片检测核心）独立挂起，本迭代只做发布面 |
| DR-002 | npm registry + GitHub Release 双通道（npm 名 `llmveto` 已核实未占用） |
| DR-003 | 上游容错维持 fail-closed 现状 + 边界登记，零运行时改动 |
| DR-004 | 双语完整：英文 README 全量镜像（用户明确选择） |
| DR-005 | v2a 活动登记已 --force 退役（状态备份 .sprint-history/） |

## 事实基线（2026-10-08 核实，R1 后补核）

- 仓库当前 **PRIVATE**（`gh repo view` 实测）——公开化动作尚未发生，历史处置窗口存在
- npm 名 `llmveto` 未占用（registry E404 实测）
- package.json scripts 实况：`llmveto/build/start/stop/status/doctor/test/test:watch/test:coverage/
  typecheck/typecheck:dist/lint/bench:record/clean`——**无 scripts/ 目录、无 sync-version 脚本**；
  版本一致性由 pre-commit **Gate 0（Version Consistency）** 把守（sprint-flow 模板引用的
  `scripts/sync-version.cjs` 不存在，VERSION-GATE 修复以手工同步 + Gate 0 验证为准）
- VERSION=0.2.0 与 package.json 一致
- **无凭据入库**：API key 仅环境变量注入；`git grep OPENCODE_EXAMPLE_API_KEY` 仅命中文档中
  的变量名提及（docs/delphi-panel.md 等）
- **内部端点已入库（已识别实例）**：`https://internal-gateway.invalid/redacted` 出现在
  `docs/delphi-panel.md`、`.sprint-state/g-canary-recording-spec.md`、
  `.sprint-state/phase-outputs/phase-2-summary.md`、`.sprint-state/phase-outputs/requirements-reviewed.json`
  （均已合并 main；处置口径属 DD-11）
- `.delphi-config.json` 等本地配置**未跟踪**（var/ 仅 canary-split.ts / capture-proxy.ts /
  mock-relay.ts 三件工具入库）
- 已有：MIT LICENSE；README.md 151 行中文（能力边界表/快速开始/CLI/环境变量/分发承诺）；
  docs/issues 五件套 + ADR + licenses.md；CI = test.yml + bench.yml；
  package.json 0.2.0 已配 bin/files/engines；VERSION 门 = Gate 0
- 缺失：`private: true` 转正（ADR-0001 明文承诺"转为公开发布前须补齐发布流程与构建门"）；
  repository/homepage/bugs/keywords 元数据；英文 README；SECURITY.md / CONTRIBUTING.md；
  release.yml；CHANGELOG（或有）；支持政策章节

## 需求清单

### REQ-REL-07 仓库公开化前置检查（新增；**阻断性，时序第一**——先于一切 public 化动作）

- AC-REL-07a：gitleaks 对全量 git 历史 + 工作区扫描，高置信发现 = 0（工具本地一次性使用，
  不入仓不分发，与 docs/licenses.md "不捆绑 gitleaks" 决议不冲突）
- AC-REL-07b：公开面核查：`git ls-files` 无内部路径（.worktrees/、evidence、本地配置、
  .sprint-history/）；.gitignore 完备性核对清单留档
- AC-REL-07c：内部域名/端点处置：已识别实例（见事实基线）按 DD-11 拍板口径执行并留验证证据
  （口径候选：A. 历史改写 filter-repo → 全库新 SHA，代价 = 全部历史绑定证据 SHA 失效需登记映射；
  B. 前瞻脱敏新提交 + 接受历史残留；仓库 PRIVATE 现状下两案均可行，公开动作在处置完成后才发生）
- AC-REL-07d：历史提交信息扫描（内部人名/邮箱/域名/工单号口径）零处置项或已按口径处置

### REQ-REL-01 npm 发布转正（ADR-0001 承诺兑现）

- package.json：`private` 移除或置 false；补 `repository`/`homepage`/`bugs`/`keywords`/`license`；
  `files` 审计（是否纳入 docs/ 属 DD-5）
- **发布前置构建门**（不可跳过，R-4）：干净构建（`bun install && bun run build`）+ 全量测试 +
  `npm publish --dry-run` + dist 烟测
- AC-REL-01a（判据客观化）：`npm pack` 产物经 `npm i -g <tarball>` 安装后，在**无 Bun 的纯 Node ≥18
  环境**（形态属 DD-9）逐一验证 `llmveto --help/start/stop/status/doctor/verify`：每命令退出码 0 +
  预期输出关键行（精确清单 BUILD 期随规格冻结，例：start 输出 pid/url 行、status 输出 running、
  verify 输出链完整）
- AC-REL-01b（失败语义补全）：`.github/workflows/release.yml`——触发 = tag push 匹配
  `^v[0-9]+\.[0-9]+\.[0-9]+$` **且** `workflow_dispatch` 手动入口；任一门红 → 不 publish 不 Release；
  部分失败 runbook（publish 成功而 Release 失败 → 手动补 Release 步骤；同 tag 重跑 → 显式拒绝）
- AC-REL-01c（新增）：npm 凭据安全口径——granular access token 最小权限（仅本包 publish scope）、
  发布账号 2FA 启用确认、NPM_TOKEN 入 GitHub secret、token 轮换口径写入发布 runbook

### REQ-REL-02 GitHub Release 通道

- AC-REL-02a：打合规 tag 后自动产出 GitHub Release，正文含该版本要点；CHANGELOG 口径随 DD-1

### REQ-REL-03 英文 README 全量双语（DR-004）

- 与中文 README 内容对等的全量英文镜像；两版顶部互链；主文件方向（README.md=英文 or 中文）属 DD-10
- AC-REL-03a（判据客观化）：基准 = 中文 README **章节清单**（冻结入规格）逐章对等 + 能力表/
  环境变量表/CLI 表**行级核对** + 术语对照表（CONTEXT.md 受控词英文定译——过闸/扫描单元/verdict/
  finding/error 等，设计期产出并冻结）；漂移控制机制属 DD-2
- AC-REL-03b：术语对照表存在且覆盖 CONTEXT.md 全部受控词

### REQ-REL-04 开源卫生件

- SECURITY.md（漏洞报告流程 + 响应承诺，承诺口径随 DD-7）、CONTRIBUTING.md（轻量；外部贡献
  口径随 DD-6）
- AC-REL-04a（核对基准客观化）：两文件描述与仓库实况逐条一致——核对基准 = package.json scripts
  实况清单（见事实基线）+ pre-commit 12 门名称 + Gate MW（推送证据绑 HEAD）+ #367 对齐报告门；
  前置核实任务已完成（scripts 实况已盘点）

### REQ-REL-05 上游容错边界登记（零代码）

- README（中/英）+ 威胁模型 T0 行核对：fail-closed 已缓解 + "无重试/备用上游，属 v2 运营面"边界明示
- AC-REL-05a（定位基准）：威胁模型 `docs/issues/1-req-threat-model.md` T0 行 + README
  §分发与 runtime 承诺 段逐点核对；`src/` 零改动

### REQ-REL-06 版本与变更记录

- 首个公开发布版本号属 DD-3；CHANGELOG.md 设立即 DD-1
- AC-REL-06a（判据客观化）：tag 格式 `vX.Y.Z` 与 package.json `version` **严格一致**（`v` + 同值）；
  版本改动（如需）与 package.json/VERSION **同一提交**（Gate 0 中间态防护）；Gate 0 绿

### 依赖与时序（切片排序依据）

1. REQ-REL-07 **先于一切** public 化动作（硬时序，不可逆动作前置）
2. REQ-REL-03 依赖中文 README 冻结点（本迭代内中文版改动收敛后）
3. REQ-REL-01b 依赖 REQ-REL-01a 构建门成形
4. REQ-REL-06 版本拍板 → package.json/VERSION/CHANGELOG 同批落地
5. 公开化动作（repo visibility 翻转 + npm publish）= 用户确认后执行（验收口径 3）

## 非目标

- v2a BUILD 15 切片（4 checker + canary 引擎 + evil-relay）——独立挂起（DR-001）
- 上游重试/备用上游实现（DR-003）
- 单二进制分发（bun --compile，README 已声明属 v2 候选）
- Docker/企业级分发形态
- npm 包签名（Sigstore/cosign）
- 社区运营与外部 PR 接受政策落地（CONTRIBUTING 口径本身随 DD-6 拍板，但不含运营机制建设）

## 风险登记

- R-1a NPM_TOKEN secret 配置（用户侧，BUILD 交付前完成即可）
- R-1b npm 账号安全（2FA 未启用 → release.yml publish 失败；token 权限过大 → 供应链风险）
  → AC-REL-01c 承载
- R-2 双语漂移 → DD-2 必须给出可执行同步基准
- R-3 发布工作流首次真跑才有验证机会 → `npm pack` 本地全链路演练替代（固化为可重复脚本/清单）
- R-4 `npm publish` 不可撤销（72h unpublish 窗口）→ 构建门前置且不可跳过 + dry-run 入门
- R-5 tag 保护（tag 可移动/删除 = 发布可重放）→ DD-4 拍板 ruleset 口径
- R-6 内部端点历史残留（已识别实例见事实基线）→ DD-11 拍板处置口径

## 设计拍板项清单（batch-grill-me 输入）

| # | 拍板项 |
|---|---|
| DD-1 | CHANGELOG.md 设立与否及风格（候选：设立，Keep a Changelog 轻量风） |
| DD-2 | 双语同步机制（中文为准 + 双文件同改检查项 / CI 章节清单机器核对） |
| DD-3 | 首发版本号（0.2.0 直发 / bump 0.2.1 / 0.3.0 / 1.0.0-rc） |
| DD-4 | tag 保护规则（GitHub ruleset 防删防移）口径 |
| DD-5 | npm files 字段是否纳入 docs/（候选：不纳入，保持 dist+README+LICENSE） |
| DD-6 | 外部贡献口径（接受 issue/PR 与否 + 响应承诺） |
| DD-7 | Support Policy 口径（候选：安全响应 best-effort + 不承诺功能请求） |
| DD-8 | 源码文件级 SPDX/License 头声明策略（候选：不加，LICENSE 文件足够） |
| DD-9 | 纯 Node 验证环境形态（Docker node:20 / 独立 Node 环境） |
| DD-10 | README 主文件方向（README.md=英文+README.zh-CN 镜像 / 反之） |
| DD-11 | 内部端点历史处置（A. filter-repo 全量改写 vs B. 前瞻脱敏+接受残留） |

## 验收口径（迭代级）

1. AC-REL-01a..07d 全部 PASS
2. 全量测试门/覆盖率门/12 道 pre-commit 门全绿；推送走 Gate MW
3. 发布演练（pack→install→烟测）通过；**真发布动作（repo 公开化 + npm publish + GitHub Release）
   由用户确认后执行**——本迭代交付"可发布态"，扣扳机属用户决策点
