
> delphi-reviewer-technical · g-glm-5.3-flash

→ Read .sprint-state/review/r3-questionnaire.md
→ Read .sprint-state/review/r2-consensus.md
→ Read docs/issues/1-req-threat-model.md
→ Read docs/issues/2-design-v1.md
→ Read docs/issues/4-test-validation.md
→ Read docs/issues/5-roadmap.md
→ Read README.md
→ Read architecture.yaml
✱ Grep "partial_response_delivered|codepoint|terminated_stream|pending_bytes|response_body_ref" in .
✱ Grep "veto-mid-stream" in .
✱ Grep "p99|delivered_chunks" in .
已完整读取评审卷与 R2 共识。现对关键修复点做全文交叉验证（残留术语、字段唯一性、数值口径），并核实修订提交。

$ git log --oneline -5 && git show --stat --oneline 9af9633 | Select-Object -First 20
9af9633 docs(design): resolve R2 delphi-review findings (2 Critical + 7 Major + 5 Minor)
2545042 docs(design): resolve all R1 delphi-review critical/major findings
8131109 chore(sprint): phase 1 PREP - dev env initialized, sizing=complex, decisions DR-001..004
223b5bd chore: initialize dev environment (Bun + TS + vitest scaffold, arch gates, import issues #1-#5 as docs)
9af9633 docs(design): resolve R2 delphi-review findings (2 Critical + 7 Major + 5 Minor)
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

三份交叉验证全部完成：残留术语零命中、`veto-mid-stream` 三处登记已核对、G1 p99 双文档等价已确认、commit 9af9633 确实触及全部 6 份冻结件。以下为独立评审意见。

---

# Delphi Round 3 聚焦复审 — 独立评审意见（专家 B / 技术）

**评审人立场声明**：本轮为收敛性复审，仅裁定 R2 的 14 项处置 + 修复引入检查，不重开 R1/R2 已闭合条款。全部证据基于当前工作区文件逐行核对，非凭 R2 记忆复判。

## 一、逐项裁定表

| ID | 裁定 | 证据位置（文件+章节） | 备注 / 最小修复动作 |
|---|---|---|---|
| **N2-C1** | ✅ **resolved** | REQ §v1 内置策略映射（1-req L73：非流式 `block`/流式终止流）；TEST §3 误报矩阵（4-test L98-99：阻断类 = `egress-secret-scan` / `invisible-unicode-scan`，FP=0，且明注“二者 v1 策略映射均为 action=block”，告警类仅剩 model-label-consistency）；ROADMAP 验收3（5-roadmap L42：阻断类 FP=0）；DESIGN 组件2 按其文件头声明“action 语义以 REQ 为唯一权威”不重复定义（2-design L4），无冲突表述 | 四处口径已单义。极小瑕疵：ROADMAP 交付清单 L17 对 invisible-unicode-scan 的括注是“跨 chunk 窗口”（实现描述而非 action 标签），不构成矛盾，无需动作 |
| **N2-C2** | ✅ **resolved** | REQ 登记表：T2a（L114：`response_body_sha256`，明文留存仅当 `body_capture≠metadata_only`，默认无明文）、T2b（L115 同上）、T1a（L112：仅证明发过字节序列）、T1b（L113：明文受 body_capture 约束）、T2c（L116 同）、P1（L122：快照哈希“不入 evidence 链；@v2 计划登记”）、T4x（L121：仅取证不判定）逐行核对，全部诚实；契约#4（4-test L69）哈希字段默认仅哈希与之对齐 | 全表扫描仅剩一处残留弱声明：**P2 行取证列“doctor 输出落 evidence”** 在 DESIGN 组件5 四项封闭枚举与 TEST §4 E2E（doctor 断言落点是 FAIL 输出+条目 id，非 evidence 记录）中均无载体，且与 P1“不入 evidence 链”形成张力。属 R1 遗留措辞、非本轮修复引入、不构成虚报安全能力 → 记 Minor，建议下次触碰登记表时改为“doctor 结果输出至 CLI（exit code + 条目 id）”或正式登记 doctor→evidence 写入字段 |
| **N2-M1** | ✅ **resolved** | REQ 行为矩阵场景4（L82 warn 列 `response_delivered.partial=true`、block 列 `response_delivered:{partial:true,delivered_chunks:N}`）；契约#4（4-test L67）；TEST E2E 流式阻断行（L112） | 全库 grep `partial_response_delivered` **零命中**；契约#4 字段名全文唯一 |
| **N2-M2** | ✅ **resolved** | DESIGN §关键决策“块级阻塞语义定案”（2-design L93-96）：同 tick 先扫描后 tee、非整段缓冲、场景3 可达⟺chunk 1 命中且 tee 前返回 → `delivered_chunks=0` 等同场景2、场景4 N≥1 定义、fixture 断言兼作“异步化探测器” | 与 G1 口径自洽：G1（L77）定义首字节增量，首字节恰是第一道 per-chunk 门，关键决策 L93“G1 度量的正是这道 per-chunk 门的增量”在首字节处与表格定义重合；REQ 场景3/4（L81-82）与 TEST E2E“前 N-1 chunk 已送达”（N=命中 chunk 序号）与 DESIGN“已转发 N chunk 后命中→delivered_chunks=N”（N=已送达计数）两套 N 语义各自内洽、无矛盾 |
| **N2-M3** | ✅ **resolved** | DESIGN G3 分档（L79：8KB→20/64KB→50/512KB→120ms，每档 ≥ G2 p95 的 3 倍——3×3=9≤20、3×10=30≤50、3×40=120=120 ✓）；交叠口径（L86：G2=统计门不计单笔、G3=单笔硬超时，[G2 p95, G3) 区间=回退信号但放行）；慢环境登记 + G-BENCH p99 约束（L87：`p99_scan < G3×0.6`，违者 ADR 上调） | 陷阱消除（余量 10ms→80ms）；TEST §5 仅引用 G3 不复述数值（L120）、测量协议 n=200/档 + p99（L125）可支撑；ROADMAP 验收6 引用 DESIGN 慢环境条（L45）一致。旧"50ms"数值全库无残留 |
| **N2-M4** | ✅ **resolved** | DESIGN §扫描单元定义（2-design L47）：`extra_headers` = 排除认证类头后的自定义头集合，排除清单明确枚举（Authorization / x-api-key / api-key / x-goog-api-key / Proxy-Authorization / Cookie）并写明理由；TEST §3 强制 benign 子集（4-test L100：≥1 条带标准认证头的 benign 请求断言 FP=0，“若实现未排除认证头，本条必然 FAIL”——回归锁） | 新缺口检查：排除仅限枚举的**标准认证头**，自定义头仍在扫描单元内 → 凭据藏于自定义头**仍会被扫**，不存在新漏检面；与 REQ T1b 边界（L113“仅覆盖模式化密钥；自写 token…漏检”）正交且一致——标准认证头的值是部署者合法出站凭据，本就不可阻断。诚实登记充分 |
| **N2-M5** | ✅ **resolved** | TEST 契约#3 fixture（4-test L43-46）：evidence 键仅 `findings{checker,threat,verdict,rule_id}`（契约#4 L64 已登记的子集）+ `response_delivered{partial,delivered_chunks}`（L67 已登记）；流式 observables（L49）三键均可回溯：`terminated_after_delivery`←action_taken 枚举值（L65）、`delivered_chunks`←契约#4/Error 事件载荷、`error_event_code`←DESIGN 组件1 | grep `codepoint`/`terminated_stream` **零命中**；REQ T2c 的“码点”仅作中文散文解释 offsets 派生规则（L116），非字段名 |
| **N2-M6** | ✅ **resolved** | TEST §4 E2E 表新增“受管枚举探测过闸”行（4-test L115）：harness 遍历 `MANAGED_CONFIG_IDS`、逐路径 ≥1 条探测请求经 mock-upstream、断言 evidence 出现 `client`+`provider_id` 记录（时间窗口内）、任一路径无记录→FAIL；且括注“探测由测试 harness 经该客户端适配器发起，**非 doctor 自查**” | 断言可判定（evidence 记录存在性 + FAIL 条件），发起者单义；与 ROADMAP 验收1(b)（L39）措辞一致，与 DESIGN 组件5 doctor 职责（仅漂移断言）不越界 |
| **N2-M7** | ✅ **resolved** | ROADMAP 验收6（5-roadmap L45：**p95 < 5ms 且 p99 < 12ms**，“两值同为验收门”）＝ DESIGN G1（2-design L77）逐字等价 | 两文档 G1 承诺等价，权威清单补全 |
| **n1** | ✅ **resolved** | DESIGN 组件5（2-design L37）：doctor v1 检查项 = 冻结封闭枚举四项，**“本清单为唯一权威，README 引用之”**，TLS/CA 项“v1 直接不注册”；README（L82）：封闭枚举 + 权威清单见 DESIGN §组件 5 + “v1 不注册该检查项（不放恒空的检查项）” | CA 项单义：**不在 v1 检查集**。极小瑕疵：README L78 CLI 注释列了四项中的三项（省略“evidence 链可验证”），紧邻 L82 散文已列全并指到权威来源 → 缩写非否认，无需动作 |
| **n2** | ✅ **resolved** | TEST 契约#4 `action_taken` 枚举（4-test L65）：`degraded_observational` 标“末值 **@v2 起可达**：v1 无观测类 checker，verify schema 须允许该枚举但 v1 fixture 不覆盖”；与 DESIGN 降级规则（2-design L84“v1 = 无”）互证 | 清晰 |
| **n3** | ✅ **resolved** | DESIGN 组件1（2-design L28）：补齐 SSE error 事件冻结规格（`event: error` + code + delivered_chunks）并与 evidence 侧 `action_taken=terminated_after_delivery` 对应；REQ 场景4、TEST observables 三处闭环 | 对外契约完整。**但修复本身引入一处 Minor 形状漂移，见第二节第 1 条** |
| **n4** | ✅ **resolved** | DESIGN 扫描单元（2-design L51：`pendingBytes`，“字段名对齐 TEST 契约 #2 `ScanWindow.pendingBytes`”）；TEST 契约#2（4-test L22） | grep `pending_bytes` **零命中**，全文 camelCase 唯一 |
| **n5** | ✅ **resolved** | REQ T1a 取证列（L112）：“`request_body_sha256`（仅证明发过该字节序列；默认 `metadata_only` 无原文不可读，亦无法证明‘对方是否留存’）” | 与 R2 处置决议措辞一致，无夸大 |

**小结：14/14 resolved，无 unresolved / partially_resolved。**

## 二、修复引入检查

**1. G3 分档 vs TEST §5 / ROADMAP 验收4/6 — 无新矛盾。** G3 数值（20/50/120）仅存于 DESIGN 单一来源，TEST §5 与 ROADMAP 验收4 只引用行为（“超时→block”）不复述数值，无漂移面；ROADMAP 验收6 的 G2 分档（3/10/40ms p95）与 DESIGN 逐值相等；G-BENCH p99 要求在 DESIGN L87 与 ROADMAP L45 双向呼应，且 TEST §5 测量协议（n=200/档、报 p99）使其可执行。

**2. 认证头排除 vs REQ T1b 边界 — 一致。** 排除清单只覆盖枚举的标准认证头，`extra_headers` 定义保证了**自定义头仍在扫描单元内**，故“排除标准认证头 ≠ 排除所有凭据载体”成立；T1b 行的能力边界声明（模式化密钥、自写 token 漏检）针对请求体/自定义头模式覆盖面，与该排除正交，无缩窄、无虚报。

**3. P3 行 vs DESIGN §脱敏 / README — 一致。** P3（缓解手段自身派生面、`body_capture` 默认 metadata_only、v1 无静态加密、v2 计划）与 DESIGN §脱敏（L106 开关三态、L110 `full` 模式“等同在本地重建中转站暴露面，责任在用户”）及 README（不提供清单 + “装上网关 ≠ 已被保护” + 信任边界原样声明“链只防意外损坏与廉价篡改，不抵抗本机同权限对手整链重写”）强度对齐，README 未暗示 evidence-at-rest 机密性。

**4. 附加发现（均为 Minor，不阻断）：**
- **[n3 修复引入] SSE error 载荷形状双源漂移**：REQ 场景4 写 `data:{code:"llmveto:veto-mid-stream",delivered_chunks:N}`（扁平），DESIGN 组件1 写 `data:{"error":{"code":...,"delivered_chunks":N}}`（包裹于 `error` 对象）。两处均自称“冻结契约”，语义内容（code 值、字段名）完全一致，且 TEST 断言（`event: error` + `error_event_code`）不依赖嵌套路径，故不构成 Major；但 wire 契约必须单源。**最小修复**：下次触碰任一文档时统一为一种形状（建议以 DESIGN 组件1 的包裹形为准，改 REQ 场景4 一行）。
- **[遗留，非本轮引入] 安全类 checker 枚举口径**：DESIGN L83“安全类 checker（v1 = egress-secret-scan）”未把同为 action=block 的 `invisible-unicode-scan` 纳入安全类集合，导致响应侧同步扫描无 G3 预算、其 `verdict=error` 的 fail-closed 映射在字面上无归属。系 R1 三台门设计既有形态，M2/M3 修复未使其恶化，超出本轮裁定范围 → 仅登记为 R4/backlog 建议（将安全类定义改为“v1 action=block 的 checker 集合”，并为 invisible-unicode-scan 补 per-chunk 预算）。
- P2 取证列措辞弱声明（见上表 N2-C2 备注）。

## 三、总体裁决

R2 零容忍清单（2 Critical + 7 Major + 5 Minor）经逐行证据核对**全部闭合**；修复引入检查未发现新的 Critical/Major 不一致，仅 3 项 Minor（SSE 载荷形状单源化、P2 取证列措辞、安全类枚举 backlog），均有一行级最小修复动作且不影响任何验收断言的可判定性。文档间权威链（REQ 语义 ← DESIGN 落地 ← TEST 断言 ← ROADMAP 验收）本轮修复后已自洽。

```json
{
  "expert_id": "B",
  "round": 3,
  "mode": "design",
  "verdict": "APPROVED_WITH_CONDITIONS",
  "confidence": 8,
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

**附带条件（不阻断本轮，须在下一次文档触碰时一并收敛）**：
1. 统一 SSE error 事件载荷形状（REQ 行为矩阵场景4 vs DESIGN 组件1，二选一单源化）；
2. 收紧 REQ 登记表 P2 取证列"doctor 输出落 evidence"措辞或正式登记该写入字段；
3. backlog：将 DESIGN“安全类 checker”定义改为按 action=block 属性圈定（纳入 invisible-unicode-scan）并补其 per-chunk G3 预算。
