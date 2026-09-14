
> delphi-reviewer-feasibility · g-qwen3.8-flash

→ Read .sprint-state/review/r3-questionnaire.md
→ Read .sprint-state/review/r2-consensus.md
→ Read docs/issues/1-req-threat-model.md
→ Read docs/issues/2-design-v1.md
→ Read docs/issues/4-test-validation.md
→ Read docs/issues/5-roadmap.md
→ Read architecture.yaml
✱ Grep "partial_response_delivered|response_delivered" in .
✱ Grep "pending_bytes|pendingBytes" in .
Now let me verify cross-document consistency with targeted searches for the specific fields and terms mentioned in the questionnaire.
✱ Grep "codepoint|terminated_stream" in .
✱ Grep "response_body_ref|body_capture" in .
✱ Grep "invisible-unicode|degraded_observational|veto-mid-stream" in .
✱ Grep "G3|120ms|40ms|p99" in .
✱ Grep "doctor|not-applicable|CA" in .
✱ Grep "摘要哈希|T1a" in .
✱ Grep "Authorization|x-api-key|api-key|Cookie|goog-api-key" in .

$ git -C D:\projects\llmveto show --stat 9af9633 | Select-Object -First 40; git -C D:\projects\llmveto log --oneline -5
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
9af9633 docs(design): resolve R2 delphi-review findings (2 Critical + 7 Major + 5 Minor)
2545042 docs(design): resolve all R1 delphi-review critical/major findings
8131109 chore(sprint): phase 1 PREP - dev env initialized, sizing=complex, decisions DR-001..004
223b5bd chore: initialize dev environment (Bun + TS + vitest scaffold, arch gates, import issues #1-#5 as docs)

✱ Grep "P3|脱敏|明文" in docs
All required files read and cross-checked (including targeted grep verification of field names, tier values, enum claims, and commit 9af9633). Below is my independent review as **Expert C（可行性 / feasibility）**.

---

## 一、逐项裁定表（Round 2 处置复核）

| ID | 裁定 | 证据位置 | 复核说明 |
|---|---|---|---|
| N2-C1 | **resolved** | REQ §v1 内置策略映射（`invisible-unicode-scan` → `block`）；DESIGN §组件2（"同步执行，不引入缓冲"）；TEST §3 误报矩阵（阻断类 = `egress-secret-scan`/`invisible-unicode-scan`，FP=0；告警类仅 `model-label-consistency`）；ROADMAP 验收3 + v1 交付清单 | 四处分类已统一为"阻断"，且 TEST §3 用"二者 v1 策略映射均为 `action=block`"给出了可回溯的归类理由 |
| N2-C2 | **resolved** | REQ 登记表 T2a/T2b 行（`response_body_sha256`，"明文留存仅当 `body_capture≠metadata_only`，默认无明文"）；T1a（"仅证明发过该字节序列…亦无法证明对方是否留存"）；T1b/T2c（"命中处明文受 `body_capture` 约束"）；P1（"v1 仅输出至 doctor 结果，不入 evidence 链"）；全文检索无 `response_body_ref` 残留 | 无任何行再把默认不做的取证写成"做成了"；五行措辞与契约#4 字段表一致 |
| N2-M1 | **resolved** | REQ §行为矩阵场景4 + 场景4 承诺段（`response_delivered.partial=true`）；TEST 契约#4 字段表；全文检索 `partial_response_delivered` 零命中 | 契约#4 字段名全文唯一 |
| N2-M2 | **resolved** | DESIGN §关键决策"块级阻塞语义定案"（同一 tick 先扫描后 tee，非缓冲整段）；场景3 可达 ⟺ chunk1 命中且 checker 在 tee 前返回 → `delivered_chunks=0`；场景4 N≥1；fixture `delivered_chunks: N` 断言作为"悄悄异步化"探测器 | 场景3 判定条件清晰、`delivered_chunks=0` 自洽、G1 口径（per-chunk 门增量）对齐。见"修复引入检查"第 1 条的边界澄清项 |
| N2-M3 | **resolved** | DESIGN §性能预算 G3 分档 20/50/120ms（每档 ≥ 对应 G2 p95 的 3 倍：20≥9、50≥30、120≥120）；§降级规则"G2=统计门 / G3=单笔硬超时门，[G2 p95, G3) 区间=回退信号但不 block"；慢环境登记 + G-BENCH 必报 G3 口径 p99 且 512KB 档 `p99_scan < G3×0.6` 否则 ADR 上调 | 陷阱消除、交叠语义清晰、p99 约束带退出条件、可执行。术语瑕疵见下 |
| N2-M4 | **resolved（附条件）** | DESIGN §扫描单元定义：逐头排除清单（`Authorization`/`x-api-key`/`api-key`/`x-goog-api-key`/`Proxy-Authorization`/`Cookie`）+ 排除理由（FP=0 可达性）；TEST §3 强制 benign 认证头 fixture（"若实现未排除本条必然 FAIL"） | 排除清单明确、fixture 锁为可回归约束。**但**"凭据藏在自定义头（如 `X-API-Token`）→ egress 扫描盲区"这一新缺口未在 REQ 登记表 T1b 行显式登记——T1b"自写 token 漏检"只覆盖 body 路径，排除后的 header 路径是**新增且更宽**的漏检面。见 Major-1 |
| N2-M5 | **resolved** | TEST 契约#3 示例 evidence 键 = `findings[{checker,threat,verdict,rule_id}]` + `response_delivered`，均可回溯契约#4；`codepoint`/`terminated_stream` 全文零命中；可观测断言改用已登记值 `terminated_after_delivery` + `error_event_code` | 全部键可回溯字段表。`expected.observables` 容器本身仍未进字段表（见 Minor-i） |
| N2-M6 | **resolved** | TEST §4 E2E 表"受管枚举探测过闸（ROADMAP 验收1(b) 落点）"行：harness 遍历 `MANAGED_CONFIG_IDS` 逐路径回放 ≥1 探测请求，断言 evidence 含对应 `client`+`provider_id`（时间窗口内），任一无记录 → FAIL；发起者明确"测试 harness 经适配器发起，非 doctor 自查" | 断言可判定、载体有落点、发起者单义 |
| N2-M7 | **resolved** | ROADMAP 验收6 "p95<5ms 且 p99<12ms（两值同为验收门）"；DESIGN §性能预算 G1 同值 | 两文档 G1 承诺等价 |
| n1 | **resolved** | DESIGN §组件5 doctor v1 检查项冻结封闭枚举①~④ + "TLS/CA 信任检查项不在 v1 检查集内，不注册"；README §CLI 照抄该枚举并声明"权威清单见 DESIGN §组件5"；DESIGN §期次标注互指 | CA 项"不在检查集"已单义，README 引用之 |
| n2 | **resolved** | TEST 契约#4 `action_taken` 行：`degraded_observational` 标"@v2 起可达；verify schema 须允许该枚举但 v1 fixture 不覆盖" | 清晰，且同时覆盖了 verify 侧的枚举兼容要求 |
| n3 | **resolved** | DESIGN §组件1 反代核："流式阻断的对外可观测契约"给出 `event: error` + `data: {"error":{"code":"llmveto:veto-mid-stream","delivered_chunks":N}}` 完整规格，并与 evidence 侧 `terminated_after_delivery` 对应 | 对外契约完整 |
| n4 | **resolved** | DESIGN §扫描单元 `pendingBytes`（"字段名对齐 TEST 契约#2 `ScanWindow.pendingBytes`"）；全文检索 `pending_bytes` 零命中 | camelCase 统一 |
| n5 | **resolved** | REQ 登记表 T1a 取证列改写为"仅证明发过该字节序列；默认 metadata_only 无原文不可读" | 诚实，与 P-20 默认脱敏声明不再冲突 |

## 二、修复引入检查

1. **G3 分档 vs TEST §5 / ROADMAP 验收4/6 超时口径**：一致。TEST §5 三档 runner（G1/G2 分档/G3 超时→block）与 DESIGN 分档、ROADMAP 验收6（含"G-BENCH 须报告 G3 口径 p99"回引）互相咬合，无残留旧口径。**边界澄清（非矛盾）**：DESIGN 定案"chunk1 在 tee 前被 checker 拦住"意味着响应侧存在 ≤1 chunk 的瞬态持有，严格说是"零缓冲（不持整段）"而非"零持有"；REQ 目标#3"响应级/流终止级"粒度与场景3"等同场景2"已隐含此语义，故自洽，但建议 README/DESIGN 加一句"≤1 chunk 瞬态窗口"以免实现期被当成 bug 或反向被放宽成整段缓冲。另：DESIGN 用"3 倍余量"描述 120=40×3（实为恰好 3 倍、含等号），措辞应为"≥3 倍"（已满足，仅防歧义）。
2. **认证头排除 vs T1b 能力边界**：部分一致。"排除标准认证头 ≠ 排除所有凭据载体"在逻辑上成立，且自定义头仍在 `extra_headers` 扫描范围内；但**被排除清单内的头承载攻击者可控凭据**（如 `Cookie` 追踪水印/投毒标记——正是 T2c/tracing 的真实载体通道之一）这条新盲区未登记。缓解动作很小（T1b 行补一句），不改变"放行"结论，列为 **Major-1（可降格为高优先 n 项）**。
3. **新增 P3 行 vs DESIGN §脱敏 / README**：一致。P3（`body_capture=full` 时 evidence 本地聚集、v1 无静态加密、责任归用户）与 DESIGN §脱敏与留痕范围末段、README"全量留痕"承诺强度互洽，属诚实登记，无过度承诺回潮。
4. **Unicode 阻断类 FP=0 × 强制跨 chunk 样本 × 码点集固定**：实际可达成（清单内码点在合法自然语言文本中近乎零出现），风险仅在畸形/敌意上游响应触发误终止——但该目录本就是 block 目标，归类正确。附带观察：SSE `\u200b` 转义形态的 JSON 语法违规字符由 `malformed:true` 原样传递路径覆盖，未见规则冲突，BUILD 期出 1 条 fixture 即可。

### Minor（不阻断收敛，BUILD 期顺手修）

- i) TEST 契约#3 `expected.observables` 容器仍含未登记键（`terminated_after_delivery`/`error_event_code`），而同行注释要求"键必须为契约#4 已登记字段"——建议在契约#4 或 #3 加注一行"observables 为 fixture-only 断言容器，非 evidence 字段"。
- ii) DESIGN §组件2 `invisible-unicode-scan` 条目未写"非流式 block / 流式=终止流"双模，需读者回查 REQ 映射表。
- iii) TEST §4 E2E 行缺场景3（`delivered_chunks=0`）用例，与 M2 修复的"场景3 可达"主张配套性略欠。
- iv) ROADMAP 前置门 G-BENCH 关闭条件未明写含 G3 p99 约束（正文已有，门表未镜像）。

## 三、总体裁决

14 项 R2 处置**全部按声称落位、证据可回溯、交叉引用闭环**；未发现新的 Critical。唯一实质残留是 N2-M4 修复派生的"排除头盲区未登记"（Minor 级修改量，一句话解决）与上述四条脚手架级 Minor。从可行性视角：修复均未引入执行陷阱，性能门的量化口径（分档、3 倍关系、p99 退出条件）在生产环境可测、可判、可审计。**APPROVED_WITH_CONDITIONS**。

```json
{
  "expert_id": "C",
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
  "new_major_concerns": [
    "N2-M4 修复派生盲区未登记：被排除的标准认证头（尤其 Cookie/x-api-key 槽位）可承载追踪水印/投毒标记，egress-secret-scan 对此确定性失明；REQ 登记表 T1b 行'仅覆盖模式化密钥'的能力边界句应补一句'且认证类头整体不进 v1 扫描单元'（一句话修订，不阻断收敛）"
  ]
}
```
