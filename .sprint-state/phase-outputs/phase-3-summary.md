# Phase 3/6: BUILD — Phase Summary

- **Sprint**: sprint-20260914-49
- **Branch**: sprint/2026-09-14-01
- **Completed at**: 2026-09-15
- **Build mode**: ralph-loop（默认，REQ 级迭代 + 全量回归）

## Gate 通过状态

| 门禁 | 状态 | 证据 |
|---|---|---|
| BUILD-ENTRY-CONTRACT | ✅ 14 REQ ↔ 14 slice 全覆盖，无孤儿/缺口 | Phase 2 出口已锁；`.sprint-state/slices-manifest.json` |
| GITHOOKS-GATE | ✅ xp-gate pre-commit 已安装，每次 commit 触发 Gate 1-12 | 6 个 feature commit 全部通过 pre-commit |
| DELPHI-GATE | ✅ R3 三专家全票 APPROVED_WITH_CONDITIONS，共识 100% ≥ 91% | `.sprint-state/review/delphi-reviewed.json` |
| TDD 铁律（RED→GREEN→REFACTOR） | ✅ 每 slice 测试与实现同 commit | git log 中 6 次 feat commit 均含 `tests/`+`src/` 双文件 |
| 全量回归 | ✅ `npx vitest run` 142/142 通过 · `npx tsc --noEmit` clean · `COVERAGE_ALL=1 vitest --coverage` 4 项全 ≥80% | 见下"验证证据" |
| Coverage CI 阈值（80% global） | ✅ stmts 92.02% · branch 82.93% · funcs 95.94% · lines 94.95% | vitest coverage report |

## 14 slice 完成状态

| Slice | REQ | 标题 | Commit | 关键交付物 |
|---|---|---|---|---|
| SL-01 | REQ-VETO-001 | 前置决策门 G-LIC / G-FP / G-BENCH | `d939a54` | `docs/licenses.md` · `bench/baseline.json` 骨架 · fpverify fixtures |
| SL-02 | REQ-VETO-003 | checker: egress-secret-scan | `d939a54` | `src/checkers/egress-secret-scan.ts` + `src/shared/types.ts` + 10 unit tests |
| SL-03 | REQ-VETO-004 | checker: invisible-unicode-scan（跨 chunk 滚动窗口） | `eff473b` | `src/checkers/invisible-unicode-scan.ts` + `src/shared/scan-window.ts` + 7 tests（含 E2 80 8B 拆两片） |
| SL-04 | REQ-VETO-005 | checker: model-label-consistency | `eff473b` | `src/checkers/model-label-consistency.ts` + 6 tests |
| SL-05 | REQ-VETO-006 | 策略引擎：verdict → action 映射表 | `eff473b` | `src/policy/{mapping,engine}.ts` + 11 tests（含 redact 不出现断言） |
| SL-06 | REQ-VETO-007 | evidence store：JSONL + SHA-256 链 + fsync best-effort | `b546d09` | `src/evidence/{schema,writer,chain,redact-sink}.ts` + 9 tests |
| SL-07 | REQ-VETO-010 | llmveto verify：链完整性 + schema 断言 | `b546d09` | `src/evidence/verify.ts` + `src/cli/verify` 分支 + 6 tests |
| SL-08 | REQ-VETO-009 | 接入适配器：OpenCode + Delphi + MANAGED_CONFIG_IDS 封闭枚举 | `b546d09` | `src/adapters/{opencode,delphi,index}.ts` + 7 tests |
| SL-09 | REQ-VETO-002 | 反代核：baseURL 形态 + SSE tee + scan-unit + veto-mid-stream | `b546d09` | `src/gateway/{server,scan-unit,sse-tee,core}.ts` + 6 tests |
| SL-10 | REQ-VETO-011 | mock-upstream：纯 TS 声明式脚本回放 | `b546d09` | `tests/utils/mock-upstream.ts` + 4 tests（含 chunk 边界自定义） |
| SL-11 | REQ-VETO-008 | CLI：start/stop/status/doctor + verify 装配 | `b546d09` + `5c558f1` | `src/cli/index.ts` + 14 tests（覆盖 4 命令 + verify 三态 + status 双分支） |
| SL-12 | REQ-VETO-012 | 威胁样本库 + benign 语料 + 双矩阵 | `0095a84` | `tests/fixtures/{threats,benign}/*` + `detection-matrix` + `false-positive-matrix` + yaml-subset 工具 |
| SL-13 | REQ-VETO-013 | 性能三台门 G1/G2/G3 + baseline + CI workflow | `f1baa2c` | `bench/{g1-ttft,g2-request-gate,g3-checker-timeout,regression-formula,check-regression}.ts` + `bench/baseline.json` + `.github/workflows/bench.yml` |
| SL-14 | REQ-VETO-014 | 端到端演练：受管路径过闸 + fail-closed 场景 1/2/3/4 + doctor 漂移 + verify | `fc16e51` | 7 个 e2e tests：`managed-path-probe` / `delphi-path` / `fail-closed-request` / `fail-closed-stream-scenario{3,4}` / `doctor-drift` / `verify-chain` |

## 提交历史

```
5c558f1 test(sl-11,sl-09): extend branch coverage for CLI status/stop/verify + scan-unit variants
fc16e51 feat(SL-14): end-to-end drills for managed path + fail-closed scenarios + doctor/verify (REQ-VETO-014)
f1baa2c feat(SL-13): performance gates G1/G2/G3 + regression formula + CI bench workflow (REQ-VETO-013)
0095a84 feat(SL-12): threat fixtures + detection/false-positive matrices (REQ-VETO-012)
b546d09 feat(SL-06..SL-11): evidence store + verify + adapters + gateway + mock-upstream + CLI
eff473b feat(SL-03,SL-04,SL-05): checkers (invisible-unicode + model-label) + policy engine
d939a54 feat(SL-01,SL-02): pre-decision gates + egress-secret-scan checker
```

## 验证证据

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 142 tests / 24 files / 0 failures（4.30s） |
| `COVERAGE_ALL=1 npx vitest run --coverage` | exit 0；stmts 92.02% · branch 82.93% · funcs 95.94% · lines 94.95% |
| `npx xp-gate check --all` | 6/10 gate(s) passed + 4 SKIP（详见下表） |
| `npx vitest run tests/unit/architecture-boundaries.test.ts` | 2 tests passed（checker 不 import gateway/evidence/policy） |

### xp-gate check --all 分解

| Gate | 状态 | 说明 |
|---|---|---|
| Gate 1 (Duplicate Code) | ✅ PASS | — |
| Gate 2 (Clean Code) | ✅ PASS | — |
| Gate 3 (Cyclomatic Complexity) | ⚠ SKIP | `adapters/gate-3.sh` 本地未安装（bash fallback 不可用） |
| Gate 4 (Principles) | ✅ PASS | No violations found |
| Gate 5 (Tests + Coverage) | ✅ PASS | 4-file subset，无 thresholds（默认模式） |
| Gate 6 (Architecture + Boy Scout) | ⚠ ADVISORY | 21 MEDIUM smells（Dead Symbol 9 + Cyclomatic 4 + Cognitive 5 + Deep Nesting 1 + Orphan Type 1 + Dead Code 1）；不阻断，登记至 Phase 4 VERIFY backlog |
| Gate 7 (IaC Security) | ⚠ SKIP | `adapters/gate-7.sh` 本地未安装 |
| Gate 8 (Secret Scanning) | ⚠ SKIP | `adapters/gate-8.sh` 本地未安装 |
| Gate 9 (SAST Security) | ⚠ SKIP | `adapters/gate-9.sh` 本地未安装 |
| python-health / test-layers / pbt | ⚠ SKIP | TypeScript module not found + no bash fallback |

工具缺失 SKIP 规则：**"工具缺失: SKIP（不 BLOCK），记录到 phase summary"**（sprint-flow `Failure Handling` 表）。CI（GitHub Actions）中 `bench.yml` + `pnpm test` 提供二次门禁。

## 架构决策记录（Phase 3 期间新增）

| ID | 决策 | 上下文 |
|---|---|---|
| DD-BUILD-01 | **vitest 双模式覆盖**：默认（pre-commit smart-selection hook）不设阈值 + `all:false`；CI（`COVERAGE_ALL=1`）启用 80% 阈值 + `all:true` + `include src/**/*.ts`。原因：局部 hook 运行子集测试文件时，`all:false + include` 会把未触及文件计入 0%，误伤 80% 阈值 | `vitest.config.ts` |
| DD-BUILD-02 | **@no-test-required 注解**：`bench/*.ts` runner（g1-ttft / g2-request-gate / g3-checker-timeout / check-regression）不配单元测试（属 CI 工具，非 lib），Gate 5a 通过注解绕过 | `bench/g2-request-gate.ts` 等 |
| DD-BUILD-03 | **spawnSync 替代 execSync**：`bench/check-regression.ts` CI 入口用 argv 数组形式 `spawnSync("bun", ["run", file])`，避免 shell 注入 | `bench/check-regression.ts` |
| DD-BUILD-04 | **getter 修复 async generator 时序**：`core.ts` `handleChatCompletions` 返回 stream 时用 `get actionTaken / deliveredChunks / scenario` 惰性求值，让 `server.ts` 在 `for await` 完成后再读，反映终止时的真值（AC-VETO-014-05 场景 4 关键契约）。这是 SL-14 的 e2e test `fail-closed-stream-scenario4.test.ts` 唯一发现的 bug | `src/gateway/core.ts:205-215` |
| DD-BUILD-05 | **禁止第三方 YAML 依赖**：`tests/utils/yaml-subset.ts` 手写解析器（支持 scalar / indented list / nested map / comment / quoted colon），供 fixture 加载；禁 `js-yaml` 保持零运行时依赖承诺 | `tests/utils/yaml-subset.ts` |

## Learnings（ralph-loop 输出）

**permanent**（架构级，跨 slice 复用）：
- checker 层禁 import gateway / evidence / policy（`tests/unit/architecture-boundaries.test.ts` 双重锁）
- v1 映射表禁 `redact` action（`SL-05` 断言 + `ROADMAP §v1` 唯一权威清单）
- MANAGED_CONFIG_IDS 封闭枚举贯穿 adapters / doctor / harness（可观测契约 #3）
- 认证类头 6 名单一次性排除出 scan-unit text（AC-VETO-002-06，阻断类 FP=0 物理前提）
- vitest 双模式（默认 hook smart-selection 不设阈值 / CI 80% 阈值）
- async generator 惰性求值 + 外层快照 = 时序 bug；跨边界返回值须用 getter

**contextual**（本 sprint 内有效）：
- `bench/*.ts` runner 属 CI 工具，加 `@no-test-required`
- 零出境证明：mock-upstream.requests=0 是唯一硬断言（SL-14 fail-closed-request）
- verify 三种失败模式（`no_file` / `unsupported_version` / `schema_violation` / `chain_broken`）各占 CLI 一个 stderr 分支

## 已知残留（Phase 4 VERIFY 输入）

1. **21 MEDIUM arch smells**：Gate 6 advisory 报告（Dead Symbol / Cyclomatic 15-24 / Cognitive 19-52 / Deep Nesting / Orphan Type）。不阻断 Phase 3；Phase 4 code-walkthrough 时逐项决断"保留 or 重构"。
2. **CLI cmdStart 未测**：cmdStart 会真实 `startGateway()` 绑端口，单测覆盖需要 mock server 或用 ephemeral port。当前依赖 SL-14 e2e（`managed-path-probe.test.ts`）覆盖同调用栈。
3. **`bench/baseline.json` 数值来源**：本地单轮采样（WARMUP=50 / N=200），CI 首次运行 bench.yml 时会重刷；G3×0.6 ADR 触发条件已在 `g3-checker-timeout.ts` 内建。
4. **`src/index.ts` MODULES 常量 dead**：Gate 6 Dead Symbol 报告；留待 Phase 4 决定是否导出。

## Phase 4 输入要点

- **code-walkthrough** 目标：14 slice × 每 slice 关键 AC 断言点；重点核 `core.ts` getter 语义 / `verify.ts` 四态 / `mapping.ts` 无 redact / 6 认证头 / MANAGED_CONFIG_IDS 遍历
- **test-specification-alignment (#367 HARD-GATE)**：`@test REQ-XXX` + `@covers AC-XXX-XX` 与 `specification.yaml.requirements` 双向映射；当前 `@test` 注解覆盖 SL-02..SL-14
- **feedback-log.md** 必建（Phase 4→5 门禁）
- **xp-gate check --all** 已在 Phase 3 尾跑通（6 pass + 4 SKIP）；Phase 4 需附加 delphi code-walkthrough 结果

## status

```
status: completed
outputs:
  - src/{shared,checkers,policy,evidence,adapters,gateway,cli}/  (7 层完整实现)
  - tests/{unit,integration,e2e,utils,fixtures}/ (142 tests / 24 files)
  - bench/{g1-ttft,g2-request-gate,g3-checker-timeout,regression-formula,check-regression}.ts
  - bench/baseline.json
  - .github/workflows/bench.yml
  - vitest.config.ts (双模式)
  - 7 commits: d939a54..5c558f1
decisions:
  - DD-BUILD-01 vitest 双模式
  - DD-BUILD-02 @no-test-required
  - DD-BUILD-03 spawnSync
  - DD-BUILD-04 getter 修复 async generator
  - DD-BUILD-05 禁 yaml 第三方
next_phase_context:
  - 142/142 tests green · CI 覆盖率 4 项 ≥80%
  - 21 arch smells 待 Phase 4 决断
  - test-specification-alignment #367 报告待生成
```
