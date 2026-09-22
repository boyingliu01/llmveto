# Bench 相对门重录待办（code-walkthrough R6 · C-R6-1 登记）

- **owner**: boyingliu01
- **截止**: 2026-09-23 23:59 (UTC+8)
- **登记日期**: 2026-09-22
- **来源**: R6 走查（`aaa9799..7e9ea12`）C 的唯一 Major-concern `C-R6-1`；A 的 `A-M1`、B 的 `B-M3` 为同项 Minor。
- **逾期处理**: 相对门将持续处于"零强制"（`samplingMatches` 判不可比 → SKIP/exit 0），必须在下一次开发会话的首项处理并向用户报告，不得静默顺延。

## 背景（为什么存在这个窗口）

`7e9ea12` 把相对门判定改为 **min-of-10**，并引入 `_repeats`/`_estimator` 口径门；而仓库内
`bench/baseline.json` 仍是 **schema v3**（无口径标记）。因此在重录提交落地之前，
`samplingMatches` 判 **不可比 → SKIP(exit 0) + "re-record required"**，即 CI 相对门处于
**零强制**状态。这是有意的过渡设计（严禁把 v3 基准与 v4 门静默比较），但窗口的关闭必须是
**可验证的待办**——ADR-0002 补遗二决策 5 的纪律性散文不足以充当跟踪载体。

**窗口期间不比较、不放宽**：不得让 v3 基准以任何方式参与判定，也不得改动容差/阈值来"让它过"。

## 关闭条件（全部满足才算完成）

- [ ] **1. 触发重录**：`gh workflow run bench.yml --ref main`（record job，CI ubuntu-latest，N=10 取 min）
- [ ] **2. 提交权威基线**：下载 `bench-baseline` artifact 覆盖提交 `bench/baseline.json`
      验收（机器可查）：`_schema_version: 4`、`_repeats: 10`、`_estimator: "min"`、
      `_environment == {os: "linux", arch: "x64", ci: true}`
- [ ] **3. 过门推送**：该提交经三位专家 code-walkthrough（对新 HEAD）→ push `main`
- [ ] **4. 关闭证据**：
      - 本地 `bun run bench/check-regression.ts` 不再打印 "re-record required"；
      - 重录后的 CI bench job 无相对门 `FAIL`、无 G3 步骤红（同时核收 R6 `C-R6-3` 的"连续观测无假红"要求）。
- [ ] **5. 关闭本待办**：在第 2 步的同一提交中删除本文件（关闭事实由该提交与第 4 步证据承载）。

## 附：R6 走查 Minor backlog（非阻断；本文件即其持久登记处）

| ID | 位置 | 内容 | 来源 |
|----|------|------|------|
| R6-B2 | `bench/check-regression.ts:38-42` | `parseP95` 的 `[\d.]+` 理论上可解析出 `NaN`（如 `"1.2.3"`），NaN 经 `isRegression` 两条件皆 false 会**静默 PASS**；runner 输出自控，故属理论面。建议加 `Number.isFinite` 守卫（fail-loud） | B |
| R6-B1 | `bench/env-gate.test.ts:69` | 畸形 `_repeats` 用例表缺 `NaN`/`Infinity`（实现已挡下，属覆盖缺口） | B |
| R6-C2 | `bench/env-gate.ts:74,77` | `trim() === ""` 校验与严格 `!==` 比对不一致：`" min "` 被判 mismatch 而非 malformed（结果仍 fail-closed，仅 reason 文案误导） | C |
| R6-A3 | `bench/check-regression.ts:1` | 文件头注释"无逻辑分支"随本轮增长略不实 | A |
| R6-A2 | `bench/env-gate.ts:77` | `_estimator` 逐字比对从严（`"MIN"`/尾随空格 → SKIP）；从严无害，登记知悉 | A |
| R6-B4 | `bench/check-regression.ts`（G2 档位正则） | 未锚定行首（既存；冻结档位集 8/64/512KB 下无子串碰撞） | B |

backlog 项不在本轮 diff 范围，由后续小提交处理（各自照例走查）。
