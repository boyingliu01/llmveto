# TODO — 从 Windows+Qoder 迁移到 WSL+dsh（llmveto 收尾清单）

> 基线快照（2026-11-23，WSL 实测后更新）
> - 仓库：`D:\projects\llmveto`，`main@eaf985e`（本清单与 WSL 安装手册均已入库）；npm `llmveto@0.4.1` 已发布（latest）。
> - 已完成并已随 0.4.0/0.4.1 入库：`dangerous-command-scan`（T2a 观测类）、`dsh/cliproxy` canary 路由、
>   `scripts/provider-probe.ts`、lint 迁移到 Biome、`architecture.yaml` 可被 Gate 6 解析。
> - 当前运行面（Windows）：网关 8787 由计划任务 `llmveto-gateway-autostart` 拉起；capture-proxy 8790
>   转发到 8787（给 opencode 用）；state dir = `C:\Users\admin\.llmveto`。
> - 当前运行面（WSL Ubuntu-22.04）：`dsh web --no-open --port 3080`；dsh-model engine 8317；
>   WSL 网络为 **mirrored 模式**（与 Windows 共享 localhost），故 dsh 经
>   `http://127.0.0.1:8787/dsh/cliproxy/v1` 直连 Windows 网关（已实测可用）。
> - WSL 工具链实测（只读探测）：node 24.22.3 / npm 11.19.1 / gh 2.105.0（已登录）/ gitleaks 8.30.1 /
>   semgrep、checkov、lizard 原生可用；**缺口**：bun 未装、jscpd/archlint 解析到 `/mnt/c`、`~/.local/bin`
>   不在 PATH、xp-gate 0.38.9（npm latest 0.38.125）、`[interop]` 未关、git 邮箱为占位。
> - 重建命令（幂等脚本 + 逐项验收）见 `docs/WSL-ENV-SETUP.md`；本清单只列**未完成**事项，
>   已完成的能力与验证记录见 README、CHANGELOG 与 0.4.x release notes。

## 1. 迁移前准备

- [ ] TODO 备份 Windows 侧 `C:\Users\admin\.llmveto\`（`canary-registry.json`、`evidence.jsonl`、`models-snapshot.json`、`autostart.ps1`）到 WSL 之外的独立备份目录，并记录备份时间点。
- [ ] TODO 确认 WSL 已启用 systemd（`/etc/wsl.conf` 中 `systemd=true`；`wsl --shutdown` 后 `systemctl --user status` 可用）。
- [ ] TODO 按 `docs/WSL-ENV-SETUP.md` 执行 WSL 重建脚本（幂等），其覆盖范围之外的验收点见下方 1.1。
- [ ] TODO 把 `LLMVETO_UPSTREAMS` 的当前值写入 WSL 私密 env 文件（如 `~/.config/llmveto/env`，`chmod 600`），不得进仓库、不得复制进文档或 issue。
- [ ] TODO 读出现有网关 env 全集（仅本次迁移用）：确认除 `LLMVETO_UPSTREAMS` 外没有其他 `LLMVETO_*` 覆盖项需要迁移。
- [ ] TODO 公司代理：WSL 内确认 `curl`/`git`/`gh` 能出网；需要时按既有方案用 Windows `no_proxy` + `WSLENV` 透传（curl 7.81 不认 `10.*` 绕过写法）。

### 1.1 WSL 实测缺口（2026-11-23 只读探测）

- [ ] TODO `/etc/wsl.conf` 加 `[interop] appendWindowsPath = false` 后在 PowerShell 执行 `wsl --shutdown`（会同时关闭 Ubuntu 26.04）；重启后确认 `command -v jscpd` 不再指向 `/mnt/c`。
- [ ] TODO 安装 bun 1.4.3 到 `~/.bun/bin`（与 `test.yml` 对齐；latest 1.4.5 不采用）。
- [ ] TODO 把 `~/.local/bin`、`~/.npm-global/bin`、`~/.bun/bin` 追加到 `~/.zshrc` 末尾——默认 shell 是 **zsh**；必须追加在末尾，防止被更早的硬编码 `export PATH` 覆盖（26.04 发行版有该坑）。
- [ ] TODO 升级 xp-gate 0.38.9 → latest（0.38.125）：`npm i -g @boyingliu01/xp-gate@latest` → `xp-gate update-hooks --global` → `xp-gate bootstrap`；随后用临时仓库真实提交探针确认 13 门触发（以 `.xp-gate/reports/pre-commit/*.json` 有新报告为准）。
- [ ] TODO 安装原生 `jscpd@5.4.3`（当前解析到 Windows 版）；确认 `detect-secrets` 在 PATH 中可见——已安装但不可见等于门禁静默降级。
- [ ] TODO 修正 `git config --global user.email`（当前 `boyingliu01@example.com` 是占位，GitHub 不接受）。
- [ ] TODO 代理可选：Windows 侧 `WSLENV=no_proxy` 已设，但 WSL 内 `no_proxy` 为空；出网正常可忽略，否则按 WSL-ENV-SETUP 第 3 节补全透传。

## 2. 代码仓位置

- [ ] TODO 决定仓库最终位置：建议 `~/projects/llmveto`（ext4）；`/mnt/d` 的 IO 开销是当前 Windows 开发效率低的主要原因之一。
- [ ] TODO 执行迁移：WSL 内 `git clone` 到 ext4（优先）或 `rsync -a --exclude=node_modules --exclude=dist /mnt/d/projects/llmveto/ ~/projects/llmveto/`，然后在 WSL 内按 bun 安装依赖。
- [ ] TODO 迁移后确认仓库内无硬编码宿主路径（已核实 `src/ tests/ scripts/ bench/ package.json` 均为相对路径，预期零改动）。
- [ ] TODO 行尾策略：WSL 侧 `git config core.autocrlf input`，核对 `.gitattributes`；Windows 侧 Gate MP 曾因 autocrlf 误报漂移（xp-gate #824）。
- [ ] TODO 旧目录处理：`D:\projects\llmveto` 改为只读归档或删除（迁移前确认工作区干净，无未推送提交）。
- [ ] TODO 若保留 Qoder(Windows) 双端开发：明确「只读浏览用 `\\wsl$`、构建/测试一律在 WSL 内跑」，避免 Windows 侧生成 `node_modules`/`dist` 污染 ext4 目录。

## 3. 网关迁入 WSL

- [ ] TODO 新建 systemd user unit（`~/.config/systemd/user/llmveto.service`）：
  `EnvironmentFile=%h/.config/llmveto/env`、`Environment=LLMVETO_DAEMON_CHILD=1`、
  `ExecStart=/usr/bin/node %h/projects/llmveto/dist/cli/index.js start`、`Restart=on-failure`。
  说明：CLI `start` 默认自守护（父进程 spawn detached 子进程后退出），systemd 下必须用 `LLMVETO_DAEMON_CHILD=1` 让其在前台持有事件循环（已核实 `src/cli/index.ts:85-96`）。
- [ ] TODO 明确生命周期口径：托管后停网关用 `systemctl --user stop llmveto`，不要用 `llmveto stop`（会杀进程但 systemd 会按 `Restart` 拉起），并在 README/迁移笔记中写死。
- [ ] TODO 决定 capture-proxy（`var/capture-proxy.ts`，8790）去留：opencode 一起迁 WSL 则同样用 systemd 托管；若 dsh 取代 opencode 则下线，并在 README / `~/.llmveto` 文档中标注退役。
- [ ] TODO 若保留 capture-proxy：其 `--upstream http://127.0.0.1:8787` 在 WSL 内直连 WSL 网关，无需改动代码。
- [ ] TODO 切换顺序（mirrored 网络下 Windows 与 WSL 共享 127.0.0.1，8787 只能有一个占用者）：
  ① 停 Windows 计划任务 `llmveto-gateway-autostart` 并 `Disable-ScheduledTask`；② 停 Windows 网关进程并确认 8787 已释放；
  ③ 启动 WSL 网关；④ 从 WSL 内实测 dsh 路由（canary/metrics/evidence）。
  不要反过来先起 WSL 网关——镜像模式下会因 8787 被 Windows 占用而绑定失败。
- [ ] TODO 若将来把 WSL 改回 NAT 网络：WSL→Windows 的 127.0.0.1 不再连通；迁移完成后网关在 WSL 内，此项无影响，但 capture-proxy 等跨端调用需重新核对地址。
- [ ] TODO 迁移后跑 `llmveto doctor`：受管配置路径将从 Windows 的 `%USERPROFILE%` 切到 WSL 的 `~/.config/...`，确认无 drift 或按提示重写。
- [ ] TODO 清理 Windows 残留：停用并删除计划任务、归档 `autostart.ps1`、删除 Windows 侧 `gateway.pid`/`gateway.url`（registry/evidence 保留备份）。
- [ ] TODO 实测启动顺序：先起 dsh web 再起网关时，第一笔请求会 fail-closed 502 且可恢复；把结论写进迁移笔记（是否需要 systemd `After=`/延迟启动策略）。
- [ ] TODO WSL 侧 xp-gate 重装/校验：用 `xp-gate-reinstall` 流程（快照→卸载清残留→装最新→逐项校验真实生效），不要手改门禁脚本；当前 WSL 为 0.38.9，latest 0.38.125，升级后须重跑真实提交探针。

## 4. 迁移后验收清单

- [ ] TODO `systemctl --user status llmveto` 为 active，`curl http://127.0.0.1:8787/_llmveto/metrics` 返回 JSON。
- [ ] TODO dsh 发一笔真实对话：确认响应正常、`evidence.jsonl` 新增记录、registry 新增会话条目。
- [ ] TODO canary 两端验证：注入串出现在上游实收体；`llmveto canary rotate` 在 systemd 托管下仍可经 loopback 控制通道生效（注意与 `systemctl stop` 的语义区分）。
- [ ] TODO 命令注入回归：让一个模型输出 `curl … | bash`，确认 `dangerous-command-scan` findings 落链且非流式 `action_taken=warned`。
- [ ] TODO `llmveto verify` 校验迁移后的 evidence 链完整（旧链备份 + 新链起点不混用）。
- [ ] TODO 全量测试+lint+typecheck 在 WSL 通过；`bun run release:gate` 跑一遍（POSIX 下走 npm shim / bin 符号链接分支，与 Windows `.cmd` 分支不同）。
- [ ] TODO 在 WSL 完成一次全链：改代码 → 提交（13 门实跑）→ `release:gate` 10/10 → `publish --dry-run`。
- [ ] TODO 记录 WSL 侧 xp-gate 钩子在本次提交中的实际拦截结果（Windows 侧存在已知假失败，见项目记忆）。
- [ ] TODO 保留一份「Windows 侧本地改动/计划任务/端口占用」清单，便于回退。

## 5. 发版与门禁残余

- [ ] TODO 处理孤儿 tag `v0.4.0`：CI 发布失败（ENEEDAUTH）后内容等价改发 0.4.1，但 tag 仍指向 `fc2c6b6`，无 Release、npm 无此版本。Ruleset 禁止删除/重指，需先放开权限：
  `gh api -X DELETE repos/boyingliu01/llmveto/git/refs/tags/v0.4.0`；或保留但建 Release 标注 "superseded by v0.4.1, never published to npm"。
- [ ] TODO 跟进 xp-gate #852（Gate 6 fail-open：层检查器 FAIL 只记录不阻断）：https://github.com/boyingliu01/xp-gate/issues/852 。上游修复后升级，并把 `architecture.yaml` 临时改回 `- name:` 序列形态做反向探针，确认提交被拒后再恢复。
- [ ] TODO workflow bun 版本漂移：`release.yml=1.3.14`、`test.yml/relay-nightly.yml=1.4.3`、`bench.yml=latest`，统一为同一版本。
- [ ] TODO `release.yml` 的 Node 20 弃用告警（runner 已强制 24）：升 `node-version` 或显式接受。
- [ ] TODO `src/cli/index.ts` 覆盖率约 71%（全局门已过，非发布阻断）：补 `runCli`/`status`/`doctor` 纯分支单测。
- [ ] TODO Gate 13 WARN（adapter 返回非 0/1/2/4）：WSL 下复现并定位是哪个语言臂返回 3。
- [ ] TODO Gate 2 jscpd 重复告警：`src/gateway/core.ts`、`tests/e2e/upstream-failure-resilience.test.ts`，可抽 helper 消噪（warning 不阻断）。
- [ ] TODO 生成 `.secrets.baseline`（Gate 8 目前只有 gitleaks 在跑，detect-secrets 报 baseline missing）。
- [ ] TODO #843 对账：detect-secrets/gitleaks「doctor 只看 PATH、门禁另有回退」两套结论，装好后用公认该报的密钥夹具做端到端验证。
- [ ] TODO WSL 下核对 xp-gate 已知坑：#841（Gate 7 命中 Windows checkov shim）、#838（YAML 校验器不可用即视为通过）、#839（doctor 写死不存在的插件子路径）。
- [ ] TODO 直推 main 时 Gate MW/MP 会被钩子自身跳过：若要闭环改用 PR 流程，并在 PR 描述披露。
- [ ] TODO `.sprint-state/sprint-state.json` outputs 仍写 v0.3.1 / npm blocked，属冻结历史不要改；如需活文档另起新 sprint 记录。

## 6. 检测能力收尾（迁移后继续）

- [ ] TODO 需拍板：`trae` 与 `codebuddy` 走 ACP 子进程直连供应商，**完全绕过网关**（canary/命令扫描/evidence 都不覆盖）。codebuddy 可尝试 `CODEBUDDY_BASE_URL` 改道网关；trae 未发现可用覆盖项——接受风险还是放弃这两个 provider？
- [ ] TODO canary 覆盖面：dsh 所有 OpenAI 兼容 provider 共用单一 `dsh/cliproxy` 路由键，命中能报「来自 dsh」但**不能定位到具体 provider**；如需按供应商归因，评估按 provider 拆路由（改动 `LLMVETO_UPSTREAMS` 与 `MANUAL_CANARY_MANAGED_ROUTES`）。
- [ ] TODO canary 会话键：dsh 不发送 `x-llmveto-session-id`，当前走「首条 user 文本摘要」回退键（`src/canary/session-key.ts`）。若客户端会裁剪历史导致首条 user 消息消失，会话键会漂移；抽样验证 dsh 实际请求历史形态。
- [ ] TODO canary 容量：registry TTL 24h / LRU 64，大量并发会话会淘汰旧串；评估是否上调容量或按客户端分桶（需同步改 spec 常量）。
- [ ] TODO `dangerous-command-scan` 补一条集成测试（真实网关 + mock upstream），覆盖「非流式警告落链、响应照常返回」；当前只有单测。
- [ ] TODO 已知语义差异登记：流式路径的 warn 只进 `findings`，`action_taken` 保持 `allowed`（v1 流式语义，见 `src/gateway/core.ts` D-11 注释）；如要统一，需单独评审。
- [ ] TODO 规则集扩充评估：短链/粘贴站下载（`bit.ly`、`pastebin`）、`docker run` 挂载宿主根目录、`npm install` 可疑 postinstall 提示等；每条先定误报门槛再入规则表。
- [ ] TODO FP 调优：收集真实开发对话里 `dangerous-command-scan` 的误报样本（安装教程类），决定是否加「代码上下文/负向语境」降噪或维持现状。

## 7. 模型清单与探针

- [ ] TODO 需拍板：`gemini-flash-lite` 稳定自称 "GPT-4o (2024-05-13)"、`modelscope GLM-5.2` 自称 "GLM-4-9B"（两轮复现）——保留观察、降级用途还是从 dsh 移除？自述不能作证据，需结合 tokenizer 指纹/官方接口比对再定性。
- [ ] TODO 为探针建立基线：把 `var/provider-probe-result*.json` 的通过率与 p50 固化为基线文件，后续定时跑 `--repeat 2` 做漂移对比（可挂 systemd timer）。
- [ ] TODO trae 17 个模型中仅验证过 DeepSeek-V4.1-Flash（GLM-5.3 已因 10/12 Internal error 删除）；其余 Seed/Kimi/MiMo/MiniMax/Step/Qwen 逐一探活或批量裁剪。
- [ ] TODO codebuddy 仅验证 hy4free；其余 16 个候选模型批量探活，并确认 hy4free 每日免费额度用尽后的报错形态（避免额度耗尽被误判为模型故障）。
- [ ] TODO codebuddy 响应会把内部推理泄漏进正文、长上下文召回 62s——评估是否只用于短任务，或在 dsh 侧限制该 provider 用途。
- [ ] TODO 探针增强：加入「要求输出结构化 JSON / tool-call 形态」的 prompt，观察供应商是否改写输出或剥离工具调用；现有 6 条 prompt 偏基础能力面。

## 8. 文档与收尾

- [ ] TODO 迁移完成后更新 README「开发环境」与 QUICKSTART：WSL 安装、systemd 托管、8790 去留、`llmveto stop` 与 `systemctl stop` 的区别。
- [ ] TODO 在 `docs/KNOWN-ISSUES.md` 登记：ACP 类客户端绕过网关、dsh 单路由无法按 provider 归因、流式 warn 的 `action_taken` 语义。
- [ ] TODO 若本迁移产生脚本改动（systemd unit 模板等），按项目惯例同步中英文 README 表格/标题（`scripts/check-readme-parity.mjs` 会拦截结构不一致）。
- [ ] TODO 迁移稳定 1 周后，复核 Windows 侧是否还有依赖（计划任务、`D:\projects` 引用、Qoder 工作区），确认后可彻底下线 Windows 网关链。

## 9. 已知坑速查（迁移时优先怀疑）

| 现象 | 可能原因 | 处理 |
|---|---|---|
| 提交卡在某 Gate / 全 PASS 却不落库 | 钩子跑超时被杀 | 给 commit 显式 timeout ≥600s 重跑 |
| WSL 里 Gate 7 扫描异常 | 命中 `/mnt/c` 的 Windows shim | 装原生工具；查 PATH 顺序 |
| WSL 里 `which jscpd/xp-gate` 指向 `/mnt/c` | `appendWindowsPath` 默认为 true | 关 `[interop]` + `wsl --shutdown` 后重开 |
| 工具装了但门禁说 Not found | `~/.local/bin` 不在 PATH（zsh rc 被硬编码 PATH 覆盖） | PATH 块追加到 rc **末尾** |
| Gate 8 说 PASS 但密钥没拦 | 夹具本身不被识别 + 回退路径 | 用公认会被报的串做端到端对账 |
| Gate 6 报 `layer_config_unparsable` | `architecture.yaml` 用了序列形态 | 保持 map 形式（0.4.0 已修） |
| Gate 6 报 FAIL 但提交成功 | xp-gate #852 fail-open | 以报告 JSON 为准，别把「提交成功」当通过 |
| `npm publish` ENEEDAUTH | setup-node 缺 registry-url | release.yml 已修；本地发布仍需 token |
| CRLF 相关门禁异常 | autocrlf / .gitattributes | `core.autocrlf input`，核对 .gitattributes |
| vitest 覆盖率产物为空 | Gate 5 只跑子集 | 以 `COVERAGE_ALL=1 npx vitest run --coverage` 为权威 |
