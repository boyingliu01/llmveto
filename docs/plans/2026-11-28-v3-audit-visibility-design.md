# v3 审计可见性：设计

- 日期：2026-11-28
- 需求：`.sprint-state/review/v3-audit-gap-requirements.md`（delphi R2，100% 共识）
- 定位：**配置遗漏可见性，不是绕过检测**

## D-01 这个功能为什么存在，以及它不是什么

**存在的理由**：用户配了三五个客户端，其中一个忘记接网关，或升级后配置漂移。
他以为全在保护下，实际有一个裸奔。`llmveto audit` 回答：
> 你声明在用的 agent 中，哪些在最近窗口里没有网关流量？

**它不是什么**：不是绕过检测。delphi R1 三席一致否决了那个定位，理由是
判据依赖攻击者控制的证据（日志可删、声明是自报）。本机无 auditd/eBPF，
无可信遥测源。那条路已单独登记为 #3 待评估。

**这个区分必须写进代码注释**，因为一个叫"检测"的模块会被人当成防线。

## D-02 数据来源

```
~/.config/llmveto/watched.json     ← 用户声明（人工编写）
~/.llmveto/evidence.jsonl           ← 网关实际流量（已有）
```

两者对比。**不引入任何新的采集机制**——这正是它能诚实的原因：
它只读用户自己写的清单，不假装知道网关外发生了什么。

### watched.json

```jsonc
{
  "schema_version": 1,
  "agents": ["claude-code", "codex", "opencode"],
  "window_days": 7
}
```

- `agents`：客户端标识，与 evidence 的 `client` 字段**精确匹配**（大小写敏感，
  不做归一化——归一化会让 `Codex` 和 `codex` 被当成同一个，反而制造假遗漏）
- `window_days`：可选，默认 7，范围 1..90

## D-03 判定逻辑

对每个声明的 agent：

| 条件 | 状态 | 含义 |
|---|---|---|
| 窗口内有流量 | `active` | 正常 |
| 窗口内无流量，但历史上有 | `stale` | 可能停用了，也可能最近绕过了 |
| 从未有过流量 | `missing` | 声明了但从没见过——最可疑 |

**为什么区分 `stale` 与 `missing`**：`missing` 通常是配置写错（客户端 id 拼错）
或压根没接；`stale` 通常是"最近没怎么用"。混成一个会让用户无法判断该看哪条。

## D-04 三种失败状态（都不能是 PASS）

| 情况 | doctor | audit 输出 |
|---|---|---|
| `watched.json` 不存在 | `[SKIP]` 未启用 | 提示如何启用 |
| JSON 损坏 | `[FAIL]` 无法解析 | 明确错误位置 |
| 声明为空数组 | `[SKIP]` 空清单 | 提示加条目 |

**为什么不是 PASS**：PASS 意味着"检查过且没问题"。没检查过的东西不能报 PASS——
这是本项目反复出现的教训（`coverageOf`、`persistState`、Gate 8 的 `reason: ""`）。

## D-05 时间窗

- 基准：**evidence 记录自身的 `ts`**，不是文件 mtime
- 窗口：`[now - window_days, now]`，**左闭右开**
- `now` 注入（测试不依赖真实时钟）

## D-06 输出形态

```
$ llmveto audit
watched: 3 agents, window: 7 days

  active   opencode      42 requests, last 2026-11-28T00:12:03Z
  stale    claude-code    8 requests, last 2026-11-19T14:02:11Z  (older than window)
  missing  codex          0 requests — declared but never seen
```

`missing` 行是唯一需要用户行动的。`stale` 是信息性的。

### 退出码（delphi 设计评审技术席修订）

| 码 | 含义 |
|---|---|
| 0 | 全部 `active`，或只有 `stale` |
| 1 | **命令本身失败**（`watched.json` 损坏、evidence 不可读） |
| 2 | 检出 `missing`（配置遗漏） |

**为什么不把 `missing` 用 1**：1 的通用语义是"工具出错"。让"查出了问题"和"工具坏了"
共用一个码，CI 里无法区分该修配置还是该修工具。用 2 与"参数/发现类"对齐。

**加 `--strict` 可直接用退出码表达**：不带 `--strict` 时 `missing` 仍返回 2，
但脚本可以选择只看输出。这样"发现"与"故障"在任何情况下都不混。

## D-07 模块划分

| 模块 | 职责 |
|---|---|
| `src/audit/watch-list.ts` | 读 `watched.json`、校验、失败状态 |
| `src/audit/coverage.ts` | 对比 evidence，产出 `active`/`stale`/`missing` |
| `src/cli/index.ts` | `audit` 子命令 + `doctor` 检查项 |

架构约束：`src/audit/` 只依赖 `shared` 与 `evidence`，**不 import gateway**——
它读落盘数据，不参与流量路径。

## D-08 不写 evidence

审计结果**不写进 evidence 链**。

理由：evidence 是 append-only 的流量事件链，`verify` 按流量语义校验它。
塞进"配置检查结果"会让链的语义混杂，也会让 `verify` 的判据变模糊。

结果只走 stdout + `doctor`。

## 边界情况（delphi 设计评审技术席修订）

### 空 evidence

`evidence.jsonl` 不存在或为空 → 所有声明的 agent 都是 **`missing`**（不是 `stale`）。

理由：`stale` 的定义是"历史上有过、窗口内没有"；从没有过就是 `missing`。
这让不变量 #2（`missing` 与 `stale` 不混用）在空数据下仍然成立。

### 已知 client 提示

`audit` 输出末尾固定附加 evidence 里**实际出现过的 client**：

```
known clients in evidence: dsh, opencode, delphi, healthz, unknown
```

用途：用户把 `codex` 拼成 `Codex` 时，能对照实际值自己发现拼错。
**不做自动归一化**（那会制造假匹配），只提供对照。

`healthz`、`unknown` 这类非客户端值也在列表里——它们确实出现在 evidence 里，
隐瞒反而让人困惑。

## 不变量（各配断言）

1. `watched.json` 缺失/损坏/空 → 绝不报 PASS
2. `missing` 与 `stale` 不混用
3. 客户端 id 精确匹配，不做大小写归一
4. 窗口边界左闭右开
5. 审计不写 evidence（`verify` 仍然只看到流量事件）

## 风险

| 风险 | 缓解 |
|---|---|
| 用户以为它能防绕过 | 代码注释 + 输出首行写"这是配置检查，不是绕过检测" |
| 客户端 id 拼错 → 假 `missing` | 输出里列出 evidence 中**实际存在**的 client 列表供对照 |
| 窗口太长 → stale 被当成 active | 默认 7 天，`stale` 明确标注"last seen 早于窗口" |
