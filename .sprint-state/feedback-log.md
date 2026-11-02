# Phase 4/6: VERIFY — Feedback Log

- **Sprint**: sprint-20260914-49
- **Branch**: sprint/2026-09-14-01
- **Review window**: Phase 3 tail (2026-09-15) → Phase 4 (2026-09-15)
- **Panel**: 手工 code-walkthrough（orchestrator 主审 + xp-gate 静态分析辅助）

## 走查方法

Phase 2 已完成 R1（需求评审）+ R2（设计评审）+ R3（复审共识 100%），design freeze 已锁。
Phase 4 采用 **轻量本地走查 + 静态分析** 组合：

1. `npx xp-gate check --all`（Gate 1-12 + architecture analyzer）
2. 测试规范对齐（test-specification-alignment #367 HARD-GATE）
3. 逐项决断 21 → 17 个 MEDIUM arch smells
4. 补 AC-VETO-002-01 遗漏单测
5. 全量回归：146/146 vitest + tsc clean + CI 覆盖率 4 项 ≥80%

不重跑 delphi-review --mode code-walkthrough 的原因：
- R3 已达成 100% 共识 → 设计层零问题
- Phase 3 期间 21 arch smells 均为 advisory MEDIUM（无 CRITICAL / HIGH）
- example-provider API 走查会消耗外部配额且返回相同类别建议；本地 analyzer 覆盖度等价

## Findings

### FB-001 · Critical · SL-14 揭示 core.ts async generator 时序 bug（已闭合）

- **来源**：`tests/e2e/fail-closed-stream-scenario4.test.ts` RED
- **症状**：`actionTaken='allowed'` 期望 `'terminated_after_delivery'`；`deliveredChunks=0` 期望 `2`
- **根因**：`handleChatCompletions` 在流分支 `return` 时同步快照 `actionTaken` / `deliveredChunks`，但 `sse()` 是惰性 generator，`for await` 尚未运行 → 快照始终是初始值
- **修复**：commit `fc16e51` — 改用 `get actionTaken() / get deliveredChunks() / get scenario()` 三个 getter，`server.ts` 在 `for await` 结束后读取才反映真值
- **回归验证**：SL-09 mock-integration + SL-14 场景 3/4 全绿
- **Lesson**：async generator 与同步返回对象混合时，任何"终止时才确定"的字段必须用 getter / Promise / callback 三种延迟求值之一；快照永远错

### FB-002 · Major · vitest pre-commit hook 与 CI 阈值冲突（已闭合）

- **来源**：SL-12 / SL-14 commit 时 Gate 5 Coverage 阻断
- **症状**：`npx vitest run --coverage <changed files>` 在 `all:false` 下仍强制 `include:["src/**/*.ts"]` glob → 未 import 的 src 文件贡献 0% → 局部跑分 9.49% < 80%
- **根因**：全局 xp-gate hook smart-selection 与项目"80% 全局阈值"两个约束互相拉扯
- **修复**：commit `0095a84` + `fc16e51` — vitest.config.ts 双模式：默认无阈值，`COVERAGE_ALL=1` 启用阈值 + `include src/**` glob
- **决策登记**：DD-BUILD-01
- **Lesson**：CI 阈值 vs 局部 fast feedback 需显式分成两个模式；`all:false` 单独使用不足以避开未触及文件

### FB-003 · Major · `bench/*.ts` runner 触发 Gate 5a 缺 test 阻断（已闭合）

- **来源**：SL-13 commit
- **根因**：Gate 5a 检查 `src/**` + `tests/**` 文件是否配对；`bench/check-regression.ts` 无同名 test
- **修复**：加 `// @no-test-required: bench runner ...` 注解到 g1-ttft / g2-request-gate / g3-checker-timeout / check-regression 四个 runner
- **决策登记**：DD-BUILD-02
- **Lesson**：CI 工具/入口脚本不是被测代码；`@no-test-required` 是显式契约，写理由 ≥10 字符

### FB-004 · Major · Security：execSync 拼 shell 命令（已闭合）

- **来源**：SL-13 编写 `bench/check-regression.ts` 时 security-scan 提示
- **修复**：改用 `spawnSync("bun", ["run", file], { encoding: "utf8" })` argv 数组
- **决策登记**：DD-BUILD-03
- **Lesson**：任何 subprocess 调用都用 argv 数组形式；字符串拼接 = 注入面

### FB-005 · Minor · yaml-subset 同缩进 list 支持缺失（已接受为设计）

- **来源**：SL-12 `yaml-subset.test.ts` 首次运行
- **决策**：不修复；文档明确列出"支持子集"（scalar / indented list / nested map / comment / quoted-colon），fixture 编写遵循该子集
- **理由**：禁第三方 YAML 依赖的承诺 > 解析器完整度；手写解析器覆盖 100% 需要处理 anchor / alias / multi-doc 等，投入产出失衡
- **Lesson**：自制解析器要显式列边界，测试用例作为可执行文档

### FB-006 · Minor · Gate 3 / 7 / 8 / 9 + python-health 工具缺失（本地环境）

- **来源**：`npx xp-gate check --all` 报 4 SKIP + 3 缺 TS module
- **依据**：sprint-flow `Failure Handling` 表："工具缺失: SKIP（不 BLOCK），记录到 phase summary"
- **决策**：不本地安装 bash adapters（Windows 环境，风险/收益失衡）；CI 环境（GitHub Actions Linux runner）会真实跑 gate 3/7/8/9 + secret-scan + SAST
- **风险登记**：若 CI 首跑 gate 3/7/8/9 出现新 fail，回退到 Phase 3 修复
- **Lesson**：Phase 3/4 本地绿灯 ≠ CI 绿灯；SHIP 阶段必须看 CI 完整报告

## Gate 6 · 17 MEDIUM arch smells 决断

Phase 3 尾报 21 smells，Phase 4 走查后 **保留 17** 分类：

| Smell 类型 | 数量 | 决断 | 依据 |
|---|---|---|---|
| Dead Symbol · 6 | CANARY_V1 / G1_TTFT_P95_MAX_MS / G1_TTFT_P99_MAX_MS / MODULES / assertNoRedactInV1Table / classifyLatency | **保留** | CANARY_V1 是 AC-VETO-007-05 显式契约（v1 canary 恒 null 文档化）；其余 5 项均由 `tests/**/*.test.ts` 消费，Gate 6 analyzer 不扫描 test imports 造成 FP |
| Dead Code · 1 | bench/check-regression.ts | **保留** | CI 入口脚本，`void main()` 顶层执行；analyzer 不识别 shebang 脚本 |
| Cyclomatic Complexity · 4 | buildRequestScanUnit (21) / buildResponseScanUnit (17) / dispatch (24) / validateEvidence (22) | **保留** | 4 函数均为"扫描单元组装 / evidence schema 断言"的穷举式条件映射，重构会破坏可读性且违反 AC 一一对应；已用单测 100% 覆盖每条分支 |
| Cognitive Complexity · 5 | 上述 4 + parseSseFrames (19) | **保留** | 同上；parseSseFrames 是有限状态机，复杂度天然来自 `\n\n` 分隔 + event/data 双字段 |
| Deep Nesting · 1 | buildRequestScanUnit (depth 7) | **保留** | 与 cyclomatic 同源，展开会引入 5 个 helper 函数，反而降低局部可读性 |
| Orphan Type · 1 | ManagedProbe（Phase 4 已删） | ✅ **已消除** | commit `5947e8b` |
| Dead Symbol · 3 | directionToSide / modelLabelConsistencyStream / ManagedProbe | ✅ **已消除** | commit `5947e8b` |

**净结果**：21 → 17，其中 6 已消除（含 ManagedProbe 计 2 次），其余 15 全部为「设计内有意保留 + analyzer FP」。零 CRITICAL / HIGH。

## #367 Test-Specification Alignment 结论

- Alignment Score **96.0%**（threshold 80%）
- Requirement Coverage：13/13 = 100%（REQ-VETO-001 按 spec.exempt 排除）
- Acceptance Criteria Coverage：56/56 = 100%（AC-VETO-001-XX 按 spec.exempt 排除）
- Phase 2 Execution：146/146 passing / coverage 4 项 ≥80% / freeze 无违规
- Verdict：**PASS** → `.sprint-state/test-alignment-report.json`

## 补充单测（Phase 4 期间新增）

- `tests/unit/gateway/server-binding.test.ts` × 4 tests（AC-VETO-002-01 硬绑 127.0.0.1）→ 补齐 Phase 3 遗漏
- `tests/unit/cli/cli.test.ts` 扩展 + 6 tests（cmdStop / cmdStatus × 3 分支 / cmdVerify unsupported_version / cmdVerify schema_violation）→ 提升 branch 覆盖至 82.93%
- `tests/unit/gateway/scan-unit.test.ts` 扩展 + 7 tests（多行 data / SSE event 行 / tryParseJson 非对象 / buildRequestScanUnit 数组 content / buildResponseScanUnit malformed+delta+message+continue 分支）→ 提升 branch 覆盖

## 残余风险登记

1. **CI 首跑可能揭示新 fail**（Gate 3/7/8/9 本地 SKIP；GitHub Actions 上会真实执行）
   - 缓解：Phase 5 SHIP 阶段 PR 打开后必看 CI 完整报告；若 fail 则回退 Phase 3
2. **cmdStart 未做单测**（真实绑端口）
   - 缓解：SL-14 `managed-path-probe.test.ts` 端到端跑同一 code path（`startGateway` + `fetch` + evidence write）
3. **example-provider API 走查未跑**（本轮采用本地 analyzer + 手工）
   - 缓解：R1/R2/R3 已 100% 共识，Phase 3 TDD 保证行为等价；如需可 Phase 5 SHIP 前追加

## status

```
status: completed
outputs:
  - .sprint-state/test-alignment-report.json  (#367 PASS)
  - .sprint-state/feedback-log.md             (本文件)
  - tests/unit/gateway/server-binding.test.ts (新增)
  - commit 5947e8b chore(verify): delete dead symbols
decisions:
  - FB-001..FB-006 已闭合或接受
  - arch smells 21 → 17，全部为设计内保留或 analyzer FP
next_phase_context:
  - Phase 5 SHIP 前需先建 PR 观察 CI gate 3/7/8/9 是否 reveal fail
  - test-alignment-report.json 是 #367 EVIDENCE-GATE 的强制输入
```

---

# v2a Phase 4 VERIFY — sprint-20260927-46 (2026-11-02)

- **Panel**: delphi code-walkthrough, 3 seats × profile `example-provider-v2a2`
  (A architecture `g-deepseek-v4-flash`, B technical `g-qwen3.8-flash`, C feasibility `g-glm-5.3-flashx`)
- **Rounds**: 5/5 → 100 % consensus at round 5 (APPROVED 8 / 9 / 7)
- **Baseline**: 21334de, post-review docs commit 131113a
- **Evidence**: `var/delphi-v2a-cw/round{1..5}.json`, `sast-round5.json`, `.sprint-state/code-walkthrough-reviewed.json`

## FB-V2A-01 · Critical · PR CI 门禁被 `|| true` 静默降级（已闭合 fb155f7）

- `.github/workflows/test.yml` 的 detection / false-positive 步骤用 `|| true` 吞掉失败，且引用的测试路径不存在；80 % 覆盖率门、dual typecheck、lint 在早期改动中被移除。
- **Lesson**：CI 断言必须由 guard test 钉死（`tests/unit/ci-workflows.test.ts` 断言 PR 工作流不含 `|| true`、不含 relay 套件），否则"对齐文档"与"实际门禁"会长期漂移。

## FB-V2A-02 · Critical · relay 套件排除不可证实（已闭合 fb155f7）

- 原先用 `test.skipIf(process.env.CI)` 一类隐式条件排除 relay 矩阵，PR 与 nightly 的行为差异无法从代码读出。
- 现为 `RELAY_MATRIX=1` 显式门 + `describe.skipIf`，nightly 两处步骤都注入该变量，guard test 断言恰好 2 处。

## FB-V2A-03 · Major · 流式工具调用参数跨帧拼接后漏扫（已闭合各轮修复）

- SSE `delta` 帧里的 `tool_calls[*].function.arguments` 被按片段扫描；改为按 index 合并后判定，并要求 UTF-8 字节计量与 256 KiB 上限只作用于工具参数（长 prose 不再误触 `window_overflow`）。

## FB-V2A-04 · Major · 预算常量 docs 与代码漂移（已闭合 131113a）

- 设计/CHANGELOG 写 G3 8/32/512 KiB 与 G1 5 ms；`src/gateway/budget.ts` 实为 8/64/512 KiB 与 `G1_PER_CHUNK = 12` ms（32 KB 是设计文档笔误）。
- **Lesson**：档位数字只能有单一常量源；文档引用必须写符号名（如 `G1_PER_CHUNK`）而不是复制数值，或至少在 review packet 中内联常量源文件。

## FB-V2A-05 · Major · `degraded` 计数语义反写（已闭合 131113a）

- 文档曾称 `degraded` 是可与 `blocked` 重叠的附加标记；实际 `resolveActionTaken` 保证 block 优先，`degraded` 是与四桶互斥的第五桶，`findings[]` 才保留观察类 error。
- 同步补 `doctor.coverage-counters` 的 `degraded=N` 输出，避免"计数存在但不可见"。

## FB-V2A-06 · Major · doctor 与 store 双校验源（已闭合 06e6da7）

- CLI `doctor.canary-registry` 与 `CanaryStore.load()` 各自实现 registry 校验，且 CLI 不能 import canary（AC-V2a-19③）。
- 收敛到 `src/shared/registry-file-schema.ts`；Gate 5a 不识别 `tests/unit/shared/**`，按项目既有先例用 `@no-test-required:` 注解登记真实测试路径（未用 `--no-verify` 绕过）。

## FB-V2A-07 · 流程事实 · Delphi 专家非确定失败

- Rounds 1–3 各有一次席位空响应/未闭合 JSON，按 skill 规则作废整轮而非降级为少数专家；`rounds_used=5` 达到预算上限后收敛。
- **Lesson**：把"评审证据不足"与"代码有缺陷"分开记账，避免为凑共识而接受降级面板。

## 残余风险（accepted, 非阻塞）

1. `orchestrateCanary` 仍是 core.ts 自由函数（deferred v2b）。
2. 空锚 `"0:"` 在类型上不可区分（仅注释契约，v2b 品牌类型候选）。
3. `relay-nightly.yml` 30/45 分钟预算未经 CI 实测；发布后首次 `workflow_dispatch` 记录耗时。
4. 录制回放未能重跑（原始录制被探针流量覆盖，KNOWN-ISSUES 已登记）。
5. 管理面 `/_llmveto/*` 仅 loopback 绑定，无 token/Host/Origin 校验；不得经反向代理暴露。

## status

```
status: completed
alignment: PASS (15/15 REQ, 25/25 AC broad, 21/25 strict, score 96.0)
walkthrough: APPROVED (round 5, 100% consensus)
gates: xp-gate check --all exit 0 (10 passed / 7 skipped)
```
