# WSL 开发环境重建手册（Ubuntu-22.04 · llmveto）

> 目标机：`Ubuntu-22.04`（用户 `bull`，默认 shell **zsh**，systemd 已启用，网络 mirrored）。
> 本手册在 2026-11-23 对本机 WSL 实测后生成；除「第 0 节」需在 Windows 侧执行一次外，其余命令全部在 WSL 终端里跑。
> 全部步骤幂等：重复执行只会跳过已完成项。

## 0. 实测现状（2026-11-23）

| 项 | 现状 | 结论 |
|---|---|---|
| node / npm | `/usr/bin/node` v24.22.3 · npm 11.19.1（原生） | 可用 |
| git | 2.34.1 原生；`user.email = boyingliu01@example.com`（占位） | 建议改 |
| gh / jq / gitleaks | gh 2.105.0 已登录 · jq 1.6 · gitleaks 8.30.1（`/usr/local/bin`） | 可用 |
| semgrep / checkov / lizard | `/usr/local/bin` 原生 | 可用 |
| detect-secrets | 在 `~/.local/bin`，但该目录**不在 PATH** | 需修 PATH |
| bun | `~/.bun` 只有 cache，**无二进制** | 需安装 |
| jscpd / archlint | 解析到 `/mnt/c/...AppData/Roaming/npm`（Windows 版） | 需装原生 |
| xp-gate | WSL 内 0.38.9（latest 0.38.125）；Windows 侧 0.38.75 | 需升级 |
| `core.hooksPath` | `~/.config/xp-gate/hooks`（已指向 Linux 侧钩子） | 保持 |
| Windows PATH 注入 | `/etc/wsl.conf` 无 `[interop]` → `/mnt/c/*` 挤进 PATH | 需关（Gate 2/7 会命中 Windows shim） |
| 代理 | Windows 侧 `WSLENV=no_proxy`，但 WSL 内 `no_proxy` 为空 | 出网正常则忽略 |
| 仓库 | `~/projects/llmveto` 尚不存在 | 需 clone |

## 1. Windows 侧一次性操作（关闭 Windows PATH 注入）

在 WSL 里执行第 2 节脚本后，回到 **PowerShell** 执行：

```powershell
wsl --shutdown
```

之后 Windows 的可执行文件仍可用绝对路径调用（`/mnt/c/Windows/System32/clip.exe`），但不再混进 PATH。

## 2. WSL 内：一键重建脚本

把下面整段存成 `~/wsl-dev-setup.sh`，`chmod +x` 后执行；也可以逐节复制。

```bash
#!/usr/bin/env bash
set -euo pipefail
log() { printf '\n=== %s ===\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

# ---------- 2.1 关闭 Windows PATH 注入 ----------
if ! grep -q 'appendWindowsPath' /etc/wsl.conf 2>/dev/null; then
  sudo tee -a /etc/wsl.conf >/dev/null <<'EOF'

[interop]
appendWindowsPath = false
EOF
  echo '⚠️  wsl.conf 已更新：回 PowerShell 执行 wsl --shutdown 后生效'
fi

# ---------- 2.2 PATH（追加在 rc 末尾，避免被前面的硬编码覆盖）----------
PATH_BLOCK='# llmveto-dev PATH
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"'
if ! grep -q 'llmveto-dev PATH' ~/.zshrc 2>/dev/null; then
  printf '\n%s\n' "$PATH_BLOCK" >> ~/.zshrc
fi
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"

# ---------- 2.3 系统依赖（全部已存在则跳过）----------
PKGS=""
have curl || PKGS="$PKGS curl"
have git  || PKGS="$PKGS git"
have jq   || PKGS="$PKGS jq"
[ -z "$PKGS" ] || { sudo apt-get update && sudo apt-get install -y $PKGS; }

if ! have node || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# ---------- 2.4 bun（与 CI test.yml 对齐 1.4.3）----------
if ! have bun; then
  curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.3"
  export PATH="$HOME/.bun/bin:$PATH"
fi
log "bun $(bun --version)（期望 1.4.3）"

# ---------- 2.5 xp-gate（latest）+ 钩子 + 工具 ----------
npm i -g @boyingliu01/xp-gate@latest
hash -r
log "xp-gate $(xp-gate --version)"
if [ -d "$HOME/.config/xp-gate" ]; then
  xp-gate update-hooks --global
else
  xp-gate install --global
  xp-gate update-hooks --global
fi
xp-gate bootstrap            # 只补缺失，不升级已有工具
npm i -g jscpd@5.4.3         # Gate 2 需要原生 jscpd（当前解析到 Windows 版）

# ---------- 2.6 仓库（ext4，勿放 /mnt/d）----------
mkdir -p "$HOME/projects"
if [ ! -d "$HOME/projects/llmveto/.git" ]; then
  git clone https://github.com/boyingliu01/llmveto.git "$HOME/projects/llmveto"
fi
cd "$HOME/projects/llmveto"
git config core.autocrlf input
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test

# ---------- 2.7 自检 ----------
log "工具解析路径（不应出现 /mnt/c）"
for t in node npm bun xp-gate jscpd gitleaks semgrep checkov lizard detect-secrets jq gh; do
  printf '%-14s %s\n' "$t" "$(command -v "$t" || echo MISSING)"
done
xp-gate doctor || true       # 退出码恒 0，以输出内容为准
xp-gate check-tools 2>&1 | tail -30
```

## 3. 收尾项（人工确认）

- [ ] **git 邮箱**：`git config --global user.email` 当前是 `boyingliu01@example.com` 占位，改成 GitHub 账号邮箱（或 `12345+boyingliu01@users.noreply.github.com`）。
- [ ] **gh 登录**：已登录 `boyingliu01`；换机重装时补 `gh auth login`。
- [ ] **代理（可选）**：若 WSL 内 `curl https://registry.npmjs.org/` 失败，在 Windows 用户环境变量补 `no_proxy` / `http_proxy`，并把 `WSLENV` 扩成 `http_proxy/u:https_proxy/u:no_proxy`；curl 7.81 不认 `10.*` 通配写法。
- [ ] **门禁真实触达探针**（必做一次，证明钩子不是空转）：

```bash
tmp=$(mktemp -d) && cd "$tmp" && git init -q && echo x > a.txt && git add a.txt
git commit -m probe || echo '✅ Gate 0 拦截（预期：新仓库无 VERSION 文件）'
SKIP_VERSION_CHECK=1 git commit -m probe2
ls .xp-gate/reports/pre-commit/*.json | tail -1   # 每次提交都应有新报告
```

- [ ] 在 WSL 仓库里完整跑一次 `bun run release:gate`（POSIX 分支与 Windows 的 `.cmd` 分支不同，0.3.1 的入口 bug 就是冒烟抓到的）。

## 4. 注意事项

- **xp-gate 0.38.9 → 0.38.125 是跨版本升级**：升级后先用上面的探针确认 13 门链行为，再提交真实工作；若上游又改了 Gate 0/6 行为，参考 `docs/TODO-wsl-dsh-migration.md` 第 5 节逐条对账。
- **不要用 `npm install` 装仓库依赖**：仓库只有 `bun.lock`，`npm install` 会生成 `package-lock.json` 污染 git 状态。
- **不要手改 `~/.config/xp-gate/` 下的门禁脚本**：会造成 fail-open；统一走 `xp-gate upgrade` / 重装流程。
- **另一发行版 `Ubuntu`（26.04）**：脚本同样适用，但注意其 rc 文件里若有硬编码 `export PATH=...`，2.2 节的"追加在末尾"必须保留在最后一行之后，否则 `~/.local/bin` 会被盖掉。
- 网关/systemd 搬迁（8787、capture-proxy 8790、dsh 路由）不在本手册范围，见 `docs/TODO-wsl-dsh-migration.md` 第 3 节。
