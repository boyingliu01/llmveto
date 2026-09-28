# ADR-0003 · 流式 tool-call 参数的跨 chunk 累积是 ScanWindow 语义的延伸，不是零缓冲的放宽

- 状态：Accepted（决策已定；G-WINDOW 实测值待 BUILD 前置门关闭后回填本文件"后果"节）
- 日期：2026-09-28
- 相关：`CONTEXT.md` §零缓冲 / §扫描单元（scan unit）；DESIGN v1 §扫描单元定义、§关键决策"块级阻塞语义定案"、§性能预算与降级规则；`docs/plans/2026-09-27-v2a-requirements.md` REQ-V2a-02 / §4.2 / AC-V2a-14 / 门 G-WINDOW；R1 Round 1 A-CRIT1

## 背景（Context）

v1 把"零缓冲"钉成可对 falsify 的定义：**不持有 >1 个 chunk**；正在被 checker 判定的那一个 chunk 允许存在 ≤1 chunk 的瞬态持有窗口，且该窗口"是实现定义的一部分而非待修缺陷"（DESIGN §关键决策）。同一节还给了一个探测器：fixture 的 `delivered_chunks: N` 断言——若实现被悄悄异步化或整段缓冲，N 会异常增大并被抓住。

v2a 要上 `tool-call-shape`（安全类，映射 `block`）。它的判据之一是"`arguments` 是不是合法 JSON / 是否缺 required 参数"。流式下 `tool_calls[*].function.arguments` 是**逐 chunk 碎片送达**的 JSON 字符串片段：chunk 3 给 `{"fi`、chunk 4 给 `rst_nam`……单独任何一个 chunk 都不是合法 JSON，也判不出结构。

于是出现表面冲突：**要判结构就得持有多个 chunk 的内容，而零缓冲说不得持有 >1 个 chunk。**

v1 已经在同一处解决过同构问题，只是当时只针对字节：U+200B 的 UTF-8 编码 `E2 80 8B` 可能被 chunk 边界切开，逐 chunk 独立扫描会系统性漏检，所以 `ScanWindow.pendingBytes` 携带未完成的多字节序列跨边界（DESIGN §扫描单元定义 第二条）。

## 备选（Options）

**(a) 视为 `ScanWindow` 既有语义的延伸**——未闭合的 `arguments` 与未决 UTF-8 尾字节是同一类状态："当前判定单元尚不完整"。由 `ScanWindow.extra` 承载累积片段，零缓冲定义**文字不改**，只加注脚。

**(b) 放宽零缓冲定义**——明说"tool-call 场景允许缓冲到调用结束"。

**(c) 只在完成帧判定**——等 `finish_reason=tool_calls` 后一次性判，不跨 chunk 累积。

## 决策（Decision）

**选 (a)。** 配套三件硬约束，缺一则本决策退化为 (b)：

1. **上界定死**：单个 `tool_call` 的 `arguments` 累积上限 **256 KiB**，超限 → `verdict=error` → `action=block`。落点（v2a 需求 §4.5）：checker 层 `CheckerResult.reason` 由 v1 三值联合扩为四值新增 `window_overflow`；链上写 TEST 契约 #4 **本就列为可选**的顶层 `reason` 位（v1 从未实现该位，见需求文档 §5 第二处背离），并另产一条 `findings[]` 内 `{checker, threat:"T2a", verdict:"error", rule_id:"window_overflow"}`。`REQUIRED_FIELDS` 26 项必填表不变。
2. **出门**：新增前置门 **G-WINDOW**，实测流式 tool-call 场景下 `ttft_delta` p95/p99 仍满足 G1，且累积量分布 p99 < 64 KiB。
3. **出 AC**：AC-V2a-14 给出**构造性形状与显式计量前置条件**（128 B × 2049 片，判据为"若收下本片则总留存 > 262144"：第 2048 片恰等不触发、第 2049 片越界拒收并 block，`delivered_chunks` 恒为 2048），断言流式 tool-call 场景下网关**仍不持有超过 1 个未判定 chunk**；AC-V2a-12 按 checker 限定 reason 取值域；AC-V2a-23/24 把守必填表全等与 reason 双层痕迹。

## 理由（Why (a) 不是自欺）

- **(b) 不可接受**：它改的是**对客户端的承诺**（已转发字节不可撤回 + 阻断粒度=响应级/流终止级）。G1/G2 阈值是 v1 冻结的对外承诺值，静默放宽会重演 v0.1 "测试全绿但装不起来"那类口径漂移。本项目的纪律是"阈值不满足必须走 ADR 修订并公开记录"（DESIGN §降级规则），(b) 正是该纪律要禁止的那种改法。
- **(c) 不安全**：把违规藏在流中段（先正常吐一半 arguments，再在第 N 片塞隐形字符或未声明工具名）即可绕过，因为 (c) 只在最后一帧判。而 `invisible-unicode-scan` 是阻断类，v1 已承诺覆盖 tool-call 参数路径（见 REQ 登记表 T2c 行的 v2a 订正）。
- **(a) 与 pendingBytes 同构**：两者都是"当前判定单元不完整，暂存不足以判定的一小段"。区别只在体量：UTF-8 未决尾字节 ≤3 字节，`arguments` 片段可达数十 KB。所以 (a) 的真实风险不是"违反零缓冲"，而是**引入了一个新的内存上界**——这才是 G-WINDOW 与 256 KiB 硬门要管的东西，也是本 ADR 存在的理由。
- **64 KiB 与 256 KiB 是两种口径，不得混读**：64 KiB 是**统计门**（累积量分布回归信号，超 = 性能/资源回退，进回退流程但不阻断单笔），256 KiB 是**单笔硬上界**（超即 `block`）。落在 64–256 KiB 区间的请求正常判定并放行。该分法沿用 DESIGN 里 G2（统计门）/ G3（单笔硬超时门）的交叠判定口径。

## 后果（Consequences）

- 正向：`tool-call-shape` 能在流中判结构非法；`invisible-unicode-scan` 对 `arguments` 的宣称覆盖首次变成真实覆盖（REQ T2c 行订正）。
- 负向 / 新风险：每个进行中的流式 tool_call 持有一份最长 256 KiB 的累积缓冲；极端并发下的内存占用由 G-WINDOW 实测界定，并由 `status` 暴露累积量 p50/p95/max（超 64 KiB 统计门只告警不 block）。
- 定义面：`CONTEXT.md` §零缓冲 条目**文字不改**。实现者不得把该瞬态窗口当 bug 消除，也不得反向放宽成整段缓冲——这与 DESIGN v1 对 pendingBytes 的措辞同一条纪律。
- 待回填：G-WINDOW 实测数字（`ttft_delta` p95/p99、累积量分布）在 BUILD 前置门关闭后写回本文件，并同步 §4.2 若需调整统计门值。

## 验证

- 定义面：`CONTEXT.md` §零缓冲 文字未变（diff 为空），仅本 ADR 与需求陈述 §4.2/§4.4 给出落点——用 grep 型文档断言把守（AC-V2a-16 同族的 `tests/unit/doc-consistency.test.ts`）。
- 行为面：AC-V2a-14 的 `delivered_chunks` 断言即异步化/整段缓冲探测器；AC-V2a-12 断言 `window_overflow → block` 真实可达（fixture 构造 >256 KiB 的 `arguments` 流）。
- 性能面：G-WINDOW 走 TEST §5 冻结协议（预热 50、n=200/档、p50/p95/p99），载体为既有 `bench.yml`，v2a 不新增绝对值 AC（AC-V2a-22）。
- 实现前自检：`src/gateway/scan-unit.ts` 的 `buildResponseScanUnit` 当前完全不提取 `tool_calls`（`tool_calls` 在 `src/` 与 `tests/` 出现 0 次）——本 ADR 的累积语义挂在该函数补齐之后，见需求陈述 §5。
