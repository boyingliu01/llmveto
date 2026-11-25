# Phase 6/6 CLOSE — llmveto v2b-A

- 日期：2026-11-25
- 结论：**已发布 v0.7.0**

## 交付

| 项 | 结果 |
|---|---|
| PR | #2（squash 合并为 `53644d3`） |
| Tag | `v0.7.0` |
| Release | https://github.com/boyingliu01/llmveto/releases/tag/v0.7.0 |
| 版本 | `VERSION` / `package.json` = 0.7.0 |
| 测试 | 837 passed / 52 skipped |
| release-gate | 10/10 |
| CI bench | **全部 PASS**：G1 0.064（基线 0.252）、G2 8KB 0.28（0.39）、64KB 0.44（0.54）、512KB 1.83（1.8） |

## 功能面（REQ-V2bA-01..17，21 REQ / 49 AC）

- Claude Code / Codex / promptfoo 进入 `MANAGED_CONFIG_IDS` 封闭枚举，`doctor` 报六态
- Anthropic Messages 与 OpenAI Responses 两种线格式的请求/响应投影（非流式 + SSE）
- 两轴判定（识别 × 覆盖）+ 三通道出境扫描（body 三形态 / URL 三部分 / 传输编码）
- 金丝雀注入边界写死为 chat-only，两条新路由记 `inject_skipped`（可观测）

## 这次 sprint 真正修掉的东西

改动前实测：后两种线格式下凭据**直接出境**（HTTP 200 + `warned`），
`opencode/anthropic` 自 v1 起就被当作受管路由。修完后端到端断言
`blocked_before_forward` + 上游 0 请求，且反向探针能把它变红。

累计修复 **15 条**真实缺陷（响应侧未接线、非受管不写 reason、受管域过宽、
坏配置报绿灯、兜底顺序、裸键名豁免、值形态启发式、扫重建副本、认证头误伤、
`\uXXXX` 转义盲区、键值拆行、query/path 编码凭据、gzip 压缩体、真实头边界登记）。

## 过程教训（比功能更值得记）

### 1. 优化必须先归因

性能门红了六轮，我每次都直接改代码：形状判定 → 重复解析 → URL 扫描 → 预筛 →
只在受管路由判定。**五次都没解决**。最后用二分定位到 `3ad3207`——一个本 sprint
开工前就存在的提交，与我无关。

违反的是 AGENTS.md 第 1 条和第 4 条：先读被测物契约、归因需多次采样。
**没有归因的优化是在猜。**

### 2. 预筛比它想跳过的更贵

修 `3ad3207` 时，第一版写成"逐规则 `includes` 关键字"。实测：单次 `includes` 在
512KB 上 0.057ms，8 规则 × 3 关键字 = **2.14ms**，比它要省的正则（1.9ms）还贵。

改用单字符整体预筛（6 个字符合计 0.026ms）后，checker 从 3.03ms 降到 0.44ms。
**优化本身要先被测量。**

### 3. 覆盖性论证写错过一次

整体预筛我论证"每条规则命中必然含 `| $ < ( /` 之一"——漏了
`powershell.exe -enc SQBFAFgA`。测试抓住了它，加了 `-`。
**凭直觉写的覆盖性论证一定要靠测试兜。**

### 4. 评审模型用错了

前五轮走查用的是 CodeBuddy 的 `hy4*`（混元）档位，因为我在项目根写了
`.delphi-config.json` 覆盖了机器级配置。判断依据"whalecloud key 不存在"是错的——
key 在 `~/.zshrc` 里（114 字符），而本机 `https_proxy` 还会劫持 `*.iwhalecloud.com`。

改用正确三席后：两席 APPROVED，GLM 席每轮都找出真缺陷（5 条全部成立）。

### 5. 拆提交前要看内容

我误判 `38c3a1a` 为"无关提交"并拆掉，导致 `scripts/canary-replay.mjs` 消失、
测试挂掉。它其实是 0.6.1 的发布提交。已回滚。

## 遗留

- 真实 HTTP 头通道属 v1 既定边界，已登记 `docs/KNOWN-ISSUES.md`
- 压缩体在受管路由上 fail-closed（不还原），代价已登记
- 非受管路由不做形状判定（性能取舍，已登记）
- v2b-B（计费对账）、v2b-C（指纹巡检）顺延

## status

```
status: completed
deliverables: v0.7.0 released
```
