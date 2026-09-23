# Bench 面 Minor backlog（持久登记处）

- **owner**: boyingliu01
- **登记日期**: 2026-09-22
- **处置期限**: 2026-09-30 23:59 (UTC+8)。**期限覆盖本文件所有行，跟踪项（`-N` 型）不例外**（R10R4-C-m1
  起成文；此前 intro 只说"处置期限"、未点明跟踪项是否算待办，构成可被无限顺延的缝）。
  **OPEN 项 1 条**：`R10R2-A-m2`（`tests/integration/**` +
  `tests/e2e/**` 共 12 文件仍无 CI 执行面，bench.yml 是全仓唯一 workflow）——守卫步已扩到单测面，
  该行按 OPEN 保留至 test job 落地。`R10R3-A-N1`（多文件批的跨面捆绑）由 R10 R4 批按四面拆分提交而消化，
  其"无到期条款"的元缺陷同时升为下面的通则。其余：R9 交换轮 6 条 + 两条历史延后项
  `R6-C2`/`R7-B2` 已随 R10 批次收口，R10 匿名轮 18 个 ID 已随 R10 R1 收口提交处置，R10 交换轮 13 个 ID
  （1 Major + 12 Minor）随 R10 R2 收口提交处置，R10 修复复评轮 13 个 ID（1 Major + 11 Minor + 1 跟踪项）
  随 R10 R3 收口提交处置，R10 第二处置复评轮 9 个 ID（1 Major + 8 Minor）随本批 R10 R4 收口提交处置，
  均 2026-09-22/23。**R11 五批 35 个 ID**（匿名轮 8：走查 7 + 仓库重建事故 `R11-INC-1` 1；交换轮 Round 1
  10 个：4 Major + 6 Minor；复评轮 Round 2 8 个：全 Minor；复评轮 Round 3 4 个：全 Minor；复评轮 Round 4
  5 个：走查 4 全 Minor + 自查 1）随 R11 R1/R2/R3/R4/R5 五个收口提交处置，均 2026-09-23。
  留痕项 `R9-A-3`/`R9R2-A-N1` 挂在下次 CI record 自愈
- **跟踪项到期与升级**（R10R4-C-m1 起成文）: 状态列写作 `OPEN（跟踪项）` 的行**必须在同一行内**给出
  可自动触发的升级条件（形如"若第 N 批仍未落地 → 升 Major"）。缺该条件的跟踪项不得登记，只能写成
  普通 OPEN 行走期限纪律。理由：跟踪项自带"这不是缺陷、只是待办"的语义，无到期条款即等于永久挂账，
  正是 `R10R2-A-m4` 起连续四批"逐批自豁免"得以成立的机制。
- **逾期处理**: 必须在下一次开发会话的首项处理并向用户报告，不得静默顺延
  （该纪律的定义体与上下文见 `git show 8bb8020:.sprint-state/bench-rerecord-todo.md`）
- **触发条件**: 任何触碰 `bench/`、`.github/workflows/bench.yml` 或 `docs/adr/0002` 的提交，
  应先消化本表中对应项；「ADR 挂账」的行随 `docs/adr/0002` 的下次修订合并落地（已于补遗三收口）。
  **推送前的 linux 重跑义务（`R11R3-C-m1` 起成文；判据面与基准取法由 `R11R4-SR-1` + `R11R4-B-m2` 批改写）**：
  比较对象是**上一次真实 linux 实跑所读的那份字节**，其 commit 记在 ADR 补遗四验证节的「linux 实跑锚点」条里
  （当前 `de727ab`），**不是**"上一批 HEAD"——以"上一批 HEAD"为基准会把"本批未变"误当成"自上次实跑以来未变"，
  漂移正好藏在批次接缝处（`R11R4-SR-1` 兑现的正是这条：`e946a0f` 变过字节，而 R3/R4 两批各自只对上一批负责）。
  触发判据取**语义面而非字节面**：`bench/out-path-guard.ts` / `bench/out-path-guard.cases.ts` 自锚点起只要
  **非注释行**有差（判据代码或期望表数据变），推送前就**必须**重跑正/负双向探针、把数字回写 ADR、并把锚点
  下移到本次实跑所读的 commit，不得沿用上一轮数字。锚点未变时的"无需重跑"须以这条命令的**空结果**为证
  （不是 `--name-only` 的空输出——那只能证明文件名未变，证明不了变的是注释）：
  `git diff -U0 <锚点>..HEAD -- bench/out-path-guard.ts bench/out-path-guard.cases.ts` 过滤掉 `+++`/`---`
  与以 `//`、`*`、`/*` 开头（含缩进）的行后为空。首次真实重跑时另需记录 node/WSL 版本与探针脚本 hash
  作为比对基线（`R11R4-C-m2`）。
  **本机 win32 实跑义务（`R11R3-C-m2` 起成文）**：win32 宿主上跑 `bun run test`（= vitest 全量）与
  `bunx vitest run bench/out-path-guard.test.ts` 是**成文义务**而不是惯例，可证伪形式 = 各批「验证」bullet
  必须带 win32 实跑数字，缺该行的批次由下一轮走查按违规判（`it.runIf(win32)` 那一族只有 win32 宿主兑现得了，
  CI 不守护，见 `R11R2-C-m1` 与 ADR 补遗四）。仍**不采**"仓库内脚本机器强制"：本仓无收口脚本，xp-gate 的
  pre-push 是仓外全局钩子（与 `R11R2-C-m1` 拒 ① 同一条理由）。
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
  **"已消化/部分消化"不蕴含机器门已建立**（`R11R4-C-m1` 起成文）：处置形态是"成文义务"的行，其状态里必须
  显式带 **（成文义务，非机器门）** 限定词，否则读者会把"已消化"读成"已有自动拦截"。本文件头部两条推送前
  义务即此类（可证伪形式在走查轮人工判，不由任何门执行）。
- **行数棘轮约定**（R10R3-A-m3/C-m1 起成文）: 机器守卫 `tests/unit/backlog-integrity.test.ts` 的
  `MIN_BACKLOG_ROWS` **恒等于当前实测数据行数**（历史 55=55、68=68），零余量是设计而非假红——合法裁剪
  某行必须**同批**下调该常量（并同步下调 `LOCKED_IDS`）并进 diff，使"删行"永远是刻意、可走查的动作。
  看到"下界 = 实测"不要反射式放宽下界；先确认删的是哪一行、为何删。留余量等于放行"删一行不登记"，
  与本登记处设立缘由（`730f82e` 自毁事故）正面对冲。

## R6 走查 backlog（原表逐字迁移）

| ID | 位置 | 内容 | 来源 | 状态 |
|----|------|------|------|------|
| R6-B2 | `bench/check-regression.ts:38-42` | `parseP95` 的 `[\d.]+` 理论上可解析出 `NaN`（如 `"1.2.3"`），NaN 经 `isRegression` 两条件皆 false 会**静默 PASS**；runner 输出自控，故属理论面。建议加 `Number.isFinite` 守卫（fail-loud） | B | 已消化（补遗三决策 6：解析与基准字段两侧共用 `finite()` 守卫） |
| R6-B1 | `bench/env-gate.test.ts:69` | 畸形 `_repeats` 用例表缺 `NaN`/`Infinity`（实现已挡下，属覆盖缺口） | B | 已消化（补遗三批次：用例表补 `NaN`/`±Infinity`） |
| R6-C2 | `bench/env-gate.ts:74,77` | `trim() === ""` 校验与严格 `!==` 比对不一致：`" min "` 被判 mismatch 而非 malformed（结果仍 fail-closed，仅 reason 文案误导） | C | 已消化（R10：取**分类修法**——`_estimator` 带首尾空白即归为畸形（提示重录），不再落入口径不匹配分支；严格逐字比对与 SKIP 出口不变（`R6-A2` 从严裁决保留），仅 reason 指向纠正。用例见 `bench/env-gate.test.ts`「带首尾空白的估计量」4 形态；定夺理由见下"延后说明 · R6-C2"收口注记） |
| R6-A3 | `bench/check-regression.ts:1` | 文件头注释"无逻辑分支"随本轮增长略不实 | A | 已消化（补遗三批次：改为 CI 入口脚本 + 覆盖指针，删去"无逻辑分支"断言） |
| R6-A2 | `bench/env-gate.ts:77` | `_estimator` 逐字比对从严（`"MIN"`/尾随空格 → SKIP）；从严无害，登记知悉 | A | 已裁决·不整改（从严属 fail-closed，符合 G-BENCH"禁止静默放宽"；仅措辞可随 R6-C2 一并微调。**R10 注**：该裁决所依据的严格逐字比对未因 `R6-C2` 收口而放宽——尾随空格形态改由 malformed 分支拦下，结论仍是 SKIP 不可比） |
| R6-B4 | `bench/check-regression.ts`（G2 档位正则） | 未锚定行首（既存；冻结档位集 8/64/512KB 下无子串碰撞） | B | 已消化（补遗三批次：G1/G2 正则行首锚定；R8-B-M3 收口后单源至 `bench/runner-format.ts`，双侧共用） |

## R7 走查新增（`8bb8020..730f82e`，另含交换轮一条）

| ID | 位置 | 内容 | 来源 | 状态 |
|----|------|------|------|------|
| R7-A-M2 | `docs/adr/0002` 补遗二（待补充：该区分尚未成文） | 区分 **environment-SKIP** 与 **method-SKIP** 两种收尾证据，避免「SKIP 即闭环」误读（重录后本地走 environment 门分支，而待办背景描述的是 method 门） | A | 已收口（补遗三新增节「SKIP 两种子因与各自的收尾证据」） |
| R7-A-M3 | `docs/adr/0002`（CI 端到端验证节，待补充） | 把 record run（`35713318131`）结果落成 repo 内可核验锚点，降低对 GitHub API 的外部依赖（当前为 artifact 逐字一致 + producer 模板一致 + record job 实存 + 阈值守卫四重间接证据） | A | 已收口（补遗三新增节「权威基线的 repo 内可核验锚点」：blob sha1 + sha256 + 复现命令） |
| R7-C-R2 | 观测事项 | record 后首次 CI bench 运行的真实相对门比较结果需回填（关闭条件 4 的前瞻性证据）；若现异常须回看本基线落地 | C | 已回填（run `35724569406` 判红 → 三次同码采样定性为结构性假红 → 补遗三；观测档 `var/delphi-r7/ci-observation-r7.md`，结论表已入 ADR） |
| R7-B2 | `.sprint-state/bench-backlog.md`（本表自身） | 本登记处缺机器守卫：backlog ID 在 tracked 文件中的存在性无断言，失联仅靠走查 grep 发现。建议补轻量断言（bench 单测或 CI grep 校验：缺 ID 即 fail-loud），实现时须放行「完成即移除行」的合法删除、只拦静默丢失 | B（交换轮） | 已消化（R10：`tests/unit/backlog-integrity.test.ts` 落地，三条规格逐一钉死——①守卫放置=单测门（本仓库 CI 只有 bench.yml、无 test job，vitest 即 pre-commit 与 `bun run test` 的必经门）；②合法删除 vs 静默丢失=显式 ID 锁清单（39 项）比对**表行 ID 列**（非整文件 substring，否则"行删了但 ID 在正文他处仍被提及"会漏判）+ 超集断言 + 行数棘轮 37；裁剪行须同步下调锁清单/棘轮，是一次刻意且进 diff 的动作；③失败面=vitest 非零退出，不新增 workflow 步骤。另含文件实存 / 被 git 跟踪 / 5 格列形三条结构断言与一条负例自检。**实跑负例**：删去 `R6-B2` 行 → 锁清单、棘轮、自检三条同时 fail；恢复文件（md5 复验）后 5 用例全绿） |

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
  **收口（R10，2026-09-22）**：延后理由已消除（本批无口径变更）。定夺取**分类修法**（把带首尾空白的
  `_estimator` 归为 malformed），不取"先归一化再比对"——后者会静默放宽严格逐字比对，与 `R6-A2`
  已裁决的"从严"方向相反，且属 G-BENCH 禁止的口径面变动（需另出 ADR）。本修法零行为变化：两条分支
  皆 `comparable:false` → SKIP，只有 reason 文案的指向被纠正。
- **延后说明 · R7-B2**：实现前需先定三条规格——①守卫放置（bench 单测 / CI grep 步骤）、
  ②"合法删除 vs 静默丢失"的区分方式（依赖本表新增的状态列语义）、③失败面（在哪条 job fail-loud）。
  本轮已为本表加状态列（守卫的判别基础），守卫本身延后为**独立小提交**。
  **收口（R10，2026-09-22）**：三条规格已在 `tests/unit/backlog-integrity.test.ts` 文件头成文并实现
  （①单测门 ②显式 ID 锁清单 + 超集断言 ③vitest 非零退出）。守卫只拦**静默**丢失：合法裁剪某行
  必须同步下调锁清单，那是一个刻意、可见、进走查范围的改动，与本表"行不删、只改状态列"的既有惯例一致。
- **观测待办 · OC-1**：**已回填（2026-09-22，closed）**——push `d334503..5325c3a` → run **35735231178**
  （`bench` job success 43s；`record` job 按预期 skipped；`grep -c SKIP` = 0，相对门**全程强制**而非放行）。
  四档 p50（min-of-10）全 PASS：G1 `base=0.252 pr=0.112`、G2 8KB `0.39→0.200`、64KB `0.54→0.290`、
  512KB `1.8→1.070`；p95 对照行同向（G1 1.554→1.160），**印证** R7 期间的 G1 p95 判红系跨实例尾部抖动
  （n=1，作旁证而非反证；R9-B-2 措辞收口）。
  绝对门全 PASS 且余量大。观测档：`var/delphi-r7/ci-observation-p50.md`（含扩项核验）。
  **扩项（R8-B-M1）核验结果**：CI 侧未出现任一判定档 `p50 min = 0`、无 `base=0` 判红原因，
  → **不触发**"显式噪声地板"新 ADR 修订，`R8-B-M1` 维持既有处置。

### R8 收口批次（`d334503..62bef31` 的走查意见，2026-09-22）

- **走查结果**：R8 R1 三家均为 APPROVED（A 8/10、B 8/10、C 9/10；0 Critical / 0 Major），
  7 条 Minor 全部随收口提交核销或留痕（见上表逐行状态）。
- **本批落地**：`R8-A-M1` / `R8-A-M2` / `R8-B-M2` / `R8-B-M3` / `R8-C-R2` 就地消化；
  `R8-B-M1` 以"ADR 量化 + record 零值告警 + OC-1 扩项"承接（判据零改动）；
  `R8-C-R1` 以写入路径守卫收口并附带事实澄清。
- **事实澄清留痕**：`R8-C-R1` 的 `.gitignore` 子项系误报（条目自 `3879347` 存在），
  已在表内记录复核命令；该误报不影响其余结论（record 侧写路径缺守卫为真实风险）。

### R8 交换轮批次（`62bef31..5325c3a` 的走查意见，2026-09-22）

R2（交换轮）三家均 APPROVED（A 9/10 ratio 0.94、B 8/10 ratio 0.95、C 9/10 ratio 0.95；0 Critical / 0 Major）。
本轮 9 条意见中 4 条为 R1 已收口项的复核确认，另 5 项处置如下（同批随 OC-1 回填提交核销）：

| ID | 位置 | 内容 | 来源 | 状态 |
|----|------|------|------|------|
| R2-X-1 | `var/delphi-r8/round2-input.md` §2.3（**评审卷，非 tracked**） | 卷面两条冻结核验命令标注 `EXIT=0` 与实测不符（全范围端点下 formula/bench.yml 因 `62bef31` 注释与字段更名而 EXIT=1）；冻结主张实质成立 | A+B+C（三家独立命中） | 已收口（卷面就地标注 + §2.3-勘误段；tracked 文档经 grep 复核不含该错误陈述） |
| R2-A-M2 / R2-C-M1 | `docs/adr/0002` 补遗一·决策 6、`record-baseline.ts` `_refresh_policy` | 写路径守卫的信任边界（`CI=true` 由平台注入）未成文；平台迁移缺该变量时无参 record 会以误导性文案失败 | A+C | 已消化（决策 6 补「信任边界」段 + `_refresh_policy` 括注；守卫行为零改动） |
| R2-B-2 / R2-C-M2 | `bench/record-baseline.ts` 守卫判据 | 原始字符串比较可被等价路径绕过（`./bench/baseline.json`、`bench/./…`、反斜杠；`--help` 被当作 out 路径） | B+C | 已消化（`path.resolve` 归一后比较 + `-` 前缀未知 flag 拒绝；实跑核验见提交说明）——**注**：该行描述的是 R8 时点的形态，归一已由 R9-B-1/R9-C-M1 升级为文件系统解析（见下表） |
| R2-B-1 | `bench/g2-request-gate.ts:13` | 单源化之前的解析约束注释漏扫（同类漏扫，R8-B-M2 当时只修了 g1） | B | 已消化（改指 `runner-format.ts` 的 `g2LineRe`） |
| R2-A-M3 | `docs/adr/0002` line 100/149/167 | 残留 `p95_pr` 措辞属历史/引用/机制语境，非 operative 文本 | A | 已裁决（记录在案，不需整改） |
| （并入 R8-B-M1） | 零值告警面 | 建议评估「零值告警时 record job 置 non-zero」 | C | 已并入该新 ADR 修订的评估清单，本轮不动 |

### R9 批次（`5325c3a..1f8745e` 匿名轮意见 + 本收口提交，2026-09-22）

R9 R1（匿名独立轮，评审对象 = R8 交换轮 4 条 OPEN Minor 收口 + OC-1 回填，单提交 `1f8745e`）
三家均 APPROVED（A 9/10 ratio 0.96、B 9/10 ratio 0.95、C 9/10 ratio 0.95；0 Critical / 0 Major）。
本轮 5 项 Minor（B-R9-1 与 C-R9-M1 同项）处置：4 项随本收口提交就地消化（`R9-A-1` / `R9-A-2` /
`R9-B-1`+`R9-C-M1` / `R9-B-2`），1 项留痕登记（`R9-A-3`，代际漂移、下次 CI 重录自愈）：

| ID | 位置 | 内容 | 来源 | 状态 |
|----|------|------|------|------|
| R9-A-1 | `bench/g2-request-gate.ts:13` | 注释写作 `g2LineRe(tier_kb)`，与 `runner-format.ts` 真实形参名 `tierKb` 非逐字一致（`tier_kb` 系结果对象字段名） | A（B 亦以 nano 提及） | 已消化（本收口提交：统一为 `g2LineRe(tierKb)`） |
| R9-A-2 | `docs/adr/0002` 补遗一·决策 6 | 符号链接为理论残余绕过面（`path.resolve` 不解引用） | A | 已消化（本收口提交：归一升级为文件系统解析（`realpath` deref）+ 已知残余段成文） |
| R9-A-3 | `bench/baseline.json`（committed，源自 `730f82e`） | 产物内嵌 `_refresh_policy` 为旧代文本（不含 R8 守卫句与归一括注），系模板与持久化产物的时序漂移，非本提交引入 | A | 留痕（**下次 CI record job 提交产物时自愈**；重录前为唯一代际共存面） |
| R9-B-1 / R9-C-M1 | `bench/record-baseline.ts`（守卫判据） | 大小写不敏感 FS（win32/darwin）上 `bench/BASELINE.JSON` 型变体绕过 `path.resolve` 字符串比较并覆写 tracked 基线（B 端到端实测，已恢复；C 独立复现并指 8.3 短名同理） | B+C | 已消化（本收口提交：归一升级为 `realpath` 解析 + 平台折叠，覆盖大小写/短名/symlink 变体；实跑核验见提交说明） |
| R9-B-2 | 本表 OC-1 行 | 「反证」措辞过度（n=1 不足以反证） | B | 已消化（本收口提交：改为「印证」+ 旁证限定） |

### R9 交换轮批次（`1f8745e..0c9e6fa` 的走查意见 + R10 收口，2026-09-22）

R9 R2（交换轮，评审对象 = 收口提交 `0c9e6fa`：`realpath` 归一 + 已知残余成文 + OC-1 关闭证据回填）
三家均 APPROVED（0 Critical / 0 Major）。9 条意见中 6 条为 OPEN（登记入下批 = R10）、
1 条留痕、1 条已裁决（实测否证）、1 条为卷面勘误：

| ID | 位置 | 内容 | 来源 | 状态 |
|----|------|------|------|------|
| R9R2-A-N1 | `bench/baseline.json`（committed，源自 `730f82e`） | 产物内嵌 `_purpose` 亦为 v4 旧代文本（描述 p95 判定），与 `_refresh_policy` 同属模板/持久化产物的时序漂移；`check-regression.ts` 不消费该字段，不影响判据 | A | 留痕（已在 ADR 补遗三决策 5 成文；下次 CI record 重录自愈，同 `R9-A-3` 机制） |
| R9R2-B-1 | `bench/record-baseline.ts` `canonicalPath`（UNC / admin-share 形态） | 继承性残余：`//localhost/c$/…`、`\\?\UNC\…` 指向同一文件时 `realpath` 不折算盘符 → 比较不等 → 放行（B 在克隆内端到端证实，已恢复） | B | 已消化（R10：ADR 决策 6「已知残余③」成文；**R10 R1 后再升级**——原「不改代码」的理由「win32 无文件 ID 可比」经实测否证，守卫增 `dev:ino` 身份判据，本形态现由代码拦下，见 `R10-B-1`） |
| R9R2-B-2 | 同上（NTFS 备用数据流） | 继承性残余：`baseline.json:<stream>` 可经守卫写入（`realpath` 返回带流后缀路径）；主流内容实测不被覆写（git 干净） | B | 已消化（R10：「已知残余④」成文；**R10 R1 后**由身份判据一并拦下——ADS 与主流同 `dev:ino`，收口方向为"从严"而非修补内容损坏面） |
| R9R2-B-3 | 同上（平台折叠的反向面） | 本提交新引入·理论级：per-directory 大小写敏感（WSL / 目录 flag 挂载）下，仅大小写不同的两个真实不同文件被判同路径而**误拒**；默认 NTFS/APFS 不可达 | B | 已消化（R10：「已知残余⑥」成文并标注为"误拒而非放行"方向；不改代码） |
| R9R2-B-4 | `var/delphi-r9/round2-input.md` 前置段（**评审卷，非 tracked**） | 卷面称 `1f8745e`「已推送」，实测 `origin/main` 当时仍为 `5325c3a`、未推送工作为 2 commits | B | 已收口（卷面就地改写 + §6 勘误段；已交付的 `input-*-r2.md` 保留原文以维持三家所见一致） |
| R9R2-B-5 | 本表 R9 批次 intro | 「3 项就地消化 + 2 项留痕」与表内「4 项已消化 + 1 项留痕」分组口径不一致 | B | 已消化（R10：intro 改为按 ID 点名分组，与本表实际状态列对齐） |
| R9R2-B-6 | `docs/adr/0002` 补遗一·决策 6 | 已知残余段未列 ADS/UNC 面；「win32/darwin 再折叠大小写」语序易读成仅 fallback 分支折叠（实际两分支均折叠） | B | 已消化（R10：残余段扩为①–⑥六面 + 语序改为「两条分支之后都…」，`canonicalPath` 注释同步） |
| R9R2-C-1 | `docs/adr/0002` 决策 6 + `record-baseline.ts` 注释 | 指「8.3 短名…均同判」超出实现能力，称 `realpathSync.native` 按请求格式返回短名不折算长名，并附探针 | C | 已裁决·**实测否证**（出题方复测：本机 `BASELI~1.JSO` 别名解析为长名，端到端亦 refuse exit 1；C 的探针文件系**字面**短名，不构成别名场景。结论保留原宣称，并在决策 6 补「以平台原生解析为准」注记） |
| R9R2-C-2 | `docs/adr/0002` 决策 6（已知残余段） | 登记缺口：硬链接（`mklink /H`，无需特权）不在归一覆盖与残余叙述中——传链接路径即覆写 tracked 内容 | C | 已消化（R10：「已知残余⑤」成文；出题方独立复现后确认。**R10 R1 订正**：原登记理由「折叠身份要比 inode，Node 在 win32 不暴露该信息」系**假命题**（win32/NTFS 实测 `statSync().ino` 为真实文件 ID，硬链接两名字 ino 全等），守卫已据此增身份判据、本形态由"登记"转为"代码拦下"，详见 `R10-B-1`） |

### R10 批次（收口 R9 交换轮 6 条 OPEN + 历史延后 2 条，2026-09-22）

- **本批落地**：`R9R2-B-1`/`B-2`/`B-3`/`B-6`/`C-2` 由 ADR 补遗一·决策 6 的「已知残余」扩写为①–⑥六面
  收口（**纯文档**，守卫代码与判据零改动）；`R9R2-B-5` 由本表 intro 措辞收口；`R6-C2` 由 `env-gate.ts`
  分类修正 + 4 形态用例收口（`comparable` 值不变，仅 reason 指向纠正）；`R7-B2` 由
  `tests/unit/backlog-integrity.test.ts` 收口（本表自身的静默丢失守卫）。
- **代码面清单**：`bench/env-gate.ts`（1 处判据分类 + 注释）、`bench/env-gate.test.ts`（+1 用例，4 形态）、
  `bench/record-baseline.ts`（注释同步，无逻辑改动）、`tests/unit/backlog-integrity.test.ts`（新增 5 用例）、
  `docs/adr/0002`（决策 6 扩写 + 验证节补残余核验分工）、本文件。
- **守卫有效性负例**（防空转，同 Gate MW 校验器的 bogus-commit 对照法）：临时删去 `R6-B2` 表行 →
  `tests/unit/backlog-integrity.test.ts` 三条断言同时 fail；由快照 `var/delphi-r10/backlog.orig.md`
  逐字恢复（md5 `102a1e01ad374b602ef9368c8ba53633` 复验一致）后 5 用例全绿。
- **写路径守卫行为零改动复跑**（win32-x64）：无参 / `./bench/baseline.json` / `bench/./baseline.json` /
  `bench\baseline.json` / `bench/BASELINE.JSON` / `BENCH/BASELINE.JSON` 六形态全部 `refusing to overwrite …`；
  `--help` 仍走 `unknown flag`；`bench/regression-formula.ts` 与 `bench/baseline.json` 对 `0c9e6fa` 零 diff。
- **冻结面零改动自证**：`bench/regression-formula.ts`、`bench/baseline.json`、`.github/workflows/bench.yml`
  本批未触碰；`git diff --exit-code 0c9e6fa..HEAD -- bench/regression-formula.ts bench/baseline.json` 应为 0。

### R10 R1 批次（`eeeba3e` 的匿名轮走查意见 → 本收口提交，2026-09-22）

R10 R1（匿名独立轮，评审对象 = 收口提交 `eeeba3e`）三家均 REQUEST_CHANGES：0 Critical / 2 类 Major
（`R10-A-M1`+`R10-C-M1`+`R10-B-3` 同一件的 CI 执行面缺失、`R10-B-1` 假命题）/ 12 条 Minor。
下表逐行登记 18 个 ID 的处置；`并入` 型合写表示同一修法覆盖多来源，两侧 ID 均入锁清单：

| ID | 位置 | 内容 | 来源 | 状态 |
|----|------|------|------|------|
| R10-A-M1 | `.github/workflows/bench.yml` / `tests/unit/backlog-integrity.test.ts` | 守卫不在任何 CI job 执行面内（仓库仅 bench.yml、无 test job），强制力止于本地 `bun run test` 与全局 pre-commit 钩子；该钩子不在仓库内，故其他开发者与 CI 均不执行——与 R7-B2 设立动机（tracked 登记处自毁后无人发现）错位 | A | 部分消化（bench job 在 `bun install` 后增 `Backlog registry integrity guard` 步；只跑本文件不跑全量，避免把纯登记处守卫变成未验证 e2e 面的假红源。同步：测试头规格①改写为"单测门 + CI 步骤"、ADR 验证节成文三处执行面、job 顶部"唯一阻断步"措辞改为"除登记处守卫外"。**根因「全仓无 test job」未消，R10 R2 由 `R10R2-A-m2` 接续并 OPEN 保留**） |
| R10-C-M1 | 同上 | 同一件，收口二选一：加 CI 步（约 3 行 YAML、不触碰判据面/record job）或把"仅 pre-commit 生效"显式成文为强制力边界。`fix_cost: trivial` | C | 已消化（并入 `R10-A-M1`；采"加 CI 步"分支——成文边界只把空档写下来，不消除空档） |
| R10-B-3 | 同上 | 同一件（实测 xp-gate 适配器为全量 `npx vitest run`），建议 bench job 增秒级 vitest 步或成文边界残余 | B | 已消化（并入 `R10-A-M1`） |
| R10-B-1 | ADR 决策 6 + `record-baseline.ts` 注释 + 本表 `R9R2-C-2` 行 + `eeeba3e` 提交说明 | 「折叠身份要比 inode/卷内文件 ID，Node 在 win32 不暴露该信息（posix 有 `ino`，跨三平台不统一）」是**可检验假命题**：Bun 1.3.14 与 Node 在 win32/NTFS 实测 `statSync().ino` 均为真实文件 ID（硬链接两名字 ino 全等），ADS 与主流亦共享身份；失真理由出现 4 处 | B | 已消化（①三处 **tracked 文字**全部订正，第 4 处即 `eeeba3e` 的**历史提交说明**——git 历史不可就地改写，勘误由 `2f2aa6c` 提交说明承接，后人 `git show eeeba3e` 仍会读到假命题原文，此点由 `R10R2-A-m3`/`R10R2-B-4` 点名（R10 R2 前本行写作"四处文字全部订正"，字面不成立）；②守卫升级为"名字折叠 **或** 身份折叠（`dev:ino`）"双判据，`ino === 0` 哨兵与 stat 失败退让为 `null`；③④⑤ 由登记转代码收口——**④ 该轮只收口"流已存在"的一半，任意流名的穿透由 `R10R2-C-M1` 的宿主折叠闭合**。判据/阈值零改动） |
| R10-A-N1 | `bench/env-gate.ts` `environmentMatches` | os/arch 未施加与 `samplingMatches` 同类的空白归一：`{os:"win32 "}` 落 mismatch 文案而非 malformed，相邻两函数对"首尾空白"用两套标准（无判据后果，两者皆 SKIP） | A | 已消化（并入 `R10-B-2`/`R10-C-m4`） |
| R10-B-2 | 同上 | 同一件（B 编号），建议登记即可 | B | 已消化（提级为就地收口：抽出 `isVerbatimMarker`，os/arch/`_estimator` 三处共用同一畸形判据；补 5 形态 malformed 用例 + 1 条"真实差异仍报 mismatch"反向用例，确保分类不放宽判定） |
| R10-C-m4 | 同上 | 同一件（C 编号），标注为既存问题、非本提交引入 | C | 已消化（并入 `R10-B-2`） |
| R10-A-N2 | `record-baseline.ts:30` 注释 vs ADR 决策 6 | 两处措辞不严格等价；建议注释改为"posix 有 ino、win32 无，跨平台不对称" | A | 已裁决·**不采其措辞**（该修法延续 `R10-B-1` 的同一假命题；以实测为准，两侧统一改为"win32 亦暴露文件 ID、守卫已用之"。A 指出的"绝对化措辞会误导"这一点成立并已吸收） |
| R10-A-N3 | ADR 决策 6 残余名录 | 未列 `\\?\D:\…` 本地设备命名空间，疑为与 ③ 同族的放行面（A 本轮只读、未实测） | A | 已消化·**推测实测否证**（`realpathSync.native` 把 `\\?\d:\…` 折回 `D:\…`，升级前即 refuse 而非放行；升级后其 `dev:ino` 亦与 tracked 全等 → 双判据同拦。已并入 ADR 验证节别名形态清单） |
| R10-C-m3 | ADR 决策 6 残余③ | `subst` 映射盘（免特权）称"realpath 不折算盘符"，为与 UNC 同构的放行面，未列入①–⑥ | C | 已消化·**推测实测否证**（本机 `subst X: d:\projects\llmveto` 后 `realpathSync.native("X:/bench/baseline.json")` → `D:\projects\llmveto\bench\baseline.json`，升级前即 refuse；现身份判据亦覆盖。已在③叙述点名两形态） |
| R10-A-N4 | `tests/unit/backlog-integrity.test.ts` 规格② | 状态列**整体改写**为任意非空文本后守卫全绿（A 实测复现：rows=37 / ids=39 / malformed=0）——静态结构守卫的固有能力边界，非实现缺陷 | A | 已消化（并入 `R10-C-m2`；文件头新增「能力边界」段成文） |
| R10-C-m2 | 同上 | 同一件（C 实测：改 `R6-B2` 状态格为 STALE → 5 passed），边界未在文件头成文 | C | 已消化（成文三件事：守卫只保证行的结构存在性；状态语义真伪由三位专家逐行核对承担，不由字符串检查冒充；`OC-1` 型正文 bullet 不在表行 ID 列语义域内） |
| R10-A-N5 | 同上「文件被 git 跟踪」断言 | 非 git 环境 `git -C <非仓库> ls-files` → status 128 → 断言必红（假红）；浅克隆与 worktree 含 index 不受影响 | A | 已消化（三分：spawn 失败 `status===null` 与 128+"not a git repository" → warn 后跳过；`status===1`（仓在、文件未跟踪）仍 fail。能力边界同入文件头） |
| R10-A-N6 | 同上 表列数断言 | `c.length !== 5` 硬编码，未来合法演进（如增"证据指针"列）会被误伤为假红 | A | 已消化（改为按**表头**推导格数、「状态」列按表头名定位；并按块解析 markdown 表格，无 `ID` 表头的表整体不参与断言） |
| R10-B-4 | `tests/unit/backlog-integrity.test.ts` 假红面 ×3 + 无 git + 内容腐坏 | 未来非 5 列新表 / 单元格含 `\|` / 自检用字面 `ID` 前缀与排版耦合，三处假红；另无 git 环境假红、状态列改写不可见建议成文 | B | 已消化（假红面并入 `R10-A-N6`/`R10-C-m1` 及下方「守卫自检」新增 fixture；排版耦合改由解析后的首格匹配（`dropRowWithId`），空格与转义变体同样删得中；余两面并入 `R10-A-N4`/`R10-A-N5`） |
| R10-C-m1 | 同上 `tableRows()` | 裸 `split("\|")` 不识别 Markdown 转义：实测下一批新增含转义竖线的表行 → 5 格断言确定性假红，且报错文案误导 | C | 已消化（parser 逐字扫描、`\|` 不作分隔符、行尾 `\|` 不当收尾符裁掉；新增**内存 fixture** 自检用例固化该形态，不依赖真实文件将来是否含转义） |
| R10-B-5 | 本表「观测待办 · OC-1」 | OC-1 仅存在于正文 bullet，不在表行 ID 列内 → 既不被收集也不被锁清单覆盖（该项已封闭，风险为理论面） | B | 已消化（成文命名空间边界：锁清单只管 `R…-…` 规范 ID 的表行首格；OC-1 的保全面由本小节与守卫文件头点名承担，不扩锁清单以免把正文当表解析） |
| R10-C-m5 | `bench/record-baseline.ts` | `bun run bench:record ""` 空串非 nullish、穿透守卫，跑满测量后死于 `writeFileSync("")`（C 探针误触，bun 抢建了空的 gitignored `baseline.local.json`，已自行删除并复验干净） | C | 已消化（增空串/纯空白即时拒绝分支。**观测口径注**：`bun run` 会剥掉空 argv 而落到"无参"分支，故该判据须经 `node bench/record-baseline.ts ""` 观测——两入口行为不同已在 ADR 验证节点名，避免后人误判守卫未生效） |

- **裁决口径**：18 个 ID（A 7 / B 5 / C 6）中，2 类 Major 全部就地修复、无降级登记；Minor 12 条中
  9 条就地消化、2 条（`R10-A-N3`/`R10-C-m3`）推测经实测否证后并入代码收口、1 条（`R10-A-N2`）指出问题
  成立但不采其修法。三家共识下确界 0.90，R2 复评卷以本收口提交为评审对象。

- **本批代码面清单**：`bench/record-baseline.ts`（守卫升级为双判据 + 空 outPath 即时拒绝 + 注释订正）、
  `bench/env-gate.ts`（`isVerbatimMarker` 统一畸形判据，三处共用）、`bench/env-gate.test.ts`（+2 用例）、
  `tests/unit/backlog-integrity.test.ts`（块级表格 parser + 转义 + 表头推导 + git 三分 + 能力边界成文，6 用例）、
  `.github/workflows/bench.yml`（bench job 增守卫步）、`docs/adr/0002`（决策 6 双判据与③④⑤ 收口改写 +
  验证节新增形态矩阵/别名身份实测/守卫执行面三条）、本文件。
- **写路径守卫形态矩阵复跑**（win32-x64，升级后）：`bench/baseline.json` 的四种既有名字变体 + 8.3 短名 +
  无参共六形态 `refusing …`；**新增**硬链接 / `baseline.json:<stream>` / `//localhost/d$/…` /
  `\\localhost\d$\…` 四别名形态亦 refuse（文案附 `(same file identity via an alias path)`）；
  `bench/baseline.local.json` 仍放行（8s 内已进入 runner）；`--help` → unknown flag；空串 → empty out path。
  探针后 `bench/baseline.json` md5 `3ebfaa9f6a71ecf7cb7b0d91355e2525` 不变、ADS `dir /r` 复核无残留、
  `git status` 干净（探针产物一律落 `var/delphi-r10/`，硬链接与 `subst X:` 均已解除）。
- **冻结面零改动自证**：`git diff --exit-code eeeba3e..HEAD -- bench/regression-formula.ts bench/baseline.json`
  应为 0；判据公式 `* 1.2` / `> 2` 与三台门阈值常量未触碰。本批触碰 `.github/workflows/bench.yml`
  （上一批未触碰），且**只增一步守卫、不改任何 runner 步骤与判据**。

### R10 R2 批次（`2f2aa6c` 的交换轮走查意见 → 本收口提交，2026-09-22）

R10 R2（交换轮，评审对象 = 收口提交 `2f2aa6c`）：A/B 各自 APPROVED（0.93 / 0.95），C REQUEST_CHANGES
（0.90，1 Major）→ 三家下确界 0.90 但**裁决不一致**，共识门未过。下表登记 13 个 ID 的处置：

| ID | 位置 | 内容 | 来源 | 状态 |
|----|------|------|------|------|
| R10R2-C-M1 | `bench/record-baseline.ts` 守卫 + ADR 决策 6 残余④ + 验证节 | 「④ NTFS ADS 已代码收口」只在**流已存在**时成立：尚不存在的流名令 realpath 与 stat 双双 ENOENT → 名字与身份双判据皆假 → `bench/baseline.json:<任意新流名>` 穿透并写出备用流（C 端到端实测 5241 字节）。R10 R1 的"六形态全部 refuse"结论系出题方与 B 各验自己创建过的字面量流名，判别力名字空间从未被覆盖 | C | 已消化（守卫增第三段**宿主折叠**：win32 上把末段首个 `:` 及其后全部流后缀剥掉（多级流一次剥净）再走双判据；合法路径末段无 `:` 故恒等、只增拒绝。17 形态矩阵复跑 + ADR④/验证节改写为"两段收口"并公开此前结论的不泛化） |
| R10R2-A-m1 | `tests/unit/backlog-integrity.test.ts` `parseTables` | 围栏盲区：``` 代码块内的示例表格被认作真实表 → 幻影行虚增棘轮下界（55 恰在下界，可掩护真实行被删）、幻影 ID 入超集、示例表缺「状态」列触发结构断言假红。既有 R10-C-m1 自检只验了游离 `\|` 行，给了错误信心 | A | 已消化（`parseTables` 按 GFM 维护 inFence（同字符、不小于开启长度者闭合），围栏内行不入块；新增内存 fixture 用例覆盖"闭合围栏内示例表 + 未闭合围栏吞掉其后内容"两形态。当前登记处 `grep '^```'` = 0，属潜伏面。**勘误（R10R3）**："按 GFM 维护"当时只覆盖了开启串的字符与长度，闭合行的 info string 与缩进两面仍偏离 GFM，由 `R10R3-A-m2`/`R10R3-B-m1`/`R10R3-B-m2` 收口） |
| R10R2-B-1 | 同上 | 同一件（B 独立发现并已固化形态） | B | 已消化（并入 `R10R2-A-m1`） |
| R10R2-A-m2 | `.github/workflows/bench.yml` / 本表 R10-A-M1 行 | 根因未消：bench.yml 是全仓唯一 workflow、无任何 test job，上批只给单个文件开执行面，`env-gate`/`repeat`/`runner-format`/`regression-formula`/`architecture-boundaries`/`toolchain-smoke` 仍无 CI 执行面；本表却记为完整"已消化"并称"当前无 OPEN 项" | A | **部分消化 → OPEN**（守卫步扩为单测面，判据公式与估计量口径两面纳入 CI；`tests/integration/**` + `tests/e2e/**` 共 12 文件仍无 CI 执行面，本行按 OPEN 保留至该面落地，不再由"扩了一个文件"冒充根因已消。**勘误（R10R3）**：原文"20 文件 169 用例"的 169 系瞬时值、写死计数本身即反模式，措辞已改为不随用例数漂移；扩面形态后又由 `R10R3-A-M1` 从裸目录名定形为显式文件列表） |
| R10R2-B-2 | 同上 | 同一件的 B 视角：对称缺口应在登记处成文为观测项，而非只留在 workflow 注释里 | B | 已消化（并入 `R10R2-A-m2` 的 OPEN 行；workflow 注释与本行互为指针） |
| R10R2-C-m1 | `bench/regression-formula.test.ts` / `bench/repeat.test.ts` | 同一件的 C 视角：守护判据公式与 min-of-N 口径的两个测试不在任何 CI 面；C 实测合跑 142 用例仅 1.09s，"避免 e2e 假红"的顾虑可用显式文件列表近乎免费消除 | C | 已消化（并入 `R10R2-A-m2`；正是采 C 的"显式文件列表"修法） |
| R10R2-B-3 | `bench/record-baseline.ts` `fileIdentity` + ADR 残余① | 身份判据的 `statSync` catch-all 在权限受限（EPERM/EACCES）时静默退让为"仅名字判定"，残余①只点名了 realpath 词法回退，未覆盖此面，且无告警 | B | 已消化（ADR 残余①改写为"两个面同为 catch-all 静默退让"并给出退让后果链；不改代码——加 warn 需在正常路径 stat 失败时刷屏，且落"防误操作"模型内） |
| R10R2-C-m2 | 同上 | 同一件（C 独立发现，repro 为代码阅读） | C | 已消化（并入 `R10R2-B-3`） |
| R10R2-A-m3 | `eeeba3e` 提交说明（历史 blob） | `R10-B-1` 登记的"失真理由出现 4 处"，其第 4 处在历史提交说明里，**不可就地改写**；本表当时未点明，后人 `git show eeeba3e` 会吸收到假命题原文 | A | 已消化（本表 `R10-B-1` 行补注：第 4 处为历史提交说明，勘误由 `2f2aa6c` 提交说明承接，历史不可改写） |
| R10R2-B-4 | 同上 | 同一件（B 独立发现，指向"四处文字全部订正"的字面不成立） | B | 已消化（并入 `R10R2-A-m3`；`R10-B-1` 行状态列措辞同步订正为"三处 tracked 文字 + 一处历史提交说明的后续勘误"） |
| R10R2-B-5 | `splitRow` / `fileIdentity` | 注脚级三点：`\|\|`（双反斜杠紧跟竖线）按 GFM 应拆两格而本实现折叠为单格；分隔线单元含内部空格的 `\|` 块被静默排除出结构断言；模板串内 `String()` 冗余 | B | 已消化（第三点就地删除冗余；前两点为**有意的保守偏差**（少认表 → 少断言，不造假红），写入守卫文件头「能力边界」段成文，不改语义以免引入未验证的解析分支） |
| R10R2-C-m3 | ADR 决策 6 抬头 + `record-baseline.ts` 注释 | 文档引用瑕疵两处：决策 6 的历史链把该批写作 `R10-R9R2-*`（自指错标，实为 R9R2 批成文于 `eeeba3e`）；注释"见 docs/adr/0002 补遗一决策 6"与补遗二决策 6（绝对门 print-only）撞名歧义 | C | 已消化（抬头订正为 `R9R2-B-1/B-2/B-3/B-6/C-2 …（登记于 eeeba3e）`；注释改写全称为"补遗一·写入路径守卫"） |
| R10R2-A-m4 | 本提交捆绑范围（7 文件 +307/−62：文档+守卫+CI+parser） | A 的保留意见：跨四面捆绑削弱回滚粒度，建议后续按判据面/测试面/流程面拆分（A 明确标注"不阻断"） | A | 已裁决·**本批不改流程**（保留为下次多文件批的自选动作；本批同样跨四面捆绑，故不在此虚报已改。`R10R2-C-M1` 的修复必须与守卫代码同批走，拆开只会让宿主折叠无测试面同批可审。**勘误（R10R3-C-m3(a)）**：位置格的"7 文件 +307/−62"是**评审对象** `2f2aa6c` 的口径，**收口提交** `8a23a24` 实为 5 文件 +163/−34（`git show --stat 8a23a24`），原文不改写以保可比对。A 的该保留意见连续四批成立，R10R3 起由"逐批自豁免"升为跟踪项 `R10R3-A-N1`） |

- **裁决口径**：13 个 ID（Major 1 / Minor 12）中，12 项就地消化、1 项（`R10R2-A-m2`）**部分消化后按 OPEN
  保留**。三家 R2 下确界 0.90，但 A/B APPROVED 与 C REQUEST_CHANGES 裁决不一致 → 共识门未过，故 C 的
  Major 修复后须出 R3 卷复评（评审对象 = 本收口提交）。
- **本批代码面清单**：`bench/record-baseline.ts`（宿主折叠 + 注释/措辞订正 + 去 `String()` 冗余）、
  `tests/unit/backlog-integrity.test.ts`（inFence + 围栏 fixture + 能力边界补两处有意偏差 + 规格①扩面说明，
  6 → 7 用例）、`.github/workflows/bench.yml`（守卫步扩面 + 注释诚实化）、`docs/adr/0002`（决策 6 历史链
  订正 + 宿主折叠成文 + 残余①扩面 + ④ 两段收口改写 + 验证节新增宿主折叠矩阵/shell 转义陷阱/执行面三条）、本文件。
- **宿主折叠复跑**（win32-x64，17 形态）：6 个流名形态（含 C 的判别力名字 `:probestreamC`、多级 `:NEW:two`、
  `::$DATA`、别名路径 + 新流名）全部 refuse；5 个既有名字变体 + 无参全部 refuse；2 个 UNC/设备命名空间
  别名 refuse；5 个合法出参形态全部放行、无误伤。探针**只读判定不写流**，`dir /r` 无残留、主流 md5
  `3ebfaa9f6a71ecf7cb7b0d91355e2525` 不变、`git status` 干净。
- **守卫有效性负例**（扩面后复跑）：临时删两行 backlog → 三条断言同时 fail（缺 ID / 棘轮下界 / 自检超集），
  恢复后 7 用例全绿。
- **冻结面零改动自证**：`git diff --exit-code 2f2aa6c..HEAD -- bench/regression-formula.ts bench/baseline.json`
  应为 0；判据公式 `* 1.2` / `> 2` 与三台门阈值常量未触碰；本批对 `bench.yml` 只改守卫步的文件列表与注释，
  三台 runner 与 Regression check 步骤逐字节未变。

### R10 R3 批次（`8a23a24` 的修复复评轮走查意见 → 本收口提交，2026-09-23）

R10 R3（修复复评轮，评审对象 = 收口提交 `8a23a24`）：A REQUEST_CHANGES（0.92，1 Major + 4 Minor）、
B APPROVED（0.93，4 Minor）、C APPROVED（0.92，3 Minor）→ 三家下确界 0.92 但**裁决不一致**，共识门
未过。下表登记 13 个 ID 的处置（含把 A 的跨批保留意见升为跟踪项）：

| ID | 位置 | 内容 | 来源 | 状态 |
|----|------|------|------|------|
| R10R3-A-M1 | `.github/workflows/bench.yml` 守卫步 | 本批唯一 Major：守卫步写成裸目录名 `bunx vitest run tests/unit tests/utils bench`，而 vitest 的位置参数是对测试文件路径的**子串过滤**、不前缀锚定 → 任何路径含 `bench` / `tests/unit` / `tests/utils` 字样的未来文件（`tests/integration/bench-*.test.ts`、`tests/e2e/benchmark.test.ts`）被静默纳入阻断步，恰好重新引入该步注释承诺要避免的"未在本 workflow 环境验证过的 e2e = 不可控假红源"。上一轮 C 的修法原话是"**显式文件列表**"，落实时变成了"目录列表"，两者在 vitest 语义下不等价 | A | 已消化（run 改为：以 `find` 的三个根目录（仅作**作用域锚点**）配 `-print0` 产出文件列表、`mapfile -d` 收进数组、再以数组展开把**逐个真实文件路径**交给 vitest；列表为空即刻 `exit 1`，绝不退化成全量。判别力实测复跑：临时放一个 `tests/integration/bench-sentinel-probe.test.ts`，裸目录名形态纳入它（21 文件）、显式文件列表形态不纳入（20 文件），用例数随之各差 1 故不在此写死（探针验后即删、`git status` 干净）。workflow 注释同步披露子串过滤机制属性，见 `R10R3-C-m3` 的 c 面） |
| R10R3-A-m1 | `.github/workflows/bench.yml` 注释 / 本表 `R10R2-A-m2` 行 / ADR 验证节 | 三处 tracked 文字把"20 文件 169 用例"当事实写死，实测 170（169 系上批新增围栏 fixture 之前的瞬时值，扩面后未复跑更新）。本批核心动作恰是"扩执行面"，却把会漂移的计数写进三处——与本项目连续多轮惩罚的命题性质同类 | A | 已消化（三处一律改为**不随用例数漂移**的措辞：workflow 注释只留"本机实测墙钟 <2s，用例数随批次漂移故不写死"；本表与 ADR 的原文不改写、各加勘误指针，避免历史失真） |
| R10R3-A-m2 | `tests/unit/backlog-integrity.test.ts` `parseTables` 的围栏识别 | 上批补的 inFence 有两处未成文的 GFM 偏差，其中一处正落在**有害方向**：① 闭合行带 info string（三反引号后另有字符）本实现按前缀即认闭合 → 围栏提前结束 → 其后的示例表格被计入 = 幻影表 / 幻影 ID（正是 `R10R2-A-m1` 要堵的类）；② 缩进 4 空格的围栏标记行在 GFM 属缩进代码，本实现先 trim 再匹配 → 把它后面的**真实**登记处表吞掉（少认 = 假红方向）。文件头"按 GFM 维护"的说法强于实现 | A | 已消化（新增 `fenceMarker(raw, role)`：开启与闭合均限缩进 ≤3 空格（tab 记 4），闭合行须为**纯**同字符标记串（带 info string 者按 GFM 只是围栏内文本），长度配平保留；三条 fixture 断言固化两形态 + `fenceMarker` 单元判定；文件头「能力边界」补第三段成文残余（开启行的 info string **内容**不做校验，GFM 仅禁其含反引号）。守卫用例 7 → 8） |
| R10R3-B-m1 | 同上（闭合判定） | 同一件，B 视角并给出可执行修法与 repro：逐字提取 shipped parser，"开围栏带 md 语言标记、内有一行带 ts 语言标记的三反引号"使围栏提前闭合，其后示例表被判 1 张幻影表、幻影 ID 入 `idColumn`（GFM 真值 0 张）；建议闭合判定追加"trim 后整行只含 marker" | B | 已消化（并入 `R10R3-A-m2`，采 B 的修法；B 的 repro 形态直接固化为新 fixture 第一条） |
| R10R3-B-m2 | 同上（缩进规则） | 同一件的第②面：4 空格缩进的三反引号行被当围栏 → 吞掉其后的真实 ID 表（B 实测 tables=0，GFM 真值 1），方向为假红；建议按 GFM 把缩进限到 3 空格，或照 `\|` 先例成文为有意偏差 | B | 已消化（并入 `R10R3-A-m2`：**实现按 GFM 收紧**而非仅成文——两候选里取更强的那个，因为"吞真表"是假红方向、成文不消除它） |
| R10R3-A-m3 | `MIN_BACKLOG_ROWS = 68`（本批后 81） | 棘轮下界恒等于实测行数（上批 55=55、本批 68=68，A 独立数出 8 张 ID 表 / 68 行）。零余量使"棘轮"退化为"快照"：任何净减 1 行的合法结构调整必红，红因是"下界贴实测"而非真丢行 | A | 已裁决·**不留余量，改为成文**（零余量是既定设计而非缺陷：合法裁剪必须同批下调常量并进 diff、与下调 `LOCKED_IDS` 同一动作、走查可见；留余量等于放行"删一行不登记"，与本登记处的设立缘由（`730f82e` 自毁事故）正面对冲。采 C 的落点：把惯例写进登记处「行数棘轮约定」+ 守卫文件头「能力边界」，并点明"看到下界 = 实测不要反射式放宽"） |
| R10R3-C-m1 | 同上 | 同一件（C 独立提取 shipped parser 复测 rows=68=MIN）；C 的具体诉求是惯例未在状态列约定成文，后人易误判为假红而反射式下调常量 | C | 已消化（并入 `R10R3-A-m3`，落点即 C 指名的「状态列约定」段，新增「行数棘轮约定」小节） |
| R10R3-A-m4 | `bench/record-baseline.ts` `fileIdentity` 的 tracked 侧 + ADR 残余① | "不加 warn"的裁决只覆盖了 `outIdentity === null`（out 尚不存在 = 合法高频，告警会刷屏）；`trackedIdentity === null` 是另一支：tracked 文件在仓内必在，对其 stat 抛错本身即异常，且一旦发生身份判据对**全部**别名形态静默失效、守卫降级为纯名字判定。ADR 把两支并入"同为 catch-all 静默退让"，在语言上掩盖了正常性差异 | A | 已消化（定向告警：新增 `statThrows()` 把"stat 抛错（异常）"与"`ino === 0`（文件系统不报文件 ID，正常降级）"分开，只在**前者**告警——健康路径永不触发、零刷屏。两分支的正常性差异同时写进 `fileIdentity` 注释与 ADR 残余①。**未采** B/C 建议的 `existsSync` / 无条件 warn 形态：9p 与部分网络盘上 `ino` 恒 0，那两种写法会每次运行都刷屏） |
| R10R3-B-m3 | 同上 | 同一件（B 视角：定向告警的健康路径永不触发、零刷屏；实测硬链接别名在正常态仍被正确拒绝） | B | 已消化（并入 `R10R3-A-m4`） |
| R10R3-C-m2 | 同上 | 同一件（C 用内存 mock 构造 `trackedIdentity === null` + 硬链接别名写入 → 仅名字判定且无告警）。C 附带的"拒绝文案仍宣称身份保护在位"一句经复核**不成立**：`sameInode` 恒假时别名措辞分支不可达，拒绝文案不会误报做过身份判定 | C | 已消化（并入 `R10R3-A-m4`；真实缺陷是**降级本身无信号**，非文案误导） |
| R10R3-B-m4 | `bench/record-baseline.ts` 采样循环 + `writeFileSync` | 写可达性预检缺失**且未登记**：错拼目录 / 不可写目标 / 空宿主（流后缀折叠后为 `""`）三类穿过守卫，先跑满 10×3 采样（约 80–90s）才在 `writeFileSync` 处 ENOENT——资源浪费 + 失败信号误导。非保真缺陷（tracked 零风险、最终 fail-loud），本批不修可辩，但登记处无任何行，违反"发现即登记" | B | 已消化（采样前 `assertWritableOutPath(outHost)`：空宿主 / 父目录不存在 / 父目录不可写 / 目标存在但非普通文件或不可写 → 即刻 throw。**只读判定**：不 mkdir、不 touch、不以 append 模式打开（那会留下 0 字节文件或改动 mtime），也**不宣称消除 TOCTOU**——预检与写之间的窗口与 ADR 残余①②同型，本步只把"必然失败"提前到失败最便宜处） |
| R10R3-C-m3 | `MIN_BACKLOG_ROWS` + `.github/workflows/bench.yml` 注释 + 本表 `R10R2-A-m4` 行 | C 的三小面：(a) `R10R2-A-m4` 位置格的"7 文件 +307/−62"沿用**评审对象** `2f2aa6c` 的口径，**收口提交** `8a23a24` 实为 5 文件 +163/−34，措辞指向错误对象；(b) 棘轮下界恒=实测的惯例未成文；(c) vitest 位置参数是子串过滤这一机制属性未在 workflow 注释披露 | C | 已消化（(a) 在该行状态格加勘误指针、原文照旧不改写以保逐行可比对；(b) 并入 `R10R3-A-m3`；(c) 并入 `R10R3-A-M1` 的注释改写） |
| R10R3-A-N1 | 多文件批的捆绑粒度（流程面） | A 的保留意见升为**跟踪项**：跨面捆绑削弱回滚粒度，自 `R10R2-A-m4` 起连续四批成立；A 明确不再接受"逐批以'Major 需同批可审'自豁免"，要求有一个可持久追溯的跟踪载体 | A | 已消化（**R10 R4 批按四面拆分提交**：判据/守卫面 → 测试面 → CI 执行面 → 文档面，四笔独立提交各自可回滚，证据见本批「代码面清单」。连续五批的"Major 需同批可审"自豁免到此为止。该行原为 OPEN，其"无到期/升级条款"的元缺陷另升为 intro 的通则，见「跟踪项到期与升级」） |

- **裁决口径**：13 个 ID（Major 1 / Minor 11 / 跟踪项 1）。三家 R3 下确界 0.92，但 A 为
  REQUEST_CHANGES、B/C 为 APPROVED → 裁决不一致，共识门未过，故 A 的 Major 修复后须出 R4 卷复评
  （评审对象 = 本收口提交）。
- **本批代码面清单**（跨四面，正是 `R10R3-A-N1` 所指形态）：`.github/workflows/bench.yml`（守卫步改
  显式文件列表 + 空列表 fail + 注释披露子串语义）、`tests/unit/backlog-integrity.test.ts`
  （`fenceMarker` 两条 GFM 规则 + 新 fixture 用例 + 锁清单 13 项 + 棘轮 68→81 + 「能力边界」补两段）、
  `bench/record-baseline.ts`（`statThrows` 定向告警 + `assertWritableOutPath` 采样前预检 + 注释两支分列）、
  `docs/adr/0002`（残余① 两支分列 + 写可达性预检成文 + 执行面措辞订正）、本文件。
- **守卫面负例**（本批复跑）：① 显式文件列表形态对 `tests/integration/bench-sentinel-probe.test.ts`
  零纳入（20 文件）而裸目录名形态纳入（21 文件）；② 人为删一行 backlog → 三条断言同红（缺 ID /
  棘轮下界 / 自检超集）；③ 外科变异删除 `fenceMarker` 的 info string 与缩进两条规则 → 新 fixture
  用例转红（证明其判别力，非空转）。
- **冻结面零改动自证**：`git diff --exit-code 2f2aa6c..HEAD -- bench/regression-formula.ts bench/baseline.json`
  应为 0；判据公式 `* 1.2` / `> 2` 与三台门阈值常量未触碰。本批对 `bench/regression-formula.ts`
  与 `bench/baseline.json` 零字节改动，`bench.yml` 只改守卫步（三台 runner 与 Regression check 逐字节未变）。

### R10 R4 批次（`e58257a` 的第二处置复评轮走查意见 → 本收口提交，2026-09-23）

R10 R4（第二处置复评轮，评审对象 = 收口提交 `e58257a`，即 R10 R3 意见的处置）：A APPROVED（0.93，
2 Minor）、**B REQUEST_CHANGES**（0.92，1 Major + 2 Minor）、C APPROVED（0.93，4 Minor）→ 三家比值
下确界 0.92 达门，但**裁决不一致**，共识门第三次未过（R1 三家全 REQUEST_CHANGES、R3 与本轮各一家
不批）。下表登记 9 个 ID 的处置。**本轮全部 ID 经出题方独立实测坐实后才接受**（含把 C 报的 2 处
ID 变体订正为 4 处、把 A 的"登记为已知残余"候选修法改为代码收口）：

| ID | 位置 | 内容 | 来源 | 状态 |
|----|------|------|------|------|
| R10R4-B-M1 | `.github/workflows/bench.yml` 守卫步 | 本批唯一 Major：`mapfile -d '' -t guard_files < <(find … \| sort -z)` 里 find/sort 的非零退出码被**进程替换整体丢弃**，`mapfile` 恒返 0，`bash -e` 也管不到替换内部 → 三个作用域锚点目录任一被重命名/拆分时，守卫以**缩减后的文件集静默变绿**（空列表守卫只拦"全灭"形态）。与 `R10R3-A-M1` 同族而方向相反（那次是多纳入=假红，这次是少纳入=**假绿**），危害同级 | B | 已消化（三处机制层修：①锚点存在性先各自 `[ -d ]` 断言，缺失即 exit 1 并**指名是哪个根**；②find 与 sort 的退出码各由 `if !` 显式检查，失败即 exit 1；③mapfile 改从 `mktemp` 出来的**普通文件**读，把"退出码被进程替换丢弃"这一机制整体移除而非绕过。空列表守卫保留为最后一道。本地四路径实测（`var/probe-workflow-guard.sh`，在 `mktemp -d` 沙箱复刻锚点空壳跑判定前缀，**不在真实仓内移动/改名任何目录**；刻意不写文件计数——见 `R10R3-A-m1` 的"可漂移计数不得当命题"）：三锚点齐全 rc=0 / 缺任一锚点 rc=1 且文案指名该根 / find 非零 rc=1 / 空列表 rc=1；**同一"缺锚点"形态喂给修复前的旧体 → rc=0 且文件集静默缩减**（本条 Major 的正身证据）） |
| R10R4-A-m1 | 同上 | 同一件的 A 视角，并给出与 R3 Major 的方向对比："少纳入真测 = 假绿"比"多纳入 = 假红"更隐蔽；亦指出旧裸目录名形态对不存在 token 同样静默少跑，故**非本批新增**，但本批改成 find 锚点时本可顺势补断言 | A | 已消化（并入 `R10R4-B-M1`；A 的"锚点存在性断言"修法即 ①，采其为同级 fail-loud 而非注释提醒） |
| R10R4-C-m2 | 同上 | 同一件的 C 视角：即便 fail 成立，收场是**裸 exit 1**，与空列表分支的定向文案不对称；且该 fail 依赖 GitHub 默认注入的 `bash -e` 约定（本地实测 `mapfile < <(false); echo $?` → 0），约定一旦变化（shell 覆写/迁移）即退化 | C | 已消化（并入 `R10R4-B-M1`，采 C 的"fail 自带修复指引"诉求：三条失败路径各有专属文案，且 ②③ 使正确性**不再依赖未成文的 `-e` 约定**——退出码检查写在步骤体内） |
| R10R4-A-m2 | `bench/out-path-guard.ts` `assertWritableOutPath`（原 `record-baseline.ts`） | 空宿主分支只覆盖"整路径折叠为空"（裸 `:stream`），**尾冒号变体**（`dir/file.json:`、`file::`、`file:a:b`）宿主非空、父目录可写 → 穿过预检，跑满 10×3 采样才在 `writeFileSync` 处 ENOENT。A 的 fs 级实测：`writeFileSync("x.json:")` → ENOENT 而 `writeFileSync("y.json:tag")` → 成功。ADR 当时"宿主折叠后为空"的窄口径字面成立，但 `R10R3-B-m4` 的精神（把必然失败提前到最便宜处）未闭该变体 | A | 已消化（**代码收口**而非 A 的另一候选"登记为已知残余"：新增判据——win32 且宿主被折叠时，流后缀为空或含 `:` 即 throw。判据比 A 建议的正则 `/[\\/][^\\/]*:$/` 更宽，一并覆盖 `file::` 与 `file:a:b`；亦只增拒绝、不放宽任何既有判定。**规则经实测精确化**：NTFS 流名必须非空且不含 `:`——`f:`、`f::`、`f:a:b`、`f:a:b:c` 即使宿主存在也一律 ENOENT，`f:tag`/`f:$DATA` 才合法。posix 上 `:` 是普通字符，整条判据不生效） |
| R10R4-B-m1 | `tests/unit/backlog-integrity.test.ts` 用例 8 | 闭合的**配平两条件**（同字符 + 长度 ≥ 开启）在 `parseTables` 层零 fixture 覆盖，而用例 8 的注释③宣称"长度与字符仍须配平：短的/异字符的闭合串不闭合"——B 的变异矩阵实测：删 `marker[0] === fence.ch` 或删 `marker.length >= fence.len`，shipped 全部 fixture 依旧全绿。**注释覆盖面高于证据**（生产代码无缺陷，纯覆盖缺口 + 文字过强） | B | 已消化（补**成对**判别力：` ```` ` 开启遇 ` ``` ` 不闭合、其后真表不入表 ↔ 遇 ` ```` ` 闭合、真表入表；`~~~` 开启遇 ` ``` ` 不闭合 ↔ 遇 `~~~` 闭合。注释③改写为如实范围并点名此前的空转。**复跑变异实测 4 条**（`var/mut-backlog-r5.mjs`，`--reporter=json` 取权威红名单）：N-a 闭合行允许带 info string / N-b 取消缩进 ≤3 空格限制 / N-c 闭合长度不必 ≥ 开启长度 / N-d 闭合可不匹配开启字符 —— **各杀恰好 1 条**用例，且 N-c 与 N-d 红在同一用例的**不同支**（配平的两条件自此各自独立可杀，不再互相掩盖）。探针纪律注：N-c/N-d 首版写成裸表达式时因**该式在文件内出现 2 次**（第 223 行代码 + 第 400 行本批新写的注释）而报 span error，被"无效探针"检查当场抓出——该检查正是为拦这类静默空转而加） |
| R10R4-B-m2 | `bench/out-path-guard.ts` `assertWritableOutPath` 的目录腿 + ADR 验证节 | win32 上 `accessSync(dir, W_OK)` **近乎恒真**：libuv 只看只读**属性**且对目录忽略该属性 → `icacls /deny (WD)` 的目录 touch 失败而预检放行（假阳性）。ADR 把"错拼目录 / 只读卷 / 空宿主"并列为即刻 throw，其中"只读卷/目录 ACL"一档在 win32 **不成立**（Linux 由内核 `access(2)` 真拦）。后果仅退回"跑满采样后 ENOENT"的旧行为，无正确性损失 | B | 已消化（**成文，不改代码**：函数文档注 + ADR「能力边界」各成文一段，并给出为什么不改——win32 上不存在"既不误拒也不漏放"的目录可写探测：写探测会留 0 字节文件或改 mtime，引入 `icacls` 子进程依赖则把一个防误操作守卫变成新的失败面。目录侧的**存在性**与非普通文件两腿仍可靠，且 `isFile()` 判据正是 ACL 恒真下的独立防线） |
| R10R4-C-m1 | 本表 `R10R3-A-N1` 行 + intro | 跟踪项只写"下次多文件批拆分时消化"，**无到期/升级触发**；intro 的 2026-09-30 期限是否覆盖跟踪项亦未明说。风险不在本批而在"无期限的下一批"——`R10R2-A-m4` 起连续四批自豁免得以成立的机制正在此 | C | 已消化（两件事，不止闭一行：①`R10R3-A-N1` 由**本批真按四面拆分提交**而转 已消化；②采 C 的"条款"诉求升为登记处**通则**——intro 新增「跟踪项到期与升级」段（无到期条件的跟踪项不得登记），并在处置期限明写"期限覆盖所有行，跟踪项不例外"） |
| R10R4-C-m3 | `docs/adr/0002:61` + `tests/unit/backlog-integrity.test.ts` 三处 | 本批重写的 tracked 文字引入不在锁清单内的 ID **变体记号**：`R10R2-B-Minor-3`/`R10R2-B-Minor-5`（canonical `R10R2-B-3`/`R10R2-B-5`，系 `8a23a24` 遗留、本批改写同行未顺手订正）。变体不受锁清单超集断言管辖，`grep` 回查脱靶——与登记处"编号可机器回查"的设立目的相悖，且恰违反本批自己确立的编号一致标准 | C | 已消化（**实测 4 处而非 C 报的 2 处**：C 的 grep 式 `R10R2-B-Minor-[0-9]` 漏掉裸 `B-Minor-1` 型两支（`test:189`/`test:343`，恰是 `e58257a` **本批新引入**的）。四处一律规范化为 canonical，`grep -rn -- '-Minor-' docs tests bench src` 现零命中） |
| R10R4-C-m4 | `bench/record-baseline.ts` 的 `assertWritableOutPath` / `statThrows` / 守卫全段 | **零自动化覆盖**：`record-baseline.ts` 是可执行脚本、不在 vitest include 面，新预检与告警分支的回归只靠人工 CLI 探针（ADR 验证节三条 bullet 即全部证据）。C 给两候选（内存 mock / 抽纯函数到受测模块），并点名"当前形态下将来重构守卫段很容易静默丢掉预检而不被守卫面捕获" | C | 已消化（取**更强的那支：抽取受测模块**，而非 C 的最低要求"登记为观测项"。新增 `bench/out-path-guard.ts`（宿主折叠/名字折叠/身份折叠/argv 形态/拒绝措辞/写可达性预检全部纯函数化，`plat` 形参作测试注入点）+ `bench/out-path-guard.test.ts`（形态矩阵 + 真实硬链接/符号链接的身份判据 + 预检各拒绝与放行支），`record-baseline.ts` 改为 import、只留 argv 解析、CI 放行判定与告警投递。**落点理由**：C 说的"将来重构"正是本批自己触发的场景——该守卫段已被改过三遍。测试文件落在 `find … bench` 锚点内 → 自动进入 CI 阻断步。变异实测 **11 条、11/11 全杀**（`var/mut-guard-r4.mjs`）：M-a 不剥流后缀（红 7 条）/ M-b 大小写无条件折叠（1）/ M-c 取消 `ino === 0` 哨兵退让（2）/ M-d `identityAbsent` 与正常降级混类（1）/ M-e 删 argv 的 `-` 前缀分支（1）/ M-f 删 NTFS 流名字面约束（1）/ M-g 删空宿主分支（1）/ M-h 宿主折叠只认正斜杠（1）/ M-i 盘符前缀识别失效（1）/ M-j `refusal` 的 stream 支退化（1）/ M-k `identityAbsent` 恒假（1）。**M-c 与 M-d 首跑双双存活，暴露的是真缺口而非探针问题**：`ino === 0` 那半条当时藏在 `fileIdentity` 的 `try` 内，唯一可达路径是"造一个报不出文件 ID 的文件系统"。据此两件收口：① 抽纯函数 `identityOf({dev,ino})` 作注入点（与 `plat` 同源动机），`fileIdentity` 只留 `statSync` + 转调；② 实测发现 **win32 的 `\\.\NUL` 是真实存在、`statSync` 成功且报 `dev=0 ino=0` 的路径**（`var/probe-ino0.mjs`），"哨兵 → 身份退让**且不告警**"整链由 `it.runIf(win32)` 用例端到端钉住。**已命名残余**（写在该测试文件头，不以恒真断言冒充）：UNC 与 `\\?\` 与 8.3 短名的**端到端**折叠需 win32 realpath 与 share 权限，仍留实机探针；`identityOf` 那半平台无关、CI 必跑，但 `\\.\NUL` 那半在 linux 上 skip（故 M-d 在 CI 仍存活，属**已命名的平台专有覆盖**而非假绿）） |

- **裁决口径**：9 个 ID（Major 1 / Minor 8）。三家 R4 下确界 0.92，但 B 为 REQUEST_CHANGES、A/C 为
  APPROVED → 裁决不一致，共识门未过，故 B 的 Major 修复后须出 R5 卷复评（评审对象 = 本收口提交）。
- **本批代码面清单**（按 `R10R3-A-N1` 的要求**四面拆分提交**，四面各成一笔、每笔独立可回滚）：
  ① 判据/守卫面 = `bench/out-path-guard.ts`（新增）+ `bench/out-path-guard.test.ts`（新增）+
  `bench/record-baseline.ts`（改为 import，删内联副本）；② CI 执行面 = `.github/workflows/bench.yml`
  （`R10R4-B-M1` 锚点 fail-loud）；③ 文档面 = `docs/adr/0002`；④ 测试面 =
  `tests/unit/backlog-integrity.test.ts`（`R10R4-B-m1` 配平断言 + `R10R4-C-m3` ID 规范化 + 锁清单与
  棘轮扩容）**+ 本登记处**。④ 把两者并为一笔不是偷懒而是棘轮契约的要求：`MIN_BACKLOG_ROWS` 与
  `LOCKED_IDS` 的**断言对象就是本文件**，分两笔必有一笔落地时该笔自身是红的（先代码后登记处 → 登记处
  那笔红；先登记处后代码 → 代码那笔之前的历史 commit 全红）。本登记处「行数棘轮约定」写死"合法裁剪必须
  **同批**下调常量并进 diff"，同批 = 同一笔。其余三面均可任意顺序独立回滚。
  四面各自成笔，是本登记处设立以来第一次没有"Major 需同批可审"捆绑的收口批。
- **守卫面负例**（本批复跑，全程不触 tracked 文件、探针产物在 `var/`）：① **十一条**外科变异 11/11 全杀
  （首跑 M-c/M-d 存活 → 补 `identityOf` 注入点与 `\\.\NUL` 真实哨兵用例后闭，见 `R10R4-C-m4`）；
  ② 四条 parseTables 闭合配平变异各致恰好 1 条用例红（见 `R10R4-B-m1`）；③ workflow 三路径
  实测（正常 / 缺锚点 / find 失败）见 `R10R4-B-M1`；④ 人为删一行 backlog → 缺 ID / 棘轮下界 /
  自检超集三条断言同红。
- **冻结面零改动自证**：`git diff --exit-code e58257a..HEAD -- bench/regression-formula.ts bench/baseline.json`
  应为 0；判据公式 `* 1.2` / `> 2` 与三台门阈值常量（G1 5/12ms、G2 8KB:3 / 64KB:10 / 512KB:40ms、
  G3 20/50/120ms）未触碰。本批对 `bench/regression-formula.ts` 与 `bench/baseline.json` 零字节改动；
  `record-baseline.ts` 的改动全部是**守卫段搬家**（判据、文案、顺序逐字保持），采样协议与输出口径未变；
  `bench.yml` 只改守卫步（三台 runner 与 Regression check 逐字节未变）。

### R10 R5 批次（`4bbea37` 的第三处置复评轮走查意见 → R11 收口，2026-09-23）

R10 R5（第三处置复评轮，评审对象 = 收口提交 `4bbea37`，即 R10 R4 九个 ID 的处置）：A / B / C **三家
首次全 APPROVED**（0.90 / 0.90 / 0.92，0 Critical / 0 Major）→ 比值下确界 0.90 达门且裁决一致，共识门
**第五次才过**。8 个 ID 全为 Minor（下表）。**本批另有 1 个非走查来源 ID**：推送后 CI 16 秒转红抓到的
根因 ①（下表 `R11-CI-1`）——它不在任何专家的 R5 意见内，是"CI 是唯一 linux 执行环境"这一结构性盲区
的产物，故单独立行而非塞进 `R10R5-A-m3`。下表全部 ID 经出题方**独立实测**坐实（含两处对 R5 卷面 §3
声称证据的订正：skip 归因、`f:`-型恒 ENOENT 的表述）：

| ID | 位置 | 内容 | 来源 | 状态 |
|----|------|------|------|------|
| R11-CI-1 | `bench/out-path-guard.ts` `canonicalPath` 词法回退 + `assertWritableOutPath` 的 `plat` 第二形参 | 推送后 CI 的 `Unit + registry guard` 步 16 秒转红，2 条用例红在阻断步最前面（正是该步设计用途），而**本机 win32 全绿**：① 反斜杠别名（`bench\baseline.json::$DATA`）的宿主折叠在 linux 上不成立——`plat` 形参改得动本仓判据，改不动**宿主绑定**的 `realpathSync.native` 与 `node:path` 默认导出的 `resolve`/`dirname`，linux 上那是一整个含反斜杠的文件名；② `assertWritableOutPath(fate, plat = platform())` 与 `fate.outHost` 的折叠平台构成**两个平台事实源**，用例只给 `inspectOutPath` 传 `plat` → 流名判据整条跳过。`R10R5-A-m3` 在推送前已把 ② 判为 Minor 并预言该失效形态 | CI 真实红灯（非走查来源） | 已消化（① 新增私有 `lexicalForPlat(p, plat)`，**只**接词法回退分支与 `dirname` 取父处；不接 realpath 分支的理由与"只增拒绝"的方向论证见 `docs/adr/0002` 补遗四，等价性钉成 `it.runIf(win32)` 用例。② `OutPathFate` 携带 `readonly plat`、由 `inspectOutPath` 与 `outHost` **同源产出**，`assertWritableOutPath` **删去**第二形参 → 不一致在类型层不可表达；生产侧 `record-baseline.ts` 本就是单参调用，零改动。预推送复现通道：WSL + `node --experimental-strip-types` 直取判据模块，见 ADR 补遗四验证节） |
| R10R5-A-m1 | `.github/workflows/bench.yml` 守卫步的三个 `[ -d ]` 锚点 | 锚点断言只证"目录**在**"，不证"目录里**有货**"：某根被合法清空（其测试迁走而未同步本步）时，`find` 返回空、其余两根照常 → 该根**静默少跑**，与 `R10R4-B-M1` 同方向（假绿），只是触发形态从"目录不见"降到"目录空转" | A | 已消化（每根加"至少匹配 1 个 `*.test.ts`"断言：`find "$root" -name '*.test.ts' -print -quit \| grep -q .`。取**零漂移**形态而非断言文件计数（`R10R3-A-m1` 的"可漂移计数不得当命题"）。并成文为**有意绊线**：某根测试被合法迁走时，本步要求在同一笔提交里删掉该锚点——这是要求而非漏洞） |
| R10R5-B-m2 | 同上（三个锚点的"有货"面） | B 独立提出的同族邻居：`[ -d ]` 三兄弟对"目录在而其中无任何受测文件"同样放行，与 `R10R4-B-M1` 的"缩减文件集静默转绿"同一失效方向（假绿），只是本批把 find 换成锚点后该面仍在 | B | 已消化（**并入 `R10R5-A-m1`**，两家同一诉求取同一形态收口，不单开第二笔改动） |
| R10R5-A-m2 | `.github/workflows/bench.yml` 守卫步的 `sort -z "$list_in" -o "$list_out"` | `sort -z -o F F` 的 in-place 形态把正确性压在 coreutils **未承诺的同时性**上（若先截断输出再读输入即毁列表），而毁形方式是"列表变短 → 少跑而转绿"，不是报错 | A | 已消化（改两个不同 `mktemp` 文件，彻底消除该同时性依赖。**如实披露**：本机 coreutils 上 in-place 与双文件形态**逐字节相同**（21 文件 / 750 字节），未复现损坏——本条是**预防性**收口而非缺陷修复，判据是不把正确性压在未承诺的实现细节上） |
| R10R5-A-m3 | `bench/out-path-guard.ts` `assertWritableOutPath` 签名 | 带默认值的第二形参 `plat = platform()` 与 `fate` 内已折叠的 `plat` 并存 = **同一事实两个源**，调用方漏传即静默跳过 win32 专有判据；A 在 R5 就点名"这会被 CI 以真实红灯兑现"（后被 `R11-CI-1` 兑现） | A | 已消化（删第二形参，`plat` 单一事实源随 `fate` 同源产出；见本表 `R11-CI-1` 支 ②） |
| R10R5-B-m1 | `bench/out-path-guard.ts` 流名判据的注释措辞 | 卷面与本仓注释把 `f:` / `f:a:b` 与 `file:` / `file:a:b` 混为一谈（统称"恒 ENOENT"）。实测两者不是一回事：单字母前缀是**盘符相对**形态（把 cwd 置于 `var/` 下 `openSync("D:h.txt:w9","wx")` **创建成功**），恒 ENOENT 的只是**多字母宿主**那一组。代码行为本就正确（`f:a:b` 折到宿主 `f:a` + 流名 `b`，是合法可写形态），错的是叙述 | B | 已消化（**订正措辞、不改判据**：注释按"多字母宿主 vs 单字母盘符"分列。若照原措辞写死判据反而会误拒合法形态，故这是措辞缺陷而非代码缺陷——B 自己亦如此定性） |
| R10R5-B-m3 | R5 卷面 §3 的 skip 归因 | 卷面称唯一 skip 用例是"W_OK 可观测性自校准（win32 `chmod 0` 后 `accessSync` 仍成功）"。实测该 shell 下 skip 的是**符号链接**用例（无建链特权）；文件腿 `chmod 0` 后 `accessSync(W_OK)` 在 node/bun 双运行时均 **EPERM**（真实可观测且真实通过），只有**目录腿**近乎恒真（与 `R10R4-B-m2` 成文一致） | B | 已消化（订正卷面与测试头注的归因；`R10R4-B-m2` 的"win32 目录 ACL 不可探测"结论不变。**教训成文**：声称证据须附复跑命令与当场输出，凭记忆写"唯一 skip 是什么"会错） |
| R10R5-C-m1 | `bench/out-path-guard.test.ts` 头部「uncovered 面」清单 | 头注只命名了 `M-d`（`identityOf` 混类）一条平台专有存活支；实测 `M-k`（`identityAbsent` 恒假的端到端腿）在 linux CI 上**同样**存活。两条一起写，读者才不会以为"只有那半条依赖 win32" | C | 已消化（测试头注把 `M-d` 与 `M-k` 并列为第 2/3 条 uncovered 项，不改代码——补 linux 覆盖需要真实 win32 runner，属既有结构性缺口，见 `R10R2-A-m2`） |
| R10R5-C-m2 | `bench/out-path-guard.ts` `assertWritableOutPath` 的目录 catch 文案 | 不可达或无权限的 **UNC 共享根**在 win32 上是 `existsSync` 报 false、`accessSync` 抛 `EACCES`，落进"无法确认存在"之外的另一条腿，却被文案表述成 `parent directory … is not writable` → 诊断失真（后果良性：仍在采样前 fail-fast）。旧 `record-baseline.ts` 即有此措辞，非 R11 回归 | C | 已消化（文案改 `cannot be verified as writable (${String(e)})` 并带出原始 errno；ADR 验证节"父目录存在性两平台都可靠"补 UNC 例外限定） |
| R11-SR-1 | `.github/workflows/bench.yml` 守卫步新增的 `find … -print -quit \| grep -q .` 管道 | 出题方走查前自查：本仓多处 tracked 文字断言"GitHub 默认注入 `bash -e`、**无** `pipefail`"，该断言从未实测；而 A-m1/B-m2 的新体恰好引入了一个管道，其正确性方向（谁的非零退出会杀脚本）取决于这两个标志。四组合 × 各 30 次实测：`-print -quit` 使 `find` 打印一条即自行退出，`grep` 关管道时已无写入 → 四种标志组合同构，判定不受 runner 标志漂移影响。对照候选命令替换形 `hits=$(find …)` 在 `-e` 下会被 `find` 非零退出**直接杀掉脚本**（丢定向文案）→ 更差，故保留管道形 | 自查（走查前） | 已消化（**降级而非判据化**：新体不依赖该断言，两处显式 `\|\| true` 兜底（`bench.yml:96` / ADR:144）；实测结论写进 `bench.yml` 注释与 ADR，"未验证的 runner 约定"自此不再是任何一条判据的前提） |

- **裁决口径**：本表 **10 行 = 走查 Minor 8 + 非走查来源 2**（`R11-CI-1` 来自 CI 真实红灯、`R11-SR-1`
  来自出题方走查前自查）。三家 R5 下确界 0.90 且裁决一致 → R10 批共识门第五次通过、`4bbea37` 推送，
  随后 CI 转红即 `R11-CI-1`。
- **本批代码面清单**（延续 `R10R3-A-N1` 的四面拆分，R11 另加 ⑤）：① 判据面 = `bench/out-path-guard.ts`
  + `bench/out-path-guard.test.ts`；② CI 执行面 = `.github/workflows/bench.yml`；③ 文档面 =
  `docs/adr/0002` 补遗四；④ 测试面 + 本登记处（锁清单 +10、棘轮随实测同批上调）；⑤ 自查订正面 =
  `lexicalForPlat` 文档注错字与 `R11-SR-1` 登记。
- **验证**：① 本机 `bunx vitest run bench/out-path-guard.test.ts`；② 真实 linux 正向 + 修复前模块负向
  对照（`git show 4bbea37:bench/out-path-guard.ts` 现取），退出条件写死为"正向必 rc=0、负向必有红"；
  ③ 守卫步沙箱从 `bench.yml` **原文抽取** `run:` 体（只替换末行 `bunx vitest run`）跑六路径；
  ④ 登记处 parser 变异与人为删行；⑤ `R11-SR-1` 的四 shell 标志组合实测（`bash` / `bash -e` /
  `bash -o pipefail` / `bash -e -o pipefail`）。落点与逐条数字见 `docs/adr/0002` 补遗四验证节。
- **冻结面零改动自证**：`git diff --exit-code 4bbea37..HEAD -- bench/regression-formula.ts bench/baseline.json
  bench/record-baseline.ts` 为 0；判据公式 `* 1.2` / `> 2` 与三台门阈值常量（G1 5/12ms、G2 8KB:3 /
  64KB:10 / 512KB:40ms、G3 20/50/120ms）未触碰；`bench/baseline.json` md5 仍为
  `3ebfaa9f6a71ecf7cb7b0d91355e2525`。

### R11 R1 批次（R11 匿名轮走查意见 + 走查期仓库重建事故 → 本收口提交，2026-09-23）

R11 R1（匿名轮，评审对象 = R11 的 ①②③ 面落点）：A 提出 **2 Major + 5 Minor**，B / C 另有意见但
本轮结论随事故作废（见下表 `R11-INC-1`）。8 个 ID = 走查来源 7 + 事故来源 1。下表处置的落点全部在
**入库面**（判据/测试/CI/文档），故 Round 1 证据作废**不**影响这些处置的可验证性——每条都能被当前
HEAD 的用例、`bench.yml` 原文或 ADR 文本复核。

| ID | 位置 | 内容 | 来源 | 状态 |
|----|------|------|------|------|
| R11R1-A-M1 | `docs/adr/0002` 补遗四·验证节末条 | 卷面写"上述三个 `var/` 探针脚本随本批收口删除，故此处引用是历史记录而非可复跑入口"，但该节全部数字（40/0、25/15）只在**被删的脚本**里成立：一段 tracked 文档把结论钉在无人能复跑的入口上。且 `!var/*.ts` 使 `.ts` 探针**可被 `git add`**，"随批删除"并非任何一道门保证的性质 | A | 已消化（改写为成文约定：**凡 ADR/登记处写作 `var/…` 的路径都是 gitignored 的本机 scratch、不是可复跑入口；回归保护一律以入库面为准**，历史批次未加此限定的同类引用按本条同解。同批把该节数字换成用**入库期望表**复跑出的 104/0（正向）与 61/43（负向）） |
| R11R1-A-M2 | `bench/out-path-guard.test.ts` 与 linux 探针各持一份形态清单 | 预推送通道与 CI 执行面**各自**手写同一批判据结论 → 两条面之间没有蕴含关系，"探针绿"不蕴含"那族字符串判据在 posix 宿主上绿"；这是 `R11-CI-1` ②（同一事实两个源）的失效方向在**测试面**的复现 | A | 已消化（新增 `bench/out-path-guard.cases.ts`：形态 × 期望的**单表**，测试与探针都只读它。Gate 5A 以首行 `@no-test-required` 出路收口——给一张数据表写断言等价于断言它等于自己，恒真；要红只能通过消费者——**未**使用 `SKIP_GATE_5A_BLOCK` 后门。仍未闭残余如实命名：vitest 自身的 `runIf`/`skipIf` 分支选择、`chmod 0` 的 EPERM 可观测性、符号链接能力探测仍只由 CI 的 linux runner 兑现，见 `R10R2-A-m2`） |
| R11R1-A-m1 | `bench/out-path-guard.ts` 的私有 `lexicalForPlat` | ADR 承诺"词法回退按被建模平台解释分隔符"的等价性钉成了用例，但那条是 `it.runIf(win32)` → linux CI 上整条 skip，即**写进 tracked 文档的承诺在 CI 里零守护**；且函数私有，外部探针无法独立断言 | A | 已消化（改**导出** + 增一条平台无关的纯字符串断言用例（6 支 `\`→`/` 与 UNC 形态，两平台 CI 都跑）。导出理由与 `identityOf` 同族——判据里平台相关的那半条要有平台无关的可测面——并把该理由写进**导出注释**而非只写在 ADR） |
| R11R1-A-m2 | `bench/out-path-guard.test.ts` 头部「uncovered 面」清单 | 反斜杠别名（`bench\baseline.json::$DATA`）的**身份**判据腿在 posix 宿主上不可达（realpath 把整串当成一个文件名），故同一条用例在两个宿主上"绿的不是同一条腿"，而清单未记这一条 | A | 已消化（清单新增第 4 条成文。判据不改：闭它需要真实 win32 runner，属既有结构性缺口 `R10R2-A-m2`，不以恒真断言冒充覆盖） |
| R11R1-A-m3 | `.github/workflows/bench.yml` 守卫步的两个 `mktemp` | 清理写成三处内联 `rm -f`，第二次 `mktemp` 自身失败时 `bash -e` 直接杀掉脚本 → 第一个临时文件无人清 | A | 已消化（两变量先置空串、`trap 'rm -f "$list_in" "$list_out"' EXIT` 挂在赋值**之前**，三处内联清理删除。实测 `rm -f ""` 静默返回 0 且不覆盖退出状态：沙箱两条红在带 trap 的体上仍以 rc=1 抵达 runner） |
| R11R1-A-m4 | 同上前 `mapfile` 之后的空数组分支 | 加了"每根至少 1 命中"断言后，该分支在当前锚点列表下已**不可达**，留着形同重复断言，将来容易被顺手删掉 | A | 已消化（不删，加注释写明它针对的是"未来新增一根不受前两条管辖的根"这一形状，属防御性兜底而非当前失效路径的重复断言） |
| R11R1-A-m5 | 仓库根 `.gitignore` 的 `var/*` + `!var/*.ts` | A 建议在 `var/` 内再加一层兜底 `.gitignore`，以防 scratch 误入库。与本仓既有硬约束冲突：`!var/*.ts` 的存在理由正是保 `var/mock-relay.ts` 可跟踪（本地试用依赖），加兜底会把它一并挡掉 | A | **拒绝并成文**（不改 `.gitignore`；改以"var/ 引用性质"约定收口（本表 `R11R1-A-M1`），并把"误 `git add` 一个 `.ts` 探针"的风险写进同条 ADR 文字。拒绝理由登记于此，避免下轮重提） |
| R11-INC-1 | 走查执行工装（`var/delphi-r11/`）与本仓 `.git` | Round 1 三家执行期间，评审进程把**被测仓库的工作目录整个重建**了：`.git` 于当日 08:23 重新 `clone`，原六笔 R11 提交（`d1f1db6`…`9c22b03`）在对象库中不可恢复（`git cat-file -t` 全部报"not a valid object"，reflog 仅存 `clone: from …`）。后果两条：① Round 1 的证据链作废（三家绑定到已不存在的 HEAD）；② 当时未提交的面丢失 | 事故（非走查来源） | 已消化（**Containment 顺序**：先逐笔核对 diffstat / `bench/baseline.json` md5 / 冻结面 `git diff --exit-code` / 全量测试，确认 ①②③ 面内容忠实；再手工重建丢失的 ④⑤ 面（即本表所在批次）；最后以新 HEAD **重跑 Round 1**。卷面追加硬纪律：评审期**禁止任何 git 写操作**（clone / reset / checkout / stash / clean），探针限定在 `var/r11b-<ID>/`，`var/delphi-r11` 视为只读。**如实登记**：本轮 R1 意见按"发现材料"采用，不作 Gate MW 证据） |

- **裁决口径**：本表 **8 行 = 走查来源 7（A 的 2 Major + 5 Minor）+ 事故来源 1**。因 `R11-INC-1`，
  Round 1 的三份专家输出**不能**充当证据（`write-evidence.cjs` 的 `commit === HEAD` 断言当场会拒），
  处置照常落地、评审照常重跑——两者不互相顶替。
- **本批代码面清单**（延续 `R10R3-A-N1` 的四面拆分）：① 判据面 = `bench/out-path-guard.ts`；② CI 执行面
  = `.github/workflows/bench.yml`；③ 文档面 = `docs/adr/0002` 补遗四；④ 测试面 + 本登记处（期望表
  `bench/out-path-guard.cases.ts` + `bench/out-path-guard.test.ts` 改写 + 锁清单 +8、棘轮同批上调）。
  **口径**：`+8` 是**本批**增量；`4bbea37..HEAD` 这段**区间**跨两批（R10 R5 批 +10 与本批 +8），
  故区间 diff 读到的总数是锁清单 92→110、棘轮 90→108（`R11R1-B-M2` 把它读成"同一节自相矛盾"即源于
  此处未成文，本条补齐；每张表的行数与增量一律按**本批**口径）。
  **顺序颠倒须披露**：本批 ④ 先于 ③ 落地（`b2cbde4` → `4959f50` → `4426b9b` → `cbe355c` → `de727ab`），
  与惯例的 ①→②→③→④ 相反，原因是 `R11-INC-1` 后需要**尽快把重建面提交进 git 对象库**，
  即"防止再次丢失"优先于"叙事顺序"。
- **验证**：① 本机 `bunx vitest run bench/out-path-guard.test.ts` → 33 passed / 1 skipped；② 真实 linux
  正向 104/104 rc=0 + 修复前模块（`git show 4bbea37:bench/out-path-guard.ts` 现取）负向 61/43 rc=1，
  两支**共用同一张期望表**，脚本退出条件写死为"正向必 rc=0、负向必有红"；③ 守卫步沙箱从 `bench.yml`
  原文抽 `run:` 体跑六路径（含 runner 真实口径 `bash -eo pipefail`）；④ 全量门 + `bunx tsc --noEmit` +
  `bunx oxlint`。逐条数字与失效形态清单见 `docs/adr/0002` 补遗四验证节。
- **冻结面零改动自证**：`git diff --exit-code 4bbea37..HEAD -- bench/regression-formula.ts bench/baseline.json
  bench/record-baseline.ts` 为 0；判据公式 `* 1.2` / `> 2` 与三台门阈值常量未触碰；`bench/baseline.json`
  md5 仍为 `3ebfaa9f6a71ecf7cb7b0d91355e2525`。

### R11 R2 批次（R11 Round 1 三家意见 → 本收口提交，2026-09-23）

R11 Round 1（重跑成功的那一次，无工具外部执行器）：A **APPROVED / 0 Critical / 0 Major / 1 Minor**，
B **REQUEST_CHANGES / 0 Critical / 2 Major / 5 Minor**，C **APPROVED 但 `major_concerns` 列了 2 条**
（与卷面 §4 的"APPROVED 不许有 Major"冲突 → 按零容忍照处置，不因其 verdict 字面为 APPROVED 而跳过）。
10 个 ID = B 家 7 + C 家 2 + A 家 1。本轮是 `R11-INC-1` 之后第一次三家全部成功执行的 Round 1。

| ID | 位置 | 内容 | 来源 | 状态 |
|----|------|------|------|------|
| R11R1-B-M1 | `bench/out-path-guard.ts` 的 `hostPath` `start` 计算 vs `R10R5-B-m1` 注释 | B 主张 `f:a:b` 折到 `f:` 而非注释声称的 `f:a`，于是预检会把一个"合法可写"形态误拒（约束 2 的对偶面） | B | **拒绝并成文 + 钉断言**（实跑 `hostPath("f:a:b","win32")` = `"f:a"`：串内无分隔符 → `sep = -1` → `start = 2`，而 `indexOf(":", 2)` 落在**索引 3**，切出 `f:a`；B 把 `start` 当成了切片终点。注释与 ADR 的声称本就成立。处置：该折叠不再只活在注释——测试「盘符相对与 UNC 共享根里的冒号…」新增 `f:a:b`→`f:a`、`D:h.txt:w9`→`D:h.txt` 两条纯字符串断言。**未**在预检层面加断言：`dirname` 是宿主绑定 API，`f:a` 的父目录探测在无该盘符的机器上必红，即 uncovered 第 5 条所写的边界，硬造断言等于假覆盖） |
| R11R1-B-M2 | `.sprint-state/bench-backlog.md` 相邻两节的"本批代码面清单"bullet + `tests/unit/backlog-integrity.test.ts` | 区间 diff 实测锁清单 +18（92→110）、棘轮 90→108，而两节 bullet 分别写"+10"与"+8" → 读成一个区间即自相矛盾（约束 4） | B | 已消化（**成文口径**：在 R11 R1 批次的清单 bullet 内补一句"`+8` 是本批增量、区间跨两批（+10 与 +8），区间总数 92→110 / 90→108"。B 的算术前提正确，误在把相邻两批读成同一节；把这一点写死是登记处的责任） |
| R11R1-B-m1 | `assertWritableOutPath` 的 `existsSync` / `statSync` / `accessSync` 三腿 | `lexicalForPlat` 接了词法面却没接宿主 FS 腿 → "建模泄漏/建模不完整" | B | **拒绝并成文**（不改代码：预检的职责是回答"待会儿 `writeFileSync(字面名)` 开得开吗"，把字面名改写后再探探的是**另一个**文件的可写性，比"探不到"更错。词法可按建模平台解释、宿主文件系统不可 —— 与补遗四 `plat` 可达边界同一条。落点 = `lexicalForPlat` 文档注新增一段 + 测试头 uncovered 清单新增第 5 条，二者互指） |
| R11R1-B-m2 | `docs/adr/0002` 补遗四·验证节末条 | 写"本批现役两支"，同节实际提到三支探针（linux 正向 / linux 负向 / 守卫步六路径） | B | 已消化（改为列举式"三支"并点名第三支及其用途，顺带把句子拆成不依赖计数也能读的形状） |
| R11R1-B-m3 | `docs/adr/0002` 补遗四·影响节 ② | "`lexicalForPlat` 由私有改为**导出**"在压扁的区间 diff 里不可读（该函数整条是新增行） | B | 已消化（改为"本批新增并导出（首笔私有、同批第二笔改导出）"，并明写"以此处为准而非以区间 diff 为准"。这是 `R11R1-B-M2` 同一族的**区间 vs 单笔**口径问题，两处一并收口） |
| R11R1-B-m4 | `bench/out-path-guard.cases.ts` 的 `GUARD_FORM_CASES` 由四族 `.map()` 展开 | 某族成员被误删则表**静默变短**，无断言会红 | B | 已消化（并入下条 `R11R1-C-M2` 的元断言族：`MIN_FORMS` 各族**下界** + 变异 M1 实跑红在「分组守恒」。下界惯例承 `MIN_BACKLOG_ROWS`（`R10R3-A-m3` 已裁决"零余量、合法裁剪须同批下调"），能力边界一并成文：挡净减与误标，**不**挡等量替换。**勘误指针（`R11R3-B-m1`）**：该边界后被收窄为"只挡**撞名**的等量替换，不挡不撞名的那一类"——原句"不挡等量替换"过宽（把唯一性断言已有的覆盖面说没了），分类见 R11 R4 批次与 ADR 补遗四·影响节；原文照存不改写。） |
| R11R1-B-m5 | 卷包 ③「登记处新增行」摘要 | 状态列被截到 60 字 → E 条"未转义 `\|` 撑破格数"从卷面无法判 | B | 已消化（**卷包面**处置，不改入库面：Round 2 起登记处内联全文。E 条本身在入库面由 `backlog-integrity.test.ts` 的「每条数据行的格数与该表表头一致」断言管辖，且该断言按 `\|` 转义感知拆格（`R10R1-C-m1`）——本批 10 行能被该用例放行，即为答案；不引 `var/` 里的临时脚本作证据，理由见 `R11R1-A-M1` 的成文约定） |
| R11R1-C-M1 | `.github/workflows/bench.yml`（建议新增 windows job） | win32 专有行为在 linux CI 只靠 `plat` 注入模拟，缺 Windows Runner 的自动化覆盖 | C | **拒绝并成文**（① 该残余早已登记并保持命名：`R10R2-A-m2`（win32 端到端身份腿 + `tests/integration`/`tests/e2e` 无 CI 执行面）与 `R11R1-A-m2`（反斜杠别名的身份腿），卷面 §7 明示不要重复报；② 收益/代价：G1/G2/G3 阈值锚在 linux runner（补遗三保真锚点），win job 只能跑功能测试，收益是"重复本机每次收口都跑的 `bunx vitest run`"，代价是双份全量时长；③ 字符串腿已两平台兑现（`lexicalForPlat` 纯函数断言 + `plat` 注入矩阵）。故维持"本机 win32 实跑 + CI linux 全量"的分工，不新开 job。**措辞勘误（`R11R2-B-m2`）**：本行原写"② 与冻结面冲突的一面"——该说法可被 `git diff` 证否（只跑 `bunx vitest run` 的 job 根本不触碰 `regression-formula.ts` / `baseline.json` / `record-baseline.ts`），真理由是**阈值保真锚在 linux**，与冻结面无涉。② 的编号与理由已按此改写） |
| R11R1-C-M2 | `bench/out-path-guard.cases.ts` 作为单一事实源 | 表错则 CI 与探针同时假绿；C 给的方向是"定期人工审核 / 变更审查机制" | C | 已消化（不采不可操作建议，落点与 A、B-m4 同源：**消费者侧结构元断言**一节 4 条，表达式与 `hostPath`/`canonicalPath` 不共享代码。三家在同一条上独立命中，是本轮最有价值的一条意见） |
| R11R1-A-m6 | 同上（`cases.ts:1-104`） | A 建议"增加轻量级元测试校验表中字符串的语法结构合法性，以打破纯数据表的盲区" | A | 已消化（**按 A 的原话落地**：三家里只有 A 给出了可操作方向，另两家只指出风险。落点 = 测试文件「期望表自身的结构元断言（共因失效面：R11R1-C-M2 / A-m6 / B-m4）」一节；判别力由三条变异自证，见下） |

- **裁决口径**：本表 **10 行**全部为走查来源（B 7 / C 2 / A 1），无事故来源。Round 1 的三份输出这次
  **是**有效材料（无工具执行器 + HEAD 未变 + `echo_matches_expected` 三家皆真），但 Gate MW 要求三家
  APPROVED，故证据文件在 Round 2 之后写；本轮 10 条处置照常落进 HEAD，评审按卷面从 Round 2 起步。
- **专家模型槽位变更（如实披露）**：architecture 槽由 `g-glm-5.3-flash` 改为 `g-qwen3.8-flash`。原因是
  两次可复现失败：该模型经代理实测是 `prompt_tokens + max_tokens ≤ ~32768` 的硬窗口（本卷包实测
  `prompt_tokens=22316`），且它是 reasoning 模型——`max_tokens=6000/8000` 时 `reasoning_content` 吃满预算、
  `message.content` 为空（`finish_reason=length`），`12000/16000` 在 240s 内不返回。代价：A 与 C 同属 Qwen
  系（不同部署：hosted flash vs local 27B，`requested_model` 与响应回显均 distinct，执行器三项 checks 全真）。
  该变更连同理由写进卷面 §0 交专家判，本轮无人判为缺陷。**配置改在 `var/` 副本上，未动用户全局
  `.delphi-config.json`**。
- **本批代码面清单**：① 判据面 = `bench/out-path-guard.ts`（**只改注释**，零判据改动）；② CI 执行面 =
  本批零改动；③ 文档面 = `docs/adr/0002` 补遗四三处措辞/新增两条影响；④ 测试面 + 本登记处（元断言
  一节 4 条 + 机制断言 1 条 + 盘符折叠断言 2 条 + `fate` 侧 uncovered 第 5 条 + 锁清单 +10、棘轮同批上调）。
- **验证**：① 本机 `bunx vitest run bench/out-path-guard.test.ts` → 37 passed / 1 skipped（38 为总数，
  +4 即元断言族）；② 期望表变异自证三条（临时改 `cases.ts` → 跑消费侧 → 逐字节还原，md5 核对）：
  M1 删 `ADS_FORMS` 一条 → 红在「分组守恒」；M2 等量替换名字变体 → 红在「`tracked` 族定义性特征」
  （消费者矩阵同时红）；M3 把 posix 对照组首条改成 win32 合法形态 → **只**红在「预检族自洽」；
  ③ `bunx tsc --noEmit` + `bunx oxlint` + 全量门；④ 表格格数由 `backlog-integrity.test.ts` 断言管辖。
  linux 正/负双向探针在推送前以新 HEAD 重跑，数字回写 ADR 补遗四（本轮不改）。
- **冻结面零改动自证**：`git diff --exit-code 4bbea37..HEAD -- bench/regression-formula.ts bench/baseline.json
  bench/record-baseline.ts` 仍为 0；`bench/baseline.json` md5 仍为 `3ebfaa9f6a71ecf7cb7b0d91355e2525`；
  判据公式 `* 1.2` / `> 2` 与三台门阈值常量未触碰，`bench/out-path-guard.ts` 的 diff 只有注释与文档注。

### R11 R3 批次（R11 Round 2 三家意见 → 本收口提交，2026-09-23）

R11 Round 2（交换轮，卷面 §10 内联 Round 1 原始输出、③-c 内联本登记处新节全文）：A / B / C **三家皆
APPROVED、0 Critical、0 Major**，consensus 1.0，合计 **8 条 Minor**（A 3 / B 3 / C 2）。这是 `R11-INC-1`
后第一次跑到"三家同轮全绿且无 Major"，因此 Gate MW 证据本轮起可写；上表 10 条处置经三家复核**无一被
推翻**（`OVERTURNED` 零次）。

| ID | 位置 | 内容 | 来源 | 状态 |
|----|------|------|------|------|
| R11R2-A-m1 | 卷面 §0「专家模型槽位」+ 本表上一条批次的披露 bullet | A 主张 A 槽（`g-qwen3.8-flash`）与 C 槽（`local-qwen3.8-27b`）同属 Qwen 系，削弱 Delphi 独立性，建议聚合侧对同族双槽"降权标记/标注独立性折扣" | A | **拒绝并成文**（编排器没有"权重"这个机制可改：`delphi-experts.cjs` 的三项 checks 只核 `requested`/`executed` 互异 + 回显相符，Gate MW 只数"三家 APPROVED 且 `requested_model` 互异"，把"降权"塞进去等于新增一条不在契约里的门。可做的只有**把折扣显式标注**——而这件事上一批已经做了（本表「专家模型槽位变更」bullet + 卷面 §0），本轮再补一句判据：本轮 8 条 Minor 里 A/C 两家的落点**互不重叠**（A 全在注释/流程面、C 全在 CI/复跑面），故"同族趋同"在本轮没有可观测的证据面。目录里确无第四族可用 ID，见 `R11-INC-1` 后的探测记录） |
| R11R2-A-m2 | 卷面 §6「CI 守卫步探针…重跑」 | A 判该声称无法从卷面代码自证，属"依赖未独立核验的自证材料" | A | 无需入库面动作（**核对后判定该声称不在 tracked 面上**：`bench.yml` 本批零改动，"重跑六路径"只写在 scratch 卷面 §6，ADR 与登记处都没有这条可被证伪的断言，故没有需要限定的入库措辞。A 自己亦判"风险极低"。留此行为记录，免得下一批又有人在 ADR 里补一句反而造出新的可证伪面） |
| R11R2-A-m3 | `bench/out-path-guard.ts` 的 `lexicalForPlat` 文档注（17-42 行） | A 建议把关键边界理由同步一份短引用进 ADR 补遗四决策节，防重构时删注释保函数 | A | **拒绝**（纯风格项，且前提半错：ADR 补遗四决策节**本就有**互指——"建模边界补一条（`R11R1-B-m1`…）"那段写的正是同一条边界理由（在影响节内，行号随本批增删漂移故不写死）。删除注释的防护也不在"再抄一份"这一侧：`R11R1-B-m1` 的落点是测试头 uncovered 第 5 条，那条是 CI 必跑面的文档，重构者删注释时它仍在原地） |
| R11R2-B-m1 | `docs/adr/0002` 补遗四·影响节 变异 M2 那句 | B 判"等量替换 → 红在 `tracked` 族定义性特征"易被读成"元断言能判等量替换"，与上一句"不挡等量替换"自相矛盾；B 给的例子（换成同样折到本名的 `bench/./BASELINE.JSON`）两侧同绿 | B | 已消化（**照 B 的例子在 ADR 补一段限定**：M2 红是因为换进去的形态恰好破坏了定义性词法名，它证明"误标会被抓到"，**不**证明"等量替换被抓到"。B 的前提核对为真：`lexicalName("bench/./BASELINE.JSON")` = `bench/baseline.json` → 定义性特征不破 → 元断言与消费者矩阵确实同绿。这是本轮唯一一条**改入库文字**的实质修复） |
| R11R2-B-m2 | 本表 `R11R1-C-M1` 行的拒绝理由 ② | B 判"加 windows job 与冻结面冲突"这一支可被 `git diff` 证伪：只跑 `bunx vitest run` 的 job 根本不触碰三个冻结件 | B | 已消化（**采纳且承认写错**：真理由是"阈值保真锚在 linux runner"（补遗三），与冻结面无涉。已改写该行 ② 为收益/代价陈述，并在同一行加**措辞勘误**标注，保留"当初写错过"的痕迹而不是静默改掉——约束 4 的对偶面：错过的断言要能被后人查出来错在哪） |
| R11R2-B-m3 | 本表「本批代码面清单」bullet 的 `+10` 与棘轮 90→118 | B 判 ③-c 的 `+10` 只描述本批增量、未说明棘轮为何 `+28`，与 ③-b 的区间口径未接上 | B | 已消化（补区间口径一句。**但按实测订正 B 给的拆分**：B 建议写"含 R10 R5 批 `+10` 与本批 `+18`"——两批归属反了。`git show` 三个 HEAD 的实值是 `4bbea37`→90 / `b42bc10`→108 / 本批→118，即**上一批 +18、本批 +10**，锁清单同形（92→110→120）。照抄 B 的措辞会把一个新的错数字写进入库面） |
| R11R2-C-m1 | `bench/out-path-guard.test.ts` 的 `it.runIf(win32)` 等价性用例 | C 判该承诺在 linux CI 上被 skip = 零守护，给出两条出路：①在 pre-push/收口脚本强制跑一次 win32 宿主用例；②否则在 ADR 明写"仅 win32 宿主可验、CI 不守护"并把残余并入 `R10R2-A-m2` 的到期复审 | C | **部分消化（采 ②，拒 ①）**：①不做——xp-gate 的 pre-push 是**全局钩子**（`~/.config/xp-gate/hooks`），不在仓内、不受本批 diff 管辖，在别的仓库也会生效，为一条 bench 判据去改全局门是越界；且 win32 本机实跑本就是每次收口的既有动作（本表多批的"本机 win32"行即其痕迹），不是一个可入库的机器门。②做——已在 ADR 补遗四的 `runIf(win32)` 那条后面写清"CI 不守护"，并把本残余挂到 `R10R2-A-m2`（OPEN，期限 2026-09-30）名下复审，不再无人认领 |
| R11R2-C-m2 | ADR 验证节的 linux 正/负双向证据 | C 判 104/0、61/43、六路径、变异三条皆出自 gitignored scratch，评审者无法独立复现；建议把负向对照固化为一段可复制粘贴的命令块 | C | **部分消化（采"可复现的那一半"，另一半说明为何不入库）**：正向那一半**本来就是**一键复跑且 tracked——`bunx vitest run bench/out-path-guard.test.ts`（`cases.ts` + 测试文件全在库，任何 clone 任何平台可跑），已在 ADR 验证节写死这条口径；负向那一半（`git show` 现取修复前模块）与三条变异**不入库**：把修复前的判据模块落一份 tracked 副本会被 jscpd 当代码克隆告警，而变异脚本的性质与 `R11R1-A-M1` 已裁决的"`var/` = 本机 scratch，不是可复跑入口"同型。C 的"降低对单一未核验自证的依赖"因此由**正向腿的可复跑性**承担，不再声称负向可一键复跑 |

- **裁决口径**：本表 **8 行**全部为走查来源（A 3 / B 3 / C 2），无事故来源。入库面**只动文字、不动判据**
  （`R11R2-B-m1` 的 ADR 限定段、`R11R2-B-m2` + `R11R2-C-m1` + `R11R2-C-m2` 的 ADR/登记处措辞订正；
  逐面清单见下一条），**判据/测试/CI 三面零改动**。
  **非专家来源的顺带改动（主动申报）**：本文件头部台账句此前只记到 R10 R4，未记 R11 三批——R11 R1/R2 两批
  登记时都漏了同一处，属"逐批不更新即静默失真"的既病。现补 26 个 ID 的三批口径，数字取自本节与 R11 R1/R2
  两节各自的批次计数行，非估算。
- **本批代码面清单（含区间口径）**：① 文档面 = `docs/adr/0002`（M2 限定段 + `runIf(win32)` 的"CI 不守护"
  + 验证节可复跑口径）；② 登记处 = 本节 + `R11R1-C-M1` 行的措辞勘误 + 头部台账句补 R11 三批（见上一条申报）；
  ③ 锁清单/棘轮 = 同批上移。
  **区间 vs 本批**（`R11R1-B-M2`/`R11R2-B-m3` 同一族的收口）：`MIN_BACKLOG_ROWS` 的区间路径是
  `4bbea37`=90 → `b42bc10`=108（上一批 `+18`）→ 本批 118（`+10`）→ 本处置批次 126（`+8`）；
  `LOCKED_IDS` 同形为 92 → 110 → 120 → 128。写单批增量时必须带这条区间链，否则读者按区间读必自相矛盾。
- **验证**：本批**无代码改动**，故复跑口径是"证明没有改到判据"：① `git diff --name-only e946a0f` 只列出
  `docs/adr/0002`、本文件、`tests/unit/backlog-integrity.test.ts` 三项（即 `bench/`、CI 工作流、判据三面零改动；
  命令钉死基准 commit 而非 `HEAD~1`，提交后照样可复跑）；② 全量 `bunx vitest run` 与 `bunx tsc --noEmit`
  必须与上一批同数（271 passed / 3 skipped；tsc rc=0；`bunx oxlint bench tests src` 0 warnings / 0 errors）；
  ③ 登记处守卫 `bunx vitest run tests/unit/backlog-integrity.test.ts` 全绿（格数与锁清单两条管辖本批 8 行）。
  **linux 探针本批未重跑，理由不是省事**：`bench/out-path-guard.ts` 与 `bench/out-path-guard.cases.ts` 自
  `e946a0f` 起逐字节未变（见上一条 ① 的文件清单），ADR 的 104/0 与 61/43 判据面正是跑在这份字节上，重跑同名
  输入不可能改结论；本批改动全在文档面，探针根本不读文档。
- **冻结面零改动自证**：`git diff --exit-code 4bbea37..HEAD -- bench/regression-formula.ts bench/baseline.json
  bench/record-baseline.ts` 仍为 0；`md5sum bench/baseline.json` 仍为 `3ebfaa9f6a71ecf7cb7b0d91355e2525`；
  本批连 `bench/` 目录都未触碰（见上一条 ①）。

### R11 R4 批次（R11 Round 3 三家意见 → 本收口提交，2026-09-23）

R11 Round 3（修复复评轮，卷面 §10 内联 Round 2 原始输出、③-c 内联本登记处新节全文）：A / B / C **三家皆
APPROVED、0 Critical、0 Major**，consensus 1.0，合计 **4 条 Minor**（B 2 / C 2）。Round 2 的 8 条处置经三家
复核**无一被推翻**（`OVERTURNED` 零次）。本轮 4 条全部落在**措辞精度**与**义务成文**两类，没有一条指向判据、
测试断言或 CI 执行面——三家在 A–G 七条检查点上给出的结论互不引用而一致。

| ID | 位置 | 内容 | 来源 | 状态 |
|----|------|------|------|------|
| R11R3-B-m1 | `docs/adr/0002` 补遗四·影响节 能力边界那句 | B 判上一批的限定段只覆盖了"折到本名且**不重复**"那一种等量变体；若换成"折到本名但**与既有条目撞名**"的变体（`bench/./baseline.json` → `./bench/baseline.json`），「形态全局唯一」会红。故"不挡等量替换"**过宽**，把元断言已有的覆盖面说没了——与上一批被订正的"过窄"读法方向相反 | B | **已消化（照 B 的前提，双向收窄）**：核对为真——「分组守恒」的 `new Set(forms).size === forms.length` 按 `form` **字面串**去重，撞名类必红。ADR 能力边界那句改为"等量替换只挡撞名那一类"，M2 限定段补①/②两分类，并把"过读"两个方向都点名（说成"能判等量替换"是夸强、说成"全盲"是夸大其弱）。同族改动同步到 `bench/out-path-guard.test.ts` 头注第 3 条（**只改注释**）与 `R11R1-B-m4` 行的勘误指针 |
| R11R3-B-m2 | 上一批「验证」bullet ① | B 判该 bullet 让读者**自行**从"只列出三项"推出 `bench/` 为空，复核成本可免；建议把 `-- bench/` 的空输出单列一行 | B | 已消化（本批「验证」bullet 直接给 `git diff --name-only 9cb8bef -- bench/out-path-guard.ts bench/out-path-guard.cases.ts` 的空输出这一行，并把该写法升成通则：见本文件头部「触发条件」的 linux 重跑义务——"未重跑"从此必须带空输出为证，不再靠读者推断） |
| R11R3-C-m1 | 卷面 §6 末条「linux 探针本批未重跑」 | C 判该理由（探针读的两件逐字节未变 + 本批全在文档面）**成立**，但性质是"推理 + 上一轮实测"而非本轮实跑；担心"未重跑"随批次累积成没人再核的隐性漂移，建议下次 bench 字节再变时强制重跑并回写 | C | **已消化（写成成文义务，不写成本批实跑；成文义务，非机器门）**：头部「触发条件」新增 **linux 重跑义务**——`out-path-guard.ts` / `cases.ts` 字节再变即必须推送前重跑正/负双向并回写 ADR，且"未重跑"须附空输出为证。本轮**确实无法**实跑：WSL 调用被本机权限层拦下（该事实已如实写进卷面 §6，未冒充实跑）。**勘误指针（`R11R4-SR-1`）**：该行所述的义务判据面（"字节再变" + 基准取"上一轮 HEAD"）在下一批即被自己兑现为缺陷——本行落地时锚点已是 `de727ab` 而非上一批 HEAD，故判据面已改写为"自**上次实跑锚点**起的**非注释行**差"，义务现文本以本文件头部为准，本行按"不重写历史行"约定原文保留 |
| R11R3-C-m2 | `bench/out-path-guard.test.ts` 的 `it.runIf(win32)` 那族 | C 复述并**认可** `R11R2-C-m1` 的处置（采 ② 拒 ①），但要求"等价性承诺"从纯叙述升级为推送前机器可查：出路 a) 确保 `R10R2-A-m2` 在 2026-09-30 到期复审闭环；b) 在本机收口脚本里把 win32 单文件实跑列为必跑动作 | C | **部分消化（采 b 的成文形态，拒 b 的脚本形态，a 已在册）（成文义务，非机器门）**：本仓**没有**收口脚本，`bun run test` 只是 vitest 别名，把它包一层脚本仍不会被任何门执行——写一个"只在本机跑"的脚本等于再造一条无人执行的面；全局 pre-push 越界（与 `R11R2-C-m1` 拒 ① 同因）。可采的是把义务**成文**：头部「触发条件」新增 **本机 win32 实跑义务**，可证伪形式 = 各批「验证」bullet 必须带 win32 实跑数字（本批即 37/1 与 271/3），缺行由下一轮走查按违规判。a) 半：`R10R2-A-m2` 已 OPEN、期限 2026-09-30，逾期纪律本就要求首项处理 |

- **裁决口径**：本表 **4 行**全部为走查来源（B 2 / C 2），无事故来源。入库面 = ADR 两处措辞收窄（能力边界
  那句 + M2 分类）、测试头注第 3 条同步（**注释，零判据改动**）、登记处头部两条成文义务 + `R11R1-B-m4`
  勘误指针 + 本节。**四条中没有一条以"拒绝并成文"结案**（`R11R3-C-m2` 只把"脚本机器强制"那一半按既有理由
  不采，其"成文义务"那一半照做）。
  **台账口径衔接**：上一批「裁决口径」申报的是"三批 26 个 ID"，那是 `9cb8bef` 当时的口径；本批加 4 行后为
  "四批 30 个 ID"（26 + 4）。两处不同数是批次差，不是同一事实的两个源（`R11-CI-1` 的根因②同一族）。
- **本批代码面清单（含区间口径）**：① 文档面 = `docs/adr/0002` 补遗四·影响节（能力边界改窄 + 等量替换两分类）；
  ② 判据面 = **零改动**，`bench/` 下只有 `out-path-guard.test.ts` 元断言族头注那 2 行被换成 4 行（`git diff
  -U0 9cb8bef -- bench/` 的**非注释行为空**，实测 −2/+4 全为 `//` 行）；③ 登记处 = 头部「触发条件」两条义务 + 本节 + `R11R1-B-m4` 勘误指针；
  ④ 锁清单/棘轮 = 同批上移。
  **区间 vs 本批**：`MIN_BACKLOG_ROWS` 为 `4bbea37`=90 → `b42bc10`=108 → `e946a0f`=118 → `9cb8bef`=126 →
  本批 130（`+4`）；`LOCKED_IDS` 同形为 92 → 110 → 120 → 128 → 132。
- **验证**（按本批新增的"本机 win32 实跑义务"给出数字）：① 本机 win32（bun）`bunx vitest run bench/out-path-guard.test.ts`
  → **37 passed / 1 skipped（38 条）**；全量 `bunx vitest run` → **271 passed / 3 skipped（34 文件）**；
  `bunx tsc --noEmit` → rc=0；`bunx oxlint bench tests src` → 0 warnings / 0 errors；
  ② 登记处守卫 `bunx vitest run tests/unit/backlog-integrity.test.ts` → 8 passed；实测行/ID 数由 scratch 侧
  只读复刻解析器得到（`node var/delphi-r11/count-rows.cjs` → `ID tables=15 dataRows=130 uniqueIds=132`），
  **未**临时改动守卫常量去"钓"真值；③ 改动面自证 = `git diff --name-only 9cb8bef` 四项。
- **linux 探针本批未重跑，按新义务给出证据而非理由**：
  `git diff --name-only 9cb8bef -- bench/out-path-guard.ts bench/out-path-guard.cases.ts` → **空输出**
  （即探针读的两件逐字节未变；本批 `bench/` 内唯一改动是 `out-path-guard.test.ts` 的头注，探针不读测试文件）。
  另注：本轮执行环境不允许调用 WSL，即便要重跑也拿不到实跑数——所以这条是"字节未变 → 结论不变"的推理，
  卷面 §6 同口径，不冒充实跑。
- **冻结面零改动自证**：`git diff --exit-code 4bbea37..HEAD -- bench/regression-formula.ts bench/baseline.json
  bench/record-baseline.ts` → rc=0；`md5sum bench/baseline.json` = `3ebfaa9f6a71ecf7cb7b0d91355e2525`；
  判据公式 `* 1.2` / `> 2` 与三台门阈值常量未触碰。

### R11 R5 批次（R11 Round 4 三家意见 + 本批自查 1 条 → 本收口提交，2026-09-23）

R11 Round 4（第三处置复评轮）：A / B / C **三家皆 APPROVED、0 Critical、0 Major**，consensus 1.0（A conf=9 /
B conf=8 / C conf=8），合计 **4 条 Minor**（B 2 / C 2）。Round 3 的 4 条处置经三家复核**无一被推翻**。此外
本批有 **1 条自查来源**（`R11R4-SR-1`）：出题方在推送前核对自己上一批刚写下的 linux 义务时，被该义务自己的
判据面兑现出一条真缺陷——四条走查 Minor 与它同属"措辞精度 / 义务成文"两类，没有一条指向判据代码或 CI 执行面。

| ID | 位置 | 内容 | 来源 | 状态 |
|----|------|------|------|------|
| R11R4-B-m1 | R11 R4 批次「验证」bullet ② 的 `ID tables=15 dataRows=130 uniqueIds=132` | 该数字由 `node var/delphi-r11/count-rows.cjs` 得到，而脚本是 gitignored scratch（本文件与 ADR 均已声明 `var/` 非可复跑入口），故数字属"依赖未独立核验的自证材料"；建议改由入库面 `backlog-integrity.test.ts` 的棘轮断言间接承担，避免行/ID 数只活在 scratch 输出里 | B | 已消化（照建议换主证据：该守卫本就是行数的机器门——它同时钉 `MIN_BACKLOG_ROWS` 下界、ID 与表头格数、`LOCKED_IDS` 完整性，故"通过"即蕴含口径成立。本批「验证」bullet ② 以 `bunx vitest run tests/unit/backlog-integrity.test.ts` 的实跑结果为主、scratch 计数降为**附注**并保留"未临时改守卫常量去钓真值"那句。非入库面动作：不为此新建脚本（会撞 `R11R1-A-M1` 的 scratch 判据） |
| R11R4-B-m2 | 头部「触发条件」linux 义务的空输出证据形态 | 命令里的基准 commit 写死（`9cb8bef`）；若后续批次再动 `cases.ts` 仍沿用旧基准，空输出会失真，跨批次复用该证据时无法判真伪。建议把基准取法钉成规则（如"以上一批 HEAD 为基准"） | B | 已消化（但**不按 B 给的方向钉**："以上一批 HEAD 为基准"正是本次被兑现的错误取法，见下表 `R11R4-SR-1`。改为钉**语义正确的取法**：基准 = ADR 验证节记录的"上次实跑所读 commit"（锚点），不是上一批 HEAD；同时把证据形态从 `--name-only` 空输出升级为"过滤注释行后**非注释行为空**"，因为文件名未变证明不了变的是注释。义务现文本见本文件头部同条 |
| R11R4-C-m1 | 登记处状态列的 `已消化` / `部分消化` | 二者只说明"有结论有指针"，不说明拦截机制存在；C-m1/C-m2 两行的落地形态是成文义务而非机器门，读者易误读为已有自动拦截 | C | 已消化（状态列约定新增"已消化/部分消化不蕴含机器门已建立"通则，并要求成文义务型行显式带 **（成文义务，非机器门）** 限定词；本文件头部两条义务对应的 `R11R3-C-m1` / `R11R3-C-m2` 两行状态已按此加注） |
| R11R4-C-m2 | linux 义务的首次真实执行 | 义务已成文，但"首次触发时怎么算跑对了"无先例：数字回写了，比对基线却没有。建议首次真实重跑时一并记录 node/WSL 版本与探针脚本 hash | C | 已消化（写进头部义务末句：首次真实重跑须记录 node/WSL 版本与探针脚本 hash 作为比对基线。**不采**"本批先跑一次建基线"：本轮执行环境仍不允许调用 WSL，实跑不了；把"拿不到"写成"已建立"正是前几批反复处罚的形态） |
| R11R4-SR-1 | 头部「触发条件」linux 义务（`R11R3-C-m1` 成文那一版）的判据面与基准取法 | 出题方自查：推送前按该义务自查"探针读的两件是否字节再变"时，两批（R3/R4）各自给出的"本批未变"证据**同时为真**，但链条整体失真——`de727ab` 才是上次实跑所读的字节，`e946a0f` 之后那两份已经变过，而"基准 = 上一批 HEAD"的写法让每次只看一眼的人恰好看不见这一跳。根因两条：① 基准取错（批次接缝 vs 实跑锚点）；② 触发面取"字节再变"过死又过松——过死：注释也触发，而本环境的 WSL 通道被权限层拦下，触发了也跑不了；过松：`--name-only` 空输出只证名字未变，不证语义。**更重的一条**：R3 批次那条 bullet 不只说"本批未变"，还声称"ADR 的 104/0 与 61/43 判据面**正是跑在这份字节上**"，而那份字节诞生于 `e946a0f`、实跑发生在它的前一个 commit `de727ab`——这句可被 `git log --oneline de727ab..HEAD -- bench/out-path-guard.ts` 直接证否，属"把推理写成实跑蕴含"的既有处罚形态。该 bullet 按"不重写历史"约定原样保留，以本行为准 | 自查（推送前核对本批义务时） | 已消化（三条同时落地：① 义务的比较对象改为 **ADR 验证节的「linux 实跑锚点」**（当前 `de727ab`），并要求实跑后下移锚点；② 触发判据改为**自锚点起的非注释行差**，语义未变即可不重跑；③ 证据形态改为"过滤 `//`、`*`、`/*` 与 `+++`/`---` 后为空"。本批同时给出该判据的**首次实测**：`git diff -U0 de727ab..HEAD -- bench/out-path-guard.ts bench/out-path-guard.cases.ts` 的 9 行 +/− 中**非注释行 0**，即自上次实跑以来判据与期望表语义未变，ADR 的 104/0 与 61/43 仍跑在同一份语义上。**历史行不改写**：`R11R3-C-m1` 行按约定保留原文，仅在其状态列追加本条勘误指针） |

- **裁决口径**：本表 **5 行 = 走查来源 4（B 2 / C 2）+ 自查来源 1**。四条走查 Minor 全部照做或按更正确的取法
  照做，无一条以"拒绝并成文"结案；`R11R4-B-m2` 是"采纳其关切、拒绝其具体方向"（给出的方向正是被兑现的错误取法）。
  **台账口径衔接**：上批申报"四批 30 个 ID"（`9cb8bef` 时为 26），本批加 5 行后为"五批 35 个 ID"。
- **本批代码面清单（含区间口径）**：① 判据面 = **零改动**，`bench/` 与 `src/` 下无任何文件触碰；
  ② 文档面 = `docs/adr/0002` 补遗四验证节新增「linux 实跑锚点」一条（含锚点 commit、语义零 delta 的命令与结果）；
  ③ 登记处 = 头部 linux 义务改写 + 状态列约定新增通则 + `R11R3-C-m1`/`C-m2` 两行状态加注与勘误指针 + 本节；
  ④ 锁清单/棘轮 = 同批上移。
  **区间 vs 本批**：`MIN_BACKLOG_ROWS` 为 `4bbea37`=90 → `b42bc10`=108 → `e946a0f`=118 → `9cb8bef`=126 →
  `11dc233`=130 → 本批 135（`+5`）；`LOCKED_IDS` 同形为 92 → 110 → 120 → 128 → 132 → 137。
- **验证**（按头部两条成文义务给出数字）：① 本机 win32（bun）`bunx vitest run bench/out-path-guard.test.ts`
  → 37 passed / 1 skipped（38 条）；全量 `bunx vitest run` → 271 passed / 3 skipped（34 文件）；
  `bunx tsc --noEmit` → rc=0；`bunx oxlint bench tests src` → 0 warnings / 0 errors。
  ② 登记处守卫 `bunx vitest run tests/unit/backlog-integrity.test.ts` → **该条为主证据**（`R11R4-B-m1` 的处置）：
  通过即蕴含"行数下界 = 135、每行格数与表头一致、ID/状态两格非空、`LOCKED_IDS` 无缺无重"。附注（非可复跑口径，
  仅记录当时观测）：scratch 只读复刻解析器报 `ID tables=16 dataRows=135 uniqueIds=137`。
  ③ 语义零 delta：`git diff -U0 de727ab..HEAD -- bench/out-path-guard.ts bench/out-path-guard.cases.ts`
  过滤注释后**非注释行 0**。
- **linux 探针本批未重跑，按改写后的义务给出证据**：上次实跑锚点 `de727ab`，自该点到本批 HEAD 的非注释行差为 0
  （上面 ③），故语义未变、不触发重跑；本环境仍不允许调用 WSL，这一点在卷面与 ADR 均如实标注，不冒充实跑。
  真正触发重跑的第一批（判据或表数据再变）须按 `R11R4-C-m2` 记录 node/WSL 版本与探针脚本 hash。
- **冻结面零改动自证**：`git diff --exit-code 4bbea37..HEAD -- bench/regression-formula.ts bench/baseline.json
  bench/record-baseline.ts` → rc=0；`md5sum bench/baseline.json` = `3ebfaa9f6a71ecf7cb7b0d91355e2525`；
  判据公式 `* 1.2` / `> 2` 与三台门阈值常量未触碰。

## 备注

- **编号谱系**：`R7-C-R2` ← R7 R1 原始报告中的 `C-R7-2`（内容一致，仅统一为 `R7-<专家>-<序号>` 型）。
- **ADR 挂账**：`R7-A-M2` 与 `R7-A-M3` 的目标落点是 `docs/adr/0002` 的下次修订——已由补遗三落地，
  不再挂账；后续同类意见仍应在 ADR 修订中收口。
- **就地整改**：R7 交换轮（A/B/C）对登记处的其余意见（命名空间前瞻风险、缺 owner/期限、
  处置约定不可机器强制、逾期纪律定义体只存于历史 blob）已就地整改于本文件头部，不再单列成行。
