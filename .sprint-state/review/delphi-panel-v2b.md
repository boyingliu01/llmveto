# Delphi 评审面板 — v2b sprint（sprint-20261124-54）

> 日期：2026-11-24 · 决策：DR-030 · 配置：项目根 `.delphi-config.json`（gitignored，不含密钥）

## 席位（active_profile = `codebuddy-v2b`）

| 角色 | 关注面 | 模型 ID（可执行） | 调用方式 |
|---|---|---|---|
| A architecture | 需求对齐 / 系统分层 / 范围边界 | `hy4std` | `codebuddy -p --model hy4std <prompt>` |
| B technical | 实现正确性 / 边界条件 / 测试可判定性 | `hy4flash` | `codebuddy -p --model hy4flash <prompt>` |
| C feasibility | 可行性 / 风险 / 范围可执行性 | `space-bunny` | `codebuddy -p --model space-bunny <prompt>` |

三席**互异**（`expected_echo` 与 `model` 逐字一致），满足 distinct-models 不变量。

## 为什么不是另外三条路（逐条实测，不是推断）

| 候选通道 | 实测命令 / 观察 | 结论 |
|---|---|---|
| whalecloud（v2a 时期用的 external provider） | `delphi-review` 工具报 `OPENCODE_WHALECLOUD_API_KEY is not set`；`/proc/<dsh-pid>/environ` 里 `*_API_KEY` 计数 = 0；`~/.config/llmveto/env` 只有 `LLMVETO_*`；直连探测返回 `HTTP 401 未提供有效的API-KEY` | ❌ 本机无凭据，无法伪装成可用 |
| Qoder CLI | `qoder -p "…" --model lite` → `Session model "lite" is unavailable`；`--model qwen3-coder-plus` 与 `--model glm-5.2` 均输出 `Model "…" is not available right now; using "auto" instead` | ❌ 三席会塌缩成 `auto` 一个模型 |
| DSH native subagent | `list_subagent_models` → 1 条；`list_subagent_models(provider="ailb")` → 1 条 | ❌ 拿不到三个互异模型 |
| CodeBuddy CLI | `hy4std`/`hy4flash`/`hy4flash-free`/`space-bunny`/`deepseek-v4.1-flash`/`glm-5.3-flash` 逐个 `-p` 返回预期文本 | ✅ 采用 |

## 为什么要诚实标注的两个限制

1. **档位背后的真实厂商无法从本机证明。** CodeBuddy 的请求日志只记模型 ID（`model.request.started` 里是 `hy4std` 这类档位名），没有 provider 判据。这与 v2a 时期"`example-provider/g-*` 自报 ≠ 证据"是同一类风险。**缓解手段只有一条且是弱的**：三席对同一份材料的结论必须互相对照；若三席措辞高度同质，应当怀疑它们其实是同一个模型，而不是当成"共识高"。
2. **有意的排除。** `deepseek-v4.1-flash` / `glm-5.3-flash` 虽然也能调通，但它们是**本项目正在审计的中转站模型**。让被审对象当评审员，会把"中转站有没有偷换模型"这个问题混进评审结论，所以不用。

## 目击记录（seed 判别力，弱检验）

`hy4std` 在本项目早期的一次审计里被目击报出内部标识 `ailb`，而 DSH 侧 bubbles 到 UI 的 provider 名恰为 `ailb`（`list_subagent_models` 的首行即 `ailb — 大创实验室`）。这**只说明该档位与 DSH 背后可能是同一后端**，不构成厂商证明，也不影响席位互异性判定。

## 执行纪律

- 每轮三席**各起一个独立进程**，互不可见（R1 匿名）。
- 每席的实际命令行（含 `--model <seat>`）写进 `.sprint-state/review/r<N>-expert-<X>.md` 头部，作为"真的用了这个模型"的凭据。
- 缺任一席 → 按剩余席位重新计票并标注缺位，**不得由实现方模型代答后冒充专家意见**。
- 共识阈值 ≥90%；Critical / Major 须全部处置，不可降级跳过。
