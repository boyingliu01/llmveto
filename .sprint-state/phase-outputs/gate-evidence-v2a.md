# v2a Gate Evidence — G-WINDOW / G-PERF / G-CANARY

**Sprint**: sprint-20260927-46 · **Collected**: 2026-11-02 · **Landing commit**: e873693
**Environment (local)**: Windows 10 x64 · Bun (latest) · Node v24.18.0 · loopback bench harness (mock upstream)

## G-CANARY (pre-BUILD gate) — CLOSED (2026-10-14), replay criteria deferred

- **Closure record** (`.sprint-state/slices-manifest.json` → `build_entry_gates.G-CANARY`):
  capture-proxy 采集 823 条交换 → `var/canary-split.ts` 切分 10 条真实会话
  (`session-01..10.json`, client=opencode / model=g-glm-5.3-flash；265 交换全流式全 200，
  拒绝样本 0/265，finish_reason tool_calls=256 / stop=9，规格问题 0)；
  `--require 10 --check` 退出码 0。
- **Artifact status**: `var/` 为 gitignored，当前 `var/canary-sessions/raw-exchanges.jsonl`
  已被后续探针流量覆盖（现存 10 条均为 502/401 单轮失败请求，非真实会话）。原始 823 条交换
  已不在磁盘，判据①②③（finish_reason 分布无迁移 / provider 拒绝增量 0 / 人工复核 10 条输出）
  的 canary 重放**无法在当前机器复现**，除非重新录制 10 条真实会话。
- **Injection wiring (fixed 2026-11-02)**: 落地复核发现 CLI daemon 未传 `canaryRegistryPath`，
  导致 `canary rotate` 恒 503、注入在分发物中永不生效。已按 D-02 在 `cmdStartDaemon` 接线
  `stateDir/canary-registry.json`，并由 `tests/e2e/daemon-lifecycle.test.ts` 经真实后台进程
  断言 rotate=200、registry 落盘、上游收到 `llmveto-canary-` 注入体。**默认安装对四条受管路由
  （opencode/openai|anthropic|mock、delphi/default）启用注入**；其他路由不注入。
- **Residual risk**: 注入对真实 agent 的兼容性（G-CANARY 判据①②③）未在 v2a 网关上重放验证，
  因原始录制已被覆盖。已登记为接受残差并写入 `docs/KNOWN-ISSUES.md`；注入本身由六分支单测与
  受管路由端到端测试覆盖。
- **Disposition**: gate 保持 CLOSED（构建解锁依据未变）；重放判据登记为接受残差，
  重新录制后按 `.sprint-state/g-canary-recording-spec.md` 的 `--check` 流程补跑。

## G-WINDOW (stream tool-call window) — hard bound CLOSED, statistical sample recorded

| 判据 | 结果 | 证据 |
|---|---|---|
| AC-V2a-14 单笔硬上界（2049×128B） | **PASS** | `tests/integration/stream-windows.test.ts`：Σ=262144 放行、Σ=262272 触发 `window_overflow` + `event:error` 恰一次 |
| 流式 tool_call 场景 `ttft_delta` | **PASS** | `bun run bench/g1-ttft.ts` → p50=0.000ms / p95=0.551ms / p99=1.533ms（门限 p95<5ms & p99<12ms，26 帧流式响应，warmup 50 + n=200） |
| 累积量分布 p99 < 64 KiB | **不可测（如实登记）** | 统计判据需要代表性真实流量分布；G-CANARY 录制已丢失，无法重建。ADR-0003 定该统计门**只告警不 block**，故不阻断关闭；硬上界由 AC-V2a-14 覆盖（256 KiB 严格大于语义）。 |

## G-PERF (4 new checkers on the existing benches)

`bench/g3-checker-timeout.ts` 已扩面：v1 三 checker + v2a 四新 checker（canary-return-scan /
thinking-signature-presence / tool-call-shape / usage-reconcile）的全部 `runNonStream` 面。

### G1 TTFT delta — PASS

`bun run bench/g1-ttft.ts` → p50=0.000ms p95=0.551ms p99=1.533ms（limit p95<5ms & p99<12ms）

### G3 checker budget — PASS（7 checkers × 8/64/512KB，p99 全部远低于档位）

| checker | 8KB (20ms) | 64KB (50ms) | 512KB (120ms) |
|---|---|---|---|
| egress-secret-scan | 0.01 | 0.03 | 0.18 |
| invisible-unicode-scan | 0.01 | 0.05 | 0.46 |
| model-label-consistency | 0.01 | 0.00 | 0.00 |
| canary-return-scan | 0.00 | 0.00 | 0.00 |
| thinking-signature-presence | 0.00 | 0.00 | 0.00 |
| tool-call-shape | 0.01 | 0.01 | 0.06 |
| usage-reconcile | 0.01 | 0.00 | 0.00 |

（单位 ms，p99；`bun run bench/g3-checker-timeout.ts`）

### G2 request gate — 64KB 档本地超阈，以 CI 为权威

| tier | p50 | p95 | p99 | 本地结论 |
|---|---|---|---|---|
| 8KB (limit 3ms) | 0.78–0.80 | 1.17–1.24 | 1.94–2.25 | PASS |
| 64KB (limit 10ms) | 1.16–1.26 | 13.97–16.14 | 17.92–23.24 | **FAIL（本地两次复现）** |
| 512KB (limit 40ms) | 4.08–4.52 | 26.55–27.45 | 30.29–30.42 | PASS |

两次复跑结论一致：64KB 档 p95 超 10ms，而 p50 仅 ~1.2ms，尾部离群；Linux CI 基线同档
p95=1.47ms。`bench/baseline.json` 已注明 p95/p99 尾部受测量环境支配、绝对门以
ubuntu-latest 为权威（本机为 Windows + 本地回环）。**处置**：PR 的 `bench.yml`
（ubuntu-latest）复跑作为权威判据；若 CI 同样超阈，则按 G-PERF 回退阶梯
（复测 → ADR 修订档位 → 规约变更回用户）处理，不在本地静默放宽阈值。

## Gate 5 (tests + coverage) — PASS

`npx vitest run --coverage`：57 files / **670 passed | 1 skipped**；
statements **92.77%** · branches **89.31%** · functions **94.85%** · lines **94.91%**（门限 80%）。
xp-gate pre-commit 全链（13 gates：11 PASS / 1 SKIP（Gate 11 stale-state，CLOSE 前修复）/ 1 WARN（Gate 13 无 C/C++ 编译器））
在本提交上通过。
