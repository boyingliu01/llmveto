# ADR-0001 · Node 运行时分发承诺（dist 构建 + 可移植入口）

- 状态：Accepted
- 日期：2026-09-16
- 相关：`package.json` `engines.node`、REQ-VETO-008（CLI 冻结）、roadmap 前置决策门 G-BENCH 的"公开记录"纪律

## 背景（Context）

`package.json` 自 v0.1 起声明 `engines.node: ">=18"`，README/部署说明据此承诺"装好即可用 Node 跑"。但 v0.1 的实机验证**证伪**了该承诺：

1. 源码 import 使用 `./x.ts` 显式扩展名（依赖 tsconfig `allowImportingTsExtensions`），Node 不识别 `.ts` 说明符；
2. `src/evidence/writer.ts` 使用构造器参数属性（`constructor(private readonly …)`），Node 的类型剥离（`--experimental-strip-types`，Node ≥22.6）无法处理该语法，Node 18/20 更是完全不能直接运行 `.ts`；
3. CLI 入口用 `import.meta.main` 判断"是否被直接执行"，该属性仅 Bun 与 Node ≥24 具备，Node 18/20 恒为 `undefined` → 入口静默不执行。

结论：**"源码即分发物"与"Node ≥18 可运行"二者不可同时成立**。这是产品级缺陷（测试全绿但装不起来），必须显式消解而非含糊带过。

## 决策（Decision）

**将编译产物 `dist/`（纯 ESM JavaScript）作为唯一分发物；源码仅供 Bun 开发态直接运行。**

具体：

1. **构建**：新增 `tsconfig.build.json`（`extends ./tsconfig.json`），开启 `rewriteRelativeImportExtensions`（把 `./x.ts` 说明符改写为 `./x.js`）、`noEmit:false`、`outDir:dist`、`rootDir:src`、`types:["node"]`。`bun run build` 产出 `dist/**/*.js`（+ `.d.ts` + sourcemap）。
2. **入口可移植化**：CLI 不再依赖 `import.meta.main`，改用 `isDirectRun(import.meta.url)`——把本模块文件路径与 `process.argv[1]` 归一化（`resolve` + `fileURLToPath`）后比对。Bun 跑源码、Node 跑 dist 均成立；被 vitest 作为模块 import 时不误触发。
3. **shebang**：源码头保持 `#!/usr/bin/env node`（Bun 经 `bun run` 显式调用，忽略 shebang；tsc 原样保留该行到 dist）。
4. **bin 指向 dist**：`package.json` `bin.llmveto` 改为 `./dist/cli/index.js`，`files` 白名单含 `dist`。分发前置 `build`。
5. **双 typecheck 门**：`typecheck`（全量 noEmit，含 tests）与 `typecheck:dist`（构建配置 noEmit）并存，确保 dist 配置不漂移。

## 影响（Consequences）

- ✅ `engines.node: ">=18"` 承诺由 dist 兑现（实测 `node dist/cli/index.js status|bogus|<no-arg>` 正确退出并分派）。运行时只用 Node 标准库 + 全局 `fetch`（Node ≥18 提供），无 Bun 专有 API。
- ✅ 消除了"参数属性 / `.ts` 说明符 / `import.meta.main`"三处 Node 不可运行根因。
- ⚠️ 安装/试用前必须 `bun run build`；`dist/` 纳入 `.gitignore`，不入库。
- ⚠️ `package.json` 保持 `"private": true` 为**有意**（2026-09-22 评审确认）：v1 不经 npm registry 发布，故不存在 `prepublishOnly` 等发布期钩子，README 不得引用之。分发路径 = 本地 clone → `bun run build` → `npm link`（或直接 `node dist/cli/index.js`）。转为公开发布须另行决策：去掉 `private`、补发布前构建/校验门，并更新本文档。
- ⚠️ 开发态仍走 `bun run src/cli/index.ts …`（即时、无构建）；仅分发/冒烟用 dist。两套入口由同一 `runCli` 纯函数收敛，行为一致。
- 记录方式遵循 roadmap G-BENCH 同类纪律：口径变化必须**公开记录**，禁止静默放宽。

## 验证

- 构建：`bun run build` 成功产出 `dist/`。
- Node 直跑：`node dist/cli/index.js`（无参/未知命令 exit 2；`status` 未运行 exit 1）——见本 ADR 关联的 CLI 黑盒冒烟测试（M1.1）。
- 回归：`bun run typecheck && bun run test` 全绿；`bun run lint` 0 告警。
