# Phase 3/6 BUILD — Summary（sprint-20261008-26 · GitHub 开源发布）

status: completed

## 交付物（8/8 切片 done，提交 3becce3 → b7b7ac4）

| 切片 | 提交 | 内容 |
|---|---|---|
| RL-02 | 3becce3 | `scripts/release-gate.mjs` 十步门链（含冻结 8 行冒烟判据 + seed 留痕 + PATH 剥离 Bun + try/finally teardown）；package.json 元数据转正（private 移除 + repository/homepage/bugs/keywords + release:gate/prepublishOnly 接线）；rimraf 补 devDeps（clean 坏依赖修复） |
| RL-03 | 29d1eb3 | `.github/workflows/release.yml`：tag+dispatch 触发、显式门链步、publish 幂等（E404/已存在/非 E404 fail-closed/EPUBLISHCONFLICT）、Release 正文取 CHANGELOG 节、tag↔package.json 一致性硬校验 |
| RL-04 | 0088830 | `docs/release/publishing.md`：凭据四要素 / 同 tag 情形表 / 真装烟测失败决策树（F-MAJ-01）/ DD-4 ruleset / 发布日 checklist |
| RL-01 | 147aa4c | `docs/release/publication-runbook.md`：07a–07d 工具化（gitleaks 双扫 / ls-files 清单 / filter-repo 三段式 + SHA 映射模板 / message 扫描 + --replace-message 追加轮）；.gitignore 补 `.sprint-history/` 与 `.archlint-cache/` |
| RL-05 | a547cf1 | README.md=English 全量 + README.zh-CN.md 迁移（首行互链）；CONTEXT.md Glossary 26 行冻结；`scripts/check-readme-parity.mjs`（10 标题对表 + 5 表行数 + 迁入自检 diff=0 全过） |
| RL-06 | 6ee43aa | SECURITY.md + CONTRIBUTING.md（英文保守承诺，scripts 实况核对） |
| RL-07 | 515bbe4 | 双语 fail-closed 边界 bullet + boundary-checklist.md（T0 基准 + src 零改动断言 base=bd4bb40 diff 0 行） |
| RL-08 | 02a2569 | CHANGELOG.md（Keep a Changelog 轻量风，[0.2.0] 首版节，Release 正文来源） |
| 收口 | b7b7ac4 | DD-5 修订：npm README* 默认纳入不可排除（files/.npmignore/取反三连败实测），tar 白名单显式接受 zh 镜像；终态全链复跑 PASS |

## 验证记录

- **G-PUBLISH 本机全链 PASS（终态）**：10 步全过 + smoke 8 行判据全过（含 seed 502 留痕）+
  基线 326 passed | 1 skipped ≥ 冻结下界 296；teardown 无残留（全局包/临时目录核查）
- `node scripts/check-readme-parity.mjs --check-migration` PASS（迁移自检 diff=0；中英 10 标题逐对相等；5 表行数 [5,8,9,7,6] 相等）
- src/ 零改动断言：`git diff bd4bb40 -- src/` = 0 行
- pre-commit 12 门全绿（每切片提交均过，无 --no-verify）

## decisions（BUILD 期实现裁定）

1. **链序修正**：install → clean（D-01 原序 clean→install 在 fresh checkout 不可行，rimraf 未装；clean-rebuild 语义不变）
2. **clean 坏依赖修复**：`bun run clean` 引用未声明依赖 rimraf，补 devDependencies ^6.1.3（全仓受益）
3. **DD-5 修订**：npm 默认纳入 README* 变体且 files/.npmignore/取反均不可排除（npm 11 实测）——README.zh-CN.md 随包为既成事实，白名单显式接受；npm 渲染面仍为 README.md，DD-5 意图不受影响
4. **endpoint 实例事实更新**：端点入库实例已从冻结时点 4 文件增至 8+（本 sprint 处置引用自产文件）——07c 前置确认改为执行时点动态导出（已固化进 publication-runbook §3.0）
5. seed 步成立依据：EvidenceWriter 仅在流量时落记录（writer.ts 实况），无路由 POST → 502 + evidence（server.ts:165-178），verify/doctor 的 `chain ok (` 锚定串依赖 ≥1 条记录

## next_phase_context（Phase 4 VERIFY 输入）

- 走查范围 = bd4bb40..HEAD（branch point → 终态），交付物全为 docs/workflow/scripts/package.json，src/ 零改动
- #367 对齐报告：specification.yaml 未改动（本 sprint），报告 head_commit 需对齐刷新至当前 HEAD（固定点规程：未提交刷新 → transition → 证据与 sprint-state 同批提交）
- 用户侧前置项未了：NPM_TOKEN 入 secret（R-1a）、三个扣扳机点（visibility 翻转 / filter-repo 执行 / npm publish+Release）
- release.yml 首次真跑留待 tag 时验证（R-3：演练面已覆盖除真 publish/gh release 外全部步骤）

outputs: [scripts/release-gate.mjs, scripts/check-readme-parity.mjs, .github/workflows/release.yml, docs/release/publishing.md, docs/release/publication-runbook.md, docs/release/boundary-checklist.md, README.md, README.zh-CN.md, CONTEXT.md, SECURITY.md, CONTRIBUTING.md, CHANGELOG.md, .gitignore, package.json, .sprint-state/slices-manifest.json]

decisions: [install→clean 链序修正, rimraf devDeps 补入, DD-5 修订（npm README* 既成事实）, 07c 替换集合动态导出, seed 步依据 writer.ts/server.ts 实况]
