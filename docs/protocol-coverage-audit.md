# 存量受管路由覆盖审计（v2b-A / REQ-V2bA-11）

> 本表回答一个必须被回答的问题：**v1 起就申报"受管"的路由，到底扫到了什么？**
>
> 立表理由（R1 三席共同意见）：本 sprint 只修了"未来"，但 `opencode/anthropic` 自 v1 起就在
> `MANAGED_CONFIG_IDS` 与 `CANARY_MANAGED_ROUTES` 里，而它的主体载荷与整个响应在 v2b-A 之前
> **都不进扫描单元**。只修不审，等于把同类静默失效留在存量里。
>
> 审计方法：对每条路由，用该客户端真实形态的 body 走 `recognize()` + `coverageOf()`，
> 记录"识别结果"与"覆盖结论"。覆盖结论非 `full` 即为该路由的已知缺口。

审计日期：**2026-11-24**（v2b-A BUILD 期，改动后实测）。

## 1. 受管路由 × 线格式可见性

| 路由键 | 声明格式 | 实测识别 | 覆盖结论 | 说明 |
|---|---|---|---|---|
| `opencode/openai` | chat | chat | full | v1 起有效，本机 1496 条 `allowed` 记录的主要来源 |
| `opencode/anthropic` | chat（镜像常量） | **chat** | full（**但见 §2**） | ⚠️ 该路由名虽含 `anthropic`，判定域里按 **Chat 线格式**处理 |
| `opencode/mock` | chat | chat | full | 测试载体 |
| `delphi/default` | chat | chat | full | endpoint 覆写为 `/v1/chat/completions` |
| `dsh/cliproxy` | chat | chat | full | 本机 296 条记录；OpenAI 兼容 provider 共用单一 base URL |
| `claude/anthropic` | anthropic-messages | anthropic-messages | full | **v2b-A 新增** |
| `codex/openai` | openai-responses | openai-responses | full | **v2b-A 新增** |
| `promptfoo/openai` | chat | chat | full | **v2b-A 新增**；格式取决于用户项目配置 |

## 2. `opencode/anthropic` 的真实状态（必须说清楚）

这一行容易误读，所以单独写：

- **路由名里的 `anthropic` 指的是 provider 名，不是线格式**。该路由的流量按 **Chat Completions**
  解析（`parseRoute` 只切路径段；线格式由正文特征或前缀权威决定，而 `opencode` 前缀绑定 chat）。
- 因此它**在 v2b-A 之前就一直是可见的**——如果用户真的用 Anthropic Messages 协议打这个路由，
  正文会被识别成 chat 而落 `shape_known_empty`（受管路由 → 阻断），**不会静默放行**。
- 也就是说：**R1 担心的"申报能力与实际能力不符"在这条路由上不成立**；
  真正不符的是"名字暗示 Anthropic 协议，实际按 Chat 处理"这一**命名歧义**。
- 处置：不改路由名（改名会破坏既有用户配置与 evidence 里的历史 `provider_id`），
  在本文与 `KNOWN-ISSUES.md` 登记这条歧义。

## 3. 审计发现的存量缺口（如实登记）

| # | 缺口 | 影响 | 状态 |
|---|---|---|---|
| 1 | 非 Chat 线格式不支持 canary 注入 | 两条新路由无 T1a 阳性检测 | 已登记（`KNOWN-ISSUES.md`、能力矩阵） |
| 2 | `opencode/anthropic` 命名暗示 Anthropic 协议 | 运维可能误以为该路由支持 Messages 协议 | 已登记（本文 §2） |
| 3 | 非受管前缀上的未知形态不阻断 | 用户自建前缀不享受 fail-closed | 已登记（`KNOWN-ISSUES.md`） |

## 4. `shape_partial_coverage` 计数守卫（REQ-V2bA-15a）

- 该码表示"协议已知、有文本，但存在已知载荷字段没被投影器覆盖"。
- **它应该永远是 0**：出现即说明投影器漏了一个字段，而那正是 v2b-A 要消灭的形态。
- 守卫方式：`tests/unit/protocol-coverage.test.ts` 对三条线的**全部已知载荷路径**逐条断言
  "present ⇒ handled"，因此只要某条路径被清单声明却没被投影，测试即红。
- 该守卫在**每次 CI** 运行，不只在 BUILD 末统计一次（这是 R2 评审要求的"持续守卫"）。
