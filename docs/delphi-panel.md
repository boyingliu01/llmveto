# Delphi 评审专家团配置

llmveto 的 DESIGN 期 R1/R2 评审与 VERIFY 期走查使用**多位不同厂家模型**的匿名专家团（delphi-review skill 要求：≥2 家不同 provider，禁止与实现方同源）。

## 面板映射

Provider：`example-provider` → `https://internal-gateway.invalid/redacted/v1`（OpenAI 兼容），凭据来自环境变量 `OPENCODE_EXAMPLE_API_KEY`（**不落盘、不写入仓库**）。

| Expert | 视角 | agent | 模型 | 厂家 |
|---|---|---|---|---|
| A | 架构 / 需求对齐 | `delphi-reviewer-architecture` | `example-provider/g-deepseek-flash` | DeepSeek |
| B | 技术 / 实现正确性 | `delphi-reviewer-technical` | `example-provider/g-glm-5.3-flash` | 智谱 GLM |
| C | 可行性 / 风险仲裁 | `delphi-reviewer-feasibility` | `example-provider/g-qwen3.8-flash` | 阿里 Qwen |

三家不同厂家，满足"≥2 家"与"禁止三专家同厂"两条约束。

## 调用方式

```bash
opencode run --agent delphi-reviewer-architecture \
  --format default \
  (Get-Content -Raw .sprint-state/review/round1-questionnaire.md)
```

要点：

- **必须 `mode: "all"`**。agent 若为 `mode: "subagent"`，`opencode run --agent X` 会打印
  `agent "X" is a subagent, not a primary agent. Falling back to default agent` 并回落到
  `sisyphus` 主 agent —— 于是评审人格 prompt 失效、模型也变成 default agent 的模型，评审静默失真。
  这是本项目最容易踩的坑：**评审看起来跑了，实际是另一个模型在答题。**
- **匿名性**：三位专家各自独立一次 `opencode run`，互不可见对方意见（防 anchoring bias）。
  Round 2 才把汇总意见一并给出。
- **输出落盘再读**：PowerShell 控制台 codepage 会让中文显示成乱码，但重定向到 UTF-8 文件后内容完好；
  务必用 `| Out-File -Encoding utf8` 收集，不要靠肉眼读控制台。

## 配置位置与变更

- 生效位置：`~/.config/opencode/opencode.json`（`agent.delphi-reviewer-*`）
- `g-qwen3.8-flash` 上游提供但本地原先未声明，已补进 `provider.example-provider.models`
- 变更脚本（幂等，带 JSON 合法性校验后才写盘）：`.sprint-state/tools/patch-opencode-delphi.ps1`
- 回滚备份：`~/.config/opencode/opencode.json.bak.delphi-20260914`

## 评审纪律

| 规则 | 说明 |
|---|---|
| 共识阈值 | ≥91% |
| 零容忍 | Critical / Major 全部须处理，不可降级跳过 |
| 诚实声明 | 若某专家调用失败，记为"缺位"并按剩余专家重新计票；不得由实现方模型代答后冒充专家意见 |
