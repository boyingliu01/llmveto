# REL-CW 代码走查共识记录（sprint-20261008-26 Phase 4，delphi-review --mode code-walkthrough）

- **走查对象**：发布面可执行工件 —— scripts/release-gate.mjs / .github/workflows/release.yml / scripts/check-readme-parity.mjs / package.json / CHANGELOG.md（scope 声明：src/ 本迭代零改动属 AC-REL-05a 冻结断言，不在走查面；文档交付物以卷包 §4 索引带过）
- **评审 HEAD**：`2d27c0ce3e3df979c816ef847b0056d5c354a734`（走查对象在此提交树冻结；其后仅追加本记录等文档提交，不回灌评审基线）
- **执行器**：`node var/delphi-r11/delphi-experts.cjs`（main 仓 var/ 未跟踪 scratch），config `var/delphi-r11/.delphi-config.json`，profile `example-provider-flash`
- **卷包**：R1 `var/delphi-r11/input-rel-cw-r1.md`（31,214 B，C 槽 131072 窗口内）；R2 `input-rel-cw-r2.md`；R3 `input-rel-cw-r3.md`
- **原始输出**：`var/delphi-r11/rel-cw-experts-r{1,2,3}.json` + `rel-cw-r{1,2,3}-run.log`

## 执行验证（每轮 4 检查）

| 轮 | all_experts_succeeded | requested_distinct | executed_distinct | echo_match | 备注 |
|---|---|---|---|---|---|
| R1 | false | true | false | false | B 角（g-deepseek-flash）回复无可解析 JSON 裁决块 → 协议失败，按纪律全员重跑（无单角补跑） |
| R2 | true | true | true | true | B 角正常执行（deepseek-flash），R1 故障消除 |
| R3 | true | true | true | true | 最终立场轮 |

三位 requested 模型：g-qwen3.8-flash（A 架构）/ g-deepseek-flash（B 技术）/ local-qwen3.8-27b（C 可行性）；executed echo：qwen3.8-flash / deepseek-flash / Qwen3_8-27B —— 三模型 distinct 且与绑定一致（专家自述不作数，以执行记录 checks 为准）。

## 轮次与裁决

| 轮 | A 架构 | B 技术 | C 可行性 | 发现（C/M/m） | 处置 |
|---|---|---|---|---|---|
| R1 | REQUEST_CHANGES conf 9 | 失败 | REQUEST_CHANGES conf 9 | 2C + 3M + 4m | [rel-cw-r1-disposition.md](rel-cw-r1-disposition.md)：ARCH-C-01/C-C-01 修复，C-M-01/C-M-02 反驳，3m 采纳；fix a5e0057 |
| R2 | APPROVED conf 9 | REQUEST_CHANGES conf 8 | APPROVED conf 9 | 0C + 2M + 4m（B 对 R1 处置全部接受） | [rel-cw-r2-disposition.md](rel-cw-r2-disposition.md)：T-R2-01 修复，T-R2-02 反驳+诊断注，2m 采纳；fix 2d27c0c |
| R3 | **APPROVED** conf 9 | **APPROVED** conf 9 | **APPROVED** conf 9 | 0C + 0M + 2m | 见下"残留 Minor" |

**最终共识：3/3 APPROVED，consensus_ratio = 1.0（≥ 0.90 达标），3 轮 ≤ 5 轮预算。**

每轮 Critical/Major 零容忍：R1 的 2C+3M、R2 的 2M 全部处置（修复或带代码引证的反驳），反驳项均获后续轮专家接受（B 角 R2 disposition_assessment 接受 C-M-01/C-M-02 反驳；R3 三家对 R2 处置无异议）。

## 残留 Minor（2 条，均登记不阻断）

- **ARCH-N-02**（R3 A 角）：release.yml Release 步——CHANGELOG 缺版本节时 awk 静默失败定位稍弱。注：现行实现已含空节守卫（`BODY` 为空 → `::error` fail-closed），该情形不产生静默成功；注记留档。
- **T-R3-N-01**（R3 B 角）：managedConfigCopies 与适配器 detectDrift 的对应由 smoke row 6 运行时真 detectDrift 兜底（失配大声失败），无构建期校验。B 角自评"src/ 冻结下维持现状可接受"；**后续项**：src/ 解冻后由适配器导出受管字段常量供本脚本导入，前移为构建期校验。登记至 phase-4 summary next_phase_context。

## 判定语义声明（诚实口径）

- release.yml 的 publish 三分支语义（tag-only 门 / E404 幂等前置 / EPUBLISHCONFLICT 兜底）属 CI 触发面，本地无法真实触发——验证形态 = 静态语义评审（3 轮三专家）+ Gate 12 YAML 语法检查；真实验证时点 = 用户侧 tag v0.2.0 push（specification.yaml constraints.user_trigger_points 已冻结）。
- scripts/release-gate.mjs 的验证 = 本机全量重跑 ×2 PASS（R1 处置后 a5e0057 树、R2 处置后 2d27c0c 树，`var/rel-gate-postfix.log` / `var/rel-gate-postr2.log`）。
