# 网关迁入 WSL：迁移记录（2026-11-23）

> 对应 `docs/TODO-wsl-dsh-migration.md` §3 / §4。本文件记录**实际执行结果**，不是计划。
> 状态：**已完成**，网关现由 WSL systemd 托管，历史证据链无缝续接。

## 1. 迁移前后对照

| 项 | 迁移前（Windows） | 迁移后（WSL） |
|---|---|---|
| 进程管理 | 计划任务 `llmveto-gateway-autostart` | `systemctl --user llmveto.service` |
| 网关进程 | `node.exe D:\projects\llmveto\dist\cli\index.js start`（PID 2236） | `/usr/bin/node ~/projects/llmveto/dist/cli/index.js start`（systemd MainPID） |
| capture-proxy 8790 | `node.exe var\capture-proxy.ts`（PID 17504） | **未迁移**（见 §5 待决） |
| state dir | `C:\Users\admin\.llmveto` | `/home/bull/.llmveto` |
| 开机自启 | 计划任务（已 Disabled） | `systemctl --user enable` + `Linger=yes` |
| 日志 | `autostart.log` | `journalctl --user -u llmveto` |
| 内存 | — | 稳态 ~220 MB RSS（RssAnon ~168 MB），40 笔压测无增长 |

## 2. 关键实现

### 2.1 systemd user unit

`~/.config/systemd/user/llmveto.service`：

```ini
[Service]
Type=simple
EnvironmentFile=%h/.config/llmveto/env
Environment=LLMVETO_DAEMON_CHILD=1
ExecStart=/usr/bin/node %h/projects/llmveto/dist/cli/index.js start
Restart=on-failure
RestartSec=3
```

**两个必须写死的点**：

1. **`LLMVETO_DAEMON_CHILD=1`**：CLI 的 `start` 默认自守护（父进程 spawn detached 子进程后退出）。不加这个变量，systemd 会看到服务立刻退出并无限重启。见 `src/cli/index.ts:91`。
2. **用 `/usr/bin/node` 而非 nvm 路径**：nvm 切换 Node 版本会让 `ExecStart` 指向不存在的文件。`/usr/bin/node`（v24.22.3）同时符合 ADR-0001「分发产物用 bundled Node ≥18 运行」的承诺。

### 2.2 私密 env

`~/.config/llmveto/env`（**chmod 600，不入库**），从 Windows 用户环境变量迁移：

```
LLMVETO_PORT=8787
LLMVETO_STATE_DIR=/home/bull/.llmveto
LLMVETO_UPSTREAM_BASE_URL=https://lab.iwhalecloud.com/gpt-proxy
LLMVETO_UPSTREAMS={"opencode/openai":"...","opencode/mimo":"...","dsh/cliproxy":"http://127.0.0.1:8317/v1"}
```

### 2.3 证据链续接（本次迁移最关键的处理）

Windows 侧 `evidence.jsonl` 已有 **1676 条**记录。直接让 WSL 新建 state dir 会产生一条 **seq 从 0 开始的全新链**，造成审计断裂。

**做法**：把历史链作为基底复制进 `~/.llmveto/`，网关启动时 `EvidenceWriter` 会读取文件尾部记录自动续接（`src/evidence/writer.ts:59`：`this.seq = last.seq + 1`）。

**验证**：迁移后首条记录 `seq=1676`（接在历史 1675 之后），全链 `verify` 通过。

> ⚠️ **不要用 `cat` 拼接两条独立链**：实测会触发 `first_bad_seq=1676 (seq_position_mismatch)`。正确做法是**替换基底后再启动**，让 writer 自己续接。

## 3. 切换顺序（mirrored 网络下 8787 只能有一个占用者）

`.wslconfig` 为 `networkingMode=mirrored`，WSL 与 Windows **共享 127.0.0.1**，因此顺序不可颠倒：

1. `Disable-ScheduledTask -TaskName 'llmveto-gateway-autostart'`（防重启后抢端口）
2. 停止 Windows 进程：网关 PID + capture-proxy PID
3. 确认 8787 已释放（`curl` 返回 `000`）
4. `systemctl --user start llmveto`

## 4. 验收结果（全部通过）

| 项 | 结果 |
|---|---|
| `systemctl --user is-enabled / is-active` | enabled / active |
| `Linger` | yes（无登录会话也常驻） |
| 8787 监听者 | 恰好 1 个（WSL 进程，`ss` 可见） |
| `/_llmveto/metrics` | 返回 JSON |
| `llmveto verify` | ok（1680 条，链连续） |
| 真实流量 | `POST /opencode/openai/...` → 上游 404（模型下线提示，17ms，转发正常）+ 证据落链 |
| 故障自愈 | `kill -9` 后 systemd 自动重启（PID 变化），journal 有记录 |
| 重启后链续接 | seq 继续递增，无断裂 |
| 内存泄漏 | 40 笔压测 RSS 增长 0.2 MB，稳定 |
| Windows 计划任务 | Disabled |

## 5. 遗留问题（需要后续决策）

### 5.1 `doctor.config-drift` 报 6 项 —— **属设计性漂移，非故障**

`MANAGED_CONFIG_IDS` 是**封闭枚举**，固定检查 `openai` / `anthropic` / `mock` 三个 provider。

- 你的 WSL `opencode.json` **只有 `whalecloud` 一个 provider**，不在枚举内；
- 因此 doctor 对这 3 个不存在的 provider 报 drift，对 `OPENCODE_MODELS_URL` 和 delphi endpoint 也报 drift（delphi 配置文件不存在）。

`--write-managed-config` 会把枚举内 provider 写向网关并通过 drift 检查，**但不会改动 `whalecloud`**。

### 5.2 ⚠️ 实际在用的 provider 未过闸（**这是本次迁移暴露的真问题**）

`whalecloud` 的 `baseURL` 仍是 `https://lab.iwhalecloud.com/gpt-proxy` —— **直连上游，完全不经网关**。

即：在你当前的主要使用路径上，canary / 命令注入扫描 / evidence **都没有生效**。这与 README 声明的边界一致（"Installing the gateway ≠ being protected"），但值得明确记录。

**可选处置**：
- (a) 在 `opencode.json` 手加 `whalecloud` 指向 `http://127.0.0.1:8787/opencode/whalecloud`，并在 `LLMVETO_UPSTREAMS` 加对应路由；
- (b) 若 opencode 已不常用（主力是 dsh），先接受现状并登记。

### 5.3 `dsh/cliproxy` 路由指向 8317，但该引擎当前未运行

`LLMVETO_UPSTREAMS` 中 `dsh/cliproxy → http://127.0.0.1:8317/v1`，而 8317 在 WSL 内**无进程监听**。该路由目前会 fail-closed 502。属独立问题（dsh-model engine 未启动），不影响网关本身。

### 5.4 capture-proxy 8790 未迁移

原 Windows 上 `var/capture-proxy.ts`（8790）给 opencode 用。本次仅迁移网关 8787。若 opencode 仍需 8790，需另行建 systemd unit 或确认下线。

## 6. 回退步骤

```powershell
# PowerShell（若需退回 Windows 网关注管）
Enable-ScheduledTask -TaskName 'llmveto-gateway-autostart'
Start-ScheduledTask  -TaskName 'llmveto-gateway-autostart'
```

```bash
# WSL 内先停，避免端口冲突
systemctl --user stop llmveto.service
systemctl --user disable llmveto.service
```

备份在 `~/backups/llmveto-windows-20261123-173107/`（含 1676 条 evidence、canary-registry、models-snapshot、autostart.ps1）。

## 7. 日常运维速查

| 操作 | 命令 |
|---|---|
| 看状态 | `systemctl --user status llmveto` |
| 看日志 | `journalctl --user -u llmveto -f` |
| **重启/停止** | `systemctl --user restart\|stop llmveto` |
| ⚠️ 不要用 | `llmveto stop`（systemd 会按 `Restart=on-failure` 拉回） |
| 改配置后生效 | `systemctl --user restart llmveto` |
| 校验证据链 | `llmveto verify`（或 `LLMVETO_STATE_DIR=/home/bull/.llmveto node dist/cli/index.js verify`） |
