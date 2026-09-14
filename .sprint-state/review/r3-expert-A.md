
> delphi-reviewer-architecture · g-deepseek-flash

I'll start by reading the review questionnaire and all required documents.
→ Read .sprint-state/review/r3-questionnaire.md
→ Read .sprint-state/review/r2-consensus.md
→ Read docs/issues/1-req-threat-model.md
I have the review questionnaire and R2 consensus. Now let me read all the documents under review in parallel.
→ Read docs/issues/2-design-v1.md
→ Read docs/issues/4-test-validation.md
→ Read docs/issues/5-roadmap.md
Now let me read the remaining documents: TEST, ROADMAP, README (already have it), and architecture.yaml.
→ Read architecture.yaml
✱ Grep "invisible-unicode-scan|FP|阻断类|告警类" in .
✱ Grep "response_body_ref|response_body_sha256|response_body_sha|落盘可事后取证" in .
I've read all documents. Now let me verify specific claims with targeted searches to make my judgments evidence-based, checking each of the 14 items across all four documents.
✱ Grep "partial_response_delivered|response_delivered|delivered_chunks" in .
✱ Grep "codepoint|terminated_stream|pending_bytes|pendingBytes|degraded_observational|veto-mid-stream|摘要哈希" in .
Good, I'm gathering concrete evidence. Let me check the remaining items: G3 tiers/timeouts, auth-header exclusion vs T1b, P3 row, evidence fields (codepoint/terminated_stream), doctor enumeration, degraded_observational, veto-mid-stream registration, pendingBytes, T1a wording, and the ROADMAP acceptance items.
✱ Grep "G3|20ms|50ms|120ms|p99|超时" in .
I have strong evidence now. Let me verify the few remaining items: T1a wording (n5), the ROADMAP acceptance #1(b) harness carrier, doctor README alignment, and the P3 row check for the "fix-introduced" analysis. Let me also confirm the git commit state.
✱ Grep "MANAGED_CONFIG_IDS|受管枚举探测|探测过闸|harness" in .

$ git -C D:\projects\llmveto log --oneline -5 && git -C D:\projects\llmveto show --stat 9af9633 2>$null | Select-Object -First 30
9af9633 docs(design): resolve R2 delphi-review findings (2 Critical + 7 Major + 5 Minor)
2545042 docs(design): resolve all R1 delphi-review critical/major findings
8131109 chore(sprint): phase 1 PREP - dev env initialized, sizing=complex, decisions DR-001..004
223b5bd chore: initialize dev environment (Bun + TS + vitest scaffold, arch gates, import issues #1-#5 as docs)
commit 9af9633186fd5d0e618b302136e733ab2b4a327d
Author: boyingliu01 <boyingliu01@example.com>
Date:   Mon Sep 14 21:33:46 2026 +0800

    docs(design): resolve R2 delphi-review findings (2 Critical + 7 Major + 5 Minor)
    
    - C1: invisible-unicode-scan FP class -> blocking (FP=0), aligned with action=block
    - C2: risk register T2a/T2b forensics -> response_body_sha256 (no plaintext by default)
    - M: partial_response_delivered -> response_delivered.partial (contract #4 freeze)
    - M: per-chunk gate-before-tee blocking semantics defined (scenario 3 reachable)
    - M: G3 tiered by body (20/50/120ms) + G2/G3 overlap + slow-env timeout registration
    - M: scan unit excludes auth headers -> blocking FP=0 reachable + benign auth fixture
    - M: fixture evidence keys use registered fields; E2E probe-per-managed-path row; p99 in ROADMAP
    - Minor: doctor v1 checklist frozen enum, degraded_observational @v2, veto-mid-stream spec,
      pendingBytes casing, T1a hash wording, P3 evidence-at-rest row, gateway/adapters note

 .sprint-state/review/r2-consensus.md      |  68 +++++++
 .sprint-state/review/r2-expert-A.md       | 325 ++++++++++++++++++++++++++++++
 .sprint-state/review/r2-expert-B.md       | 116 +++++++++++
 .sprint-state/review/r2-expert-C.md       | 142 +++++++++++++
 .sprint-state/tools/run-delphi-expert.ps1 |  54 +++++
 README.md                                 |   2 +-
 architecture.yaml                         |   3 +
 docs/issues/1-req-threat-model.md         |  21 +-
 docs/issues/2-design-v1.md                |  19 +-
 docs/issues/4-test-validation.md          |  15 +-
 docs/issues/5-roadmap.md                  |   2 +-
 11 files changed, 743 insertions(+), 24 deletions(-)

The commit 9af9633 confirms the fix scope. Note: README showed only 2 lines changed (`+2 -1` implied via `2 +-`). Let me do a final verification of the remaining n-items and cross-check the P3 row integration and README consistency.
$ git -C D:\projects\llmveto diff 2545042 9af9633 -- README.md docs/issues/1-req-threat-model.md docs/issues/5-roadmap.md
diff --git a/README.md b/README.md
index 6af96ce..5f83772 100644
--- a/README.md
+++ b/README.md
@@ -79,7 +79,7 @@ bun run src/cli/index.ts doctor     # 受管配置枚举的覆写/漂移断言 +
 bun run src/cli/index.ts verify     # evidence 链完整性 + schema 断言
 ```
 
-`report`（计费对账）与 `canary rotate`（金丝雀轮换）属 v2。`doctor` 的 CA 信任检查项随 TLS 拦截（v3）才有意义，v1 输出 `not-applicable@v1` 而非"通过"。
+`report`（计费对账）与 `canary rotate`（金丝雀轮换）属 v2。`doctor` 的 v1 检查项为**封闭枚举**（受管配置覆写/漂移断言 + 端口连通 + `--write-managed-config` + evidence 链可验证），权威清单见 DESIGN §组件 5；TLS/CA 信任检查项随 TLS 拦截能力（v3）才引入，**v1 不注册该检查项**（不放恒空的检查项）。
 
 ## 状态
 
diff --git a/docs/issues/1-req-threat-model.md b/docs/issues/1-req-threat-model.md
index e04897b..c0ebced 100644
--- a/docs/issues/1-req-threat-model.md
+++ b/docs/issues/1-req-threat-model.md
@@ -46,7 +46,7 @@ GitHub 同类项目两极分化（2026-09 调研，详见 [REUSE] issue）：
 
 1. **受管路径全量过闸**：覆盖集合按版本声明（v1 = OpenCode + XP-Gate Delphi；v2 += Claude Code / Codex / promptfoo；v3 += HTTPS_PROXY+CA TLS 拦截以覆盖无法覆写 baseURL 的客户端）。**不使用"所有流量"这一全称承诺**：未接入客户端的流量在对应期次内属未覆盖暴露面，须在 §v1 残余风险登记表中登记。判定方法见 ROADMAP「受管配置封闭枚举」。
 2. **逐请求确定性验证**：checker 注册表，可插拔扩充，先覆盖已知威胁类型；每个 checker 的检测能力边界须成文（不默认"已挂编号即已覆盖"）
-3. **违规可阻断**：fail-closed 策略（区别于质量门禁的 SKIP 语义——安全检查失败或**超时**均不允许放行）。可阻断性的物理前提见下节 §裁决与动作语义：流式响应已开始转发的字节不可撤回，故 v1 的"阻断"粒度是**响应级**而非**字节级**。
+3. **违规可阻断**：fail-closed 策略（区别于质量门禁的 SKIP 语义——安全检查失败或**超时**均不允许放行）。可阻断性的物理前提见下节 §裁决与动作语义：流式响应已开始转发的字节不可撤回，故 v1 的"阻断"粒度是**响应级**（未开始转发时整体拒绝）或**流终止级**（已开始转发时注入 error 事件后关闭连接）而非**字节级**。
 4. **全量审计留痕**：append-only 证据链，支撑门禁集成/计费对账/事后取证。其信任边界为"防意外损坏与单条改写，**不抵抗本机同权限对手整链重写**"（见 §裁决与动作语义 · evidence 信任边界）。
 
 ## 裁决与动作语义（v1 冻结件）
@@ -79,11 +79,11 @@ GitHub 同类项目两极分化（2026-09 调研，详见 [REUSE] issue）：
 | 1 | 请求侧（非流式，转发前） | 原样转发 | 转发 + evidence 告警 | **v3**：改写命中字段后转发 | 不转发 upstream；返回 `502 llmveto:rejected`；evidence `action_taken=blocked_before_forward` |
 | 2 | 响应侧 非流式 | 原样返回 | 返回 + evidence 告警 | **v3**：整体缓冲后改写返回 | 不返回响应体；返回 `502`；evidence `action_taken=blocked_before_deliver` |
 | 3 | 响应侧 流式，命中发生在**首字节转发前** | 原样 | 原样 + evidence | **v3** | 等同场景 2（尚未有字节外泄） |
-| 4 | 响应侧 流式，命中发生在**已转发 N 个 chunk 后** | 继续 | 继续 + evidence + `partial_response_delivered=true` | **v3（流式不可执行，见下）** | **终止响应流**：注入 `event: error` `data:{code:"llmveto:veto-mid-stream",delivered_chunks:N}` 后关闭连接；evidence `action_taken=terminated_after_delivery` |
+| 4 | 响应侧 流式，命中发生在**已转发 N 个 chunk 后** | 继续 | 继续 + evidence + `response_delivered.partial=true` | **v3（流式不可执行，见下）** | **终止响应流**：注入 `event: error` `data:{code:"llmveto:veto-mid-stream",delivered_chunks:N}` 后关闭连接；evidence `action_taken=terminated_after_delivery` + `response_delivered:{partial:true,delivered_chunks:N}` |
 
 **场景 4 的明文承诺（不粉饰）**：
 - 已送达客户端的字节**不撤回、不可撤回**；v1 不承诺"客户端未接触到任何恶意内容"。
-- v1 承诺的可验证效果是：(a) 违规内容不再继续流入 agent 的 tool-call 解析路径（流被终止，`finish_reason` 非 `stop`）；(b) evidence 中该响应被标记 `delivered=true` + 命中偏移，供 `llmveto verify` 与人工取证。
+- v1 承诺的可验证效果是：(a) 违规内容不再继续流入 agent 的 tool-call 解析路径（流被终止，`finish_reason` 非 `stop`）；(b) evidence 中该响应被标记 `response_delivered.partial=true` + 命中偏移，供 `llmveto verify` 与人工取证。
 - 若 agent 已在终止前执行了半截 tool-call，该后果属 v1 未覆盖范围（登记在 §v1 残余风险登记表 T2a 行）。
 - 选择"零缓冲 + 终止流"而非"1-chunk 缓冲窗口 + 真阻断"的理由：本项目的威胁模型认定"网关变慢 → 用户绕过网关"是比"半截字节泄漏"更高概率的失效路径（性能即安全属性）。此取舍为 ADR 级决策，Round 2 复审需确认其成立。
 
@@ -109,22 +109,23 @@ GitHub 同类项目两极分化（2026-09 调研，详见 [REUSE] issue）：
 
 | 威胁 | v1 状态 | v1 缓解手段 | 缺口理由 | 计划期次 | v1 取证可得性 |
 |---|---|---|---|---|---|
-| T1a prompt/上下文被记录转售 | **未缓解** | 无（金丝雀在 v2） | 金丝雀引擎排 v2；v1 无任何阳性检测手段 | v2 | 请求体摘要哈希（可对账"发过什么"，无法证明"对方是否留存"） |
-| T1b 凭据窃取 | 部分 | `egress-secret-scan`（gitleaks 模式，阻断） | 仅覆盖**模式化**密钥；自写 token / 内网 URL / 客户数据一律漏检 | v2（+自定义模式库） | 命中与放行均落 evidence |
-| T2a tool-call 篡改/恶意代码注入 | **未缓解** | 无（`tool-call-shape` 排 v2） | v1 不解析 tool-call 结构；流式已转发字节不可撤回 → 即便 v2 检出也无法阻止 agent 执行已收到的半截调用 | v2 | `response_body_ref` 落盘可事后取证 |
-| T2b 响应夹带 prompt 注入 | **未缓解** | 无 | v1 拒绝引入无 FP 门槛的文本规则（大面积误报会摧毁"告警可信"） | v2 | 同上 |
-| T2c 隐形字符水印 | 部分 | `invisible-unicode-scan`（跨 chunk 滚动窗口；非流式 block / 流式终止流） | 归一化（NFKC 后同形）与自定义 PUA 编码变体不覆盖 | v2 扩展码点集 | 命中码点 + 偏移 + 样本 |
+| T1a prompt/上下文被记录转售 | **未缓解** | 无（金丝雀在 v2） | 金丝雀引擎排 v2；v1 无任何阳性检测手段 | v2 | `request_body_sha256`（仅证明发过该字节序列；默认 `metadata_only` 无原文不可读，亦无法证明"对方是否留存"） |
+| T1b 凭据窃取 | 部分 | `egress-secret-scan`（gitleaks 模式，阻断） | 仅覆盖**模式化**密钥；自写 token / 内网 URL / 客户数据一律漏检 | v2（+自定义模式库） | 命中/放行事件落 evidence（`findings[].rule_id` + `action_taken`；命中处明文受 `body_capture` 约束） |
+| T2a tool-call 篡改/恶意代码注入 | **未缓解** | 无（`tool-call-shape` 排 v2） | v1 不解析 tool-call 结构；流式已转发字节不可撤回 → 即便 v2 检出也无法阻止 agent 执行已收到的半截调用 | v2 | `response_body_sha256`（明文留存仅当 `body_capture≠metadata_only`，默认无明文，事后不可读回内容） |
+| T2b 响应夹带 prompt 注入 | **未缓解** | 无 | v1 拒绝引入无 FP 门槛的文本规则（大面积误报会摧毁"告警可信"） | v2 | 同上（`response_body_sha256`，默认无明文） |
+| T2c 隐形字符水印 | 部分 | `invisible-unicode-scan`（跨 chunk 滚动窗口；非流式 block / 流式终止流） | 归一化（NFKC 后同形）与自定义 PUA 编码变体不覆盖 | v2 扩展码点集 | `findings[].offsets`（命中偏移，码点为偏移处字节的派生值）；命中处样本明文受 `body_capture` 约束 |
 | T2d 条件投递（潜伏触发） | **未缓解** | 无 | v1 checker 全部为单请求作用域，无跨请求状态 | v2+（会话级统计） | 按 session 聚合的请求计数在 evidence 中 |
 | T3a 模型偷换 | **部分（弱）** | `model-label-consistency`：仅比对响应 `model` 字段与请求是否一致 | **只抓"忘改字段"的低级对手**；实证背景（`model_mapping` 静默替换且响应字段无回写校验）恰说明真替换会返回一致字段 → 本 checker 对定向替换无效 | v2 指纹巡检（`fingerprint-probe`） | 字段值 + 不一致事件 |
 | T3b 量化降级 | 未缓解 | 无 | 需指纹/探针，不在 v1 | v2 | 无 |
 | T3c 路由波动 | 未缓解 | 无 | 需跨请求观测 + provider 信任分 | v2 | 无 |
 | T4a/b/c/d usage 虚报/假缓存/隐藏系统提示/倍率操纵 | 未缓解（仅取证） | 无判定逻辑 | 对账需官价基准与计费口径，属 v2 计费对账 | v2 | `usage` / `cache` 字段原样落 evidence，供人工对账 |
-| P1 模型目录投毒 | 部分 | `OPENCODE_MODELS_URL` 锁本地模型目录镜像（由 `llmveto doctor --write-managed-config` 负责写入，非用户手工步骤） | 只把上游目录注入移出实时路径，不校验镜像内容真伪 | v2 | 目录快照哈希 |
+| P1 模型目录投毒 | 部分 | `OPENCODE_MODELS_URL` 锁本地模型目录镜像（由 `llmveto doctor --write-managed-config` 负责写入，非用户手工步骤） | 只把上游目录注入移出实时路径，不校验镜像内容真伪 | v2 | doctor 配置快照哈希（v1 仅输出至 `doctor` 结果，不入 evidence 链；@v2 计划登记字段） |
 | P2 配置劫持绕过 | best-effort 部分 | 全局配置 > 项目级配置（v1 内置硬编码优先级）+ `doctor` 配置漂移检测（限定于受管配置封闭枚举） | 流量级"未过闸观测"（审计缺口检测）排 v3 → v1 **无法发现旁路** | v3 | doctor 输出落 evidence |
+| P3 evidence 明文本地聚集（缓解手段自身派生面） | 部分 | `body_capture` 默认 `metadata_only`（仅哈希，明文不落盘）+ 单一 `redactSink()` 咽喉点 | 若用户主动开启 `full` 模式，evidence 文件本身成为凭据/上下文的本地聚集目标（T1b 的静态变体）；v1 无静态加密 | v2（静态加密/权限模板评估） | 文件权限依赖 OS；v1 不承诺 evidence-at-rest 机密性 |
 
 **v1 部署者须知的三句话**：
 
-1. v1 提供的是"凭据出境拦截 + 隐形字符告警/终止 + 模型字段一致性告警 + 全量留痕"。
+1. v1 提供的是"凭据出境拦截 + 隐形字符拦截/终止流 + 模型字段一致性告警 + 全量留痕"。
 2. v1 **不提供**：外泄检测（T1a）、tool-call 注入防护（T2a，RCE 级）、响应注入防护（T2b）、模型真实性证明（T3a 的实质）、usage 对账（T4x）、旁路检测。
 3. v1 的"阻断"在流式响应上是**终止流**，不是**撤回字节**。
 
diff --git a/docs/issues/5-roadmap.md b/docs/issues/5-roadmap.md
index 1265212..74b2abb 100644
--- a/docs/issues/5-roadmap.md
+++ b/docs/issues/5-roadmap.md
@@ -42,7 +42,7 @@ v1 先保证**受管路径流量 100% 过闸**（哪怕验证逻辑最简），v
 3. **checker 有效性门槛**：fixture 集内检出率 100%；benign ≥50 条上告警类 FP ≤2%、阻断类 FP = 0（判据见 TEST §3）。
 4. **fail-closed 端到端**（载体 = mock-upstream，非 evil-relay）：请求侧阻断（零出境证明）+ 流式阻断（前 N-1 chunk 确实已送达 + `event: error` + 连接终止 + `terminated_after_delivery`）两条路径均通过；外加 G3 超时 → `block` 用例。
 5. **evidence 可验证性**：`llmveto verify` 对正常链返回 `ok`；篡改任一中间记录必报 `first_bad_seq`；daemon 重启/崩溃后为纯追加、无覆盖写；schema 字段断言（TEST 契约 #4）全绿。
-6. **性能三台门**：G1 `ttft_delta` p95 < 5ms；G2 `request_gate_delta` 按 body 分档达标；均按 TEST §5 测量协议在每 PR 运行并按 §3 回退公式判定。
+6. **性能三台门**：G1 `ttft_delta` **p95 < 5ms 且 p99 < 12ms**（对齐 DESIGN §性能预算，两值同为验收门）；G2 `request_gate_delta` 按 body 分档（≤8KB:3ms / ≤64KB:10ms / ≤512KB:40ms）达标；G3 扫描超时=block 用例见验收 #4。均按 TEST §5 测量协议在每 PR 运行并按 §3 回退公式判定；G-BENCH 须报告 G3 口径 p99（见 DESIGN §性能预算 慢环境登记条）。
 
 > **v1 交付后仍存在的暴露面**以 [REQ] §v1 残余风险登记表为准（T1a/T2a/T2b/T2d/T3b/T3c/T4x 未缓解）。README 必须引用该表，禁止暗示"装上网关即被保护"。

I now have complete evidence across all 14 items and the fix-introduced cross-checks. Let me compile my independent review.

## Expert A (Architecture) — Round 3 Focused Re-review

### Section 1: Item-by-item resolution table

| ID | Verdict | Evidence location (file + section) | Notes |
|---|---|---|---|
| **N2-C1** | `resolved` | TEST §3 L99 (`invisible-unicode-scan` moved to 阻断类 FP=0); REQ §v1 内置策略映射 L73 (`block`); DESIGN §组件2 L31 (synchronous, action=block); ROADMAP 验收3 L42 (阻断类 FP=0) | All four loci now agree: it is a blocking checker. TEST §3 L98 leaves only `model-label-consistency` in the warn class. Coherent. |
| **N2-C2** | `resolved` | REQ §残余风险登记表 T2a L114 / T2b L115 (`response_body_sha256`, plaintext only if `body_capture≠metadata_only`, default no plaintext); T1a L112 (`request_body_sha256`, explicitly "默认 metadata_only 无原文不可读"); T1b L113 (aligned `findings[].rule_id`); T2c L116 (offsets + body_capture constraint); P1 L122 (doctor-output-only, not in evidence chain); P3 L124 (honest: no at-rest confidentiality) | No row now claims forgery capability that the default mechanism cannot deliver. T2c kept "样本" but correctly bounded by `body_capture`, and offsets are non-content derived values. Honest. |
| **N2-M1** | `resolved` | REQ §行为矩阵 场景4 L82 and L86 now `response_delivered.partial=true` / `response_delivered:{partial:true,delivered_chunks:N}`; TEST 契约#4 L67 defines the same field; TEST E2E L112 consistent | Field name unique across all docs. No `partial_response_delivered` remains anywhere (grep returned zero hits for the old token). |
| **N2-M2** | `resolved` | DESIGN §关键决策 L93-96 ("同一事件循环 tick 内的先扫描、后转发"; explicitly not buffering N+1 onward → still zero-buffer; scenario 3 reachable L94 → `delivered_chunks=0`; scenario 4 L95; G1 measures this per-chunk gate) | Block-level semantics now decidable, scenario 3 reachability is a strict iff-clause, and `delivered_chunks` has one definition (`tee`d before hit). Consistent with G1 framing in DESIGN §性能预算 L77. |
| **N2-M3** | `resolved` | DESIGN §性能预算 G3 row L79 (20/50/120ms, each ≥3× G2 p95); overlap semantics L86 (G2 = statistical p95 gate, G3 = per-request hard timeout; interval [G2, G3) is regression signal but relays normally); slow-env registration L87 (`p99_scan < G3×0.6`, ADR exit condition); ROADMAP 验收6 L45 (G-BENCH must report G3-caliber p99) | Old 10ms margin eliminated (512KB: G2 40ms vs G3 120ms = 3×). Overlap wording is unambiguous. p99 constraint executable. |
| **N2-M4** | `resolved` | DESIGN §扫描单元定义 L47 (exclusion list: `Authorization`/`x-api-key`/`api-key`/`x-goog-api-key`/`Proxy-Authorization`/`Cookie`, with rationale); TEST §3 L100 (mandatory benign auth-header fixture, makes exclusion a regression constraint) | Exclusion list explicit and closed enough for a scan unit. See fix-introduction check below re: custom-header credential gap. |
| **N2-M5** | `resolved` | TEST 契约#3 L43-46 uses `findings` (registered per 契约#4 L64) and `response_delivered` (L67); L49 uses `terminated_after_delivery`/`delivered_chunks`/`error_event_code` as `expected.observables` | `codepoint`/`terminated_stream` no longer appear (grep zero hits). All fixture keys trace to the contract #4 field table. `expected.observables` is a fixture-only assertion block, not an evidence field — acceptable. |
| **N2-M6** | `resolved` | TEST §4 E2E L115 (harness iterates `MANAGED_CONFIG_IDS`, replays ≥1 probe per path, asserts evidence `client`+`provider_id`, explicit "探测由测试 harness 经该客户端适配器发起，非 doctor 自查"); ROADMAP 验收1(b) L39 | Assertion decidable (evidence presence in time window, per-path), initiator explicitly named (harness, not doctor). Closure of the ROADMAP 1(b) execution locus. |
| **N2-M7** | `resolved` | ROADMAP 验收6 L45 (`p95 < 5ms 且 p99 < 12ms`, both "同为验收门", aligned to DESIGN §性能预算); DESIGN L77 same values | Two documents now make equivalent G1 commitments. |
| **n1** | `resolved` | DESIGN §组件5 L37 (frozen closed enum of 4 v1 items; TLS/CA explicitly "不在 v1 doctor 检查集内…直接不注册"); README §CLI L(last) references DESIGN §组件5 as authority and says "v1 不注册该检查项" | README no longer says `not-applicable@v1`; single unambiguous meaning (CA item is absent from v1, not present-and-empty). Consistent with DESIGN L24. |
| **n2** | `resolved` | TEST 契约#4 L65 (`degraded_observational` … "末值 **@v2 起可达**：v1 无观测类 checker，verify schema 须允许该枚举但 v1 fixture 不覆盖") | Clear. Schema allows the enum value, v1 reachability disclaimed, fixture exclusion stated. |
| **n3** | `resolved` | DESIGN §组件1 L28 (frozen client-facing contract: `event: error` + `data: {"error":{"code":"llmveto:veto-mid-stream","delivered_chunks":N}}`, mapped to evidence `terminated_after_delivery`); REQ §行为矩阵 场景4 L82; TEST L49 | The error event is now specified in the component that emits it, and the three-way mapping (client event ↔ action_taken ↔ observable) is explicit. |
| **n4** | `resolved` | DESIGN §扫描单元定义 L51 (`pendingBytes`, aligned to TEST 契约#2 `ScanWindow.pendingBytes`); TEST L22 `pendingBytes` | camelCase consistent; no `pending_bytes` anywhere (grep zero hits). |
| **n5** | `resolved` | REQ §登记表 T1a L112 ("仅证明发过该字节序列；默认 metadata_only 无原文不可读，亦无法证明'对方是否留存'") | No longer overclaims "可对账发过什么"; explicitly bounds to "发过该字节序列" and denies留存 proof. Honest. |

### Section 2: Fix-introduction check (did fixes create new cross-document contradictions?)

**G3 re-tiering vs TEST §5 / ROADMAP 验收4/6 — no new contradiction.**
- TEST §5 L120 still only says "G3 扫描超时 → 必须 `block`" and does not restate the numbers, so no stale tier values. TEST §5 protocol L125 reports p50/p95/p99 per tier — compatible with the new DESIGN L87 demand for G3-caliber p99.
- ROADMAP 验收4 L43 ("G3 超时 → block 用例") and 验收6 L45 (G-BENCH reports G3-caliber p99) reference DESIGN as the numeric authority. No duplicated/conflicting tier constants. ✅
- **Minor observed (not a defect):** ROADMAP 验收6 inlines G2 tiers (3/10/40ms) but does *not* inline G3 tiers — it defers to DESIGN. That is consistent with the "single authority" convention and avoids drift. Acceptable.

**Auth-header exclusion vs T1b "自写 token 漏检" capability boundary — consistent, and the new gap is registered (with one residual under-specification below).**
- REQ T1b L113 states the boundary: "仅覆盖**模式化**密钥；自写 token / 内网 URL / 客户数据一律漏检." DESIGN L47 excludes *standard auth headers*, which are header *names*, not content classes. The two statements are compatible: excluding `Authorization`/`x-api-key`/etc. removes standard *carriers*, not all *credential-bearing text*. A credential can still appear in `messages[*].content`, `tools[*]`, `system`, or **custom headers** and is still scanned.
- The P3 row L124 and T1b row remain honest about the static-aggregation derivative risk.

**New P3 row vs DESIGN §脱敏 / README strength — consistent.**
- DESIGN §脱敏与留痕 L106/L110 states default `metadata_only` and that `full` mode "等同在本地重建中转站的暴露面". P3 L124 restates "v1 无静态加密" and "v1 不承诺 evidence-at-rest 机密性". README's "全量 evidence 留痕" (L table) is a capability claim, not a confidentiality guarantee, and README directs the reader to REQ §残余风险登记表. No overclaim. ✅

**Cross-check of the unmodified `expected.observables` block (TEST L49):** keys `terminated_after_delivery` / `delivered_chunks` / `error_event_code` are not contract #4 evidence columns. This is a fixture assertion namespace whose *targets* all exist in registered fields (`action_taken`, `response_delivered.delivered_chunks`) plus the newly-registered client event code (DESIGN 组件1). It does not reintroduce N2-M5 because it is not asserted as an evidence row. **Minor observation only.**

### Overall verdict

All 8 Critical/Major items (N2-C1, N2-C2, N2-M1…M7) and all 5 Minor items (n1–n5) are `resolved` with concrete, mutually consistent evidence. The three specified fix-introduction hazards (G3 tiers, auth-header exclusion, P3 row) are clean. No new Critical or Major inconsistency was introduced by the fixes.

I record **one new Minor concern** (non-blocking, does not affect verdict): the DESIGN L47 exclusion list is specified by *header name*, but the new "custom header" scan surface means an adversary/benign flow can carry a raw credential in a non-standard header (e.g. `x-my-token: <raw-secret>`), and REQ T1b's boundary text does not explicitly name "自定义头中的非标准凭据载体" as a漏检 class. The capability boundary (T1b) is still truthful, but it would be more precise to add that class. This is a documentation-precision Minor, not a requirement break.

I judge the convergence criteria met: no unclosed Critical/Major → APPROVED_WITH_CONDITIONS with the single Minor noted.

```json
{
  "expert_id": "A",
  "round": 3,
  "mode": "design",
  "verdict": "APPROVED_WITH_CONDITIONS",
  "confidence": 9,
  "resolutions": {
    "N2-C1": "resolved",
    "N2-C2": "resolved",
    "N2-M1": "resolved",
    "N2-M2": "resolved",
    "N2-M3": "resolved",
    "N2-M4": "resolved",
    "N2-M5": "resolved",
    "N2-M6": "resolved",
    "N2-M7": "resolved",
    "n1": "resolved",
    "n2": "resolved",
    "n3": "resolved",
    "n4": "resolved",
    "n5": "resolved"
  },
  "new_critical_issues": [],
  "new_major_concerns": []
}
```

The sole condition (Minor, does not block): REQ T1b §残余风险登记表 could add "自定义头中非标准命名的凭据载体" to its漏检 enumeration for one-to-one correspondence with DESIGN's new `extra_headers` scan surface. This is a wording-precision improvement, not a requirement or architecture defect.
