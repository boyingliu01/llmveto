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

## 采集方式（推荐：capture-proxy，正文零手工）

**订正（2026-09-30）**：初版曾建议"临时把 v1 网关 evidence.body_capture 调成 full 再导出"——
该路已核实不可行：v1 evidence writer 的记录字段里**没有 body 文本位**，full 模式也只落 sha256
（src/evidence/writer.ts append() 仅含 *_sha256）。删除该建议。

推荐链路：opencode/delphi → **capture-proxy（127.0.0.1:8790）** → v1 网关（127.0.0.1:8787）→ provider

- 代理：`var/capture-proxy.ts`（已入仓）。启动：`node var/capture-proxy.ts`
- 客户端只需把 baseURL 里 `127.0.0.1:8787` 改成 `127.0.0.1:8790`（其余路径不变，代理透传）；
- 正常聊天即可，每次交换原样落一行到 `var/canary-sessions/raw-exchanges.jsonl`；
- 凭据类头（Authorization / x-api-key / Cookie 等）在**记录里**自动打码为 `[STRIPPED]`，转发不受影响；
- 聊完 ≥10 条真实会话后由 orchestrator 把 raw-exchanges.jsonl 分割为 session-01..10.json 并校验规格；
- 采完把客户端 baseURL 改回 8787 即恢复原链路（代理与记录文件均可留在 var/）。

真实性与脱敏的边界：判据要的是"真实"，**正文尽量不做人工脱敏**（重放验证需要真实形态）；
凭据头代理已自动打码；正文中的敏感内容只存在于 var/（gitignored，不出本机、不入 git）。

## 采集执行手册（2026-10-05 接管后补齐；切分工具 = `var/canary-split.ts`）

**现状订正**：`var/canary-sessions/raw-exchanges.jsonl` 里 9-30 那条是 `GET /gateway/v1/models`
（拉模型清单的烟测，129KB 响应），**不是会话**——切分脚本按非 chat 请求丢弃。有效录制计数仍为 **0/10**。

**链路订正**：上文"opencode/delphi → 代理 → v1 网关 → provider"只对 **opencode** 成立。
**delphi 不经网关**：`var/delphi-v2a/.delphi-config.json` 的 `base_url` 是
`https://internal-gateway.invalid/redacted` 直连。故按客户端分两趟采，代理 `--upstream` 不同。

### 趟 A — opencode（经 v1 网关，≥7 条会话）

1. 起网关：`npm start`（127.0.0.1:8787；当前未运行，已核实）
2. 起代理：`node var/capture-proxy.ts --upstream http://127.0.0.1:8787`
3. `~/.config/opencode/opencode.json` 第 190/195 行的 `127.0.0.1:8787` → `127.0.0.1:8790`
   （`/opencode/openai`、`/opencode/anthropic` 路径原样保留，代理透传；第 200 行 mock 不必改）
4. 正常用 opencode 干真活 ≥7 个会话（多轮最佳——上下文增长的轮次会自动归为同一会话）
5. 改回 8787，Ctrl-C 停代理

### 趟 B — delphi（直连 example-provider，补齐剩余会话）

1. 起代理：`node var/capture-proxy.ts --upstream https://internal-gateway.invalid`
2. `var/delphi-v2a/.delphi-config.json` 的 `base_url` → `http://127.0.0.1:8790/gateway`
3. 跑一次真实 delphi 评审 = 3 个单轮会话（三专家各一，persona 不同故不会被误并）
4. 改回 base_url，停代理

两趟写同一个 `raw-exchanges.jsonl`（append），**不要同时开两个代理实例**（并发追加同一文件在
Windows 上不保证行完整性）。WSL 侧 `~/.config/opencode/` 无 8787 引用，录制在 Windows 端做。

### 切分 + 门关判据

```bash
node var/canary-split.ts --require 10              # 切分并写 session-01..10.json，出核对清单
node var/canary-split.ts --require 10 --check      # 只校验已落盘文件；退出码非 0 = G-CANARY 不关
```

- 归组规则：真实 agent 循环上下文单调增长，"上一轮 messages 是本轮真前缀"即判同会话；等长或更短
  的新请求另起会话（故重复单轮调用各自成一条）。取 exchanges 最多的 10 个写盘。
- 流式响应：`data:` 帧原文进 `response.chunks`，须含带 `finish_reason`/`stop_reason` 的终止帧，
  否则脚本报"规格问题"（判据① 无法计算分布）。
- 清单直接给出三门判据输入：`finish_reason 分布（基线臂）`①、`provider 拒绝样本 非2xx/总数`②、
  逐会话 `client/model/exchanges/status/body` 摘要供③ 人工复核。
- `client` 依 path 前缀与 UA 自动判（`/opencode/`→opencode，node/undici→delphi）；判成 `unknown`
  时脚本会点名，用 `--client opencode|delphi` 强制标注后重跑。

**链路已烟测（2026-10-05）**：假上游 8799 → capture-proxy:8790 → 记录落盘 → 切分出 1 会话，
证明 `Authorization` 在记录里为 `[STRIPPED]`、中文正文原样保留、SSE 终止帧可解析；客户端收到的
流式响应与不经代理时一致（代理不改写转发）。烟测产物已删除。

## 抗中断约束（本机 WSL2 会随机整机 panic —— 2026-10-05 实测）

诊断结论：近 10 天内 WSL2 内核 5 次 `Kernel panic - not syncing: Fatal machine check`
（9-27 16:20 / 9-30 18:03 / 10-3 14:20 / 10-3 14:53 / 10-5 22:47，签名逐字相同，
`mce: [Hardware Error]: Processor context corrupt`，见 `%TEMP%\wsl-crashes\kernel-panic-*.txt`）。
VM 被整体带走时，同一次 panic 里所有 WSL 进程一起消失，落盘中的最后半行会留在 jsonl 里。

对采集的影响与处置：

1. **代理与网关放在 Windows 侧跑**（`capture-proxy` + `llmveto` 网关都是 node/bun 进程，与 WSL 无关）。
   `.wslconfig` 是 `networkingMode=mirrored`，WSL 里的客户端照样能连 `127.0.0.1:8790`，
   所以 WSL 会话**可以**入选，但它被 panic 带走的概率最高 —— 优先从 Windows 端 opencode 录。
2. 已加固 `var/capture-proxy.ts`：客户端硬断/上游断链时代理进程不死、把已收部分落盘并标
   `truncated: true`；`var/canary-split.ts` 剔除 `truncated` 交换与 JSON 坏行，
   判据不会被半截会话污染（清单会单列"坏行剔除""客户端中断/截断"两行）。
3. 每录完 2-3 个会话跑一次 `node var/canary-split.ts --require 10 --dry-run` 早暴露；
   被 panic 打断的会话**重录**即可，无需清理 jsonl。
4. 录制期间不要把 `raw-exchanges.jsonl` 放 WSL 侧路径（跨 9P 边界写大文件在 VM 硬切时更易留残块）。
