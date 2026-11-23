# canary 会话键：dsh 真实请求形态诊断（2026-11-23）

> 对应 `docs/TODO-wsl-dsh-migration.md` §6「canary 会话键」条目（P1-1）。
> 方法：解压本机 13 个真实 dsh 会话记录（`~/.dsh/sessions/*/session.v4.jsonl.zstd`，Node `zlib.zstdDecompressSync`），
> 按其实际 user 消息序列重算 `deriveSessionKey` 的回退键。**不是模拟，是真实历史数据。**

## 结论摘要

| 问题 | 实测结果 |
|---|---|
| 同一会话内跨轮漂移（原 TODO 担心的） | **不发生** ✅ 30 轮全部同键 |
| **不同会话之间撞键（原 TODO 未预料）** | **发生，且严重** ❌ 6 个不同会话共享同一个键 |

原 TODO 问的是「首条 user 被裁剪会不会导致漂移」，答案是**不会**——dsh 的历史累积从不删除首条。
但真实数据暴露了一个反向缺陷：**不同会话撞键**，导致 canary 跨会话检测失效。

## 1. 机制链条

```
dsh 不发送 x-llmveto-session-id
  → 网关走回退键 = sha256(首条 role="user" 的 text parts)
    → dsh 把「系统注入类」消息也标成 role: "user"
      → 若会话首条恰好是这类消息，且文本对所有会话相同
        → 多个会话得到同一把 canary
```

## 2. 关键实测证据

dsh 写入历史的 user 角色消息，`source.kind` 分布如下（`role` 字段实测为 `"user"`）：

| source.kind | 首条文本特征 | 是否会跨会话相同 |
|---|---|---|
| `user` | 真实用户输入 | 否（除非用户逐字重复） |
| `runtime-context` | `Current runtime context. This snapshot supersedes…` | **是**（含固定措辞，仅有工作目录等少量差异） |
| `time-context` | `Time sampled while preparing turn 1, step 1: <时间戳>` | 否（含时间戳） |
| `model-selection` | `[model changed: assistant turns above…]` | **是** |
| `agent-instructions` / `skill-catalog` | `<system-reminder>…` | **是** |
| `user-approval` | `The user changed the approval policy from "ask the user…"` | **是** |
| `tool-jobs` | `background job <随机ID> …` | 否 |

**最典型的碰撞**：6 个不同会话（`f49d29a4`、`af671945`、`b571bd24`、`760072d6`、`dc3469af`、`e7eafc18`）
首条都是同一条审批策略变更通知 → **全部得到键 `54442a56dc3a791e`**。

## 3. 影响

`canary-return-scan` 的语义是「响应里出现了**其他会话**的 canary → block」（T1a 跨会话串流检测）。
会话键相同 ⇒ `store.snapshot(sessionKey)` 彼此包含 ⇒ 这些会话共享同一把 canary ⇒
**它们之间的跨会话泄漏无法被检测到**，且会互相污染（一个会话的 canary 出现在另一个会话响应里时
被判为「自己的」而排除）。

这违反 `specification.yaml` 中 `AC-V2a-17` 的字面契约：

> 异会话键不同 canary 不同；同会话 canary 相同；回退键同对话恒定

当前实现满足第 2、3 条，违反第 1 条。

## 4. 已验证的修复方向

**判据**：跳过「系统注入类」首条消息，取首个真实用户消息。

**实测验证**：按此判据在 10 个含真实用户消息的会话上重算 →
**10 个会话 10 个不同键，全部唯一**。

**障碍**：`source.kind` 是 dsh 的私有元数据，**网关在 HTTP 请求体里看不到**（它只看到 `role`/`content`）。
因此项目侧若要自愈，只能用**文本特征**识别注入类消息，这是脆弱的启发式。

## 5. 两条修复路径（需决策）

### 路径 A：让 dsh 发送会话头（推荐）

dsh 的 `request-headers` 钩子能拿到 `sessionId`（`dsh-llm-pi-ai/lib/index.js:1959-1965`，
`request` 对象含 `sessionId`），可配置为写入 `x-llmveto-session-id`。

- **优点**：命中 spec 设计的头优先路径，一次解决所有注入类碰撞与裁剪漂移；无需改项目代码。
- **缺点**：依赖 dsh 配置；`sessionAffinityFormat: "withhold"` 表明上游协议本身不带该字段，
  由 harness 侧注入需确认可行性。

### 路径 B：项目侧按文本特征跳过注入类消息

在 `fallbackKey` 里跳过以 `Current runtime context.`、`The user changed the approval policy`、
`[model changed:`、`<system-reminder>` 开头的首条消息。

- **优点**：不依赖客户端配合。
- **缺点**：脆弱（dsh 改文案即失效）；可能误伤真实用户以这些字符串开头的消息；需同步改 spec 常量。

## 6. 修复实施（路径 A，2026-11-23 完成）

新建 DSH Host 插件 `~/.dsh/plugins/llmveto-session-header`，监听
`llm-pi-ai/request-headers` waterfall，把 DSH 的 `sessionId` 写入 `x-llmveto-session-id`。

### 验证（真实 dsh 流量，非模拟）

用一个记录请求头的本地捕获器替换 whalecloud 的 baseURL，让运行中的 dsh 实例发真实推理请求：

| 观察 | 结果 |
|---|---|
| dsh 真实请求是否带该头 | **是**，7 条请求全部带上 |
| 两个不同会话的头 | `session-dc3469af-…` / `session-4cb8d1bd-…`（**不同**） |
| 同一会话多次请求的头 | 恒定同一个值 |
| 插件对无 sessionId 的调用 | 不写头（不伪造） |
| 插件对非法值 | 不写头 |

### 修复前后对比（用捕获到的真实头 + 真实网关代码）

```
修复前（无头，回退键）：两个会话都得到 54442a56dc3a791e  → 撞键 ❌
修复后（带真实头）：    两个会话得到各自的 UUID       → 键不同 ✅
同会话跨轮稳定（与 body 无关）：✅
```

### 注意事项

- 插件装好后**运行中的 dsh 进程未重启**（进程启动早于安装时间），但 HMR 已使其生效——上表数据
  正是从那个未重启的进程里捕获的。
- 验证用的临时 baseURL 覆盖已还原；捕获器已停止，端口已释放。
- 该修复依赖 dsh 侧配置，**换机或重装 dsh 需重新安装此插件**（`plugin_manager` `install_bundle`
  指向 `~/.dsh/plugins/llmveto-session-header`）。

## 7. 当前状态

- **已修复**：DSH 侧插件注入会话头，撞键问题消除（见 §6 实测）。
- **项目侧尚未改动**：`deriveSessionKey` 与 spec 常量均未变更；修复走的是 spec 已设计的头优先路径，
  因此不需要改代码或改 `AC-V2a-17`。
- **残留边界**（不变）：若客户端不带该头（未装插件的其他客户端），仍走回退键，仍可能在
  「系统通知打头」的会话上撞键。这是已登记的残余风险，不是回归。
- **回退键本身仍是正确设计**：它是无头客户端的兜底，本次未削弱其作用。
