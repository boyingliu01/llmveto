# REL-CW R1 处置记录（代码走查 Round 1 → 处置 → Round 2 重评）

- **走查范围**：sprint/2026-10-08-01 分支可执行工件（scripts/release-gate.mjs、.github/workflows/release.yml、scripts/check-readme-parity.mjs、package.json、CHANGELOG.md）
- **R1 卷包**：var/delphi-r11/input-rel-cw-r1.md（31,214 B）；专家原始输出 var/delphi-r11/rel-cw-experts-r1.json
- **R1 执行检查**：requested_models_distinct = true（g-qwen3.8-flash / g-deepseek-flash / local-qwen3.8-27b）；all_experts_succeeded = **false**（B 角技术专家回复无可解析 JSON 裁决块，失败）
- **R1 裁决**：A（架构）REQUEST_CHANGES conf 9；C（可行性）REQUEST_CHANGES conf 9；B 失败
- **处置纪律**：任一专家失败 = 全员重跑（无单角补跑）；成功专家的 Critical/Major 零容忍逐条处置

## R1 发现与处置

| ID | 角 | 级 | 发现 | 处置 | 落点 |
|---|---|---|---|---|---|
| ARCH-C-01 | A | Critical | workflow_dispatch 触发时 GITHUB_REF_TYPE=branch，若 registry 无该版本（E404 分支）则直接 `npm publish`，构成从任意分支绕过 tag 校验的发布后门 | **修复（成立）**：publish 步加显式 tag-only 门——`GITHUB_REF_TYPE != "tag"` 即跳过 publish（dispatch 仅保留补建 Release 语义） | release.yml Publish 步 |
| C-C-01 | C | Critical | `npm publish` 自身无 EPUBLISHCONFLICT 处置；npm view 与 publish 之间的并发竞态会硬失败，违背冻结语义（AC-REL-01b "EPUBLISHCONFLICT 兜底" / publishing.md §2 情形⑤） | **修复（成立）**：publish 包裹判定——成功 → 正常；EPUBLISHCONFLICT → 按已发布兜底跳过；其他失败 → fail-closed | release.yml Publish 步 |
| ARCH-M-01 | A | Major | 递归防护与 --ignore-scripts 职责关系表述不清，易误导维护者移除 --ignore-scripts | **修复（成立，注释澄清）**：两层关系写明——主防线 = --ignore-scripts（dry-run 内 prepublishOnly 不执行）；RELEASE_GATE_RUNNING = 兜底断言（覆盖 flag 丢失/钩子直调） | release-gate.mjs publishDryRunStep + main() 两处注释 |
| C-M-01 | C | Major | CI 冒烟环境未剥 Bun：setup-bun@v2 全局加 PATH，bun 不可达断言将在 ubuntu-latest 上失败 | **反驳（不成立）**：buildSmokeEnv 的 hasBunExecutable 在非 Windows 检查裸名 `bun`（release-gate.mjs:83-89），PATH 过滤对 `$HOME/.bun/bin`（setup-bun 安装位）同样生效（:91-96）；本机 Windows（bun 在 PATH 上）全链绿灯即同一过滤逻辑的实测证据 | 登记于本记录 |
| C-M-02 | C | Major | package.json engines.bun>=1.1 可能令纯 Node 用户 npm install 告警/报错，与"纯 Node 运行时"承诺冲突 | **反驳（不成立）**：npm 仅检查 engines.node / engines.npm，未知引擎键被忽略（无告警无阻断）；engines.bun 正确表达贡献者源码运行要求（CONTRIBUTING.md 已载 Bun ≥ 1.1 + Node ≥ 18） | 登记于本记录 |
| C-N-01 | C | Minor | ORIGINAL_HEADINGS 硬编码；历史改写后会失配且无维护指引 | **采纳**：脚本头补维护约定（两表冻结快照语义 + 同 PR 同改 + --check-migration 仅迁入回放） | check-readme-parity.mjs 头注 |
| ARCH-N-01 | A | Minor | 正则级 markdown 解析对 HTML 混排容忍度低 | **采纳（约束声明）**：脚本头补解析约束（跳过围栏代码块；不支持 HTML 标题，引入前先升级脚本）——未引 markdown-it（避免为 10 标题核对引入运行时依赖，复用清单纪律） | check-readme-parity.mjs 头注 |
| C-N-02 | C | Minor | vitest 汇总行格式假设；格式变更时失败信息不够指向版本漂移 | **采纳**：解析失败信息追加"若 vitest 版本升级导致汇总行格式变更，须同步修订本脚本正则" | release-gate.mjs test 步 |

## 处置后验证

- `node --check` 两脚本语法过；`node scripts/check-readme-parity.mjs` PASS（10 标题逐对相等；5 表行数 [5,8,9,7,6]）
- 修改后全量 release:gate 本机重跑：见 `var/rel-gate-postfix.log`（结论回填处：**PASS**，gate exit=0，2026-10-09）
- release.yml 属 CI 面（tag push / dispatch 触发），本地以语法与语义评审为准，真实验证在首次 tag push（用户触发点）

## R2 换入证据

R2 全员重跑卷包 = R1 卷包全文 + 本处置记录 + 修复后工件全文；三位专家（含 B 角重跑）在交换证据上给最终立场。
