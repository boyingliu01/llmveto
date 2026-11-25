# R1 需求评审 — Round 1 共识

- 日期：2026-11-24
- 评审对象：`.sprint-state/review/r1-requirements-draft.md`（v2b-A 需求陈述初稿）
- 面板：`.delphi-config.json` / `active_profile = codebuddy-v2b`（见 `delphi-panel-v2b.md`）

## 席位与实际凭据

| 席位 | 配置模型 | 实际命令行 | 结果 |
|---|---|---|---|
| A architecture | `hy4std` | `codebuddy -p --model hy4std`（读文件式 prompt） | ✅ 11599 B |
| B technical | `hy4flash` | `codebuddy -p --model hy4flash`（正文内联式 prompt） | ✅ 7807 B |
| C feasibility | `space-bunny` | `codebuddy -p --model space-bunny` | ❌ **两次执行无输出**（600s / 420s 均超时且输出 0 字节） |
| C′ 补位 | `hy4flash-free` | `codebuddy -p --model hy4flash-free` | ✅ 7568 B |

**缺位处置**：C 席两次执行失败，按"不得由实现方模型代答"的纪律，改用同为外部可调、且与 A/B 均不同的 `hy4flash-free` 补位，并在本文如实标注它是补位席而非原配置席。三席模型 ID 互异（`hy4std` / `hy4flash` / `hy4flash-free`）。

## 投票

| 席位 | VERDICT |
|---|---|
| A（hy4std） | `REQUEST_CHANGES` |
| B（hy4flash） | `REQUEST_CHANGES` |
| C′（hy4flash-free） | `REQUEST_CHANGES` |

**共识：0/3 APPROVED（0%）→ 不达标（阈值 90%），进入修订轮。** 但缺乏共识的原因不是意见分歧，而是三席独立指向同一批缺口——本文的重点是逐条处置。

## 三席独立命中同一问题（收敛信号，必须处理）

| # | 问题 | A | B | C′ | 性质 |
|---|---|---|---|---|---|
| 1 | **流式/SSE 覆盖缺失** | ✅（列为应纳入而未纳入） | ✅ **CRITICAL-1** | ✅ **CRITICAL-1（称"全篇最大空洞"）** | 三席一致；本文已补实测证据 |
| 2 | **端到端验收判据 = 假过闸** | ✅ **CRITICAL-1** | ✅（验收 #5 的 client/provider_id 来源不明） | ✅（同源） | 本文 §5.5 与 §0 自相矛盾 |
| 3 | **D3 未识别形态可被武器化** | ✅ MAJOR-1 | ✅ **CRITICAL-2** | ✅ MAJOR-3 | 二席直接判为 CRITICAL |
| 4 | **offsets 口径无定义、无验收** | ✅（MINOR/R2 无验收） | ✅ MAJOR | ✅ MAJOR-2 | 对象参数规范化后无原文 span |
| 5 | **promptfoo 语义未定（项目级文件）** | ✅ MAJOR-5 + D2 | ✅ MAJOR（假漂移） | ✅ MAJOR-6（写库侵入） | 项目级 vs 用户级受管混合 |
| 6 | **既有 `opencode/anthropic` 申报不符无人认领** | ✅（SCOPE-5） | ✅ MAJOR | ✅ **MAJOR-1（存量审计）** | 只修未来、未处置存量 |
| 7 | **可追溯落点未进验收** | ✅ MAJOR-3 | ✅ MINOR | ✅ MAJOR-7 | 最大验证局限的补偿悬空 |
| 8 | **D1 定点编辑边界未定义** | ✅（三类边界） | ✅ MAJOR | ✅ MAJOR-4 | 双目标键 / 插入 / 多处匹配 |
| 9 | **D4 后果陈述未落地** | ✅ MAJOR | ✅（`inject_skipped` 可观测） | ✅ MAJOR-5 | 不注入 → 失去什么能力 |

## 各席独有、本文采纳的修正

- **A CRITICAL-2（结构性问题）**：需求把"协议线覆盖"窄化成两个投影函数，**漏掉入口/路由/原始 body 透传一层**。§1 基线绕过 HTTP 直接喂函数，证明不了网关入口能接住 `POST /v1/messages`（Anthropic Messages）与**是否存在** Responses 端点。**这是本文最严重的结构性疏漏**：投影函数改得再对，入口不认照样落空。
- **A MAJOR-2**：`ANTHROPIC_AUTH_TOKEN` 凭据语义未定义（Gateway 需要网关侧凭据，否则 401）。
- **A MINOR-1**：§1.1 矩阵"Chat 的 `system` 是字符串"——真实 Chat Completions 的系统提示在 `messages[].role=system`，草稿形态写错，验收正样本不得照抄。
- **A MAJOR-5 / C MINOR-3**：§0 说"三种协议"，实际是**两种新格式**（Anthropic Messages、Responses）+ 一个复用 Chat 的 promptfoo；promptfoo 也未进 §1.1 矩阵。
- **B CRITICAL-3**：REQ-08 若按未验证的"客户端→线格式"映射输出确定结论，比说"不知道"更危险 → 必须输出"未知"。
- **B MINOR**：`reason` 应区分"字段不存在"与"字段存在但为空"，避免健康探针刷噪声。
- **C MAJOR-3**：`reason` 必须是**稳定机器可读码**，不能是自由文本；须定义纯工具调用 / `input: []` 等**合法空请求**的豁免规则。
- **C MAJOR-4**：Codex 的 `<id>` 和 `wire_api` 是否算"目标键"必须写死。
- **B / C 对 D5 的一致意见**：做成**数据驱动的 `recognize` / `projectRequest` / `projectResponse` 三件套**，不要类继承；`recognize` 输出"已知 / 未知 / 已知但零文本"三态作为一等结果。

## 与本文倾向相左的结论（需要改）

| 议题 | 本文倾向 | 三席意见 | 处置 |
|---|---|---|---|
| D3 | (b) 覆盖降级 | B：**(a) 限定版**——受管路由上未知形态 fail-closed；C：同意 (b) **但必须硬化**（稳定码 + 豁免 + 显式风险接受） | **改为条件式 fail-closed**：受管路由上"未知形态"与"已知但零文本"分权处理，详见修订稿 §4-D3 |
| D2 | (a) 直接写 | A/B/C 一致：项目文件默认**只报告**，写入需**显式 opt-in** | 采纳 |
| D1 | (b) 定点编辑 | 三席一致同意 (b)，但补齐边界 | 采纳并补齐 |

## 处置原则（进入修订轮）

1. **A 的 CRITICAL-2（入口层）并入本文范围**——否则本 sprint 无法自证"真过闸"。
2. **流式覆盖同步补入**，并附带本文紧跟实测到的证据（三形态 SSE 投影：Responses/Anthropic 每帧 `""`，Chat 正常）。
3. **验收判据整体升级**：从"evidence 出现 client/provider_id"升级为"`unit.text` 非空且命中探针文本 + evidence 记录"。
4. 存量审计、可追溯表、offsets 口径、`reason` 枚举、D1/D2 边界、`inject_skipped` 全部落成 REQ 与验收条目。

## 附：本文在评审期间补出的新证据（三席评审时尚未看到）

| 协议 | 流式每一帧的扫描投影 | 结论 |
|---|---|---|
| Responses (`response.output_text.delta`) | `""` | ❌ 不可见 |
| Anthropic (`content_block_delta.delta.text` / `input_json_delta`) | `""` | ❌ 不可见 |
| Chat（对照 `choices[].delta.content`） | `"PROBE-CHAT-TOKEN"` | ✅ 可见 |

这直接证实了 A/B/C′ 三席判定的 CRITICAL-1，且说明其严重度高于三席估计：**流式是默认形态，非流式才是特例。**

---

## 第二轮评审前补出的入口层实测（对 A 席 CRITICAL-2 的独立证实）

A 席判定"需求漏掉入口/路由/原始 body 透传一层"。本文用真实 `startGateway` + mock 上游做了端到端探测，
**两处各带一个 `sk-` 形态凭据**发出：

```
POST /claude/anthropic/v1/messages -> HTTP 200   evidence: {client:"claude", provider_id:"anthropic", action_taken:"warned"}
POST /codex/openai/v1/responses    -> HTTP 200   evidence: {client:"codex",  provider_id:"openai",     action_taken:"warned"}
```

`egress-secret-scan` 是**阻断类**（命中即 `blocked_before_forward`，请求不出境）。实测却是 `warned`、
HTTP 200、请求已转发——**因为凭据从未进入扫描单元**。

这一条同时证实了三件事：

1. A 席 CRITICAL-2 成立：入口层对两种形态"接得住"，但**接住不等于扫到**；只改投影函数而不做端到端断言，
   交付后仍是假过闸。
2. A 席 CRITICAL-1 成立：端到端判据必须是"扫描单元命中探针文本"，"evidence 有 client/provider_id" 恰恰是失效形态本身。
3. **既有路由的暴露面比草稿 §1.2 描述更大**：不只是 Anthropic 形态的主体与响应不可见，
   **阻断类凭据规则在两种形态上完全不生效**，且当前会以 `warned` 记录——事件看起来"被看见了"，实际没有。

**由此新增的硬要求（进入修订稿）**：验收必须包含"凭据形态探针在三种协议线上都被 `blocked_before_forward`"
（正向：Chat 现状已满足；目标：Anthropic / Responses 修好后也必须满足），并以反向探针证明该断言能变红。
