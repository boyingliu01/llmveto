# 协议线格式能力矩阵（v2b-A）

> 本文是 REQ-V2bA-13(b) 要求的**失去能力清单**：两种新协议上"不做什么"必须成文，
> 不得靠"总体目标"含糊带过。`tests/unit/doc-consistency.test.ts` 引用本文。

## 1. 覆盖矩阵

| 能力 | Chat Completions | Anthropic Messages | OpenAI Responses |
|---|---|---|---|
| 请求侧文本投影 | ✅ 既有 | ✅ v2b-A | ✅ v2b-A |
| 响应侧文本投影（非流式） | ✅ 既有 | ✅ v2b-A | ✅ v2b-A |
| 响应侧逐帧投影（流式） | ✅ 既有 | ✅ v2b-A | ✅ v2b-A |
| 凭据出境阻断（`egress-secret-scan`） | ✅ | ✅ v2b-A | ✅ v2b-A |
| 隐形字符检测（`invisible-unicode-scan`） | ✅ | ✅ 经同一投影 | ✅ 经同一投影 |
| **金丝雀注入（T1a）** | ✅ | ❌ **显式不注入** | ❌ **显式不注入** |
| 跨会话串流检测 | ✅ | ❌ 无注入即无从检测 | ❌ 同左 |
| 形状/覆盖 fail-closed | ✅ | ✅ | ✅ |

## 2. 两种新协议上**失去**的能力（如实列举）

1. **T1a 外泄的阳性检测（跨会话串流）**：金丝雀不注入，因此"某会话的 canary 出现在他人响应里"
   这条唯一的阳性证据链在这两条路由上不存在。可以证明"发过什么"（`request_body_sha256`），
   但**无法证明"上游是否留存并复用"**。
2. **`canary rotate` 对这两条路由无意义**：没有注入就没有需要作废的串。
3. **`doctor.canary-registry` 的计数不反映这两条路由**：它们的 `canary_injected` 恒为 0，
   `inject_skipped` 恒增长——看到后者增长是**预期行为**，不是故障。

## 3. 为什么不做全形态注入（取舍记录）

- 注入点语义完全不同：Chat 是"末条 message 的 content 尾部"；Anthropic 有 `system` 块数组与
  `tool_result` 分支；Responses 的 `input[]` 元素需要按 `type` 分派。三套注入点 = 第二次 canary 改造。
- DR-012/DR-012a 的范围纪律是**砍范围不砍深度**：与其三套都做浅，不如两套做深、一套显式不做并登记。
- 若将来要做，最小形态是"只在 `input[]` 最后一个 `input_text` 尾部追加"，但必须重新过一遍
  AC-V2a-07 的六分支不变式与 G-CANARY 回放判据。

## 4. 可观测性

- 每次不注入都落 evidence 顶层 `reason = "inject_skipped"`，并计入 `/ _llmveto/metrics` 的
  `inject_skipped` 计数器。
- **"不在注入判定域"与"在域内但不注入"是两件不同的事**：前者无声（非受管路径，零计数零字段），
  后者可观测。`claude/anthropic` 与 `codex/openai` 属于后者。
