# R1 需求评审（v2a 检测核心）— 五轮共识报告

- **Sprint**: sprint-20260927-46 / Phase 2 DESIGN / delphi-review **R1（需求评审，requirements mode）**
- **评审对象**: `docs/plans/2026-09-27-v2a-requirements.md`（v2a 需求陈述）+ `CONTEXT.md`（词汇表）+ `docs/adr/0003`、`docs/adr/0004` + 附录 B 代码摘录（`src/evidence/schema.ts`、`src/shared/types.ts`、`src/policy/mapping.ts`、TEST 契约 #4）
- **评审范围**: v2a 检测核心（14 条 REQ / AC-V2a-01~24 / 四张前置门）是否可冻结并进入 Phase 3 BUILD
- **专家团**: A=架构视角(`g-glm-5.3-flash`) / B=技术视角(`g-deepseek-flash`) / C=可行性视角(`local-qwen3.8-27b`) —— 三家 `requested_model` 与 `executed_model` 全程互异
- **最终裁决**: Round 5 **3/3 APPROVED**，`consensus_ratio = 1.00`（阈值 0.90）
- **机读证据**: `.sprint-state/phase-outputs/requirements-reviewed.json`（xp-gate Phase 2 契约入口）
- **冻结基线**: `head_commit = 539487afcae71e4084adce2c782cd24886727a04`

## 1. 轮次账（含作废轮，保持审计可回溯）

| 轮次 | 状态 | A | B | C | Critical/Major/Minor | 说明 |
|---|---|---|---|---|---|---|
| 1 | 有效 | GAPS_FOUND(8) | GAPS_FOUND(7) | GAPS_FOUND(8) | 6 / 12 / 11 | 首次成文即被三家一致认定存在不可落盘断言 |
| 2 | 有效 | GAPS_FOUND(7) | APPROVED(8) | APPROVED(9) | 0 / 4 / 9 | A 家剩 1 Major（会话身份 digest 与 registry 并发语义） |
| 3 首跑 | **无效执行** | `fetch failed` | — | — | — | `all_experts_succeeded:false`、`executed_models_distinct:false`；按"任一专家失败即整套重跑、不得聚合或降级"作废，不登记为专家意见 |
| 3 重跑(3b) | 有效 | APPROVED(8) | APPROVED(8) | APPROVED(9) | 0 / 2 / 7 | 首轮出现 3/3 APPROVED；剩余 Major 全部处置 |
| 4 | **无效执行** | `fetch failed` | GAPS_FOUND(7) | APPROVED(9) | 1 / 2 / 3 | 同一失效模式第 2 次出现 → 整轮作废、不聚合；其 B 家 Critical 不依赖该轮有效性，按实质单独采纳（见 §3） |
| 5 | 有效 | APPROVED(8) | APPROVED(8) | APPROVED(9) | 0 / 2 / 9 | 对最终文本（含 ADR-0003 / CONTEXT.md 同步后）评审，3/3 APPROVED |

- **计入共识的有效轮**: 1、2、3、5；**Round 3 首跑与 Round 4 为无效执行**，均记入 `round_anomalies`（`counted_in_consensus:false`）。
- **轮次预算 5 已用尽**（`round_budget:5`，`budget_exhausted:true`）。
- `executed_models_match_expected_echo` 在各轮间不稳定（`g-glm-5.3-flash` 回显在 Round 1 为 `glm-5-3-flash-260826`、Round 2 起为 `glm-5.3-flash`，后端部署名带日期后缀漂移）。多模型契约由 requested/executed distinctness 保证，不依赖 expected_echo；Round 3b 与 Round 5 该检查亦为 true。

## 2. 三家一致肯定的部分（修订中必须保留）

1. 范围切分（v2a 检测核心 / v2b 运营面）与 §3 排除表把"不做的事"写成了可判定清单，未以范围模糊换取深度下降。
2. Q1~Q7 七项已定决策各自挂了 ADR 或定值表，且**参数定值不留在待议清单**（Round 1 的 T-MAJ2/A-MAJ5 正是为此而修）。
3. §4.5「安全类词汇的物理落点」把词汇落点收敛到唯一表，使 AC 断言与真实 schema 对齐——这是本链最重要的结构性产出。
4. 门的设计区分统计门与硬上界（64 KiB p99 / 256 KiB 单笔），沿用 DESIGN 的 G2/G3 交叠口径，未静默放宽 v1 冻结阈值。
5. 对"链外可观测的覆盖降级"不假装链内有信号（§7 P4 漏检族如实登记）。

## 3. Critical / Major 处置索引（全部指向本文既有小节）

| 来源 | 级别 | 问题 | 处置落点 |
|---|---|---|---|
| Round 1 | C×6 | 见 §11 修订记录（29 行逐条） | 本文 §2/§4/§5/§6/§8 首轮重写 |
| Round 1 | M×12 | 同上 | §11 |
| Round 2 | M×4 | 会话身份 digest 输入、registry 并发与轮换、注入六分支、G-RELAY 复用未定 | §12（13 行）+ §4.3/§4.4/§8.4 |
| Round 3b | M×2 | canary-return-scan 预算档位来源；注入分支 5 的再分派 | §13 + §4.2/§4.4 |
| Round 4（轮次作废，按实质采纳） | **C×1** | REQ-V2a-13 声明 `CheckerResult.reason` 三值扩四值，但 §6 无任何 AC 断言该联合取值域 → checker 层落点不可判定 | 新增 **AC-V2a-24**（类型层 + 运行期双断言，且断言 `scanner_error`/`input_malformed` 仍可达）；§4.5 补 `input_malformed` 行 |
| Round 4 | M×2 | REQUIRED_FIELDS 字面 26 的口径核对；AC-V2a-12 reason 取值域断言手段 | AC-V2a-23① 改为从 `EvidenceRecord` 键集派生期望集（不硬编码 26）；AC-V2a-12 明确断言手段与 fixture 档位名 |
| Round 5 | M×2 | **T-M1**：AC-V2a-14 的 262272B > 256KiB 依赖"计量点在判定并送达之后"这一散文约定，第 2049 片是否计入未写成显式前置条件 | AC-V2a-14 重写为构造式断言并给出显式前置条件"若收下本片则总留存 > LIMIT"，i=2048→262144（不超）、i=2049→262272（超 ⇒ 拒收并 block）、`delivered_chunks=2048` |
| Round 5 | M×2 | **T-M2**：AC-V2a-18 的"全文不含 `registry_unavailable`/`inject_skipped`"会误伤 status 快照，断言域需收紧 | AC-V2a-18/23 把断言域限定为 `findings[].rule_id` / `findings[].checker` 值集，并排除 `ts/event_id/request_id/seq/latency`（写在 fixture helper 常量里） |
| Round 5 | m×9 | A 家 4（reason 白名单与 v1 既有值关系、REQ-V2a-12 档位来源字面口径、AC-V2a-18 孪生 body 构造、`EvidenceFinding.threat` 必填值约定）；B 家 4（G3 档位名入 fixture、`undefined` 与"未设置"的区分、轮换瞬间时序注入点、P4⑤ 回归守卫注记）；C 家 1（nightly loopback 端口争用首跑后验证） | §14.3 十六行处置表；已落入 AC-V2a-12/13/16/18/19/23/24、§4.2/§4.5/§7 P4⑤/§8.4/§10.1 |

统计：有效四轮（1/2/3/5）累计 Critical 6、Major 20、Minor 36；另含作废轮 Round 4 的 Critical 1 / Major 2 / Minor 3（按实质采纳，不重复计数）。以上全部关闭或登记，无遗漏：`unclosed_critical:0`、`unclosed_major:0`、`escalation_needed:false`。

## 4. 批准之后的二次自查（本链的诚实边界，必须随证据一起读）

Round 5 给出 3/3 APPROVED **之后**，逐字核对 `docs/issues/4-test-validation.md:66` 发现本文 §4.5 自身的一处事实错误：原文写"TEST 契约 #4 的字段表里没有 `reason`"，实际契约有 `reason` 行、必填列为 **❌（可选）**、示例值即 `checker_timeout` / `scanner_error`；`REQUIRED_FIELDS` 的自身注释限定为"契约 #4 全部 ✅ 必填字段"。**缺席的是实现，不是契约。**

由此连带订正（均已在本文落地）：

- §4.5 重写为**双层落点**：顶层可选 `reason` 描述位 + `findings[]` 内 `verdict="error"` 条目（契约的 findings 枚举本就含 `error`）；`registry_unavailable` / `inject_skipped` 只进描述位、**不进** `findings[]`（否则 `mapBySpec` 会按 safetyClass 兜底，使注入失败改变策略结论）。
- §5 由"一处背离"扩为**三处**：第一处 响应扫描单元从不提取 `tool_calls`；第二处 契约 #4 的 `reason`/`usage`/`cache_reported` 三个可选位在实现里整体缺席、必填位 `latency` 是标量而非四元组；第三处 fail-closed 的 error→block 在链上不留 per-checker 痕迹（`flattenFindings` 只取 `result.evidence`、`safeRun` 返回空数组、`decide()` 的 `reasons` 从不落链）。
- REQ-V2a-13 重写、新增 REQ-V2a-14；AC-V2a-13 / 16（四处→六处订正）/ 18 / 19① / 23 / 24 同步；Q1、§4.3、§4.4、§7 P4⑤、ADR-0003、CONTEXT.md 相应表述同步。
- 决策记录：`.sprint-state/decisions.md` **DR-020**。

**后果与义务（原文见本文 §14.4）**：

1. 订正**只扩大**交付面（新增 REQ-V2a-13/14、AC-V2a-24，实装一个契约内可选位，修 `flattenFindings` 的取证缺口），未删减任何已批准 AC，未放宽任何门；
2. 三家 Round 5 的判据面（无 Critical、剩余 Major 均已处置或登记）在订正后仍成立——但**它们没有对订正版独立判过**；Round 5 看到的 §4.5 是"链上只能借 `findings[].rule_id`"那一版，方向正确而事实错了一层；
3. 因此 **Phase 4 VERIFY** 的测试-规格对齐报告与 code-walkthrough **必须**把 §5 第二/第三处、§4.5 双层落点列为专门复核项，当作"未经 R1 独立确认的义务"对待；
4. 若 Phase 3/4 发现双层落点在实现层走不通（例如 `record_hash` 的 canonical JSON 对新增可选位不稳定），**不得**就地静默改需求，必须回到本文并出 ADR 记录。

## 5. 冻结与后续

- `requirements_hash = 066e80f680535301ba7065b786f4a05b55b83f21aae9db2e82fef599074f936f`，输入为 `docs/plans/2026-09-27-v2a-requirements.md` 全文 + `CONTEXT.md` 全文 + `timestamp` 日期前缀（`2026-09-28`）。自本时刻起这两个文件冻结；任何后续改动都会使 `phase-transition 2 completed` 报 mismatch。
- **该哈希含日期前缀，且 `head_commit` 必须等于校验时的 HEAD**，故机读证据在 Phase 2 收尾（Step 3~10 的设计文档 / R2 / 切片 / `specification.yaml` 全部落盘并提交后）用 `node var/delphi-v2a/write-requirements-evidence.mjs 5 …` 重新生成一次，再立即跑 `phase-transition 2 completed`，最后才提交 `.sprint-state/` 的证据文件。本节所记数值对应 `539487a`（需求文本冻结提交）。
- Phase 2 余下步骤：Step 3 设计文档（`docs/plans/2026-09-27-v2a-design.md`，2~3 候选 + 推荐 + 成功判据）→ Step 4 用户批准（HARD-GATE）→ Step 6 batch-grill-me 议 §10.1 十项参数 → Step 7 R2 delphi-review（design mode）→ Step 8 to-issues 切片（`slices-manifest.json` 的 G-RELAY `estimate` 必须是结构化对象）→ Step 9 `specification.yaml`。
- BUILD/VERIFY 期间必须落地并各有 AC 守卫的文档订正：ROADMAP T2b；REQ 登记表 T1a/T2a/T2c/T3a/T4a 与新增 P4；TEST 契约 #4 的 `degraded_observational` / `canary` 保留位 / `latency` / `reason` 注记；README §CLI 5→6 与"不提供"清单。由 `tests/unit/doc-consistency.test.ts` 把关。
