# Delphi 评审卷 — Round 3（聚焦复审）

> 角色：三位不同厂家专家（A 架构 / B 技术 / C 可行性）。本轮为**收敛性复审**：
> 仅裁定 Round 2 提出的 14 项修复是否 resolved，并检查修复本身是否引入**新的** Critical/Major 不一致。
> 不重新评审 R1/R2 已 resolved 且本轮未触碰的条款。

## 背景

- Round 2 共识度 86.4% < 91% → 未通过。A/B 各报 2 条 Critical，已按零容忍全部修订（commit 9af9633）。
- 完整 R2 共识与处置决议见 `.sprint-state/review/r2-consensus.md`。

## 必读文件（按序读取）

1. `.sprint-state/review/r2-consensus.md`（本轮待裁定的问题清单与处置）
2. `docs/issues/1-req-threat-model.md`
3. `docs/issues/2-design-v1.md`
4. `docs/issues/4-test-validation.md`
5. `docs/issues/5-roadmap.md`
6. `README.md` · `architecture.yaml`

## 一、逐项裁定（Round 2 新问题的处置是否 resolved）

对下表每一项给出 `resolved` / `partially_resolved` / `unresolved`，并标注**证据位置（文件+章节）**；若 unresolved/partially，给出**最小修复动作**。

| ID | 问题（R2） | 声称的处置 | 复核重点 |
|---|---|---|---|
| N2-C1 | `invisible-unicode-scan` 被 TEST §3 归"告警类 FP≤2%"，但其 action=block | 移入阻断类 FP=0 | REQ §策略映射 / DESIGN 组件2 / TEST §3 / ROADMAP 验收3 四处是否已统一为"阻断" |
| N2-C2 | REQ 登记表 T2a/T2b 取证列虚报 `response_body_ref 落盘可事后取证` | 改为 `response_body_sha256` + 默认无明文 | 是否仍有任何行把"默认不做的取证"写成"做成了"；T1a/T1b/T2c/P1 是否同步 |
| N2-M1 | REQ 行为矩阵场景4 用 `partial_response_delivered` | 改 `response_delivered.partial` | 契约#4 字段名是否全文唯一 |
| N2-M2 | 零缓冲 tee vs 同步 per-chunk checker 块级语义未定 | DESIGN §关键决策补"先扫描后 tee" | 场景3 是否已可判定可达、`delivered_chunks=0` 是否自洽、是否与 G1 口径一致 |
| N2-M3 | G2(512KB:40ms) 与 G3(50ms) 仅 10ms 余量 | G3 分档 20/50/120ms + 交叠口径 + 慢环境登记 | 新分档是否消除陷阱；G2/G3 交叠判定语义是否清晰；G-BENCH p99 约束是否可执行 |
| N2-M4 | 扫描单元含认证头 → 阻断类 FP=0 不可达 | DESIGN 排除认证头 + TEST 强制 benign 认证头 fixture | 排除清单是否明确；是否引入"凭据藏在自定义头漏检"的新缺口且是否诚实登记 |
| N2-M5 | TEST 契约#3 fixture 用 `codepoint`/`terminated_stream` 未登记字段 | 改用契约#4 已登记字段 | fixture 示例键是否全部可回溯到字段表 |
| N2-M6 | ROADMAP 验收1(b) 探测过闸无执行落点 | TEST §4 E2E 补"受管枚举探测过闸"行 | 断言是否可判定、发起者（harness vs doctor）是否明确 |
| N2-M7 | G1 p99<12ms 仅在 DESIGN、ROADMAP 验收缺 | ROADMAP 验收6 补 p99 | 两文档 G1 承诺是否等价 |
| n1 | doctor v1 检查项 README vs DESIGN 互斥 | DESIGN §组件5 冻结封闭枚举、README 引用 | CA 项在/不在检查集是否已单义 |
| n2 | `degraded_observational` v1 不可达未标注 | 契约#4 标 `@v2起可达` | 是否清晰 |
| n3 | `llmveto:veto-mid-stream` 未登记于 DESIGN 组件1 | 组件1 补 error 事件规格 | 对外契约是否完整 |
| n4 | `pending_bytes`(DESIGN) vs `pendingBytes`(TEST) | 统一 camelCase | 是否一致 |
| n5 | T1a"摘要哈希可对账发过什么"夸大 | 改写措辞 | 是否诚实 |

## 二、修复引入检查（判据2 关键）

对上述任一修复，检查它**是否与未改动的条款产生新的跨文档矛盾**。特别是：
- G3 分档改动是否影响 TEST §5 / ROADMAP 验收4/6 的超时口径一致性。
- 认证头排除是否与 REQ 登记表 T1b"自写 token 漏检"能力边界声明一致（排除标准认证头 ≠ 排除所有凭据载体）。
- 新增 P3 行（evidence 明文本地聚集）是否与 DESIGN §脱敏、README 承诺强度一致。

## 三、总体裁决

- 若你认定的问题已全部 closed 且无新 Critical/Major → 给 `APPROVED` 或 `APPROVED_WITH_CONDITIONS`。
- 若仍有未闭合 Critical/Major → `REQUEST_CHANGES`，并明确列出。
- 给 consensus 信心值（0-10）。

## 输出格式（严格）

先输出逐项裁定表，再输出"修复引入检查"结论，最后输出 JSON 块：

```json
{
  "expert_id": "<A|B|C>",
  "round": 3,
  "mode": "design",
  "verdict": "APPROVED | APPROVED_WITH_CONDITIONS | REQUEST_CHANGES",
  "confidence": <0-10>,
  "resolutions": { "N2-C1": "resolved", ..., "n5": "resolved" },
  "new_critical_issues": [],
  "new_major_concerns": []
}
```

不要向用户提问；不要等待确认；一次性给出完整结论。
