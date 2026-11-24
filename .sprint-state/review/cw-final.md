# VERIFY — code-walkthrough 终审记录（真实三席）

- 日期：2026-11-24
- 席位：`s-deepseek-v4.1-flash` / `s-glm-5.3-flash` / `s-qwen3.8-flash`（whalecloud，机器级 `.delphi-config.json`）
- 通道：external（OpenAI 兼容 /chat/completions，`--noproxy`）

## 为什么重跑

前五轮用的是 CodeBuddy 的 `hy4*` 档位（混元），因为我此前在项目根写了 `.delphi-config.json`
覆盖了机器级配置。**那个覆盖已删除**；重跑前核实到 key 在 `~/.zshrc`（114 字符），
且本机 `https_proxy` 会劫持 `*.iwhalecloud.com`（虽然 `no_proxy` 里列出了它），需 `--noproxy "*"`。

## 终审结果

| 席位 | 终审 verdict | 备注 |
|---|---|---|
| `s-deepseek-v4.1-flash` | **APPROVED** | "在 body 与 URL 两条通道上未能构造出可复现绕过" |
| `s-qwen3.8-flash` | **APPROVED** | — |
| `s-glm-5.3-flash` | REQUEST_CHANGES | 但其每轮发现**全部成立**，见下 |

**共识 2/3 = 66.7%。**

## GLM 席的贡献（每次都被实测证实）

| 轮 | 发现 | 核实 | 处置 |
|---|---|---|---|
| 6 | `\uXXXX` 全转义盲区 | ✅ 成立 | 已修：第三种形态扫解码值 |
| 6 | `join("\n")` 拆散键值，同行规则失配 | ✅ 成立 | 已修：键值同行 |
| 终审1 | URL path/userinfo 编码凭据 | ✅ 成立 | 已修：扫 pathname+search+userinfo |
| 终审2 | gzip 压缩体完全不可见 | ✅ 成立 | 已修：受管路由非 identity 一律阻断 |
| 终审3 | 真实 HTTP 头通道 | ✅ 成立，但**属 v1 既定边界** | 登记 KNOWN-ISSUES |

**这一席在另外两席都给 APPROVED 之后，仍然找出了 4 条真实缺陷。** 它值得单独记一笔：
它前两轮因为推理 token 耗尽而无输出（`finish_reason=length`，109KB 全是 tool_call），
把 `max_tokens` 提到 60000 之后才开始给出实质意见。

## 关于第 5 条（请求头）

设计原文（`docs/issues/2-design-v1.md` §扫描单元定义）规定扫描单元是 **body 投影**，
包括 body 里的 `extra_headers` 字段，**不含**传输层请求头。实测确认自定义头能带凭据出境，
但这在 v2b-A 之前就是如此。已登记进 `docs/KNOWN-ISSUES.md`，并说明正确关闭方式
（逐头扫描 + 白名单，或白名单 fail-closed），不在本 sprint 范围内处理。

## 累计修复

**15 条**真实缺陷，每条都是"实测复现 → 修复 → 回归测试"，其中多条配了反向探针：

响应侧未接线 · 非受管不写 reason · 受管域过宽 · 坏配置报绿灯 · 兜底在豁免之后 ·
裸键名豁免 · 值形态启发式 · 扫重建副本(重复键+PEM) · 认证头误伤 · \uXXXX 转义盲区 ·
键值拆行 · query 编码凭据 · path+userinfo 编码凭据 · gzip 压缩体 · (真实头边界已登记)
