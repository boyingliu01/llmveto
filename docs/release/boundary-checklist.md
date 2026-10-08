# fail-closed 边界登记核对（REQ-REL-05 / AC-REL-05a · 零代码）

核对基准（D-08）：威胁模型 T0 行 + 双语 README 分发承诺段逐点核对；`src/` 零改动断言。
本清单为 RL-07 切片验收留档，执行于 BUILD 期。

## 核对点

| # | 核对点 | 基准 | 结果 |
|---|---|---|---|
| 1 | 威胁模型 T0 行 = "已缓解（fail-closed）"，v1 不重试、不备用 upstream（属 v2 运营面），每次故障落 evidence（`blocked_before_forward` + 成因摘要） | docs/issues/1-req-threat-model.md L119 | ✓ 原文在场，未改动 |
| 2 | README.zh-CN.md §分发与 runtime 承诺 含「**无重试、无备用上游**」bullet，502 + `llmveto:upstream-error` 留痕、daemon 存活、v2 运营面、链接 T0 行 | D-08 核对清单 | ✓ 已落（RL-07） |
| 3 | README.md 同段含 **"No retry and no failover upstream."** 定译 bullet，语义逐点对等 + 同链接 | D-08 英文定译候选（落地版把候选句中 "audit record" 按受控词定译为 "evidence record"——术语表 evidence 保留原名不译） | ✓ 已落（RL-07） |
| 4 | `src/` 零改动断言 | `git diff <merge-base> -- src/` 为空 | ✓ base=bd4bb402ce150dd035a7f233abf112b43158155a，diff 0 行（RL-05/RL-07 两次核对均跑） |
| 5 | 双语结构完整性不受内容增补影响 | `node scripts/check-readme-parity.mjs` PASS | ✓ 10 标题逐对相等 + 5 表行数序列 [5,8,9,7,6] 相等 |

## 结论

AC-REL-05a 逐点 PASS。登记边界表述与威胁模型 T0 行、双语 README、src 实况四方一致；
上游容错能力缺口 = 已登记边界（"无重试/备用上游，属 v2 运营面"），非隐性缺陷。
