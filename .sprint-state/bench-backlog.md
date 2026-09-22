# Bench 面 Minor backlog（持久登记处）

- **owner**: boyingliu01
- **登记日期**: 2026-09-22
- **处置期限**: 2026-09-30 23:59 (UTC+8)；余下项中 `R6-C2` 最优先（原最优先项 `R6-B2` 已随 ADR-0002 补遗三落地）
- **逾期处理**: 必须在下一次开发会话的首项处理并向用户报告，不得静默顺延
  （该纪律的定义体与上下文见 `git show 8bb8020:.sprint-state/bench-rerecord-todo.md`）
- **触发条件**: 任何触碰 `bench/`、`.github/workflows/bench.yml` 或 `docs/adr/0002` 的提交，
  应先消化本表中对应项；「ADR 挂账」的行随 `docs/adr/0002` 的下次修订合并落地（已于补遗三收口）
- **命名空间说明**: 本文件位于 `.sprint-state/`（sprint 生命周期目录）。当前未被 `.gitignore` 覆盖、
  无自毁条款、脚本与 CI 均无清理引用，且同目录已有长期 tracked 的 `decisions.md`/`feedback-log.md`，
  故不受待办自毁影响；若将来引入 sprint 目录清理机制，本文件须一并迁移至 `docs/` 或 `bench/`（或显式豁免）。
- **设立缘由**: R6 走查 backlog 的原登记处 `.sprint-state/bench-rerecord-todo.md` 按其自述关闭条件 5
  在 `730f82e` 自毁，六个 ID 未在任何 tracked 载体承接。R7 三位专家独立实测
  `git grep 730f82e` 对全部 6 个 ID 零命中（A-M1 / B-R7-B1 / C-R7-1），一致建议迁移至
  tracked 文件。本文件即该迁移（内容来源可经 `git show 8bb8020:.sprint-state/bench-rerecord-todo.md` 复核）。
- **处置约定**: 各项由后续小提交处理（**各自照例走三位专家 code-walkthrough**）；
  「逾期不得静默顺延」纪律同样适用——触碰 bench 面的提交应优先消化本表。
- **状态列约定**（2026-09-22 补遗三批次起）: `OPEN` = 未处理；`已消化(依据)` = 已落地并给出证据指针；
  `已裁决` = 有结论但按结论不整改；`延后(理由)` = 明确不回应的原因与下一步。行内容（ID/位置/内容/来源）
  在加列时保持不变——R6 表在迁移时与原文逐字全等（`d334503` 由三位专家核验），加列后逐行文本仍可比对。

## R6 走查 backlog（原表逐字迁移）

| ID | 位置 | 内容 | 来源 | 状态 |
|----|------|------|------|------|
| R6-B2 | `bench/check-regression.ts:38-42` | `parseP95` 的 `[\d.]+` 理论上可解析出 `NaN`（如 `"1.2.3"`），NaN 经 `isRegression` 两条件皆 false 会**静默 PASS**；runner 输出自控，故属理论面。建议加 `Number.isFinite` 守卫（fail-loud） | B | 已消化（补遗三决策 6：解析与基准字段两侧共用 `finite()` 守卫） |
| R6-B1 | `bench/env-gate.test.ts:69` | 畸形 `_repeats` 用例表缺 `NaN`/`Infinity`（实现已挡下，属覆盖缺口） | B | 已消化（补遗三批次：用例表补 `NaN`/`±Infinity`） |
| R6-C2 | `bench/env-gate.ts:74,77` | `trim() === ""` 校验与严格 `!==` 比对不一致：`" min "` 被判 mismatch 而非 malformed（结果仍 fail-closed，仅 reason 文案误导） | C | 延后（见下"延后说明"） |
| R6-A3 | `bench/check-regression.ts:1` | 文件头注释"无逻辑分支"随本轮增长略不实 | A | 已消化（补遗三批次：改为 CI 入口脚本 + 覆盖指针，删去"无逻辑分支"断言） |
| R6-A2 | `bench/env-gate.ts:77` | `_estimator` 逐字比对从严（`"MIN"`/尾随空格 → SKIP）；从严无害，登记知悉 | A | 已裁决·不整改（从严属 fail-closed，符合 G-BENCH"禁止静默放宽"；仅措辞可随 R6-C2 一并微调） |
| R6-B4 | `bench/check-regression.ts`（G2 档位正则） | 未锚定行首（既存；冻结档位集 8/64/512KB 下无子串碰撞） | B | 已消化（补遗三批次：G1/G2 正则行首锚定；R8-B-M3 收口后单源至 `bench/runner-format.ts`，双侧共用） |

## R7 走查新增（`8bb8020..730f82e`，另含交换轮一条）

| ID | 位置 | 内容 | 来源 | 状态 |
|----|------|------|------|------|
| R7-A-M2 | `docs/adr/0002` 补遗二（待补充：该区分尚未成文） | 区分 **environment-SKIP** 与 **method-SKIP** 两种收尾证据，避免「SKIP 即闭环」误读（重录后本地走 environment 门分支，而待办背景描述的是 method 门） | A | 已收口（补遗三新增节「SKIP 两种子因与各自的收尾证据」） |
| R7-A-M3 | `docs/adr/0002`（CI 端到端验证节，待补充） | 把 record run（`35713318131`）结果落成 repo 内可核验锚点，降低对 GitHub API 的外部依赖（当前为 artifact 逐字一致 + producer 模板一致 + record job 实存 + 阈值守卫四重间接证据） | A | 已收口（补遗三新增节「权威基线的 repo 内可核验锚点」：blob sha1 + sha256 + 复现命令） |
| R7-C-R2 | 观测事项 | record 后首次 CI bench 运行的真实相对门比较结果需回填（关闭条件 4 的前瞻性证据）；若现异常须回看本基线落地 | C | 已回填（run `35724569406` 判红 → 三次同码采样定性为结构性假红 → 补遗三；观测档 `var/delphi-r7/ci-observation-r7.md`，结论表已入 ADR） |
| R7-B2 | `.sprint-state/bench-backlog.md`（本表自身） | 本登记处缺机器守卫：backlog ID 在 tracked 文件中的存在性无断言，失联仅靠走查 grep 发现。建议补轻量断言（bench 单测或 CI grep 校验：缺 ID 即 fail-loud），实现时须放行「完成即移除行」的合法删除、只拦静默丢失 | B（交换轮） | 延后（见下"延后说明"） |

## R8 走查新增（`d334503..62bef31`，全表随收口提交一并核销）

| ID | 位置 | 内容 | 来源 | 状态 |
|----|------|------|------|------|
| R8-A-M1 | `docs/adr/0002` 正文 line 33/40、`docs/issues/4` §回退定义 | operative 措辞描述已被补遗三取代的 p95 判据，无行内取代标注 | A | 已消化（收口提交：三处加行内「口径演进」标注，指向补遗三/spec AC） |
| R8-A-M2 | `docs/adr/0002` 补遗三·影响「残余假红风险（p50 版）」 | 缺"最坏窗口抽签"量化上界，仅有两次记录的 −7.5% | A | 已消化（收口提交：补同估计量漂移 ≤7.5% / 单次采样包络 1.73–1.87× 两向界 + 近零基线变体） |
| R8-B-M1 | 相对门判据（p50 口径，近零基线处） | min-of-10 的 p50 取整到 0 时 1.2×0=0 且 +2ms 地板为 OR 条件不构成保护 → 任何 pr>0 确定性假红。win32 实测 record 10 次中 2 次 `p50=0.000`（`var/delphi-r8/probe-baseline-b.json`：base=0、pr=0.295 → FAIL exit 1）；CI 未观测（G1 p50 稳定 0.23–0.25） | B | 留痕+告警（收口提交：ADR 影响节量化 + record 侧 print-only 零值告警 + 本表登记；**若 CI 复现按 ADR 点名的"显式噪声地板"走新 ADR 修订**，不得静默放宽） |
| R8-B-M2 | `bench/g1-ttft.ts:14` | 解析约束注释仍引用旧无锚定模式 `/p95=([\d.]+)ms/` | B | 已消化（收口提交：改为指向 `bench/runner-format.ts` 的 `G1_LINE_RE`） |
| R8-B-M3 | `bench/record-baseline.ts`（解析侧） | R6-B4 锚定只落在 check 侧，record 侧平行解析器未锚定；两侧契约宜共模块 | B | 已消化（收口提交：新增 `bench/runner-format.ts` 单源契约 + `bench/runner-format.test.ts` 6 用例，双侧共用） |
| R8-C-R1 | `bench/record-baseline.ts`（写路径） | 默认 outPath 即 tracked 的 `bench/baseline.json`，本地误跑无参 `bench:record` 会静默覆盖权威基线（record 侧无守卫） | C | 已消化（收口提交：非 CI 覆写 tracked 路径即 refuse，exit 1；实跑核验）+ **事实澄清**：C 报告所称「`.gitignore` 无对应条目」不成立——`bench/baseline.local.json` 自 `3879347` 起即在 `.gitignore:13`，`git check-ignore -v` 与 `git status`（干净）均可复核 |
| R8-C-R2 | `docs/adr/0002` 补遗三·决策 7 | "改的只是被比较的分位数"自述偏窄，未计同批落地的 `finite()` 守卫与解析锚定 | C | 已消化（收口提交：决策 7 改写为"两处收紧（分位数切换 + 决策 6 两条防护）+ 文案同步"） |

## 本批消耗与延后说明（2026-09-22，ADR-0002 补遗三批次）

- **本批落地**：`R6-B2` / `R6-B1` / `R6-B4` / `R6-A3` 随补遗三实现一并消化（同一函数面，
  避免为 6 行守卫单开一次改 HEAD 的走查）；`R7-A-M2` / `R7-A-M3` / `R7-C-R2` 由补遗三成文收口。
- **延后说明 · R6-C2**：该不一致 fail-closed（仅 reason 文案误导，无判据后果），且修法有两种
  （把 `" min "` 归为 malformed，或先归一化再比对）需在提交说明中定夺；本轮提交已捆绑
  "判定分位数 p95 → p50" 这一口径变更（补遗三），不宜再混入门分类逻辑，故延后为**独立小提交**。
- **延后说明 · R7-B2**：实现前需先定三条规格——①守卫放置（bench 单测 / CI grep 步骤）、
  ②"合法删除 vs 静默丢失"的区分方式（依赖本表新增的状态列语义）、③失败面（在哪条 job fail-loud）。
  本轮已为本表加状态列（守卫的判别基础），守卫本身延后为**独立小提交**。
- **观测待办 · OC-1**：p50 判据的首次 CI 真实比较结果需回填（随本批 push 观测；若判红则按
  ADR-0002 补遗三「残余假红风险」节复审，不得静默放宽）。该观测与 `R7-C-R2` 同型，
  故沿用观测档 `var/delphi-r7/`（新开 `ci-observation-p50.md`）并回填结论。
  **扩项（R8 收口）**：OC-1 观测清单同时覆盖 `R8-B-M1`（近零基线：CI 侧若出现任一判定档
  `p50 min = 0`，或判红原因为 `base=0`，即按 ADR 点名的"显式噪声地板"候选走新 ADR 修订）。

### R8 收口批次（`d334503..62bef31` 的走查意见，2026-09-22）

- **走查结果**：R8 R1 三家均为 APPROVED（A 8/10、B 8/10、C 9/10；0 Critical / 0 Major），
  7 条 Minor 全部随收口提交核销或留痕（见上表逐行状态）。
- **本批落地**：`R8-A-M1` / `R8-A-M2` / `R8-B-M2` / `R8-B-M3` / `R8-C-R2` 就地消化；
  `R8-B-M1` 以"ADR 量化 + record 零值告警 + OC-1 扩项"承接（判据零改动）；
  `R8-C-R1` 以写入路径守卫收口并附带事实澄清。
- **事实澄清留痕**：`R8-C-R1` 的 `.gitignore` 子项系误报（条目自 `3879347` 存在），
  已在表内记录复核命令；该误报不影响其余结论（record 侧写路径缺守卫为真实风险）。

## 备注

- **编号谱系**：`R7-C-R2` ← R7 R1 原始报告中的 `C-R7-2`（内容一致，仅统一为 `R7-<专家>-<序号>` 型）。
- **ADR 挂账**：`R7-A-M2` 与 `R7-A-M3` 的目标落点是 `docs/adr/0002` 的下次修订——已由补遗三落地，
  不再挂账；后续同类意见仍应在 ADR 修订中收口。
- **就地整改**：R7 交换轮（A/B/C）对登记处的其余意见（命名空间前瞻风险、缺 owner/期限、
  处置约定不可机器强制、逾期纪律定义体只存于历史 blob）已就地整改于本文件头部，不再单列成行。
