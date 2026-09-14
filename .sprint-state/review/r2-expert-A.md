
> delphi-reviewer-architecture · g-deepseek-flash

I'll start by reading the review questionnaire and then the documents under review.
→ Read .sprint-state/review/r1-consensus.md
→ Read .sprint-state/review/r2-questionnaire.md
→ Read docs/issues/1-req-threat-model.md
→ Read docs/issues/2-design-v1.md
I'll now read the revised documents in parallel.
→ Read .sprint-state/decisions.md
→ Read docs/issues/4-test-validation.md
→ Read docs/issues/5-roadmap.md
→ Read docs/issues/3-reuse-list.md
I have the R1 consensus and DR-006~010. Now let me read the remaining documents.
→ Read architecture.yaml
✱ Grep "redact" in .
I have all primary documents. Let me check a few cross-cutting details for consistency: README already read, plus check for `redact` mentions, threshold consistency, and the architecture.yaml gateway layer (adapters not in gateway's allowed imports). Let me run targeted searches.
✱ Grep "ttft_delta|p95|p99|3ms|10ms|40ms|5ms|12ms|50ms" in docs
I have all the data needed. Now I'll write the Round 2 review.

Key findings for my review:

**Consistency checks done:**
- README line 42: `allow/warn/block（redact 属 v3）` — consistent with docs.
- `redact` consistently stated as v3 across REQ/DESIGN/ROADMAP/TEST/architecture.yaml. Good.
- G1 threshold: DESIGN says `p95<5ms 且 p99<12ms`; ROADMAP acceptance #6 says only `G1 ttft_delta p95 < 5ms` — drops p99<12ms. This is a new inter-doc inconsistency (承诺强度差异), but it's ROADMAP looser than DESIGN, minor-to-major. Actually per rule #2 "新引入的矛盾算 Critical"... but I should judge whether it's a real contradiction or just abbreviated summary. ROADMAP is declared "唯一权威清单". DESIGN declares thresholds "v1 冻结承诺值". So the authority doc omits p99. That's a genuine gate inconsistency. I'll flag as Major/Critical candidate. Let me be careful — the rule says new inconsistency = Critical. This is a genuine one: DESIGN §性能预算 (p99<12ms) vs ROADMAP 验收#6 (only p95<5ms). I'll call it Major-to-Critical. Given rule 2 is explicit, I should note it as a Critical. But is it "新引入"? In R1, DESIGN had no G1/G2/G3 table (it was added this round per修订记录). ROADMAP acceptance #6 also new. So yes, newly introduced. Per rule 2 → Critical.

- G3: DESIGN G3 = `egress-secret-scan 50ms/请求`. ROADMAP #4 mentions "G3 超时 → block" but doesn't state 50ms. Not necessarily contradiction.

- G2: DESIGN gives 3/10/40ms; ROADMAP says "按 body 分档达标" without numbers. Acceptable delegation.

- architecture.yaml: `gateway` allowed_imports = [shared, checkers, policy, evidence, gateway] — **adapters missing**. But DESIGN says gateway implements adapters (`接入适配器与受管配置清单` under the design doc), and gateway scans unit normalization. Also `cli` includes adapters. Is gateway supposed to import adapters? The adapters layer is separate; gateway is 反代核. The CLI is composition root. Possibly gateway doesn't need adapters — CLI wires them. Actually DESIGN component 1 反代核 doesn't mention adapters. The adapters are "接入适配器" used by doctor (CLI). So gateway not importing adapters could be intentional. But then who applies baseURL rewriting? The adapter writes config files, not runtime. So likely fine. I'll note as Minor (possible layering gap for adapter runtime use).

- P-11 门槛: TEST says 检出率 = 100% fixture 集内. ROADMAP #3 repeats. Consistent. Test's FP for 告警类 ≤2% but for `invisible-unicode-scan` — is it 告警类 or 阻断类? TEST §3 lists "告警类 checker（model-label-consistency / invisible-unicode-scan）FP ≤ 2%" but invisible-unicode-scan has action `block` (non-stream) / terminate (stream) per REQ mapping! So classifying `invisible-unicode-scan` as 告警类 while its action is block is a NEW CONTRADICTION. This is exactly the kind of inconsistency rule #2 targets. Let me verify: REQ §v1 内置策略映射 line 73: `invisible-unicode-scan` | 非流式 `block`；流式 `block`=终止流. TEST §3 line 97: 告警类 checker = model-label-consistency / invisible-unicode-scan, FP ≤2%. TEST §3 line 98: 阻断类 checker (egress-secret-scan) FP=0. So invisible-unicode-scan is mislabeled as 告警类 in TEST while it's block in REQ/DESIGN. This is a **Critical newly-introduced inconsistency** — actionable: block-class FP=0 must apply to invisible-unicode-scan, or explicitly state a 2% tolerance for a blocking checker which then contradicts "阻断误报直接破坏可用性". Two locations: REQ §v1 内置策略映射 (line 73) / DESIGN §组件2 & TEST §3 (line 97). Excellent find.

- README "model-label-consistency (T3a 子集)" consistent.

- P-22 runtime: README and DESIGN consistent.

- CLI: REQ? REQ doesn't list CLI. README, DESIGN, ROADMAP all 5 commands. Consistent.

- canary field null vs v1 no canary: consistent, flagged.

- P-03: doctor probe assertion (b) requires replaying a probe request per path and evidence. For OpenCode path, how does doctor send a "探测请求" through OpenCode's provider without a real API key/upstream? The ManagedConfigIds assertion is config-level; probe through the client is not executed by doctor (doctor cannot drive OpenCode). Re-reading ROADMAP 1(b): "对枚举内每条路径回放 ≥1 条探测请求" — who sends it? If doctor itself sends to gateway directly, that doesn't prove the *client* goes through gateway. This is a residual verifiability gap but somewhat bounded. I'll note as Major in new issues (or partially_resolved for P-03).

- P-02: DESIGN resolves via three gates + safety-class timeout=block. But note: G2 includes egress-secret-scan full scan with p95<3ms at 8KB while G3 timeout=50ms — consistent (timeout is upper bound, not target). Fine. However `egress-secret-scan` 50ms/请求 vs G2 ≤512KB p95<40ms — a 512KB body scan under 40ms with gitleaks regex patterns is plausible but the 50ms timeout with p95 40ms gives only ~10ms headroom, meaning a nontrivial fraction time out → block → usability. Not a contradiction, but a risk. Note Major.

- P-01: resolved via matrix + observables. But is it truly "resolved"? The fail-closed claim vs partial delivery: REQ is honest. The behavior matrix scenario 3 vs 4 distinction "命中发生在首字节转发前" — how does the gateway know a finding occurs "before first byte forward" in zero-buffer streaming? With zero buffer, the first chunk is forwarded immediately upon receipt, before the checker returns. So scenario 3 (命中在首字节转发前) is **practically unreachable** in a zero-buffer design for a finding in response body — the finding can only be known after the chunk arrives, and with zero buffer the chunk is already forwarded. Unless the checker runs synchronously before forwarding that chunk (which introduces at least one chunk of latency = buffer). This is a real architectural tension: zero-buffer + synchronous window checker per chunk means the checker must complete before forwarding that chunk → that IS a per-chunk buffer/latency. G1 p95<5ms implies a small per-chunk delay. So scenario 3 is reachable only if the blocking finding is in the first chunk and the checker completes before tee-forward of chunk 1; but then scenario 4's "已转发 N chunk" means N could be 0. The matrix is internally plausible but the naming "首字节转发前" vs implementation needs precision. This is a **Major** new concern: the interaction between zero-buffer tee and synchronous per-chunk checker is under-specified (is each chunk gated before forward, or forwarded then checked? If gated, G1 is the gate latency; if not gated, scenario 3 is impossible). Given G1 measures TTFT delta, the design must gate first chunk. But then it contradicts "客户端立即收字节" (zero buffer). Not necessarily a contradiction if latency is small, but the doc should state whether per-chunk head-of-line blocking exists. I'll flag Major.

- P-04: resolved — mock-upstream @v1, Delphi acceptance, etc.

- P-05: resolved — registration table exists and honest.

- P-08: field table now defined (contract #4). Resolved. But note the field table lists `canary: null` as required — fine.

- P-20: resolved via §脱敏与留痕范围. But `body_capture=full` default is metadata_only. However REQ registration table T1b says "命中与放行均落 evidence" and other rows say "response_body_ref 落盘可事后取证" / "`usage` 字段原样落 evidence". With `body_capture=metadata_only` default, the claim "response_body_ref 落盘可事后取证" is only true if full capture is enabled. **New inconsistency**: REQ 登记表 (T2a row: "`response_body_ref` 落盘可事后取证"; T1a row: "请求体摘要哈希") vs DESIGN §脱敏 default metadata_only + TEST contract #4 says `request_body_sha256`/`response_body_sha256` default hash only. The registration table's evidentiary claims implicitly assume body content on disk. This is a **Critical/Major over-promise** (rule #4: 登记表虚报). I'll call Major (arguably Critical as over-claim of v1取证能力). Location: REQ §v1 残余风险登记表 T2a/T2b rows vs DESIGN §脱敏与留痕范围 (line 99). Good find.

- P-07: verify in v1. resolved.

- P-14: G-LIC/G-FP resolved.

- P-16/P-17/P-18/P-19/P-21/P-22: resolved.

- P-06: resolved, but the invisible-unicode classification issue is adjacent.

- P-09/P-10: resolved (scan unit + rolling window). Note `sse_event` unit only extracts `choices[0].delta.content`/tool_calls arguments. `invisible-unicode-scan` scanning single chunk text with window. But the window type `ScanWindow` is per-checker; contract #2 signature `(window, chunk) => [result, window]`. OK.

- P-11: partially — the FP classification contradiction.

- P-12: resolved.

- P-15: resolved.

- P-13: resolved.

Now DR opinions:
- DR-006: agree (with note about scenario 3 precision).
- DR-007: agree.
- DR-008: conditional agree — probe assertion (b) actor unclear.
- DR-009: agree.
- DR-010: conditional agree — G2 numbers are unsourced ("承诺值而非实测值" self-admitted), G-BENCH gate mitigates partially. 512KB/40ms with gitleaks full scan is aggressive → risk of frequent timeout=block. Also 50ms timeout vs 40ms p95 leaves insufficient headroom. Conditional on G-BENCH producing evidence and a documented mid-build ADR path.

Now residual risk register虛報/漏報:
- 虚报: T2a "response_body_ref 落盘可事后取证" conflicts with metadata_only default. Also T2b same.
- P1 row claims `OPENCODE_MODELS_URL` lock "由 doctor --write-managed-config 负责写入" — but REQ mapping says `experimental.policies` write failure downgrades to warn, while P1 row treats model dir as a mitigation. Mild.
- 漏报: T3a listed as "部分（弱）" honest. Good.
- 漏报 possible: prompt/response header leakage, `extra_headers` may carry credentials — egress-secret-scan scans `extra_headers` per scan unit (request_body includes extra_headers). Good. But T1b "自写 token" acknowledged. OK.
- 漏报: no row for T2c normalization bypass? It's in the mitigation cell. OK.
- Register does not list "local evidence plaintext aggregation" (P-20) as a threat row — but DESIGN handles it. Minor: the risk register omits data-at-rest aggregation risk (T1b local). Could be minor.

Now let me decide verdict. I found at least one Critical newly introduced inconsistency (invisible-unicode-scan FP class: 告警类 vs block) and a possible Critical over-claim in the risk register (body_capture default vs 取证 claims). Plus G1 p99 omission. Per judgement rule 1, any Critical → REQUEST_CHANGES. Rule 2 says new inconsistency = Critical.

I'll be rigorous: the FP-classification one is unambiguous and material (block-class FP=0 vs 2% tolerance for a blocking checker). That's Critical. So verdict = REQUEST_CHANGES.

Let me write the output now. Need all 22 resolutions in JSON.

For levels: 原/现. Let me map original levels from table: P-01..P-07 Critical; P-08..P-15 Major; P-16..P-22 Minor. Current: after resolution.

Let me finalize table with resolutions:
- P-01 Critical → partially_resolved (matrix good, but scenario 3/zero-buffer+sync checker per-chunk semantics under-specified)
- P-02 Critical → resolved
- P-03 Critical → partially_resolved (probe actor/feasibility)
- P-04 Critical → resolved
- P-05 Critical → resolved (register exists) — but original level Critical? Table says P-05 Critical. Yes.
- P-06 Critical → partially_resolved (redact/verdict split done; but invisible-unicode FP class new inconsistency re-introduces action/verdict confusion at TEST level) — actually that's a new issue; still P-06's core is resolved. I'll say resolved, and put new issue separately. Hmm. To be fair: P-06 was about term mixing; that's fixed. I'll mark resolved.
- P-07 Critical → resolved
- P-08 Major → resolved
- P-09 Major → resolved
- P-10 Major → resolved
- P-11 Major → partially_resolved (FP classification contradiction)
- P-12 Major → resolved
- P-13 Major → resolved
- P-14 Major → resolved
- P-15 Major → resolved
- P-16 Minor → resolved
- P-17 Minor → resolved
- P-18 Minor → resolved
- P-19 Minor → resolved
- P-20 Minor → partially_resolved (default metadata_only conflicts with register's取证 claims)
- P-21 Minor → resolved
- P-22 Minor → resolved

ADR opinions:
- DR-006 conditional (zero-buffer chosen sound, but scenario 3 unreachable unless per-chunk gating, which needs explicit statement)
- DR-007 agree
- DR-008 conditional
- DR-009 agree
- DR-010 conditional

expert_id: A (架构视角). The panel config: A=架构视角(g-deepseek-flash). My model is g-deepseek-flash, so expert A.

Critical issues (new/unresolved):
1. invisible-unicode-scan FP 分类矛盾 (TEST §3 line 97 vs REQ §v1内置策略映射 line 73 / DESIGN §组件2).
2. REQ 登记表取证承诺 vs DESIGN metadata_only 默认 (REQ T2a/T2b rows vs DESIGN §脱敏 line 99 / TEST 契约#4).
3. G1 p99<12ms (DESIGN §性能预算) 未进 ROADMAP 验收#6 (权威清单) — 门槛强度不一致.

Actually #3: ROADMAP is 权威清单, DESIGN says "G1/G2 阈值为 v1 冻结承诺值". ROADMAP omits p99. Is this "矛盾"? It's an omission causing 承诺强度不一致. I'll classify Major rather than Critical to be calibrated; rule 2 says 门槛不一致 = Critical. Hmm. The rule explicitly lists "门槛" inconsistencies as Critical. I'll put it as Critical to comply with the stated hard rules? Let me be principled: it is a genuine 门槛 inconsistency between two docs. Rule 2 → Critical. But I could also argue ROADMAP abbreviation "p95<5ms" is not a contradiction since it doesn't deny p99. A false positive Critical would be bad. I'll list it as Major with clear reasoning, and keep Critical for the two unambiguous ones. Actually the rule is a hard constraint given to me. But it says "若...造成新的不一致（术语、期次、门槛、承诺强度）". The p99 omission is 承诺强度不一致 in the authority doc. I'll call it Critical to be safe with rule compliance, noting it's borderline. Hmm, but over-firing Critical could be seen as uncalibrated. 

Decision: I'll list two Critical (the two unambiguous ones) and put G1 p99 as Major, explicitly noting it's rule-2-adjacent. Actually, re-reading rule 2: it says "新引入的矛盾算 Critical". A contradicting pair must exist. DESIGN p99<12ms and ROADMAP silence is not a contradiction (silence ≠ contradiction), it's an omission. So Major is defensible and better calibrated. I'll go with Major.

Wait — but is there another genuine新矛盾 I should double check? The invisible-unicode one is the strongest. Let me also verify Test line 97 wording: "告警类 checker（`model-label-consistency` / `invisible-unicode-scan`）FP ≤ 2%". Yes explicit. And REQ mapping says invisible-unicode non-stream block. Contradiction: a checker whose action is block is classified as告警类 with 2% FP tolerance, while TEST line 98 states block-class FP must be 0 "because block FP destroys usability". Two locations ⇒ Critical. 

Also check: TEST fixture example `expected.action: warn` for T3a — consistent. Fine.

Another possible new contradiction: README architecture diagram still shows `[checker 注册表 verdict] → [策略引擎 action: allow/warn/block（redact 属 v3）]`. README CLI says doctor has "--write-managed-config" and "CA 信任检查项 v1 输出 not-applicable@v1". DESIGN says v1 not in doctor checks. README says doctor outputs not-applicable@v1 rather than pass — is that "in doctor check item"? DESIGN §接入 says "v1 不实现、不监听、不在 doctor 检查项内（避免检查项空转）". README says doctor outputs `not-applicable@v1`. Slight tension: including it as a not-applicable output vs not in check list. Minor at most. I'll note Minor.

Also: README says "v1 冻结为 5 个命令" and lists doctor responsibilities including "受管配置枚举的覆写/漂移断言 + 端口连通 + --write-managed-config". ROADMAP #1(a) says doctor asserts endpoint==gateway. Consistent.

Another: DESIGN line 32 & 50 say egress-secret-scan timeout=block. ROADMAP #4 includes G3 timeout→block case. Consistent.

One more: TEST §3 says 检出率 100% "逐条期望匹配,零漏报,无例外". ROADMAP #3 repeats. Good.

Now residual risk register虚报: the T2a/T2b "response_body_ref 落盘可事后取证" vs metadata_only default. Also T1a "请求体摘要哈希（可对账发过什么）" — with metadata_only, hash is stored, so that's true. T4x "usage/cache 字段原样落 evidence" — contract #4 has usage optional and always stored (metadata), true even in metadata_only. So T4x claim OK. T2a "response_body_ref 落盘" — with metadata_only, no body ref to plaintext; hash only. So "可事后取证" is overstated. That's the虚报. Also missing: register has no row for the local-at-rest plaintext aggregation risk (T1b local clustering) that P-20 raised — DESIGN addresses via default metadata_only, but register doesn't list it as a row. Minor漏报.

Let me now write it. Keep it structured, Chinese, no large quotes.

Confidence: 7.

Let me write.## 独立评审 - Round 2（角色 A · 架构视角）

### 一、逐条处置裁定

| 问题ID | 级别(原/现) | 裁定 | 依据（文件+章节） | 若不成立，最小修复动作 |
|---|---|---|---|---|
| P-01 | Critical/Critical | partially_resolved | REQ §行为矩阵（场景1-4+明文承诺）；TEST 契约#3 `expected.observables` | 需补一句实现级口径：零缓冲 tee 下"场景3=命中在首字节转发前"是否要求**首块先过同步 checker 再 tee**（即存在每块 head-of-line 门）。否则场景3 在实现上不可达，矩阵只覆盖场景2/4 |
| P-02 | Critical/— | resolved | DESIGN §性能预算与降级规则（三台门+安全类超时=block）；TEST §5 测量协议；ROADMAP 验收#6 | — |
| P-03 | Critical/Major | partially_resolved | ROADMAP 验收#1(a)(b)(c)；DESIGN §接入适配器 `MANAGED_CONFIG_IDS` | 1(b)"回放探测请求"未指定**执行主体**：doctor 自身直连网关 ≠ 证明 OpenCode/Delphi 走网关。需写明探测由适配器驱动对应客户端进程，或把 1(b) 降为"网关侧收到带该 client 标记的请求"并在验收中标注其局限 |
| P-04 | Critical/— | resolved | ROADMAP v1 交付（mock-upstream/verify/封闭枚举）；TEST §2/§4 | — |
| P-05 | Critical/— | resolved | REQ §v1 残余风险登记表（冻结件）；README 不能做什么 | —（表本身存在；其虚报项见 §三/§四） |
| P-06 | Critical/— | resolved | REQ §术语定案；TEST 契约#2/#3；architecture.yaml checkers/policy 注释 | —（术语两层已彻底分离，`redact` 独立声明） |
| P-07 | Critical/— | resolved | REQ §evidence 信任边界；DESIGN 组件4；ROADMAP 验收#5 | — |
| P-08 | Major/— | resolved | TEST 契约#4（v1 冻结字段表 + `evidence_version:1`） | — |
| P-09 | Major/— | resolved | DESIGN §扫描单元定义；TEST 契约#2 ScanUnit | — |
| P-10 | Major/— | resolved | DESIGN §组件2 滚动窗口；TEST 契约#3 跨 chunk 强制 | — |
| P-11 | Major/Major | partially_resolved | TEST §3 门槛；ROADMAP 验收#3 | FP 分类自相矛盾：`invisible-unicode-scan` 在 TEST §3 被判为"告警类 FP≤2%"，但其动作为 `block`。须改成"阻断类 FP=0"或显式给出该 checker 的独立宽容度（见 §三-C1） |
| P-12 | Major/— | resolved | REQ 登记表 T3a 行；DESIGN 组件2；REUSE 指纹行标 v2 | — |
| P-13 | Major/— | resolved | ROADMAP 验收#2；TEST §4 Delphi 行 | — |
| P-14 | Major/— | resolved | REUSE 表格三列 + G-LIC/G-FP；ROADMAP 前置门 | — |
| P-15 | Major/— | resolved | REQ §目标#1；ROADMAP 验收#1(c) | — |
| P-16 | Minor/— | resolved | TEST 五件套逐项 `@v1/@v2/@v3`；ROADMAP 分期纪律 | — |
| P-17 | Minor/— | resolved | README 架构图；DESIGN 期次标注；CLI 三处一致（5 命令） | — |
| P-18 | Minor/— | resolved | REQ 登记表 P2 行；DESIGN §接入（不在 doctor 检查项内） | —（README 仍写 doctor 输出 `not-applicable@v1`，与"不在检查项内"措辞有轻微张力，列入 Minor） |
| P-19 | Minor/— | resolved | REQ §evidence 信任边界（单写者/fsync/末行半行） | — |
| P-20 | Minor/Minor | partially_resolved | DESIGN §脱敏与留痕范围（默认 `metadata_only`）；TEST 契约#4 哈希字段 | 默认不存明文的决策正确，但与 REQ 登记表 T2a/T2b 行的"`response_body_ref` 落盘可事后取证"承诺冲突（见 §三-C2） |
| P-21 | Minor/— | resolved | DESIGN §接入适配器（写入责任方=网关）；README doctor `--write-managed-config` | — |
| P-22 | Minor/— | resolved | README §分发/runtime；DESIGN §关键决策 | — |

**统计**：resolved 17 / partially_resolved 5 / unresolved 0。P-01~P-07 全部由 Critical 降为已处置或部分处置，无悬空 Critical。

### 二、DR-006 ~ DR-010 独立意见

**DR-006 零缓冲 + 终止流 — 有条件同意。**
取舍方向我同意（性能即安全属性的论证成立，1-chunk 缓冲换真阻断的代价在本项目威胁模型下确实更高）。但"可实现吗"这一问有硬缺口：**零缓冲 tee 与"每块同步 checker"在物理上不能同时为真**。若块在 checker 返回前已 tee 出去，则命中永远晚于该块（场景3 不可达）；若 checker 先于 tee 返回，则每块都有 head-of-line 门，G1 的 p95<5ms 就是这道门的延迟预算。文档目前两种读法都容得下，这使场景3 vs 场景4 的边界不可判定。**条件**：在 DESIGN 明写"第 N 块在进入 checker 窗口前不 tee"（则 G1 即门延迟），并据此把场景3 删除或改为"首块命中且门未通过"。

**DR-007 术语两层分离 — 同意。** 这是本轮质量最高的一处修订，verdict/action 在 REQ/TEST/DESIGN/architecture.yaml 四处已完全对齐，`expected.verdict`+`expected.action` 双断言可机器执行。

**DR-008 受管配置封闭枚举 — 有条件同意。** 把不可证伪全称命题改成可枚举断言的思路正确。**条件**：验收#1(b) 的探测执行主体必须确定（doctor 自探是循环论证：它验证的是网关自己能过闸，不是客户端确实走网关）。最小可行形式 = 探测由适配器改写后的客户端配置触发，或 1(b) 显式降级为"网关侧观测到 client 标记"并接受其证明力上限。

**DR-009 mock-upstream 进 v1 / evil-relay 归 v2 — 同意。** 控制 chunk 边界这一粒度需求只有自建 mock 能满足，且顺带把 Python 逐出 v1 CI（与 DR-001/REUSE 一致）。

**DR-010 G2 分档阈值 3/10/40ms — 有条件同意，且数字依据薄弱。**
可实现的乐观面成立：本地 loopback、纯 TS 正则扫描，8KB 请求扫 3ms p95 并非不可能。但两处需要修：
1. **G2 与 G3 的余量结构不健康**：≤512KB 档 p95 目标 40ms，而 `egress-secret-scan` 超时上限 50ms。p95 与 timeout 只差 10ms，意味着分布右尾有可观比例触顶 → `verdict=error` → `block`。对一个"阻断类 FP=0"的 checker，这会以**超时而非误报**的方式制造大量线上阻断。建议 timeout 与 p95 目标至少留 3-5× 余量，或对 >64KB body 改走分片扫描。
2. **数字无实证来源**：DR-010 自认"承诺值而非实测值"，G-BENCH 门只兜住"超阈值需 ADR"，没兜住"阈值定得没有工程依据"。**条件**：G-BENCH 关闭时必须附骨架实测与阈值推导（而非仅"未超标"），并把该 ADR 作为 v1 冻结件之一。

### 三、新引入的问题

**C1（Critical）— `invisible-unicode-scan` 的 FP 分级自相矛盾。**
- 位置一：`docs/issues/4-test-validation.md` §3 误报矩阵（"告警类 checker（`model-label-consistency` / `invisible-unicode-scan`）FP ≤ 2%"）。
- 位置二：`docs/issues/1-req-threat-model.md` §v1 内置策略映射（`invisible-unicode-scan` 非流式 `block`、流式 `block`=终止流）；`docs/issues/2-design-v1.md` 组件2 同。
- 为何是问题：该 checker 的 action 是 `block`，却不适用"阻断类 FP=0"。TEST 自己写的"阻断误报直接破坏可用性"被同节推翻。这会让 CI 接受一个 2% 概率对正常文本终止流的实现——正是本项目最不可接受的失效模式。属判据2（新引入矛盾，门槛/承诺强度）与判据3/4 交叉。
- 可判定解决标准：TEST §3 把 `invisible-unicode-scan` 移入阻断类（FP=0），并保留"零宽字符出现即命中"的明确定义；若担心不可见字符的正常用法，则以显式白名单（逐条裁决+来源）而非百分比容忍处理。

**C2（Critical）— 残余风险登记表的取证承诺与默认脱敏策略冲突（过度承诺）。**
- 位置一：`docs/issues/1-req-threat-model.md` §v1 残余风险登记表 T2a/T2b 行（"`response_body_ref` 落盘可事后取证"）。
- 位置二：`docs/issues/2-design-v1.md` §脱敏与留痕范围（evidence 默认 `body_capture=metadata_only`，"**不默认存明文 body**"，仅存 `sha256(body)`）。
- 为何是问题：默认配置下磁盘上**没有** body 可达，仅哈希不可用于"事后取证恶意内容"。登记表作为 v1 冻结件向部署者承诺了一项默认关掉的能力，等于虚报 v1 取证面；这与判据4（过度承诺）一致。
- 可判定解决标准：登记表 T2a/T2b 行的取证列改为"默认仅哈希（`response_body_sha256`），明文取证需显式开启 `body_capture=full`"；或在 T2a/T2b 行标注"取证需 full 模式，默认模型不可用"。

**M1（Major）— G1 的 p99<12ms 未进入权威验收清单。**
- 位置一：`docs/issues/2-design-v1.md` §性能预算（G1 = `p95 < 5ms 且 p99 < 12ms`，并声明"G1/G2 阈值为 v1 冻结承诺值"）。
- 位置二：`docs/issues/5-roadmap.md` 验收#6（仅"G1 `ttft_delta` p95 < 5ms"，p99 缺失），而 ROADMAP 自述为"v1 验收条目的唯一权威清单"。
- 为何是问题：权威清单比设计少一条冻结阈值，BUILD 期按 ROADMAP 执行就会默认丢掉 p99 门；这正是 R1 P-04"两处口径漂移"的同类复发（程度较轻，因只是省略而非反向）。
- 可判定解决标准：ROADMAP 验收#6 补齐 `p99 < 12ms`，或将 DESIGN 的 p99 显式标为"非验收门、仅观测上报"。

**M2（Major）— 零缓冲 tee 与同步窗口 checker 的阻塞语义未定义（与 P-01 同源但属新引入的实现级缺口）。**
- 位置一：`docs/issues/2-design-v1.md` 组件1（"SSE 流式 tee（零缓冲——客户端立即收字节）"）。
- 位置二：`docs/issues/4-test-validation.md` 契约#2 流式签名 `(window, chunk) => [result, window]` + §5 G1 门。
- 为何是问题：契约要求每块归约出 verdict，行为矩阵假设"命中可发生在首字节前"，而 G1 又要求 tee 零延迟。三者不能同时成立而不指定块级门的存在。缺此定义，场景3/4 的验收不可复现，`delivered_chunks: N` 的期望值在测试中无法推算。
- 可判定解决标准：DESIGN 增一句"每个 `sse_event` 先过同步 checker 窗口，通过后才 tee；未通过则不发该块"（并据此把 G1 定义为该门延迟），或反向声明"每块立即 tee、checker 结果只对**后续**块生效"，据此删除场景3。

**M3（Major）— `egress-secret-scan` 的 G2 目标与 G3 超时余量过窄。**
- 位置一：`docs/issues/2-design-v1.md` §性能预算（G2 ≤512KB p95<40ms；G3 50ms/请求）。
- 位置二：`docs/issues/5-roadmap.md` 验收#4（"G3 超时 → `block` 用例"）。
- 为何是问题：p95 40ms 与硬超时 50ms 之间仅 10ms，正常负载即可把可观比例请求推入 `error→block`，与"阻断类 FP=0"的可用性目标直接冲突（用超时代替误报）。
- 可判定解决标准：给出两者的余量规则（如 timeout ≥ 3×p95 档位目标），或对 >64KB body 定义分片扫描并在 TEST 中加对应 fixture。

**m1（Minor）— README 与 DESIGN 对 doctor/CA 项的措辞张力。**
- 位置一：`README.md` CLI 段（doctor "的 CA 信任检查项…v1 输出 `not-applicable@v1`"）。
- 位置二：`docs/issues/2-design-v1.md` §接入期次标注（TLS "不在 doctor 检查项内"）。
- 为何是问题：一处说"作为检查项输出 not-applicable"，一处说"不是检查项"。不构成实质矛盾但在 BUILD 期会导致 doctor 输出契约歧义。
- 可判定解决标准：统一为"`doctor` 输出含固定 `not-applicable@v1` 占位项，但该项不计入 PASS/FAIL 判定"。

**m2（Minor）— architecture.yaml 未声明 gateway 与 adapters 的依赖关系。**
- 位置一：`architecture.yaml` gateway 层 `allowed_imports: [shared, checkers, policy, evidence, gateway]`（无 `adapters`）。
- 位置二：`docs/issues/2-design-v1.md` §接入适配器与受管配置清单（适配器负责配置写入，doctor 遍历）。
- 为何是问题：若配置写入/漂移检测由 CLI 直接调用 adapters，则现契约自洽；但文档未点明"gateway 不依赖 adapters"，BUILD 期若在反代核内做配置注入就会撞上 import 断言。
- 可判定解决标准：在 architecture.yaml 注释中写明 gateway 不 import adapters、adapters 仅由 cli（组合根）编排；或把 adapters 加入 gateway 允许清单并说明用途。

### 四、剩余风险与 v2/v3 边界

**虚报（把未做的写成做了）：**
- 登记表 T2a/T2b 行"`response_body_ref` 落盘可事后取证"——默认 `metadata_only` 下不成立（即 §三-C2）。这是本表唯一实质性虚报。
- T1b 行"命中与放行均落 evidence"——在默认模型下仅落哈希与裁决，属实；但该行未标注"命中样本默认不留明文"，读者易高估取证能力，建议补一句限定。

**漏报（把已做的写成未做/该登未登）：**
- 登记表缺一行"evidence 本地明文聚集风险"（原 P-20 的本地 T1b 变体）。DESIGN §脱敏给出默认缓解，但风险表未登记，违反"缺风险登记=以为被保护"的立表示例。
- 登记表缺"流式已转发字节内嵌恶意内容的残留暴露"独立行：场景4 明文承诺已写，但威胁矩阵只在 T2a 行提了一句，读者按威胁编号查表会漏掉 T2c 的同类残留。
- T2c 行称归一化同形与 PUA 变体不覆盖——诚实，无漏报。

**期次边界：** 各文档对 v1/v2/v3 的归属整体一致（`redact`=v3、指纹/金丝雀/evil-relay=v2、审计缺口/TLS=v3），未发现期次错配。

### 五、总体判断

本轮修订方向正确且力度大：术语两层分离、残余风险登记表、量化门槛、三台性能门、受管配置枚举，把 R1 的七条 Critical 全部从"未处理"推进到"已处理或仅剩边界条件"，是一份合格的修订。但**尚不足以直接冻结 v1**：新引入的 `invisible-unicode-scan` FP 分级矛盾（一个 `block` 类 checker 被允许 2% 误报）实质削弱了"fail-closed 阻断"这一立项主张，且登记表存在一处默认配置下不成立的取证承诺。这两条都是可低成本修复的，修完（含 M1/M2/M3 的门槛补齐与零缓冲阻塞语义定案）我预期可给出 `APPROVED_WITH_CONDITIONS`。当前按硬判据（存在 Critical）裁决为 `REQUEST_CHANGES`。

### 六、JSON 结论块

```json
{
  "expert_id": "A",
  "round": 2,
  "mode": "design",
  "verdict": "REQUEST_CHANGES",
  "confidence": 7,
  "resolutions": {
    "P-01": "partially_resolved",
    "P-02": "resolved",
    "P-03": "partially_resolved",
    "P-04": "resolved",
    "P-05": "resolved",
    "P-06": "resolved",
    "P-07": "resolved",
    "P-08": "resolved",
    "P-09": "resolved",
    "P-10": "resolved",
    "P-11": "partially_resolved",
    "P-12": "resolved",
    "P-13": "resolved",
    "P-14": "resolved",
    "P-15": "resolved",
    "P-16": "resolved",
    "P-17": "resolved",
    "P-18": "resolved",
    "P-19": "resolved",
    "P-20": "partially_resolved",
    "P-21": "resolved",
    "P-22": "resolved"
  },
  "adr_opinions": {
    "DR-006": "conditional",
    "DR-007": "agree",
    "DR-008": "conditional",
    "DR-009": "agree",
    "DR-010": "conditional"
  },
  "critical_issues": [
    "C1 TEST §3 把 invisible-unicode-scan 列为'告警类 FP≤2%'，但其 action 为 block（REQ §v1 内置策略映射 / DESIGN 组件2）——阻断类 checker 的零误报门槛被同节自我推翻",
    "C2 REQ §v1 残余风险登记表 T2a/T2b 行承诺'response_body_ref 落盘可事后取证'，与 DESIGN §脱敏与留痕范围默认 body_capture=metadata_only（仅哈希）冲突——默认配置下该取证能力不存在，属过度承诺"
  ],
  "major_concerns": [
    "M1 G1 的 p99<12ms 仅在 DESIGN §性能预算，未进入自述为唯一权威的 ROADMAP 验收#6，冻结门槛两处不一致",
    "M2 零缓冲 tee（DESIGN 组件1）与流式同步窗口 checker（TEST 契约#2）的块级阻塞语义未定义，导致行为矩阵场景3/4 边界与 delivered_chunks 期望值不可判定",
    "M3 G2 ≤512KB p95<40ms 与 G3 timeout 50ms 余量仅 10ms，正常负载即以超时→block 方式制造线上阻断，与阻断类零误报目标冲突",
    "P-03/DR-008 的探测过闸断言执行主体未指定，doctor 自探构成循环论证",
    "P-01/DR-006 场景3（命中在首字节转发前）在零缓冲实现下可达性未定义"
  ],
  "minor_concerns": [
    "m1 README 称 doctor 输出 CA 项 not-applicable@v1，DESIGN 称 TLS 不在 doctor 检查项内，输出契约措辞歧义",
    "m2 architecture.yaml gateway 未声明不依赖 adapters，BUILD 期配置注入实现可能撞 import 断言",
    "登记表缺'evidence 本地明文聚集风险'与'流式残留暴露'两行，查表式读者会漏",
    "T1b 行未标注命中样本默认不留明文，读者易高估取证能力"
  ]
}
```
