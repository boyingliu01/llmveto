# Round 3 共识报告（Delphi 聚焦复审）

> 输入：r3-questionnaire.md + R2 修订（commit 9af9633）后的 6 份冻结件。
> 三专家聚焦复审：仅裁定 R2 的 14 项处置是否 resolved + 修复是否引入新矛盾。

## 1. 裁决与共识度

| Expert | 模型 | verdict | confidence | 新 Critical | 新 Major |
|---|---|---|---|---|---|
| A | g-deepseek-flash | APPROVED_WITH_CONDITIONS | 9 | 0 | 0 |
| B | g-glm-5.3-flash | APPROVED_WITH_CONDITIONS | 8 | 0 | 0 |
| C | g-qwen3.8-flash | APPROVED_WITH_CONDITIONS | 8 | 0 | 1 |

- **14/14 项 resolved，三专家全票一致** → 复审域共识度 100% ≥ 91% 阈值。
- 唯一新 Major（C-Major-1：N2-M4 排除认证头派生的"header 路径盲区未在 T1b 登记"）**已在提交前闭合**——T1b 行补写"标准认证头被排除出扫描单元 → 夹带凭据/追踪水印亦成 v1 盲区；自定义头仍进扫描单元仍会被扫"。A 亦独立提出同一处（判为 Minor），一并覆盖。
- **R2 零容忍清单（2 Critical + 7 Major + 5 Minor）全部闭合，无遗留未处理 Critical/Major。**

## 2. 附带条件的处置（B/C 提出的 Minor，冻结前一并收敛）

| 条件 | 提出者 | 级别 | 处置 |
|---|---|---|---|
| SSE error 载荷形状双源（REQ 扁平 vs DESIGN 包裹） | B | Minor | ✅ 统一为 DESIGN §组件1 的 `{"error":{...}}` 包裹形，REQ 场景4 改为引用权威源 |
| "安全类 checker" 未纳入 invisible-unicode-scan → 其 fail-closed/超时映射无归属 | B | Minor/backlog | ✅ DESIGN 降级规则改为"按 action=block 属性圈定"，含两 checker，并写明 invisible-unicode 走 per-chunk 门预算（计入 G1，不设独立 G3） |
| 零缓冲实为"≤1 chunk 瞬态持有" | C | Minor | ✅ DESIGN §关键决策补精确表述，防实现期误当 bug 或反向放宽 |
| P2 取证列"doctor 输出落 evidence"无载体 | B | Minor | ✅ 改为"doctor 结果输出至 CLI（exit code+条目 id），v1 不写 evidence" |
| `expected.observables` 键非契约#4 字段 | C | Minor | ✅ TEST 加注"fixture-only 断言容器"+ 键到已登记项的映射 |
| E2E 缺场景3（delivered_chunks=0）用例 | C | Minor | ✅ TEST §4 拆场景3/4 两行，验证 M2"零缓冲下场景3 可达"主张 |
| invisible-unicode 组件2 未重述双模 | C | Minor | 由降级规则改动覆盖（不再需要单点重述） |

## 3. R1 遗留 8 条 partially 的最终状态

R2 曾把 P-01/P-03/P-05/P-11/P-17/P-18/P-20 标 partial/unresolved；经 R2 修复 + R3 逐行证据核对，三专家一致判 resolved（P-18 doctor 检查项互斥经 n1 冻结枚举解决）。P-03 探测过闸执行落点经 N2-M6（TEST E2E 行）闭合。

## 4. 结论

**DESIGN 期 R2 delphi-review 通过**：Round 3 三专家 APPROVED_WITH_CONDITIONS，共识 ≥91%，无未闭合 Critical/Major，全部附带条件已在冻结前落入文档。可进入设计文档用户 APPROVAL + specification.yaml/slices-manifest 阶段。
