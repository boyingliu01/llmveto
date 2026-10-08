# 公开化前置 runbook — 07a–07d（REQ-REL-07 · DD-11 = A 案全量改写）

维护者操作手册。**执行时点 = 本迭代全部切片 merge main 之后、repo visibility 翻转之前**，
由维护者确认后执行（验收口径 3：扣扳机属用户决策点）。此时点后置的原因：A 案改写全库
SHA，执行时若本 sprint worktree 仍存在则随之作废——必须 merge 后执行。

> **不可逆警示**：07c force-push 覆盖 origin 后全库 SHA 变更，唯一恢复源 = 第一段的
> bundle 备份。每一段完成后先核对判据再进下一段；任一判据不过，停止并从 bundle 恢复评估。

## 0. 环境准备（一次性）

- `gitleaks`：单二进制，**本地一次性使用，不入仓不分发**（与 docs/licenses.md「不捆绑
  gitleaks」决议不冲突）。安装：GitHub release 下载对应平台二进制，或 `scoop install gitleaks`
- `git filter-repo`：Python 工具。WSL 内 `pip install git-filter-repo`（推荐），或 Git-Bash +
  Windows Python ≥3.5 后 `pip install git-filter-repo`；`git filter-repo --version` 可执行为准
- 替换规则文件 `replacements.txt`（**UTF-8、无 BOM、LF 换行**——CRLF 会导致 blob 匹配失败），
  置于仓库目录**之外**：

  ```
  internal-gateway.invalid/redacted==>https://internal-gateway.invalid/redacted
  internal-gateway.invalid==>https://internal-gateway.invalid/redacted
  ```

  长串在前（先精确端点、后裸域名）；`.invalid` 为保留域，占位符无重指向风险。

## 1. 07a — gitleaks 全历史 + 工作区扫描（AC-REL-07a）

在主仓根执行：

```bash
gitleaks git -v --report-path ../gitleaks-history.json    # 全历史 blob 扫描
gitleaks dir . -v --report-path ../gitleaks-worktree.json # 工作区扫描
```

**过闸判据 = 高置信发现 = 0**（两份报告留档）。非零发现逐条人工归因：确认真泄密 →
先处置再继续；工具误报（如测试夹具样例串）→ 归因说明留档后排除，**不允许静默跳过**。

## 2. 07b — 公开面核查（AC-REL-07b）

```bash
git ls-files > ../tracked.txt
grep -E "^\.worktrees/" ../tracked.txt                    # 必须为空
grep -E "^\.sprint-history/" ../tracked.txt               # 必须为空
grep -E "\.delphi-config\.json|\.code-walkthrough-result" ../tracked.txt   # 必须为空
grep -E "evidence" ../tracked.txt                         # 必须为空（evidence 产物不入库）
grep -E "^var/" ../tracked.txt                            # 仅 canary-split.ts / capture-proxy.ts / mock-relay.ts
```

**.gitignore 完备性清单**（核对基线 = 仓库实况，随本 runbook 留档）：`node_modules/`、`dist/`、
`coverage/`、`.worktrees/`、`.xp-gate/`、`.quality-history.jsonl`、`.code-walkthrough-result.json`、
`.omo/`、`.qoder/`、`.llmveto/`、`bench/baseline.local.json`、`.env*`、`*.pem`、`*.key`、
`var/*`（白名单 `!var/*.ts`）均已覆盖；`.sprint-history/` 与 `.archlint-cache/` 已随本 runbook
交付补入 .gitignore（此前为未跟踪但未显式忽略）。

**`.sprint-state/` 处置声明（R1 T-12）**：`.sprint-state/` **保留为公开审计面**（透明性优先级），
但保留前提 = 先过 §3 端点改写（其含已识别端点实例）+ §1 复扫。**不接受「顺手删除」**——
审计链完整性优先于面面俱到的干净。

## 3. 07c — 内部端点全量改写（AC-REL-07c · filter-repo 三段式）

### 3.0 前置确认：动态导出替换对象集合（R1 A-MN-01）

```bash
git log -p --all | grep -F "internal-gateway.invalid" | grep -oE "^diff --git a/[^ ]+" | sort -u
```

**集合以执行时点实测为准，不硬编码**。已知基线（设计冻结时点）= 4 文件
（docs/delphi-panel.md、.sprint-state/g-canary-recording-spec.md、.sprint-state/phase-outputs/
phase-2-summary.md、.sprint-state/phase-outputs/requirements-reviewed.json，均已在 main）。
**预期新增** = 本 sprint 自产且引用端点作为处置对象的文件（release 设计/需求文档、
specification.yaml、.sprint-state 决策与共识记录等）——它们提及端点正是为了处置端点。
**除上述两类外出现未知文件 → 停止，先查明再继续**；扫描结果与替换清单并档。

范围声明（R1 T-06）：`--replace-text` 只改 blob，**不改 commit/tag message**——message 侧归 §4。

### 3.1 第一段：备份（回滚锚点）

```bash
git bundle create ../llmveto-pre-rewrite.bundle --all
git bundle verify ../llmveto-pre-rewrite.bundle   # 校验通过 = 恢复源可用
```

bundle 存放于仓库目录之外；改写全程原仓未被触碰，bundle 即改写前全历史快照。

### 3.2 第二段：mirror clone 预演 + 人工审查

```bash
git clone --mirror <origin-url> ../llmveto-mirror.git
cd ../llmveto-mirror.git
git filter-repo --replace-text ../replacements.txt --force
```

审查判据（全部通过才进第三段）：

```bash
git log -p --all | grep -cF "internal-gateway.invalid"          # 必须 = 0
git log -p --all | grep -cF "internal-gateway.invalid"     # 必须 > 0（占位符确已写入）
ls .git/filter-repo/commit-map                              # 旧→新 SHA 映射存在（§5 用）
```

filter-repo 出于安全会移除本 clone 的 origin remote——第三段重加。

### 3.3 第三段：force-push 覆盖 origin + 三重复扫

```bash
git remote add origin <origin-url>
git push --force --all origin
git push --force --tags origin
```

随后**三重复扫，零残留为过闸判据，非可选项**：

| 复扫 | 指令 | 判据 |
|---|---|---|
| 07a blob 侧 | 重新 clone 后跑 §1 两条 gitleaks | 端点零命中 |
| 07b 工作区侧 | 重新 clone 后跑 §2 清单 + `git grep -F internal-gateway.invalid` | 零命中 |
| 07d message 侧 | §4 两条扫描 | 零命中或已处置 |

### 3.4 改写后闭环（R1 T-05）

- **测试门复跑**：改写只动历史不动工作树内容 → 改写后 main 重新 clone，`bun install &&
  bun run test` 全量复跑，预期全绿，结果留档
- **SHA 映射桥接**：sprint 证据链（走查报告 / requirements-reviewed / delphi-reviewed 的
  head_commit）以 §5 映射表桥接，**不重做评审**——评审对象内容零变化，仅历史锚点迁移
- **悬链登记**：GitHub PR/issue 引用的旧 SHA 成为悬链——接受并登记，不做修复
- **本地环境重建**：原本地 clone / worktree 历史已陈旧，映射表填完后重新 clone，
  旧 clone 仅在确认无未推内容后废弃

## 4. 07d — 提交信息扫描（AC-REL-07d · 对象明含 commit 与 tag message）

```bash
git log --all --format="%H%n%s%n%b%n---" | grep -inE "examplecorp|lab\.|gateway" # commit message 侧
git tag -l --format="%(refname:short)%(contents)" | grep -inE "examplecorp|gateway"  # tag message 侧
```

口径：内部域名/内部人名/内部邮箱/工单号——执行时按当时清单扩展 pattern。**过闸判据 =
零处置项，或命中项已按口径处置**。

**message 命中端点 → `--replace-message` 追加轮**（同 runbook 指令序列，T-06 范围声明承接）：

```bash
cd ../llmveto-mirror.git
git filter-repo --replace-message ../replacements.txt --force
# 重复 3.3 force-push + 三重复扫，直至 message 侧与 blob 侧双双归零
```

## 5. SHA 映射表模板（并入本 runbook 留档）

数据源 = `../llmveto-mirror.git/.git/filter-repo/commit-map`（旧 SHA → 新 SHA 全表）。
对证据文件记录的每个 head_commit 逐条登记：

| 证据文件（main 路径） | 记录的 pre-SHA | post-SHA（commit-map 查得） |
|---|---|---|
| .sprint-state/delphi-reviewed.json | `<旧 40 位>` | `<新 40 位>` |
| .sprint-state/phase-outputs/requirements-reviewed.json | `<旧 40 位>` | `<新 40 位>` |
| .sprint-state/review/rel-*.md（走查/共识记录内引用的 HEAD） | `<旧 40 位>` | `<新 40 位>` |
| test-alignment-report.json（head_commit 字段） | `<旧 40 位>` | `<新 40 位>` |

查询：`grep "^<pre-SHA>" ../llmveto-mirror.git/.git/filter-repo/commit-map`。

## 6. 公开化 checklist（visibility 翻转前逐项打勾）

| # | 项 | 判据 | 出处 |
|---|---|---|---|
| 1 | 07a gitleaks 双扫 | 高置信发现 = 0（报告留档） | §1 |
| 2 | 07b 公开面核查 | 清单全空 + .gitignore 完备 | §2 |
| 3 | 07c 改写闭环 | 三重复扫零残留 + 测试门全绿 + 映射表归档 | §3 |
| 4 | 07d message 扫描 | 零处置项或已处置（含追加轮后归零） | §4 |
| 5 | tag 保护 ruleset | Settings → Rulesets：`v*` Restrict deletions + Restrict updates，bypass 空 | publishing.md §5 |
| 6 | 开源卫生件就位 | README 双语 / SECURITY / CONTRIBUTING / CHANGELOG 已在 main | 本迭代 S5–S8 |
| 7 | **维护者确认扣扳机** | repo visibility 翻转（private → public） | 验收口径 3 |
| 8 | 首次发布 | 打 `v0.2.0` tag → release.yml 首跑 → npm + GitHub Release | publishing.md §1 |
