# 发布 runbook — npm + GitHub Release（REQ-REL-01b/01c · AC-REL-01b/01c）

维护者操作手册。权威门链 = `scripts/release-gate.mjs`（`npm run release:gate`）；
发布工作流 = `.github/workflows/release.yml`。真发布动作（tag push / publish / Release）由维护者确认后执行。

## 0. 发布日 checklist（全部满足才打 tag）

| # | 项 | 判据 |
|---|---|---|
| 1 | NPM_TOKEN 已入 GitHub secret | Settings → Secrets and variables → Actions 存在 `NPM_TOKEN`；token 类型与权限见 §3 |
| 2 | npm 账号 2FA | npmjs.com → Account Settings → Two-Factor Authentication = enabled |
| 3 | 版本三点一致 | tag 名 = `v` + package.json `version`（严格同值，workflow 硬校验）；CHANGELOG.md 存在 `## [<version>]` 节 |
| 4 | main 全绿 | test workflow（含覆盖率门）最近一次 run PASS |
| 5 | 门链本机过 | `npm run release:gate` PASS（本机演练，不触 registry） |
| 6 | 本地无 publish token | `npm whoami` 未登录或非 publish token（见 §3 绕过面口径） |

## 1. 正常发布路径

1. `git tag v0.2.0 && git push origin v0.2.0`
2. workflow 依次执行：install → build → test → **release:gate（权威门链：pack → install-tarball →
   smoke（PATH 剥离 Bun）→ publish-dry-run）** → tag↔package.json 一致性 → publish（幂等前置）→
   GitHub Release（正文 = CHANGELOG 该版本节）
3. 发布后核验：`npm view llmveto@<version>` 在架；GitHub Releases 页出现该版本且正文为对应节；
   `npm i -g llmveto` 真装烟测通过
4. 部分失败按 §2 情形表处置；真装烟测失败按 §4 决策树处置

## 2. 情形表

| # | 情形 | 现象 | 处置 |
|---|---|---|---|
| ① | 同 SHA tag 重复 push | workflow 不触发 | **预期行为**（GitHub 对已存在 ref 静默 no-op），非拒绝、无需处置 |
| ② | 需补建 Release | publish 已在架但 Release 缺失 | `workflow_dispatch` 手动触发 = 合法补建入口：publish 步被幂等前置跳过（registry 已有该版本），仅补 `gh release create`（`--target` 取 dispatch 时 SHA） |
| ③ | publish 成功而 Release 步失败 | job 红在最后一步 | 先归因：CHANGELOG 节缺失 → 补节后 `workflow_dispatch` 重跑；gh 瞬时故障 → 直接 `workflow_dispatch` 重跑（②路径，publish 不会重发） |
| ④ | registry 查询失败且非 E404（T-R2-02） | job 红在 publish 步，日志含非 404 错误 | **fail-closed**（workflow 不 publish）；网络/registry 恢复后 `workflow_dispatch` 重跑。不得改脚本绕过查询 |
| ⑤ | 强发重复内容 | npm 侧 `EPUBLISHCONFLICT` 报错 | 兜底语义生效（registry 已有该版本）；确认无重发需求后走 ②补建 Release |

## 3. 凭据安全口径（AC-REL-01c）

- **token 最小权限**：npm **Granular Access Token**，权限仅 **Read and write（Packages）**，
  包范围仅 `llmveto`；禁用长期有效的经典 Full Access Token
- **NPM_TOKEN 仅存 GitHub secret**，本地 npmrc 不持有 publish token。本地 `npm publish` 无凭据
  自然不可行，`--ignore-scripts` 的本地绕过面因此关闭（权威门 = workflow 显式步；
  `prepublishOnly` 为本地纵深防御，二者语义见设计 D-01「防跳过定位」）
- **2FA**：发布账号必须启用（第 0 节 checklist 项 2）；2FA 未启用时 workflow publish 步会失败
- **轮换**：每 90 天例行，或疑似泄露立即执行——npmjs.com 吊销旧 token → 生成新 granular token
  → 更新 GitHub secret `NPM_TOKEN` → 删除旧 token。轮换窗口内 release workflow 不可用属预期

## 4. 发布后真装烟测失败决策树（R2 F-MAJ-01）

第 1 步判定：缺陷是否**安全性质**（阻断失效 / 注入路径 / 上下文泄露 / evidence 链失真）。

**安全缺陷（立即处置，不过夜）**：

1. `npm deprecate llmveto@<version> "security defect: <一句话>"` —— 立即阻止新装机
2. 72h unpublish 窗口内 `npm unpublish llmveto@<version> --force` —— registry 移除
3. 开**公开** issue 公告：受影响版本、缺陷性质、已装用户应立即 `npm rm -g llmveto`
4. 处置过程留痕：CHANGELOG 该版本节加注 Security 处置记录

**非安全缺陷（功能/兼容性问题）**：

1. `npm deprecate llmveto@<version> "<缺陷说明>; use >=<patch> instead"`
2. 修复 → 重走门链（release:gate 全链）→ `v<patch>` 打 tag 发补丁版本（如 0.2.1）
3. CHANGELOG 登记

## 5. tag 保护 ruleset（DD-4 · 公开化 checklist 项）

- 路径：Settings → Rules → Rulesets → New branch ruleset（resource = Tags）
- 目标 pattern：`v*`；规则勾选 **Restrict deletions**（防删）与 **Restrict updates**（防移）
- Bypass list 留空；执行时点 = repo 公开化之后（见 `publication-runbook.md` 公开化 checklist，
  本迭代只交付口径，不执行配置）

## 6. 演练与真发布的关系（R-3 / R-4）

- `npm publish` 不可撤销（仅 72h unpublish 窗口）→ 构建门前置且不可跳过；
  本地演练 = `npm run release:gate`（pack/install/smoke/dry-run 全链，不触 registry、无凭据即可跑）
- 发布工作流首次真跑前，演练面已覆盖除 `gh release create` / 真 publish 外的全部步骤；
  首次真跑的额外风险集中在 §2 情形表与 §4 决策树的覆盖范围
