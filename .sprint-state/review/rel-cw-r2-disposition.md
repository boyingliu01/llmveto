# REL-CW R2 处置记录（代码走查 Round 2 → 处置 → Round 3 最终立场）

- **R2 卷包**：var/delphi-r11/input-rel-cw-r2.md（R1 背景 + R1 证据 + R1 处置记录 + 修复后工件全文）
- **R2 执行检查**：all_experts_succeeded = true；requested_models_distinct = true；executed_models_distinct = true；echo 四项全过（B 角本轮由 g-deepseek-flash 正常执行并产出裁决，R1 协议故障消除）
- **R2 裁决**：A（架构）APPROVED conf 9（1 Minor）；B（技术）REQUEST_CHANGES conf 8（2 Major + 2 Minor）；C（可行性）APPROVED conf 9（0 发现）
- **B 对 R1 处置的 assessment**：ARCH-C-01 / C-C-01 / ARCH-M-01 修复接受；C-M-01 / C-M-02 反驳接受——R1 全部处置闭合

## R2 发现与处置

| ID | 级 | 发现 | 处置 | 落点 |
|---|---|---|---|---|
| T-R2-01 | Major | seedEvidenceRecord 裸 fetch 无超时，daemon 挂起时 gate 无限阻塞而非 fail-closed，与 run() 每步超时纪律不一致 | **修复（成立）**：fetch 加 `AbortSignal.timeout(30_000)` + try/catch，失败路径 fail("smoke seed: request failed …") | release-gate.mjs seedEvidenceRecord |
| T-R2-02 | Major | managedConfigCopies 与适配器 detectDrift 期望值的对应仅靠注释声明、无机器校验，适配器演进时静默失配 | **反驳核心主张（不成立）+ 采纳诊断改进**：机器校验面真实存在——smoke row 6 以**真 detectDrift** 对副本执行（doctor.config-drift 任一失配即 exit 1 → 门红，src/cli/index.ts:246-249 exit 语义），演进失配 = 大声失败非静默；"适配器侧导出常量供本脚本导入"的修法需改 src/adapters（TS），违反本迭代 src/ 冻结（AC-REL-05a）。采纳残余合理部分：注释写明机器校验面与诊断起点 | release-gate.mjs managedConfigCopies 注释 |
| T-R2-03 | Minor | 白名单硬编码 package/README.zh-CN.md 例外，绑定 npm 11 行为 | **采纳**：注释标注该例外绑定 npm 11 实测行为，npm 大版本升级须随实测修订 | release-gate.mjs packStep 注释 |
| T-R2-04 | Minor | teardown 的 npm rm -g 未加 --ignore-scripts，防御不一致 | **采纳**：加 --ignore-scripts | release-gate.mjs teardown |

## 处置后验证

- `node --check scripts/release-gate.mjs` 语法过
- 处置后全量 release:gate 本机重跑：`var/rel-gate-postr2.log`（结论：**PASS**，10/10 步，smoke 8 行全过，基线 326 passed，2026-10-09）

## Round 3 换入证据

R3 = 最终立场轮（Delphi Round 3）：卷包 = R2 卷包 + 本处置记录 + 修复后 release-gate.mjs 全文；三专家就"R2 全部处置是否闭合"给最终裁决。
