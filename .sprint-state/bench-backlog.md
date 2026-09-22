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
  均 2026-09-22/23。
  留痕项 `R9-A-3`/`R9R2-A-N1` 挂在下次 CI record 自愈
- **跟踪项到期与升级**（R10R4-C-m1 起成文）: 状态列写作 `OPEN（跟踪项）` 的行**必须在同一行内**给出
  可自动触发的升级条件（形如"若第 N 批仍未落地 → 升 Major"）。缺该条件的跟踪项不得登记，只能写成
  普通 OPEN 行走期限纪律。理由：跟踪项自带"这不是缺陷、只是待办"的语义，无到期条款即等于永久挂账，
  正是 `R10R2-A-m4` 起连续四批"逐批自豁免"得以成立的机制。
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

## 备注

- **编号谱系**：`R7-C-R2` ← R7 R1 原始报告中的 `C-R7-2`（内容一致，仅统一为 `R7-<专家>-<序号>` 型）。
- **ADR 挂账**：`R7-A-M2` 与 `R7-A-M3` 的目标落点是 `docs/adr/0002` 的下次修订——已由补遗三落地，
  不再挂账；后续同类意见仍应在 ADR 修订中收口。
- **就地整改**：R7 交换轮（A/B/C）对登记处的其余意见（命名空间前瞻风险、缺 owner/期限、
  处置约定不可机器强制、逾期纪律定义体只存于历史 blob）已就地整改于本文件头部，不再单列成行。
