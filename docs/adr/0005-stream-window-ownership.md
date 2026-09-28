# ADR-0005 · 流式窗口按 checker 分持，游标由网关权威推进且只推进一次

- 状态：Accepted
- 日期：2026-09-28
- 相关：`src/gateway/core.ts:89-109`（`scanResponseStreamChunk`）；`src/checkers/invisible-unicode-scan.ts:58-72`；窗口语义的权威声明 `tests/unit/checkers/invisible-unicode-scan.test.ts:50-69`（AC-VETO-004-02）；TEST 可测试性契约 #2（两态纯 reducer，状态由调用方注入/回传）；ADR-0003（把未闭合 `tool_call.arguments` 片段当作 window 语义延伸）；`docs/plans/2026-09-27-v2a-requirements.md` §5 第四处、REQ-V2a-15、AC-V2a-25/26、§14.5

## 背景（Context）

v1 只有一个有状态流式 checker（`invisible-unicode-scan`），`ScanWindow` 是**单例传递**的：网关建一个窗口，交给 checker，收回，下一片继续。这个形状让两处缺陷长期不可见：

1. **游标双重推进**。契约说 checker 收到的 `window.cursor` 是"本片之前的已消费码点数"（该单测把它钉死，并且一直绿）。但 `core.ts:97` 在进 checker 循环**之前**就把 cursor 加上了 `unit.text.length`，checker 内部又按同一长度自增一次。
2. **`extra` 被丢弃**。同一行重建 `nextWindow` 时只携带 `pendingBytes` 与 `cursor`，不带 `extra`；而且即使带上，串行传递下后一个 checker 的空返回值也会覆盖前一个写入的 `extra`（`invisible-unicode-scan.ts:64-67` 的返回对象里没有 `extra` 键）。

实测（三片流式响应，隐形字符的真实全局码点偏移 22 与 33）：链上 `findings[].offsets` 报 **49** 与 **71**。缺陷能存活到 v1，是因为 `offsets` 只在**直接调 checker**的单测里被断言，**经网关路径零断言**。

v2a 让这两处从"取证瑕疵"升级为"阻塞"：`tool-call-shape` 是**第二个**有状态流式 checker，而 ADR-0003 决定用它自身窗口的 `extra` 承载未闭合的 `arguments` 片段——窗口不跨片存活，256 KiB 单笔上界与 AC-V2a-14 的"总留存字节"就没有计量点，G-WINDOW 关不掉。

## 决策（Decision）

1. **窗口按 `checkerId` 分持**。网关为每个有状态流式 checker 维护各自的 `ScanWindow`，键是 checker id。每片开始时，各 checker 收到的是**同一基窗口的自己的副本**：`pendingBytes` 与 `cursor` 是网关侧共享事实（UTF-8 未决尾字节、全局已消费码点数），`extra` 是该 checker 私有且跨片保留。
2. **游标只有一个权威推进点**：`cursor_next = cursor_prev + unit.text.length`，在全部 checker 都已看到基窗口**之后**由网关写回。checker 回传的 `cursor` **被忽略**（不报错、不参与断言）；回传窗口的 `extra` **被保留**进该 checker 自己的槽位。
   契约 #2 的两态签名 `(window, chunk) → ([result], window)` **不变**，checker 侧实现与既有 fixture **不动**——修改只在网关侧。
3. **`extra` 的键空间私有**，禁止跨 checker 读取或复用同名键；`tool-call-shape` 的累积片段只存在于它自己的窗口里（具体字段名是设计细节，见 v2a 设计文档，不是本 ADR 的内容）。
4. **已落链的失真 offsets 不回填、不重算**。append-only 链的事后改写就是伪造。处置只在文档面：REQ 登记表 T2c 行标注"v1 流式命中的 `offsets` 不可用，v2a 修复后方可作定位取证"（AC-V2a-16⑦ 把守）。

## 备选与被否理由（Options）

| 方案 | 否因 |
|---|---|
| (a) 继续串行共享单窗口，只要求"每个 checker 记得透传 `extra`" | 正确性寄托在礼貌上：任何新 checker 忘记透传就静默清空别人的累积窗口，且单测层看不出来（这正是本次缺陷的成因）。offsets 还会依赖"上一个 checker 是否推进过 cursor"，等于把游标语义交给调用顺序 |
| (b) 改契约 #2：checker 只读不回传 cursor | 破 v1 冻结的可测试性契约，`invisible-unicode-scan` 及其 fixture 全要重写，换来的收益 (a) 也能给；且契约 #2 是本项目声明"不可事后补"的那类前置件 |
| (c) tool-call 累积窗口不放 `ScanWindow`，网关侧另立一个结构 | 与 ADR-0003 冲突（那边已定"window 语义延伸"），并出现**两套**跨片状态口径：一套归 checker、一套归网关，纯函数签名内读不到后者，最终仍要把状态塞进 `meta`，等于把同一问题换个位置 |
| (d) 保留缺陷，只改 AC 措辞（"offsets 近似定位"） | test-follows-implementation，即 v1 纪律里禁止的"静默放宽"。T2c 是阻断类，其定位是"隐形字符在第几个字符"的对外承诺；且它回避不了 (1)(3) 的窗口存活问题 |

## 后果（Consequences）

- ✅ AC-V2a-14 的构造式断言（i=2048 → 262144 恰不超、i=2049 → 262272 超即拒收并 block，`delivered_chunks=2048`）**获得唯一可信计量点**：`tool-call-shape` 自己窗口的累积字节。
- ✅ §4.2"运行时累积量可观测"行的 `status` 口径随之定死为"该路窗口的累积量"，不是"全部窗口之和"（AC-V2a-26③）。
- ✅ `invisible-unicode-scan` 的既有单测一行不改（契约未动），新增的是**经网关**的等值断言（AC-V2a-25），它把此前无人把守的那条路径变成有人把守。
- ⚠️ 本决策带出 **REQ-V2a-15 + AC-V2a-25/26**，发生在 R1 Round 5 批准**之后**且 5 轮预算已用尽，因此**没有任何评审轮看过它们**；披露与复核义务写在需求文档 §14.5，Phase 4 必须与 §5 第二/第三处、§4.5 双层落点并列专门复核。
- ⚠️ 影响面声明：本修复只改取证面（`offsets`），不改任何 `verdict`/`action`，因此**不构成 v1 验收回退**，也不触发 v1 冻结阈值（G1/G2/G3）的修订。
