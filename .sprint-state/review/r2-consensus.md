# R2 设计评审 — Round 1 共识

- 日期：2026-11-24
- 评审对象：`docs/plans/2026-11-24-v2b-a-design.md`（用户已批准的初版）
- 输入：设计 + `r1-requirements-r3draft.md` + `specification.yaml` + `slices-manifest.json` + DR-029/030/031
- 方法改进：串行单跑 + 相对路径（R1 期间的并发/绝对路径导致多席产出 0 字节，见 `r1-consensus-r2.md`）

## 席位

| 席位 | 模型 | 结果 |
|---|---|---|
| A | `hy4std` | ✅ 10858 B |
| B | `hy4flash` | ✅ 7512 B |
| C | `space-bunny` | ❌ 600s 超时，0 字节（本轮两次均失败；记录为缺位，不代答） |

**共 2/2 有效席位，均 `REQUEST_CHANGES`（0% 共识）。**

## 两席独立命中同一 CRITICAL（必须先修）

### C1 — 识别规则会把目标流量自己判成歧义并阻断

设计 §2.4 用"特征键"让 `chat` 与 `anthropic-messages` 互相竞争，而两席都指出：

- Chat 标准请求（`messages` + `max_tokens`）与 Claude 请求（`messages` + `system`/`max_tokens`）**同时命中两组特征键**；
- 按"歧义即 unknown" + DR-031（直接 fail-closed）→ **阻断目标客户端自己的全部流量**。

**本文实测确认（不可辩驳）**：

```
Chat 标准请求          chat=true anthropic=true → AMBIGUOUS → unknown → BLOCK
Claude(带 system)     chat=true anthropic=true → AMBIGUOUS → unknown → BLOCK
Claude(无 system)     chat=true anthropic=true → AMBIGUOUS → unknown → BLOCK
```

根因：Claude 的"无 system、纯文本"请求与 Chat 请求**在结构上本来就相同**，任何纯内容识别都必然二选一或判歧义。
这正是本项目 2026-11-24 事故（观测类 checker 误阻断正常流量）的翻版。

**处置**：识别改为**路由权威 + 内容吻合**两层（设计 §2.4）——路由前缀直接决定线格式，
内容识别只在无权威前缀时使用，且"其余 → chat"（倾向已支持格式而非判未知）。

### C2 — 覆盖判据没有独立 oracle，四态不可判定/不可达/有空洞

两席指出：`shape_partial_coverage` 只能由投影器自证（漏投影时仍判 `projected`）；
`known_but_empty` 在识别规则下无法产生（不可达）；"零文本 + 部分未覆盖"落入四态之外。

**处置**：把"已知载荷字段权威清单"变成协议声明的数据 `CoverageSpec`，判定改为**两轴**
（轴1 识别 / 轴2 覆盖：`full` / `partial` / `vacuous`），`partial = present \ handled` 由两个独立来源求得，
与文本量无关（设计 §2.3 / D-02）。

## 其余 MAJOR（两席均有提及或单席提出，全部处置）

| 问题 | 处置 |
|---|---|
| REQ-00/REQ-16 的"四段全链"无归属切片；SL-06 排在适配器之前拿不到真实 adapter 产物 | 新增 **SL-13 四段全链 E2E**，依赖 SL-08/SL-09；切片从 13 增至 15 |
| SL-04/SL-05 依赖写错 | SL-04 依赖 SL-02+SL-03；SL-05 依赖 SL-01+SL-02+SL-03 |
| `coverage_unknown` 退出码与 REQ-09/AC 冲突 | D-07 改为 exit 1 |
| D-04 路径 `<gw>/anthropic/<provider>` 与 REQ-06 冲突；"受管路由"未定义 | 前缀改为 `claude/codex/promptfoo`，并在 D-03 写死"受管路由 = 路由前缀集合 ∪ CANARY_MANAGED_ROUTES" |
| 每客户端线格式声明跨层无合法落点（adapters 不得 import gateway） | 新增 **SL-07 `src/shared/client-wire-format.ts`**；adapters/gateway 只依赖 shared，cli 做 join |
| REQ-08a"三个 JSON 写路径复用"与实现形态不符 | D-04/D-05/D-06 逐条写明：Claude 复用 `applyManagedPatch`；Codex/promptfoo 走 tmp+rename+bak |
| DR-031 后风险缓冲落空（BUILD 不接管流量只是推迟到 SHIP） | 风险 2 增加 **(d) SHIP 期缓冲**：`LLMVETO_PROTOCOL_STRICT=0` 观察一次真实客户端会话；§5.14 加强为必须含"跨格式相似性"三对样本 |
| `shape_partial_coverage` 无长期守卫 | REQ-15a 改为"永久为 0 + doc-consistency 持续断言"；SL-14 承担 |
| offsets 派生片段的落地规则未定义 | 设计改为 `Projection.derived` 布尔 + `handled`/`present` 上报；派生片段不参与原文 offsets 断言（REQ-05 已载） |

## 少数意见（记录，不改）

- C 席提出的"promptfoo YAML 行级编辑脆弱"：已采纳其**失败即拒绝写入**的要求（D-06），不因此引入 YAML 写库。
- 两席均未反对 `src/gateway/protocols/` 的层次归属（A 席确认不违反 `architecture.yaml`，仅提醒在
  `architecture-boundaries.test.ts` 中补 `protocols` 只 import `shared` 的断言 —— 采纳进 SL-01）。
