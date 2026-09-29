# G-CANARY #E 录制交付规格（判据输入契约）

> owner = 用户（录制方，脱敏责任同）。未交付则 G-CANARY 未关闭、BUILD 不启动
> （设计 §6 G-CANARY / §8 #E；用户 2026-09-29 拍板"维持原判据"，F-m1 两段式降级不采纳）。

## 交付什么

**10 条真实 agent 会话录制** —— 从你本机 opencode / delphi 的实际使用中录制（合成语料不算，
`tests/fixtures/false-positives.json` 不满足"真实"定值）。每条会话一个文件：

```
.worktrees/sprint/sprint-2026-09-27-01/var/canary-sessions/session-01.json
… 共 10 个（session-01 … session-10）
```

`var/` 已 gitignore，录制文件**不进 git**。

## 文件格式（每条一个 JSON）

```json
{
  "session_id": "任意稳定字符串，10 条互不相同",
  "client": "opencode 或 delphi",
  "model": "该会话实际使用的模型 id",
  "exchanges": [
    {
      "request_body": { "...": "原始发给 provider 的 JSON 请求体，原样，不要重排字段" },
      "response_status": 200,
      "response": {
        "finish_reason": "stop",
        "content": "完整输出文本"
      }
    }
  ]
}
```

- 流式会话：`response` 写为 `{ "chunks": ["<每帧 data: 的 JSON 字符串或原文>", "..."] }`，
  并保证 chunks 内含 finish_reason 的终止帧；`finish_reason`/`content` 字段可省。
- `exchanges` ≥ 1 个请求-响应对，按时间序；一条会话内多轮就多对。
- `response_status` 填 provider 实际返回的 HTTP 状态码（200 之外的也照录，那正是拒绝率样本）。

## 字段 → 判据的对应

| 字段 | 服务哪条判据 |
|---|---|
| `response.finish_reason`（或终止帧） | ① finish_reason 分布无迁移（录制原件 = 基线臂，v2a 网关 canary 注入开启重放 = 对照臂） |
| `response_status` | ② provider 拒绝率增量 0 |
| `response.content` / chunks | ③ 人工复核 10 条输出 |
| `request_body` | BUILD 期经 v2a 网关重放（canary 注入点选取需要原始体） |
| `client` / `model` | 分臂统计与映射 |

## 判据执行时点

录制交付 → BUILD 启动解锁（SL-01 起）；三门判据在 canary 引擎建成后用真实网关重放评估；
**G-CANARY 全关前，canary 注入不上线**（DR-025 ①）。

## 脱敏与安全边界

- 录制含本机敏感内容：**脱敏责任在录制方**；密钥/个人信息改占位符（规约同 v1 benign 语料，
  见 docs/issues/2-design-v1.md:108）。
- 文件只进 `var/`，永不入 git；evidence store 同理不收录制原文。

## 采集方式建议（供参考，非强制）

- 任选你顺手的方式：客户端侧导出会话、本机抓包、或临时把 v1 网关
  `evidence.body_capture` 调成 `full` 跑 10 条真实会话后导出（注意 full 模式会把请求体
  写进 evidence 文件，属 T1b 登记的本地聚集风险，采集完调回 `metadata_only`）。
- 格式对不上的部分宁可手工补一个转换脚本放 `var/`（`var/*.ts` 可入仓），不要为凑格式
  重放或改写真实流量——判据要的是"真实"。
