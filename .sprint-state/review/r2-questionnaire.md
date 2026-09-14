# R1 → Round 2 评审卷（需求修订复审）

## 给你的任务

你是 Delphi 专家团的成员，现在是 **Round 2**。Round 1 你与另两位专家对本项目 v1 需求文档一致给出 `REQUEST_CHANGES`。

需求方已按"零容忍"规则修订了全部 Critical 与 Major 问题。**你本轮的工作不是重新自由评审，而是逐条裁定处置是否成立**，并给出新的裁决。

保持匿名：不要在输出中指认某条问题由哪位专家提出（下文已隐去提出者）。允许并鼓励你反对你自己在 Round 1 提过的意见——如果修订方案比你原建议更差，请直说。

## 你必须阅读的文件

修订后的文档（已变更，请重新读）：
- `docs/issues/1-req-threat-model.md`（新增 §裁决与动作语义、§v1 残余风险登记表）
- `docs/issues/2-design-v1.md`（新增 §扫描单元定义、§性能预算与降级规则、§脱敏与留痕范围；改 §接入适配器、§验收）
- `docs/issues/4-test-validation.md`（契约 #2/#3/#4 重写；五件套逐项标期次；新增量化门槛与测量协议）
- `docs/issues/5-roadmap.md`（v1 交付/前置门/验收六条重写）
- `docs/issues/3-reuse-list.md`（许可与运行时列）
- `architecture.yaml`、`README.md`

上一轮问题与处置清单：
- `.sprint-state/review/r1-consensus.md`（P-01 ~ P-22 + §3 处置决议 + §4 未纳入建议及理由）
- `.sprint-state/decisions.md` DR-006 ~ DR-010（六项 ADR 级取舍）

## 本轮判据（不得松动的规则）

1. 只要存在任何 **Critical Issue** → 裁决必须是 `REQUEST_CHANGES`。
2. **新引入的矛盾算 Critical**：本轮修订若在不同文档间造成新的不一致（术语、期次、门槛、承诺强度），按 Critical 计，并指出具体两处位置。
3. **不可证伪/不可判定的验收条款算 Critical**（这是 Round 1 的共性问题类别，重点复查）。
4. **过度承诺算 Critical**：文档声称的能力若超过其登记的实际能力（尤其 evidence 链、`verify`、流式阻断、T3a 覆盖、"过闸"覆盖率），按 Critical 计。
5. **反向也要查**：是否把本来正确的原设计改坏了、是否为了通过评审而把承诺降得过低以致丧失项目立项价值（例如"零缓冲 + 终止流"是否仍支撑得起"fail-closed 阻断"这一市场空白主张；例如把 `redact` 推到 v3 是否让 v1 主张残缺）。这类回退风险请明确评估。

## 输出格式（严格遵守）

```
## 独立评审 - Round 2（角色视角）

### 一、逐条处置裁定
| 问题ID | 级别(原/现) | 裁定 | 依据（文件+章节） | 若不成立，最小修复动作 |
（必须覆盖 r1-consensus.md §1 表内全部 22 条，一条不漏；裁定取值 resolved | partially_resolved | unresolved）

### 二、DR-006 ~ DR-010 五项 ADR 的独立意见
逐条：同意 / 有条件同意（条件是什么）/ 反对（替代方案是什么）。
特别针对 DR-006（零缓冲+终止流）与 DR-010（G2 分档阈值 3/10/40ms）给出你的技术判断：可实现吗？数字有依据吗？

### 三、新引入的问题（Critical / Major / Minor）
仅列本轮修订**新产生**的问题；每条给：位置（两个文件+章节）、为何是问题、可判定的解决标准。

### 四、剩余风险与 v2/v3 边界
残余风险登记表是否有虚报（把未做的写成做了）或漏报（把已做的写成未做）。

### 五、总体判断
2-4 句，含：本轮修订是否足以支撑 v1 冻结。

### 六、JSON 结论块
```json
{
  "expert_id": "<你的角色字母>",
  "round": 2,
  "mode": "design",
  "verdict": "APPROVED | APPROVED_WITH_CONDITIONS | REQUEST_CHANGES",
  "confidence": <1-10>,
  "resolutions": {"P-01": "resolved", "...": "...（22 条全填）"},
  "adr_opinions": {"DR-006": "agree|conditional|disagree", "...": "..."},
  "critical_issues": ["仅新引入或未解决的；无则填 []"],
  "major_concerns": ["同上"],
  "minor_concerns": ["..."]
}
```
```

不要输出与上述六节无关的内容。不要复述文档原文大段。中文输出。
