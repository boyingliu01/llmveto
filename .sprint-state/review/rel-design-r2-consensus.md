# R2 设计评审共识记录 — sprint-20261008-26「GitHub 开源发布」

> 链：Round 1（A=APPROVED 8 / B=REQUEST_CHANGES 8 / C=REQUEST_CHANGES 8）→ 设计文档 v2 修订
> （处置台账 21 行）→ Round 2 交换核验（3×APPROVED 9/8/9，共识比 1.0）。
> 判据：delphi-review design 模式，三专家（三 distinct 模型）+ 四执行器 checks 全绿。
> 评审对象：docs/plans/2026-10-08-release-design.md；需求基线 = 需求陈述 v2（R1 需求链 3/3 APPROVED，
> requirements_hash 510273de…）。拍板 DR-001..011 声明为不在挑战范围。

## Round 1（2026-10-09，卷面 var/delphi-r11/input-rel-design-r1.md，结果 rel-design-experts-r1.json）

A=APPROVED(8) / B=REQUEST_CHANGES(8) / C=REQUEST_CHANGES(8)，合计 **3 Critical + 9 Major + 9 Minor**：

| 严重度 | 条目 |
|---|---|
| Critical | T-01 门链无 teardown（残留全局包/daemon）；T-02 "纯 Node"判定不成立（有 Bun 机器证伪不了）；F-CRIT-01 filter-repo 无回滚锚点与预演 |
| Major | A-MC-01 release.yml 依赖 prepublishOnly 隐式触发；T-03 prepublishOnly 可绕 + 双链漂移；T-04 同 tag 重跑判据不成立；T-05 改写后证据链未闭环；T-06 复扫不含 commit message；T-07 关键行清单未冻结；T-08 verify 判据不可机器判定；F-MAJ-01 发布后验证失败无处置；F-MAJ-02 双语无自动化辅助 |
| Minor | A-MN-01/02/03；T-09..T-13；F-MIN-01（共 9 条，清单见设计 v2 §8 台账） |

## 修订（设计文档 v1 → v2，fix commit bc4f065）

21 行逐条处置台账（设计 v2 §8），处置要点：

1. **冒烟判据按 CLI 实况冻结**（T-07/T-08/F-MIN-01）：8 行判据表（退出码 + contains 锚定串），
   出题方补核 `src/cli/index.ts` 后修正设计两处实况错误——CLI **无 `--help`**（改为无参调用
   exit 2 + valid 清单锚定）；**干净环境 doctor 必漂移**（doctor 前预写
   LLMVETO_OPENCODE_CONFIG/LLMVETO_DELPHI_CONFIG 受管配置副本）。
2. **"纯 Node ≥18"判定重做**（T-02）：受控 PATH 剥离含 bun 的目录 + `bun` 不可达断言 +
   node ≥18 断言；runner 冒烟同用（D-02）。
3. **门链 teardown**（T-01）：install-tarball/smoke/publish-dry-run 包 try/finally——
   stop daemon + `npm rm -g` + 临时 STATE_DIR 清理。
4. **单一真源 + 权威门**（A-MC-01/T-03）：release.yml 显式 `npm run release:gate` 步；
   prepublishOnly 降为本地纵深；`--ignore-scripts` 绕过面以"publish token 仅存 GitHub secret、
   本地不持有"关闭（AC-REL-01c 承载）。
5. **同 tag 重跑三情形**（T-04）：同 SHA 重 push = no-op 不触发（登记为预期）；workflow_dispatch
   = 补建 Release 合法入口 + publish 幂等前置（`npm view` 已存在则跳过）；EPUBLISHCONFLICT 兜底。
6. **filter-repo 三段式**（F-CRIT-01/A-MN-01/T-05/T-06）：bundle 备份（回滚锚点）→ mirror clone
   预演 + 人工审查 → force-push + 三重复扫（blob 07a/07b + message 07d）；全历史 grep 前置确认
   替换集合；范围声明（--replace-text 只改 blob，message 归 07d，命中则 --replace-message 追加轮）；
   改写后全量测试门复跑留档 + SHA 映射表桥接 + 不重做评审声明。
7. **发布后故障决策树**（F-MAJ-01）：安全缺陷 deprecate + 72h unpublish 窗口 + 公告；
   非安全 deprecate + 0.2.1 补丁。
8. **双语机器辅助**（T-10/F-MAJ-02）：`scripts/check-readme-parity.mjs`（章节标题序列 + 三表行数）
   + 人工行级核对（DD-2 口径修订，DR-011）。
9. 其余 Minor：S5→S7 串行（A-MN-02）、迁入章节 diff=0 自检（A-MN-03）、术语表追加 evidence 行 +
   vetting avoid 注释（T-09）、`.sprint-state/` 处置声明（T-12）、scripts/ 门禁负担核对（T-13）、
   元数据转正移入 S2 / S8 仅 CHANGELOG 收口（T-11）、断言结构化内置（F-MIN-01）。

## Round 2 交换核验（卷面 input-rel-design-r2.md，结果 rel-design-experts-r2.json）

三家 **APPROVED**（A=9 / B=8 / C=9），0 Critical / 0 Major，共识比 1.0 ≥ 0.90。
执行器四 checks 全绿（all_experts_succeeded / requested_models_distinct /
executed_models_distinct / executed_models_match_expected_echo）。

## 残留 Minor（5 条，APPROVED 附注；处置落规格/切片验收）

| 来源 | 条目 | 处置 |
|---|---|---|
| A | A-R2-MN-01 parity 脚本不挂 CI 应设复审触发条件 | → S5/S6 验收：任一 README 结构性改动（章节/表行）须在 PR 附 parity 运行输出；触发约定写入 CONTRIBUTING 贡献流程 |
| B | T-R2-01 doctor 受管配置副本来源与最小字段集未冻结 | → S2 验收：release-gate.mjs 冻结两份受管配置副本的最小字段集（以 readCurrentConfig 可解析 + drift=0 为判准），生成方式留档 |
| B | T-R2-02 publish 幂等前置未定义 registry 查询失败语义 | → S3/S4：`npm view` 非"已存在"类失败按 fail-closed 阻断 publish 步（与项目语义对齐），runbook 登记重试口径 |
| B | T-R2-03 parity 漂移防护依赖人工纪律 | → 并入 A-R2-MN-01 处置（触发约定 + PR 检查单机器前置项） |
| C | F-R2-01 parity 取舍需持续监控 | → 并入 A-R2-MN-01 处置；若开源后外部贡献量级变化，复审是否升格 CI 门（登记为 v2 运营面观察项） |

## 结论

DESIGN 门（R2 设计评审）通过：Round 2/5，共识 100%，残 0C/0M/5m（全部登记处置落点）。
状态文件 `.sprint-state/delphi-reviewed.json`（reviewed_head_commit = bc4f065，
design_sha256 = 46e3fe3a5df08c9cc7b6845a4c4bb4db2deb04d9ca98e370a9e3d622fffb5e50）。
原始卷面与结果（主仓本地，不入库）：var/delphi-r11/input-rel-design-r{1,2}.md、
rel-design-experts-r{1,2}.json。
