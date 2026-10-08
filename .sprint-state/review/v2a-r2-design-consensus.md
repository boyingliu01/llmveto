# R2 设计评审（v2a 检测核心）— 三轮共识报告

- **Sprint**: sprint-20260927-46 / Phase 2 DESIGN / delphi-review **R2（设计评审，design mode）**
- **评审对象**: `docs/plans/2026-09-27-v2a-design.md`（候选 A + D-01~D-14，Step 4 已批准）+ `CONTEXT.md` + 需求陈述（判定基准，R1 已批准）+ 附录 A 接缝代码原文 / 附录 B evidence 契约代码原文
- **评审范围**: 设计文档是否消解需求 15 条 REQ / 27 条 AC 的全部承载点、五处 v1 背离修复是否可落盘、四张前置门关闭安排是否成立——R2 APPROVED 前不进入 Step 8 切片（DR-022 义务）
- **专家团**: A=架构视角(`g-glm-5.3-flashx`) / B=技术视角(`g-deepseek-flash`) / C=可行性视角(`local-qwen3.8-27b`) —— 三家 `requested_model` 与 `executed_model` 全程互异，Round 3 四项执行 checks 全过
- **最终裁决**: Round 3 **3/3 APPROVED**（各 conf 8），`consensus_ratio = 1.00`（阈值 0.90），第 3 轮 / 预算 5 轮内达成
- **评审基线**: `reviewed_head_commit = ab08cc1c53950fe5b8b3d6872c171bf7e6bb82e6`，`reviewed_design_sha256 = 2800fe79…afa9c2`
- **机读证据**: `.sprint-state/delphi-reviewed.json`（design mode）

## 1. 轮次账（含作废执行，保持审计可回溯）

| 轮次 | 状态 | A(arch) | B(tech) | C(feas) | C/M/m | 说明 |
|---|---|---|---|---|---|---|
| 1 | 有效 | REQUEST_CHANGES | REQUEST_CHANGES | APPROVED | 1 / 8 / 12 | 首轮即抓出 D-10 优先序违反 §4.3 无条件承诺（T-C1）与 D-11 观测类抑制条款违反 AC-V2a-24② 无范围双层落链（A-M1/T-m3） |
| 1-attempt1/2 | **无效执行** | `fetch failed` | 成功 | 成功 | — | A 槽 `g-glm-5.3-flash` 连续两次 fetch failed；根因 = undici HTTP/2 stream timeout 300s（full-shape curl 实测 570.9s，native-fetch 探针 300.1s 复现 `InformationalError`）。按"窗口可修则修后重跑"纪律换 A 槽为 `g-glm-5.3-flashx`（55.7s 同包跑完，finish=stop）后重跑；attempt 产物保留不聚合 |
| 2 | 有效 | REQUEST_CHANGES | APPROVED | APPROVED | 0 / 2 / 8 | 共识 2/3（66.7%）未达 90%；**Round 1 的 21 项被三家一致判定全部闭合**；新缺口核心 = A-M1（D-07 推进点次序违反 AC-VETO-004-02 冻结语义——Round 1 三家均未抓到，Round 2 由 A 槽 flashx 抓出，DR-024 多轮评审对"次序型"缺陷检出价值的实证） |
| 3 | 有效 | APPROVED(8) | APPROVED(8) | APPROVED(8) | 0 / 1 / 6 | **3/3 APPROVED，共识达成**；Round 2 的 10 项被三家一致判定全部闭合（A-M1 修复经冻结语义与附录代码核验为"真消解"） |

## 2. 三轮评审链上最有价值的三个信号

1. **T-C1（Round 1 Critical）**: D-10 R1 稿"裁决影响优先"规则在组合场景下会让 `registry_unavailable` 在链上无处可落（§4.5 禁其入 findings[]），违反 §4.3/AC-V2a-19① 的无条件承诺。修复 = 网关描述值优先 + checker reason 经 findings[] 全额保全（无信息损失）。已由 Round 2/3 双轮确认自洽。
2. **A-M1（Round 2 Major）**: 设计文档"写对了意图、写错了次序"——时序 2 把 cursor 推进写在 checker 调用前，照字面实现 = v1 双重推进 bug 的镜像，AC-V2a-25 将系统性判红。修复 = 网关唯一推进点移至 checker 返回后（旧值+len），钉住 AC-VETO-004-02 冻结语义。
3. **T-M1（Round 3 Major，共识轮唯一残留）**: 多 checker error 并发时顶层单值与 findings 多条目的对应关系未定义。补钉 = 取证反推规则（对 `rule_id` 等于顶层值的条目按同一固定序 + 平局规则重放，唯一确定胜者条目）。

## 3. 残留处置（Round 3，0C/1M/6m → §10.2 七行对账表）

| 编号 | 级别 | 处置 |
|---|---|---|
| T-M1 (tech) | Major | **补钉** D-10：顶层值与 findings 条目的对应关系（重放选取规则） |
| A-m1 (arch) | Minor | **登记** D-14：durable 计数遮蔽语义（单值描述位结构性代价，对账以事件时 status 为准） |
| A-m2 (arch) | Minor | **修复** D-13：evil-relay 载体路径改回需求 §4.2 定值字面 `testkit/evil-relay.ts` |
| T-m1 (tech) | Minor | **补钉** D-10：D-09 改写的 `checker_timeout` 属 checker 词汇，恒不参与网关值优先、与发生时刻无关 |
| T-m2 (tech) | Minor | **补钉** D-03：标记文件删除失败告警计数口径（每启动序最终失败计 1） |
| T-m3 (tech) | Minor | **补钉** D-14：`[DEGRADED]` 前缀 = doctor 输出单测结构断言，不在 doc-consistency grep 域 |
| F-m1 (feas) | Minor | **登记（默认不采纳）** §8 #E：两段式降级预案属门判据协议变更，列为 Step 8 用户拍板项 |

## 4. 证据与产物索引

- 专家输出: `var/delphi-v2a/r2-round{1,2,3}-experts.json`（executor 原始 JSON，含 checks 与 raw_excerpt）
- 缺口清单: `var/delphi-v2a/r2-round{1,2,3}-gaps.md`（`export-r2-gaps.mjs` 逐字导出）
- 评审卷包: `var/delphi-v2a/r2-round{1,2,3}-prompt.md`（`build-r2-prompt.mjs` 生成；Round 2/3 附前轮缺口对账基准）
- 处置落盘: 设计文档 §10（Round 1，21 行）/ §10.1（Round 2，10 行）/ §10.2（Round 3，7 行）
- 决策记录: `.sprint-state/decisions.md` DR-022（R2 义务）/ DR-023（Round 1 执行与 A 槽换模型）/ DR-024（Round 2 处置）/ DR-025（Round 3 处置与收链）
- 作废产物: `var/delphi-v2a/r2-round1-attempt{1,2}-experts.json`（A 槽 fetch failed，不聚合，保留审计）

## 5. 结论

R2 设计评审链闭合：无 Critical 未闭合，唯一共识轮 Major 已补钉，6 Minor 全部处置或登记——满足 APPROVED 定义。设计文档头部状态行已更新为"R2 评审链已闭合，进入 Step 8 切片"。下一步 = Step 8（to-issues 切片 + slices-manifest，含 #E 提醒节点与 S-BUDGET 关键路径标注）。
