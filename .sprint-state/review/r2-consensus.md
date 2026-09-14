# Round 2 共识报告（Delphi 复审）

> 输入：r2-questionnaire.md + R1 修订后的 6 份冻结件。
> 三专家独立复审：A(g-deepseek-flash/架构) · B(g-glm-5.3-flash/技术) · C(g-qwen3.8-flash/可行性)。

## 1. 裁决与共识度

| Expert | verdict | confidence | Critical | Major |
|---|---|---|---|---|
| A | REQUEST_CHANGES | 7 | C1, C2 | M1, M2, M3, probe, scenario3 |
| B | REQUEST_CHANGES | 8 | NC-1, NC-2 | auth-head, fixture-field, probe, G2/G3 |
| C | APPROVED_WITH_CONDITIONS | 8 | — | — |

- **共识度 86.4% < 91% 阈值 → Round 2 未通过。**
- 触发零容忍：A/B 各报 Critical（取证虚报为 A-C2 与 B-NC-1 同源，unicode FP 分类为 A-C1 独有但经核实成立）。
- 结论：修复 Critical + Major 后进入 Round 3 聚焦复审。

## 2. R1 遗留 22 条处置的三专家一致度

| 问题 | A | B | C | 一致度 |
|---|---|---|---|---|
| P-01 | partial | resolved | resolved | 2/3（场景3可达性需补语义）|
| P-02 | resolved | resolved | resolved | 3/3 |
| P-03 | partial | resolved | partial | 1/3（探测过闸无执行落点）|
| P-05 | resolved | partial | resolved | 2/3（取证列虚报）|
| P-11 | partial | resolved | resolved | 2/3（unicode FP 分类矛盾）|
| P-17 | resolved | resolved | partial | 2/3（doctor CA 尾巴）|
| P-18 | resolved | resolved | unresolved | 2/3（doctor 检查项互斥）|
| P-20 | partial | resolved | resolved | 2/3（默认与取证声明冲突）|
| 其余 14 条 | resolved | resolved | resolved | 3/3 |

## 3. Round 2 新引入问题（去重合并）

### Critical（必修）

- **N2-C1｜unicode checker FP 分级矛盾**：TEST §3 把 `invisible-unicode-scan` 归"告警类 FP≤2%"，但 REQ §v1 策略映射其 action=`block`。阻断类 checker 容忍 2% 误报 = 破坏可用性主张。[A 独家，核实成立]
  - 处置：TEST §3 将 `invisible-unicode-scan` 移入"阻断类 FP=0"；告警类仅留 `model-label-consistency`。
- **N2-C2｜登记表取证虚报**：REQ §v1 残余风险登记表 T2a/T2b 取证列称 `response_body_ref 落盘可事后取证`，但默认 `body_capture=metadata_only` 仅存 SHA-256，无原文无法事后对账注入内容。[A/B 同源]
  - 处置：取证列改写为"`response_body_sha256`（明文留存仅当 `body_capture≠metadata_only`，默认无明文）"。

### Major（零容忍，必修）

- **N2-M1｜字段名漂移 partial_response_delivered**：REQ §行为矩阵场景4 用 `partial_response_delivered=true`，契约#4 冻结字段为 `response_delivered:{partial,delivered_chunks}`。[B/C]
  - 处置：REQ 场景4 改用 `response_delivered.partial=true`。
- **N2-M2｜块级阻塞语义未定义**：零缓冲 tee（DESIGN 组件1）与同步 per-chunk checker（契约#2）的关系未写明"第 N chunk 是否先过 checker 再 tee"，导致场景3（首字节前命中）可达性不清、`delivered_chunks` 语义待定。[A]
  - 处置：DESIGN 组件1/关键决策补定案："每 chunk 到达后先经同步窗口 checker，通过后再 tee 转发；G1 = 该 per-chunk 门延迟"，并说明场景3 可达、场景4 `delivered_chunks` 可为 0。
- **N2-M3｜G2/G3 余量陷阱**：G2(512KB:40ms p95) 与 G3(50ms 硬超时) 仅 10ms 余量，慢机正常大请求即超时→block。[A/B/C]
  - 处置：G3 改按 body 分档（8KB:20 / 64KB:50 / 512KB:120ms，随档递增给余量），DESIGN 登记"慢环境大请求可能被超时阻断"为已知运行时行为，G-BENCH 须报 G3 口径 p99。
- **N2-M4｜扫描单元含认证头 → 阻断类 FP=0 不可达**：DESIGN `request_body` 含 `extra_headers`，未排除 `Authorization`/`x-api-key`；真实流量认证头值即高置信凭据模式，benign 必命中。[B]
  - 处置：DESIGN 扫描单元定义补排除清单（认证类头不进扫描单元）+ TEST §3 加一条"含 auth 头 benign" fixture。
- **N2-M5｜fixture 字段名未登记**：TEST 契约#3 示例用 `codepoint`/`terminated_stream`，契约#4 无此字段（P-06 术语二义回潮）。[B]
  - 处置：契约#3 示例 evidence 键改用契约#4 已登记字段（`findings.offsets[]` + `action_taken`/`response_delivered`）；REQ 登记表 T2c/P1 取证措辞对齐字段表。
- **N2-M6｜探测过闸无执行落点**：ROADMAP 验收1(b)"逐条路径回放探测请求"，但 DESIGN doctor 职责与 TEST §4 E2E 均无载体。[A/B/C]
  - 处置：TEST §4 E2E 表补"受管枚举探测过闸"行（harness 逐路径回放 + 断言 evidence 命中 `client`+`provider_id`）。
- **N2-M7｜p99 门槛权威清单缺失**：G1 p99<12ms 仅 DESIGN 有，ROADMAP 验收#6 未列 → 承诺强度不一致。[A]
  - 处置：ROADMAP 验收#6 补 p99<12ms（或 DESIGN p99 标注为非验收门；采用前者）。

### Minor（低成本一并修）

- **n1 doctor v1 检查项互斥**：README"CA 信任项输出 not-applicable@v1" vs DESIGN"不在 doctor 检查项内"。→ DESIGN 冻结 doctor v1 检查项封闭枚举，README 引用之，统一措辞。
- **n2 `degraded_observational` v1 不可达**：契约#4 枚举值应标 `@v2起可达`。
- **n3 `llmveto:veto-mid-stream` 未登记**：DESIGN §组件1 补一行 error 事件规格。
- **n4 `pending_bytes`(DESIGN) vs `ScanWindow.pendingBytes`(TEST)**：统一 camelCase。
- **n5 T1a"摘要哈希可对账发过什么"措辞夸大**：改为"摘要哈希（仅证明发过该字节序列，无原文不可读）"。

## 4. 处置范围决议

Critical 2 条 + Major 7 条全部修复，Minor n1~n5 一并修复。修复后提交，派 Round 3 聚焦复审（仅裁定本 14 项是否 resolved）。
