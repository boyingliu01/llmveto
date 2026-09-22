# Bench 面 Minor backlog（持久登记处）

- **owner**: boyingliu01
- **登记日期**: 2026-09-22
- **设立缘由**: R6 走查 backlog 的唯一登记处 `.sprint-state/bench-rerecord-todo.md` 按其自述关闭条件 5
  在 `730f82e` 自毁，六个 ID 未在任何 tracked 载体承接。R7 三位专家独立实测
  `git grep 730f82e` 对全部 6 个 ID 零命中（A-M1 / B-R7-B1 / C-R7-1），一致建议迁移至
  tracked 文件。本文件即该迁移（内容来源可经 `git show 8bb8020:.sprint-state/bench-rerecord-todo.md` 复核）。
- **处置约定**: 各项由后续小提交处理（**各自照例走三位专家 code-walkthrough**）；
  「逾期不得静默顺延」纪律同样适用——触碰 bench 面的提交应优先消化本表。

## R6 走查 backlog（原表迁移，内容逐字保留）

| ID | 位置 | 内容 | 来源 |
|----|------|------|------|
| R6-B2 | `bench/check-regression.ts:38-42` | `parseP95` 的 `[\d.]+` 理论上可解析出 `NaN`（如 `"1.2.3"`），NaN 经 `isRegression` 两条件皆 false 会**静默 PASS**；runner 输出自控，故属理论面。建议加 `Number.isFinite` 守卫（fail-loud）。**最高优先** | B |
| R6-B1 | `bench/env-gate.test.ts:69` | 畸形 `_repeats` 用例表缺 `NaN`/`Infinity`（实现已挡下，属覆盖缺口） | B |
| R6-C2 | `bench/env-gate.ts:74,77` | `trim() === ""` 校验与严格 `!==` 比对不一致：`" min "` 被判 mismatch 而非 malformed（结果仍 fail-closed，仅 reason 文案误导） | C |
| R6-A3 | `bench/check-regression.ts:1` | 文件头注释"无逻辑分支"随本轮增长略不实 | A |
| R6-A2 | `bench/env-gate.ts:77` | `_estimator` 逐字比对从严（`"MIN"`/尾随空格 → SKIP）；从严无害，登记知悉 | A |
| R6-B4 | `bench/check-regression.ts`（G2 档位正则） | 未锚定行首（既存；冻结档位集 8/64/512KB 下无子串碰撞） | B |

## R7 走查新增（`8bb8020..730f82e`）

| ID | 位置 | 内容 | 来源 |
|----|------|------|------|
| R7-A-M2 | `docs/adr/0002`（收尾证据约定） | 区分 **environment-SKIP** 与 **method-SKIP** 两种收尾证据，避免「SKIP 即闭环」误读（重录后本地走 environment 门分支，而待办背景描述的是 method 门） | A |
| R7-A-M3 | `docs/adr/0002`（CI 端到端验证节） | 把 record run（`35713318131`）结果落成 repo 内可核验锚点，降低对 GitHub API 的外部依赖（当前为 artifact 逐字一致 + producer 模板一致 + record job 实存 + 阈值守卫四重间接证据） | A |
| R7-C-R2 | 观测事项 | record 后首次 CI bench 运行的真实相对门比较结果需回填（关闭条件 4 的前瞻性证据）；若现异常须回看本基线落地 | C |
