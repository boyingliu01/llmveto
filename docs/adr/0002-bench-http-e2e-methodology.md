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

## 补遗（2026-09-22）：权威基线的落地机制与环境门

### 背景（Context）

Code-walkthrough 评审（R1）指出本 ADR 的空缺：正文规定"权威基准由 main 分支绿色 CI 重录"，但 `bench.yml` 只跑三台 runner + `check-regression.ts`，**没有任何重录/提交路径**；而随代码提交的 `baseline.json` 是 Windows dev 占位值。后果是流程上的鸡生蛋——每个 PR 的 bench job 都把 ubuntu 采样与 Windows 基准做相对比较（64KB 档 p95 阈值 8.66×1.2=10.39ms，而 ubuntu 与 Windows 尾部分布双双跨 4–16ms），门在权威基线落地前会持续误伤所有 PR。

### 决策（Decision）

1. **基准 schema v3：新增 `_environment` 标记**（`{ os, arch, ci }`，由 `bench/record-baseline.ts` 随录制写入）。
2. **环境门（`bench/env-gate.ts`）前置**：`check-regression.ts` 在判定前要求基准 `_environment` 与当前环境 **os/arch/ci 三字段全等**。不匹配（含 schema < 3 无标记）→ **SKIP：exit 0 非阻断** + 打印双方环境、补救指引，CI 上额外发 `::warning::` 注解。匹配 → 照常执行相对回归判定（可达 exit 1 阻断合并）。
3. **SKIP ≠ 放行**：SKIP 的语义是"相对门在当前环境不具备判别力"，不是"检查通过"。绝对门（G1/G2 各档 gate_p95）仍由 runner 逐档打印在 CI 日志；一旦权威基线落地，同一 CI 环境上相对门自动从 SKIP 转为强制（无需再改任何开关）。
4. **重录路径**：`bench.yml` 增 `workflow_dispatch` 触发 + `record` job（ubuntu-latest 跑 `bun run bench:record`，`git diff --exit-code bench/regression-formula.ts` 守卫冻结阈值零改动，`bench/baseline.json` 作为 artifact 产出）。产物**由人工下载并提交**——不引入 bot 直推 main 的写路径，main 的写权限与提交纪律保留在人工门。
5. **本地强制**：`bun run bench:record bench/baseline.local.json` 录制本机基准，再以 `LLMVETO_BENCH_BASELINE=bench/baseline.local.json bun run bench/check-regression.ts` 对拍（该文件已入 `.gitignore`）。本地录制产物的 `ci=false`，不可能被 CI 误当作权威基准使用。

### 影响（Consequences）

- ✅ CI 不再因 Windows 占位基准而确定性假红；同时"没有权威基准"这件事以 SKIP + warning 显式可见，不会静默通过。
- ✅ 权威性的转移（本机占位 → CI 录制）由数据自带标记承载，不依赖人记忆；本地录制无法伪装成 CI 基准。
- ✅ 冻结阈值仍零改动：守卫步骤在每次录制时机器化断言 `regression-formula.ts` 无 diff。
- ⚠️ 落地顺序：合并本机制后，须立即 dispatch 一次 record job 并提交产物，相对门才在 CI 上真正强制；在此之前 CI 出 SKIP 属预期状态。
- ⚠️ **过渡期零强制（2026-09-22 R2 评审后显式声明）**：从合并本机制到提交 CI 录制基准之间，bench job **没有任何阻断性性能门**——相对门 SKIP（exit 0），绝对门按上文 v2 决策（"绝对门仅供人读，不阻断 CI"）只逐档打印、不设非零退出码。`check-regression.ts` 的 SKIP 输出与 CI `::warning::` 现均明写 `no blocking performance gate in effect`，避免"逐档打印"被读成仍有强制力。因此 **dispatch record job 并提交产物是强制待办，不是可选优化**。
- ⚠️ **同构判据的已知残余**：`_environment` 仅含 os/arch/ci；GitHub `ubuntu-latest` 是异构机器池，`ci` 相同不保证 CPU/镜像同构。若后续观测到 CI 内跨 runner 的假红/假绿，应扩展判据（如 `ImageOS` / runner 标识）并复审本 ADR。
- 🔭 **后续决策点（数据驱动）**：CI 权威基准落地后，先记录 record 与 bench 日志中的绝对门逐档实测值；若各档均在冻结阈值内且余量稳定，再另行评审把绝对门升级为阻断（runner 置非零退出码）。该升级会改变 v2 记录的行为并伴随噪声假红风险，须单独修订本 ADR 后再实施。

### 验证

- `bun run bench/env-gate.test.ts`（vitest）覆盖三字段等值/不等值/缺标记/畸形（用例数与断言数以该测试文件为准，可直接核对）。
- 本地 `bun run bench/check-regression.ts` 打印 `SKIP relative regression gate — environment mismatch: baseline=win32-x64-local current=…`（提交 CI 基准后）。
- `bun run bench:record bench/baseline.local.json` 产出含 `_environment` 与 `_schema_version` 的基准文件（不入库）。

## 补遗二（2026-09-22）：相对门降噪口径 —— N 次重复采样取最小值（min-of-N）

### 背景（Context）

补遗一落地并提交 CI 权威基准后，相对门首次在 CI 真正强制执行（不再 SKIP）。当次运行与随后的重跑**连续两次判红**，且失败面全部落在相对条件上、绝对门余量宽（64KB 档 p95 1.88–2.51ms vs 门 10ms）：

| 次 | 判定 | 失败档 |
|---|---|---|
| 首跑 | FAIL exit 1 | G2 64KB：base=1.64 pr=2.330 > 1.64×1.2=1.97 |
| 重跑 | FAIL exit 1 | G2 8KB：base=1.23 pr=1.830 > 1.48；G2 64KB：base=1.64 pr=2.230 |

决定性证据是**同一 job、同一份代码、相隔数秒**的两次采样（`Run G1/G2` 独立步骤 vs `check-regression` 内部复跑）：

| 指标 | 独立步骤 | check 复跑 | 倍率 |
|---|---|---|---|
| G2 8KB p95（重跑次） | 0.60ms | 1.830ms | **3.05×** |
| G2 64KB p95（首跑次） | 1.88ms | 2.330ms | 1.24× |
| G1 p95 | 2.795ms / 2.821ms | 2.361ms / 2.964ms | 0.84× / 0.95× |

根因有两层：

1. **量级**：基线各档 p95 落在 1–6ms，1.2× 容差的绝对宽度只有 0.2–1.2ms（8KB 档仅 0.25ms、64KB 档仅 0.33ms），低于 GitHub 共享 runner 上的单次采样噪声（同 job 内同码实测差值达 0.45–1.23ms）。
2. **公式结构**：`p95_pr − p95_base > 2ms` 本意是噪声地板，但与相对条件**取或**——任一成立即判回退，故 0.69ms 的抖动也能单独构成 FAIL。

该次推送的 diff（`fab9216..aaa9799`，5 文件）**不可能造成此回归**：被测路径（`bench/g1-ttft.ts`、`bench/g2-request-gate.ts`、`bench/http-harness.ts`、`bench/regression-formula.ts`）逐字节未变（`git diff --exit-code` = 0），改动全在 bench 脚本、基线与测试侧。补遗一已预告此类风险（"`ubuntu-latest` 是异构机器池……若后续观测到 CI 内跨 runner 的假红/假绿，应扩展判据并复审本 ADR"）。

**中途方案"取中位"被本地对拍证伪**。本补遗先落地 `BENCH_REPEATS = 5` 取中位数，随即以本地同口径对拍（`bench:record` 录 5 次 → `check-regression` 再采 5 次）复核，仍判红：

| 档 | 录制 5 样本 | 检查 5 样本 | 判定 |
|---|---|---|---|
| G2 8KB | 2.23 / 1.31 / 1.90 / 1.34 / 1.26（中位 1.34） | 2.01 / 2.14 / 1.08 / 1.04 / 2.06（中位 2.01） | FAIL（1.34×1.2=1.61 < 2.01） |
| G2 64KB | 15.1 / 23.6 / 17.6 / 11.9 / 2.64（中位 15.1） | 3.77 / 4.14 / 14.4 / 12.1 / 18.1（中位 14.4） | 通过但双侧分布显著异质 |

数据形态揭示噪声不是"突发离群"而是**双峰/模式切换**：1–2ms 档存在快模式（≈1.0–1.3ms）与慢模式（≈1.9–2.2ms），两组样本各自内部紧致，干扰只把成本从快模式抬向慢模式。中位数在 5 样本下按**模式抽签**——录到多数快样本就压低基准，检查时多数慢样本就抬高 PR，两侧取中位的差可稳定地超过 1.2× 而不代表任何真实回归。离群剔除假设（少数样本被抬高）不成立，故取中位不够；而"取每组的最小值"恰好对应**不受干扰时的真成本**：干扰只会抬高测量值，最小值是最接近真值的估计量，且假红要求两侧全部 N 次采样都恰好落慢模式（概率随 N 指数下降）。

### 决策（Decision）

1. **估计量改为 N 次独立采样的最小值**（`BENCH_REPEATS = 10`、`BENCH_ESTIMATOR = "min"`，`bench/repeat.ts`）：`record-baseline.ts` 与 `check-regression.ts` 对每一档都取 N 次独立运行的各分位（p50/p95/p99）的最小值。"干扰只会抬高成本"是被测系统（本机进程 + 回环 socket）单调受扰的物理性质，故 min 是二侧同分布下的真成本下限估计。两个 runner 交替采样，避免指标间的时间偏置。中位数仍随附打印（人读用），但不参与判定。**为何 N=10**：假红的两个机制只需不同的 N——①模式抽签（1–2ms 档）：快模式可达率 p 时漏采概率为 (1−p)^N，p≈0.3 时 N=5 ≈17%、**N=10 ≈3%**；②持续漂移（大档）：N 再大也无用（见"影响"的本地实证）。故 N=10 是"消抽签"与"CI 时长"的平衡点——继续加 N 只对机制①有效，代价是 bench/record 单 job 线性增长（本地实测单次 G1≈5s、G2≈8s，N=10 时 check/record 各约 2 分钟，CI 上更短）。
2. **口径机器可比**：基准写入 `_repeats` 与 `_estimator` 标记（schema v4）；`check-regression` 的可比性前置门在环境判据之外新增 `samplingMatches`，任一标记缺失/畸形（含 schema v3 旧基准），或与当前门口径不同（含 N 漂移、统计量漂移）→ SKIP（不可比），与跨环境同一语义。避免"基准取中位 vs 门取最小"这类不同分布之间的比较。
3. **判定公式与阈值一律不变**：`isRegression` 的 1.2× 与 +2ms 照旧，AC-VETO-013 的 v1 冻结常量照旧（record job 守卫继续机器化断言 `regression-formula.ts` 零 diff）。本补遗只改**测量程序**，不改容差、不碰 G-BENCH 纪律禁区的任何一侧。
4. **重录路径不变**：dispatch record job → 人工提交产物。过渡形态（代码已落地、基准未重录）为 SKIP + `re-record required` 显式披露，不再是假红。
5. **过渡纪律**：本变更合并后必须立即重录并提交基准，否则 CI 回到零强制（"SKIP ≠ 放行"文案仍会打印）。
6. **绝对门不阻断的显式化（行为零变化）**：`bench.yml` 三台 runner 的独立步骤补 `|| true`。此前"不阻断"由 `bash -e`（无 pipefail）下 `| tee` 退出码取末命令这一 shell 默认语义**巧合地**成立，任何未来 workflow 改写都可能把它变成真阻断。本项把既有语义写成契约（提交 f1baa2c 起的既存脆弱性，见 walkthrough R5 的 A-R5-1/B-R5-1），不改变任何运行行为。

### 影响（Consequences）

- ✅ 消除已实测的假红机制：任一档假红需两侧**全部** N 次采样都被干扰抬高，概率远低于单次或中位数抽签。
- ✅ 口径漂移机器可见：基准与门若不同口径（N 或统计量），不再静默比较。
- ✅ "绝对门 print-only"从 shell 巧合升为显式契约（决策 6）。
- ⚠️ **min 是有方向的估计量**：它系统性取"无干扰底"→ 只对**确定性成本上移**（整个分布平移，如新增一次加密/一次拷贝）敏感；对"只抬高尾部分散度"的回归不敏感。这是有意识的取舍：本门职责是拦"显著性能回退"（每档 1.2× 且 2ms 地板之上的分布平移），不是测真成本。冻结容差与 +2ms 地板未因降噪而改动哪怕 1ms。
- ⚠️ **残余假红风险：持续漂移（N 不可解）**。本地对拍（win32-x64，2026-09-22）暴露第二种机制：同码、20 分钟间隔，512KB 档 min-of-10 由 20.85ms → 28.06ms（**+35%**），且其间 12 次独立采样**全部**落 28.3–31.4ms、无一次回到快模式 —— 属持续慢窗口而非抽签，任何 N 都无解。该档本机 p95 达 21–28ms（CI 同档基准 6.06ms，本机约为其 3–5 倍），使 +2ms 地板的等效余量只有 ≈10%（2/20.85），低于本机漂移幅度；CI 各档量级（1.2–6.1ms）下支配项恒为 1.2× 相对条件（20% 余量，地板等效余量 ≥33%），故本项主要影响**本地强制路径**（best-effort，判据见"验证"），不影响 CI 权威判定。复核路径：日志随附全部 N 个采样与中位数可直接定性；若 CI 也观测到同型漂移，按数据复审本 ADR（候选：为相对条件加噪声地板、或在同 job 内对拍基准修订版），**不得静默放宽**。
- ⚠️ CI 时长：bench job 内 G1/G2 各 10 次独立运行（另有 workflow 中三台 runner 的独立步骤各 1 次，用途是保留"原始单次采样"日志供方差复核），record job 同量级；实测单次 runner 各 ~1–2s，总增量可忽略。
- ⚠️ 决策 6 的代价：G3 runner 若崩溃，其独立步骤也不会报红（既存行为不变）；兜底是 record job 的 `runRunner` 非零即 throw。
- 🔭 与补遗一"后续决策点"的关系不变：绝对门由 print-only 升级为阻断仍须单独修订本 ADR。

### 验证

- `bench/check-regression.ts` 逐档打印 N 个采样值、最小值（判定值）与中位数（人读），突发样本与模式切换肉眼可辨。
- 单元：`bench/repeat.test.ts`（min 取最小/单元素/负增量/空集拒绝/**假红免疫用例**：`[2.01,2.14,1.08,1.04,2.06]` 下 min=1.04 通过而中位 2.01 会误判；median 辅助统计）、`bench/env-gate.test.ts`（口径门：一致 / 缺标记 / 畸形 / N 漂移 / 统计量漂移）。
- 本地端到端（win32-x64，2026-09-22 实跑）：`bun run bench:record bench/baseline.local.json` → `LLMVETO_BENCH_BASELINE=bench/baseline.local.json bun run bench/check-regression.ts` 同口径对拍。1–2ms 档与 G1 全部 PASS 且 min 漂移 ≤13%（G1 4.461→4.303、8KB 1.12→1.130、64KB 2.34→2.650，其中 64KB 中位 7.100ms/最大 22.28ms 被 min 正确滤除）；**512KB 档 FAIL**（20.85→24.43，+3.58ms > 2ms 地板）——定性为上述持续漂移，非本门可解，故本地强制路径为 best-effort：权威判定在 CI（该档 20% 余量）。
- 旧基准（schema v3，无 `_repeats`/`_estimator`）在新门下的 SKIP + `re-record required` 文案可达且 exit 0（本地实跑核对）。
- workflow：三台 runner 步骤加 `|| true` 后 YAML 合法、`| tee` 语义未变（行为与 f1baa2c 起的既存状态一致）。
- CI 端到端：合并后 dispatch record job 取 min 基准 → 提交 → 连续观测 bench 运行无假红（实测次数与结果随提交说明记录）。
