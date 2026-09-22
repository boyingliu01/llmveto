# Bench 面 Minor backlog（持久登记处）

- **owner**: boyingliu01
- **登记日期**: 2026-09-22
- **处置期限**: 2026-09-30 23:59 (UTC+8)；**当前无 OPEN 项**（R9 交换轮 6 条 OPEN + 两条历史延后项
  `R6-C2`/`R7-B2` 已随 R10 批次收口，2026-09-22）。留痕项 `R9-A-3`/`R9R2-A-N1` 挂在下次 CI record 自愈
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
| R9R2-B-1 | `bench/record-baseline.ts` `canonicalPath`（UNC / admin-share 形态） | 继承性残余：`//localhost/c$/…`、`\\?\UNC\…` 指向同一文件时 `realpath` 不折算盘符 → 比较不等 → 放行（B 在克隆内端到端证实，已恢复） | B | 已消化（R10：ADR 决策 6「已知残余③」成文，附"名字 vs 身份"定位理由；不改代码） |
| R9R2-B-2 | 同上（NTFS 备用数据流） | 继承性残余：`baseline.json:<stream>` 可经守卫写入（`realpath` 返回带流后缀路径）；主流内容实测不被覆写（git 干净） | B | 已消化（R10：「已知残余④」成文；不改代码） |
| R9R2-B-3 | 同上（平台折叠的反向面） | 本提交新引入·理论级：per-directory 大小写敏感（WSL / 目录 flag 挂载）下，仅大小写不同的两个真实不同文件被判同路径而**误拒**；默认 NTFS/APFS 不可达 | B | 已消化（R10：「已知残余⑥」成文并标注为"误拒而非放行"方向；不改代码） |
| R9R2-B-4 | `var/delphi-r9/round2-input.md` 前置段（**评审卷，非 tracked**） | 卷面称 `1f8745e`「已推送」，实测 `origin/main` 当时仍为 `5325c3a`、未推送工作为 2 commits | B | 已收口（卷面就地改写 + §6 勘误段；已交付的 `input-*-r2.md` 保留原文以维持三家所见一致） |
| R9R2-B-5 | 本表 R9 批次 intro | 「3 项就地消化 + 2 项留痕」与表内「4 项已消化 + 1 项留痕」分组口径不一致 | B | 已消化（R10：intro 改为按 ID 点名分组，与本表实际状态列对齐） |
| R9R2-B-6 | `docs/adr/0002` 补遗一·决策 6 | 已知残余段未列 ADS/UNC 面；「win32/darwin 再折叠大小写」语序易读成仅 fallback 分支折叠（实际两分支均折叠） | B | 已消化（R10：残余段扩为①–⑥六面 + 语序改为「两条分支之后都…」，`canonicalPath` 注释同步） |
| R9R2-C-1 | `docs/adr/0002` 决策 6 + `record-baseline.ts` 注释 | 指「8.3 短名…均同判」超出实现能力，称 `realpathSync.native` 按请求格式返回短名不折算长名，并附探针 | C | 已裁决·**实测否证**（出题方复测：本机 `BASELI~1.JSO` 别名解析为长名，端到端亦 refuse exit 1；C 的探针文件系**字面**短名，不构成别名场景。结论保留原宣称，并在决策 6 补「以平台原生解析为准」注记） |
| R9R2-C-2 | `docs/adr/0002` 决策 6（已知残余段） | 登记缺口：硬链接（`mklink /H`，无需特权）不在归一覆盖与残余叙述中——传链接路径即覆写 tracked 内容 | C | 已消化（R10：「已知残余⑤」成文；出题方独立复现后确认，不改代码——折叠身份要比 inode，Node 在 win32 不暴露该信息） |

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

## 备注

- **编号谱系**：`R7-C-R2` ← R7 R1 原始报告中的 `C-R7-2`（内容一致，仅统一为 `R7-<专家>-<序号>` 型）。
- **ADR 挂账**：`R7-A-M2` 与 `R7-A-M3` 的目标落点是 `docs/adr/0002` 的下次修订——已由补遗三落地，
  不再挂账；后续同类意见仍应在 ADR 修订中收口。
- **就地整改**：R7 交换轮（A/B/C）对登记处的其余意见（命名空间前瞻风险、缺 owner/期限、
  处置约定不可机器强制、逾期纪律定义体只存于历史 blob）已就地整改于本文件头部，不再单列成行。
