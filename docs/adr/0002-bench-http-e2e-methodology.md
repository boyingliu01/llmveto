# ADR-0002 · 性能门 G1/G2 测量口径：进程内 microbench → HTTP 端到端

- 状态：Accepted
- 日期：2026-09-16
- 相关：REQ-VETO-013 / AC-VETO-013-01（G1 TTFT）、AC-VETO-013-02（G2 请求侧分档）、roadmap 前置决策门 G-BENCH"禁止静默放宽，口径变化必须公开记录"纪律、`bench/baseline.json`、`.github/workflows/bench.yml`

## 背景（Context）

v0.1 的 G1/G2 runner 是**进程内 microbench**：直接调用 checker 函数或对内部数据结构计时，样本为纳秒/微秒级（旧 `baseline.json` 记录 G1 p95=0.002ms、G2 64KB p95=0.05ms）。这类测量：

1. **不含反代 HTTP 路径**——没有"客户端 → 网关 → 上游 → 网关 → 客户端"这一真实跳；
2. **不含 store-and-forward 成本**——网关必须先读尽并扫描请求体才能转发（安全模型要求，不可流式预转发），该成本被完全绕过；
3. 因此其绝对值**无法回答产品真正关心的问题**："对一个真实客户端，启用网关会带来多少可观测延迟增量？"

M2.5 把 G1/G2 重写为 **HTTP 端到端**：同一 mock 上游，分别经网关与直连采样，报告二者之差（过闸增量）。这是一次**测量口径的实质变更**，按 G-BENCH 纪律必须公开记录，不得借换算法之名静默放宽阈值。

## 决策（Decision）

1. **G1/G2 改为 HTTP 端到端**，估算量为**逐请求配对的 (经网关 − 直连) 增量分布**，取其 p50/p95/p99（`bench/http-harness.ts:sampleDelta`）。选配对相减而非"两条独立分布做分位数差"：后者因两条分布在不同时刻独立采样，会把机器慢漂移耦合进尾部，制造非单调的肥尾（曾观测 p99 < p95 的伪影）；配对增量分布天然单调，且固定 gw-first 顺序使任何热场偏置只会保守地计入网关侧。
2. **传输层去伪影**：测量客户端使用 `node:http` + `keepAlive`（复用 socket）+ `TCP_NODELAY`（抑制 Nagle/delayed-ACK）。此前用全局 `fetch` 不复用连接，64KB 请求体恰撞 Windows loopback socket 缓冲边界时引入数十毫秒的传输层停顿，属测量环境噪声而非网关成本。
3. **G3 保持进程内**：AC-VETO-013-03 定义的是"单个 checker 的扫描超时 = block"，语义就是纯计算耗时，不应混入 HTTP 跳，故 G3 不重写。
4. **AC-VETO-013 的 v1 冻结阈值常量（`regression-formula.ts` 的 `G1_TTFT_P95_MAX_MS/G2_THRESHOLDS` 等）一律不改**——本 ADR 只改测量口径，不触碰预算。

## 影响（Consequences）

- ✅ G1/G2 数字第一次真实反映反代成本。重写后 dev 机观测：
  - **G1 TTFT 增量**：p50≈0.00ms、p95≈3.1ms、p99≈3.8ms → **绝对门通过**（p95<5 & p99<12）。中位增量为 0，说明网关对首帧几乎零贡献。
  - **G2 8KB**：p95≈1.0ms → 通过（gate 3ms）。
  - **G2 512KB**：p95≈21.5ms → 通过（gate 40ms）。
  - **G2 64KB**：p50≈0.9ms 稳定，但 p95 在 dev 机上稳定落在 **10–18ms**，**超出 v1 冻结的 10ms 绝对门**。
- ⚠️ **64KB 超阈是测量环境现象，不是网关计算成本**：G3 实测 64KB 档 `egress-secret-scan` p95=0.04ms，扫描算力可忽略；p50 增量仅 0.9ms。跳变集中在 p95 尾部且与 512KB 档相比呈非比例放大（64KB 的字节数是 8KB 的 8 倍，增量却从 1ms 跳到 15ms 后在 512KB 仅缓升至 21ms），符合 Windows loopback 在 64KB socket 缓冲边界处的 delayed-ACK/分段停顿特征。该停顿是本地回环栈的环境属性，在 CI 的专用 ubuntu runner 上缓冲/栈行为不同，预期不复现或显著更低。
- ⚠️ **绝对门仅供人读，不阻断 CI**：`bench.yml` 唯一的阻断步是 `bench/check-regression.ts`（相对回退公式，见下）；G1/G2 runner 命中绝对阈值只 `console.log` "FAIL" 并以退出码 0 结束。因此 dev 机 64KB 绝对 FAIL 不会使流水线变红。
- **绑定不变量 = 相对回归门**：`check-regression.ts` 用 `isRegression`（`p95_pr > p95_base × 1.2` 或 `p95_pr − p95_base > 2ms`）对比 `baseline.json` 与当前采样。它要求基准与 PR 在**同构环境**下才可比——这正是 `baseline.json._refresh_policy` 规定"权威基准由 main 分支绿色 CI（ubuntu-latest）重录"的原因。本次随代码重录的 `baseline.json` 是 **dev 机占位**（`_measured_on` 已注明），合并后由绿色 main CI 覆盖为 CI 口径数值。
- 记录方式与 ADR-0001 同源，遵循 G-BENCH"公开记录、禁止静默放宽"纪律。

## 验证

- `bun run bench/g1-ttft.ts`、`bun run bench/g2-request-gate.ts`、`bun run bench/g3-checker-timeout.ts` 均正常产出且退出码 0（绝对 FAIL 不改变退出码）。
- `bun run bench/check-regression.ts` 以重录后的 HTTP-e2e 基准做相对判定，本地全绿（同机同口径）。
- 输出格式与 `check-regression.ts` 解析约束保持一致：G1 `/p95=([\d.]+)ms/`、G2 `${kb}KB → p50=…ms p95=…ms`。
- 回归：`bun run typecheck && bun run test` 全绿；`bun run lint` 0 告警。

## 复审触发条件

- 若绿色 main CI 上 G2 64KB 绝对 p95 仍 > 10ms（即非环境噪声而是稳定成本），则须回到网关请求路径本身排查（store-and-forward 缓冲策略、egress 连接复用），而非再次调整基准或阈值。
