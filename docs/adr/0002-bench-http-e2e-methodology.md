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
- **绑定不变量 = 相对回归门**：`check-regression.ts` 用 `isRegression`（`p95_pr > p95_base × 1.2` 或 `p95_pr − p95_base > 2ms`）对比 `baseline.json` 与当前采样。**口径演进**：判定分位数已于补遗三改为 p50，入参为 `isRegression({base_ms, pr_ms})`——本段 p95 公式为该时代口径，保留为历史。它要求基准与 PR 在**同构环境**下才可比——这正是 `baseline.json._refresh_policy` 规定"权威基准由 main 分支绿色 CI（ubuntu-latest）重录"的原因。本次随代码重录的 `baseline.json` 是 **dev 机占位**（`_measured_on` 已注明），合并后由绿色 main CI 覆盖为 CI 口径数值。
- 记录方式与 ADR-0001 同源，遵循 G-BENCH"公开记录、禁止静默放宽"纪律。

## 验证

- `bun run bench/g1-ttft.ts`、`bun run bench/g2-request-gate.ts`、`bun run bench/g3-checker-timeout.ts` 均正常产出且退出码 0（绝对 FAIL 不改变退出码）。
- `bun run bench/check-regression.ts` 以重录后的 HTTP-e2e 基准做相对判定，本地全绿（同机同口径）。
- 输出格式与 `check-regression.ts` 解析约束保持一致：G1 `/p95=([\d.]+)ms/`、G2 `${kb}KB → p50=…ms p95=…ms`。**口径演进**：现行解析契约为 `bench/runner-format.ts` 的行首锚定常量/工厂（record 与 check 双侧共用，R8-B-M3），判定分位数为 p50——见补遗三。
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
6. **写入路径守卫**（2026-09-22 R8 走查收口；R2-B-2/R2-C-M2 加固；R9-B-1/R9-C-M1/A-R9-2 收口；R9R2-B-1/B-2/B-3/B-6/C-2 已知残余成文（该批登记于 `eeeba3e`，即 R10 匿名轮的评审对象）；R10R1-B-1 升级为"名字折叠 + 身份折叠"双判据，③④⑤ 由登记转为代码收口；R10R2-C-M1 再加**宿主折叠**（先剥 `:` 流后缀），④ 从"仅对**已存在**的流名成立"扩为任意流名；R10R3-A-m4 把 tracked 侧的 stat 异常与 out 侧的正常缺席分开、前者定向告警，R10R3-B-m4/C-m1 在守卫**之外**加采样前只读预检；R10R4 把整段守卫由可执行脚本抽为**受测模块** `bench/out-path-guard.ts`（C-m4，形态矩阵自此进 vitest/CI 阻断面；`ino === 0` 的哨兵退让同时抽成纯函数 `identityOf`，理由与 `plat` 形参同源——CI 在 linux 造不出报 0 的文件系统，不注入就永远只剩人工探针）、补 NTFS 流名的字面约束（A-m2）、成文预检目录腿的 win32 平台边界（B-m2））：`record-baseline.ts` 拒绝在非 CI 环境覆写 tracked 的 `bench/baseline.json`（须显式传 out 路径，如 `bench/baseline.local.json`）——权威基线的 repo 内保真锚点（见补遗三）不得被本地运行静默改写。out 路径**归一后比较**：先做**文件系统解析**（`realpath`，解引用 symlink、按平台原生规则取回真实大小写与长名），目标尚不存在或不可解析时退化为词法 `resolve`；**其后两条分支一律**在大小写不敏感平台（win32/darwin 默认 FS）折叠大小写（非仅 fallback 分支）。据此 `./bench/baseline.json`、`bench/./baseline.json`、反斜杠变体、`BENCH/BASELINE.JSON` 型大小写变体、8.3 短名与指向 tracked 的符号链接均与 tracked 路径同判；以 `-` 开头的未知 flag、空串/纯空白 out 路径直接拒绝。**身份判据**（R10R1-B-1 升级；与路径折叠取**或**）：`statSync` 的 `dev:ino` 相等即同一文件——路径归一只折叠**名字**，折叠不掉"同一字节另有名字"的别名形态。`ino === 0`（文件系统不报文件 ID 的常见哨兵值，两个不同文件会假等）或任一路径 stat 失败（尚不存在，**或 ACL 令 stat 被拒**）时该判据退让为 `null`，守卫回落为纯路径折叠，不会把"不存在"误判成"同一文件"。退让的**两支不同类**（R10R3-A-m4/B-m3/C-m2）：out 侧 stat 失败是合法高频场景（首次录制目标尚不存在），告警必刷屏故保持静默；tracked 侧在仓内必在，其 stat 抛错本身即异常事件、且令身份判据对全部别名形态静默失效 → 以 `statThrows()` 把"stat 抛错"与"`ino === 0` 正常降级"分开，只在**前者**打一条定向 `console.warn`（健康路径永不触发）。**宿主折叠**（R10R2-C-M1）：win32 上 `:` 只可能来自 NTFS 备用数据流引用（文件名本身禁用该字符），而 realpath/stat 对**尚不存在**的流一律 ENOENT → 前两判据同时为假，`baseline.json:<任意新流名>` 可穿透；故折叠前把末段首个 `:` 及其后的全部流后缀剥掉（多级流 `baseline.json:a:b` 一并剥净），把判定对象折回宿主文件后走名字+身份双判据。合法路径末段不含 `:`，此步恒等 —— **只增拒绝，不放宽**（17 形态矩阵见验证节）。**写可达性预检**（R10R3-B-m4/C-m1，守卫**之外**、紧随其后的独立步骤）：守卫只判"这个 out 路径是不是受保护文件"，不判"写不写得下去"。错拼目录 / 只读卷 / 空宿主（流后缀折叠后为 `""`）此前穿过守卫、跑满 10×3 采样（约 80–90s）才在 `writeFileSync` 处 ENOENT——资源浪费且失败信号误导（非保真缺陷：tracked 零风险、最终 fail-loud）。现由 `assertWritableOutPath()` 在采样前以**只读**判定即刻 throw（宿主非空 / **NTFS 流名字面合法** / 父目录存在且可写 / 目标若存在须是可写的普通文件）：**不 mkdir、不 touch、不以 append 模式打开**（那会留下 0 字节文件或改动 mtime），也**不宣称消除 TOCTOU**（与残余 ② 同型），只把"必然失败"提前到失败最便宜处。两件事不合并、顺序也在守卫之后，以免"受保护"与"写不了"两种拒绝理由混成一条。**流名字面约束**（R10R4-A-m2）：宿主折叠后剩下的流后缀若为**空串或含 `:`**，该路径写不出任何东西——实测 `file:`、`file::`、`file:a:b`、`file:a:b:c` 即使宿主文件存在也一律 ENOENT，只有 `file:tag` / `file:$DATA` 合法；此前预检只看宿主，这三类穿过预检、跑满 10×3 采样才在 `writeFileSync` 处失败，正是本函数要消灭的形态（A 提出的另一候选"登记为已知残余"未采：代码收口只增拒绝、且一并覆盖 `::` 与 `:a:b`，比 A 建议的"尾冒号"正则更宽）。**目录腿的平台边界**（R10R4-B-m2 成文，不改代码）：`accessSync(dir, W_OK)` 在 win32 **近乎恒真**——libuv 只看只读**属性**且对目录忽略该属性，故 `icacls /deny (WD)` 的目录被假阳性放行；后果仅退回"跑满采样后 ENOENT"的旧行为，**无正确性损失**。不在 win32 上补齐的原因是不存在"既不误拒也不漏放"的目录可写探测：写探测会留 0 字节文件或改 mtime（违反只读约束），子进程调 `icacls` 则把一个防误操作守卫变成新的失败面。Linux（CI 与 record job 所在处）由内核 `access(2)` 真拦；文件侧的 `W_OK` 两平台都可靠，目录侧另由"存在但非普通文件"这条独立判据守住。**受测化**（R10R4-C-m4）：上述全部判据（宿主/名字/身份三段折叠、argv 形态、三种拒绝措辞、预检各分支）自 `record-baseline.ts` 抽入 `bench/out-path-guard.ts`，`plat` 形参作测试注入点（CI 在 linux，否则 win32 专有分支永不可达），配套 `bench/out-path-guard.test.ts`；`record-baseline.ts` 自此只保留 argv 解析、`isCi` 放行判定与告警投递。已命名残余：`ino === 0` 一支与 UNC / `\\?\` / 8.3 短名的**端到端**折叠仍需实机（前者需 9p/网络盘，后者需 win32 realpath 与 share 权限），写在该测试文件头，不以恒真断言冒充覆盖。**信任边界**（R2-A-M2/R2-C-M1 成文）：放行判据是 `process.env.CI === "true"`，即信任"CI 平台会注入该变量"（GitHub Actions 隐式注入）——该守卫防的是**误操作**，不是防篡改的安全控制；平台迁移若不再注入，无参 record 会以拒绝文案失败（fail-loud 属预期行为）。**已知残余**（R9 R2 成文；均落在"防误操作、非防篡改"的信任模型内，需刻意构造，且**零改判据**。R10 R1 后 ③④⑤ 已由身份判据代码收口、④ 于 R10 R2 扩至任意流名，真实残余收缩为 ①②⑥）：
   - **①②（R9 已述；R10R2-B-3/C-m2 扩①的覆盖面成文；R10R3-A-m4 把①拆成三支并给出可观测性差异）**：解析失败（目标尚不存在、权限受限）的路径退化为词法比较；`check → write` 之间的 TOCTOU 窗口不做防护。**① 此前三支被一句"同为 catch-all 静默退让"合并，掩盖了正常性差异**，现分列：(a) `realpath` 词法回退——目标尚不存在/不可解析，属正常路径，静默；(b) **out 侧** `statSync` 抛错——首次录制目标尚不存在是合法高频场景，加告警必刷屏，按裁决保持静默；(c) **tracked 侧** `statSync` 抛错——tracked 文件在仓内必在，抛错即异常事件（ACL/损坏/盘未挂载），此时 `trackedIdentity` 为 `null` → `sameInode` 恒假、身份判据对**全部**别名形态（硬链接/UNC/ADS 宿主）失效、守卫降级为纯名字判定，**该支已由 R10R3-A-m4 加定向告警**（`statThrows()` 区分它与"`ino === 0` 文件系统不报 ID"的正常降级，后者不告警）。三支都**不构成**对"覆写 tracked 文件"的已知实际绕过面——tracked 文件在仓内存在即默认可解析可 stat；构造 (c) 需刻意改 ACL，且落在此守卫"防误操作、非防篡改"的信任模型内。另注：C 在 R3 提出的"拒绝文案仍宣称身份保护在位"一句经复核**不成立**（`sameInode` 恒假时别名措辞分支不可达），真实缺陷是降级本身无信号，已按告警收口而非改文案。
   - **③ UNC / admin-share 同文件形态**（R9R2-B-1）→ **已代码收口（R10R1-B-1）**：`realpath` 不折算 `//localhost/d$/…`、`\\?\UNC\…` 为盘符路径（名字不等），但其 `dev:ino` 与 tracked 文件全等 → 身份判据拦下。
   - **④ NTFS 备用数据流**（R9R2-B-2）→ **代码收口分两段**：R10R1-B-1 的身份判据只对**已存在**的流名成立（`baseline.json:<stream>` 的 stat 与主流同 `dev:ino` → 拦下）；**尚不存在**的流名使 realpath 与 stat 双双 ENOENT → 双判据皆假 → 穿透（R10R2-C-M1：C 端到端实测 `bench/baseline.json:probestreamC` exit 0 并写出 5241 字节备用流；出题方以判据级复现同一形态 —— 该路径的 realpath 与 stat 双双 ENOENT，`sameName`/`sameInode` 皆假）。R10R2 的宿主折叠（剥 `:` 后缀后判）覆盖**任意流名**，含多级流 `baseline.json:a:b` 与经典 `:$DATA`；R10R4-A-m2 进一步在预检侧补"流名必须非空且不含 `:`"的字面约束（该三型即使宿主存在也 ENOENT，属写不出东西的形态而非穿透，收口方向是**更早拒绝**而非放宽拒绝）。注：ADS 写入本就**不改主流字节**（实测 git 干净），此项收口是**从严**方向（按"不得覆写 tracked 基线文件"的字面语义一并拒绝），并非修补实际内容损坏面。
   - **⑤ 硬链接**（R9R2-C-2，出题方独立复现）→ **已代码收口（R10R1-B-1）**：`mklink /H var/x.json bench/baseline.json`（无需特权）后传该链接路径，`dev:ino` 全等 → 拦下。这是③⑤两型实际内容覆写面之一（③ 经 UNC 写 tracked 主流、⑤ 经硬链接写同一 inode 亦覆写主流），④ 只及备用流。
   - **⑥ 反向面（误拒，非放行）**（R9R2-B-3）：per-directory 大小写敏感（WSL / 目录 flag 挂载）下，仅大小写不同的两个**真实不同**文件会被折叠成同一路径而误拒其一。默认 NTFS/APFS 不可达。
   ③④⑤ 原登记为"已知残余"，其共同依据是**一句可检验的假命题**——"折叠身份要比 inode / 卷内文件 ID，
   而 Node 在 win32 不暴露该信息（posix 有 `ino`，跨三平台不统一）"。R10 R1 由 B 与出题方**双重实测否证**：
   libuv 在 win32 以卷序列号 + 文件 ID 填充 `st_dev`/`st_ino`，Bun 1.3.14 与 Node 在 win32/NTFS 实测均暴露
   真实文件 ID，且硬链接、NTFS 备用数据流、UNC/admin-share（`//localhost/d$/…`、`\\localhost\d$\…`）三类
   别名形态的 `dev:ino` 与 tracked 文件**全等**（`\\?\` 设备命名空间与 `subst` 盘另经 realpath 折名字，升级前
   本即被拒）。守卫据此升级为"名字折叠 **或** 身份折叠"双判据，③⑤ 由登记转为代码收口、④ 于该轮只收口
   了"流已存在"的一半（R10R2-C-M1 补宿主折叠后才覆盖任意流名）；真实残余收缩为 ①②（不构成实际绕过面）
   与⑥（误拒方向）。**8.3 短名折叠以平台原生解析为准**：本机实测 `realpathSync.native("bench/BASELI~1.JSO")` → 长名 `D:\projects\llmveto\bench\baseline.json`，端到端亦 refuse（C 的相反结论系其探针用了**字面**短名文件，不构成别名场景，已否证）。该守卫只限制**写路径**，不改变任何测量口径或判据。

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
- **写路径守卫形态矩阵**（win32-x64，R10 R2 复跑并扩至 17 形态，`var/delphi-r10/probe-matrix-r2.cjs`）：无参 / `./bench/baseline.json` / `bench/./baseline.json` / `bench/BASELINE.JSON` / `bench\BASELI~1.JSO`（8.3 短名）→ 全部 refuse；`--help` → unknown flag；空串 → empty out path（`bun run` 会剥掉空 argv，故该支须经 `node bench/record-baseline.ts ""` 观测）；`bench/baseline.local.json` → **放行**（8s 内已开始跑 runner，退出码非拒绝文案）。**该矩阵自 R10 R4 起不再是纯人工探针**：判据已抽入 `bench/out-path-guard.ts` 并由 `bench/out-path-guard.test.ts` 覆盖（R10R4-C-m4），本条与下三条保留为**当时的实机端到端证据**——测试面覆盖字符串折叠与身份判据（跨平台），而 8.3 短名 / UNC / `\\?\` 的端到端折叠仍只有 win32 实机能给（原因见该测试文件头）。
- **宿主折叠的流名名字空间**（R10R2-C-M1 收口后复跑，17 形态全为预期）：`bench/baseline.json:probestream`（历史上验过的那个字面量）、`:probestreamC`（**专家探针用过的判别力名字**）、`:NEW:two`（多级流）、`\baseline.json::$DATA`（经典默认流）、`//localhost/d$/…:zzz` 与 `\\?\d:\…:zzz`（别名路径 + 新流名）→ **全部 refuse**；对照修复前该六者中除已存在的 `:probestream` 外全部穿透。合法侧无回归：`bench/baseline.local.json`、`bench/dir/../baseline.local.json`、`C:\tmp\baseline.other.json`、`C:baseline.local.json`（盘符相对）、`x:y`（畸形短名）→ 全部放行。**探针全程只读判定，不写任何流**；`dir /r bench\baseline.json` 复核无残留流、主流 md5 不变、`git status` 干净。
- **NTFS 流名的字面约束**（R10 R4 实测，R10R4-A-m2 的收口依据）：流名**必须非空且不含 `:`**——`file:`、`file::`、`file:a:b`、`file:a:b:c` 四型即使宿主文件存在也一律 ENOENT（`fileExists` 为真、`open` 即败），只有 `file:tag` / `file:$DATA` 这类非空无冒号后缀才可写。上条矩阵里的"多级流"形态因此从来不是穿透，而是"根本写不出东西"；本条把它从"跑满采样后失败"改成"预检即拒"。另注两点平台事实：① `realpathSync.native` 在 win32 走 `GetFinalPathNameByHandle`，**要求目标存在**（实测不存在的宿主/流一律 ENOENT），故"词法折叠"不可能由它承担；② 同一 API 会自行把 `bench\baseline.json::$DATA` 折回宿主长名，即默认流在 win32 上有一道 plat 之外的独立防线（该象限已由测试固化，见 `out-path-guard.test.ts` 的 `runIf(win32)` 用例）。
- **身份判据的别名形态实测**（R10R1-B-1，dev=119610712 / ino=1688849860291391 与 tracked 全等）：`mklink /H`（硬链接）、`baseline.json:<已存在的 stream>`（NTFS 备用数据流）、`//localhost/d$/…` 与 `\\localhost\d$\…`（admin share）、`\\?\d:\…`（设备命名空间）、`subst X:` 盘 → 六形态端到端全部 refuse；探针结束后 `bench/baseline.json` md5 不变、`git status` 干净（ADS 经 `fs.unlinkSync("…:probestream")` 单独删除，`dir /r` 复核无残留）。⚠️ **该轮"ADS 已收口"的结论不泛化**（R10R2-C-M1）：出题方与 B 各自验的字面量流名**恰好都是已被前序探针创建过的流**，流不存在时 stat 抛错、判据退让，"六形态全部 refuse"对 `:<任意新流名>` 不成立——收口面由上条宿主折叠矩阵重新覆盖。**分工**：出题方与 B 各自独立构造并复现，C 的相反结论（字面短名文件）已否证。
- **探针的 shell 转义陷阱**（R10 R2 出题方踩坑，成文以免后人误判"守卫未生效"）：Git Bash 下 `'\\localhost\d$\…'` 形式的反斜杠会被剥成单 `\`，传给 bun 的是一个**真实不存在的别的路径**（`\localhost\d$\…` → 解析到当前盘根），守卫按语义放行该路径、最终在 `writeFileSync` 处 ENOENT 退出——这不是穿透（tracked 主流零改动，实测 md5 与 `git status` 自证），但会**白跑一整套 10×3 采样**。UNC 形态一律改用正斜杠 `//localhost/d$/…` 传入。
- **登记处守卫的执行面**（R10R1-A-M1/C-M1；R10R2-A-m2/B-2/C-m1 扩面；R10R3-A-M1 定形为**显式文件列表**）：CI bench job 的守卫步已由"只跑 `tests/unit/backlog-integrity.test.ts`"扩为单测面，并进一步改为以 `find` 的三个根目录（仅作作用域锚点）产出 `-print0` 文件列表、`mapfile -d` 收进数组、逐个真实文件路径入 vitest（本机墙钟 <2s；**用例数不写死**——上批把"20 文件 169 用例"当事实写进三处 tracked 文字，下一批实测即 170，属可漂移计数被当作命题，由 R10R3-A-m1 订正）。**为何必须是文件而非目录**（R10R3-A-M1，Major）：vitest 的位置参数是对测试文件路径的**子串过滤**、不前缀锚定，写 `… bench` 会把任何路径含 `bench` 字样的未来文件（`tests/integration/bench-*.test.ts`、`tests/e2e/benchmark.test.ts`）静默纳入这个阻断步，恰好重新引入"未在本 workflow 环境验证过的 e2e = 不可控假红源"这一该步注释明确要避免的形态；列表为空即刻 `exit 1`，绝不退化成全量。判别力实测：临时放一个 `tests/integration/bench-sentinel-probe.test.ts`，裸目录名形态 21 文件 / 显式文件列表形态 20 文件（探针验后即删）。判据公式（`bench/regression-formula.test.ts`）与 min-of-N 估计量（`bench/repeat.test.ts`）这两个"改了就会静默改变门语义"的面自此在 CI 执行面内。`tests/integration/**` 与 `tests/e2e/**`（共 12 文件）**仍无 CI 执行面**，且本仓唯一 workflow 就是 bench.yml（无任何 test job）——该对称缺口作为观测项登记于 `.sprint-state/bench-backlog.md`（`R10R2-A-m2`），不由本步冒充已消。**同批的 fail-loud 半边**（R10R4-B-M1，Major；R10R4-A-m1/C-m2 同因）：`mapfile -d '' -t … < <(find …)` 的**进程替换丢弃 find 退出码**（`bash -e` 管不到替换内部），故锚点目录被重命名/拆分时 find 只喷 stderr、其余根照常产出，本步以**缩减后的文件集转绿**——方向是假绿，比上段"多纳入"的假红更隐蔽。现三步收口：① 三个作用域锚点先各自 `[ -d ]` 显式断言，缺哪个就指名哪个；② `find` / `sort -z` 的退出码**直接**判定（列表先落临时文件，不再走进程替换）；③ `mapfile` 改从该临时文件读。实测四路径（`var/probe-workflow-guard.sh`，在 `mktemp -d` 沙箱里复刻锚点目录的**空壳**跑判定前缀，**不在真实仓内移动或改名任何目录**）：三锚点齐全 → 列表非空、rc=0；缺任一锚点 → rc=1 且文案**指名是哪个根**；`find` 自身非零 → rc=1；列表为空 → rc=1。**同一"缺锚点"形态喂给修复前的旧体**（`mapfile < <(find … | sort -z)`）→ **rc=0 且文件集静默缩减**，这是本条 Major 的正身证据。另：旧批在真实仓做过一次等价观测（三根缺一 → 少一个根的文件数而 rc=0），与沙箱结论同向。**文件集是动态求得的**，故新增受测文件（如本批的 `bench/out-path-guard.test.ts`）自动进入该阻断步，无需改 workflow。
- **写可达性预检实跑**（win32-x64，R10R3-B-m4/C-m1 收口后）：`bench/nosuchdir-r3/out.json` → **0.18s** 内 `error: out path …: parent directory bench/nosuchdir-r3 does not exist`（收口前该形态跑满 10×3 采样、约 80–90s 后才 ENOENT）；`:probestream`（宿主折叠后为空串）→ `invalid out path …: its host is empty`；对照零误伤：`bench/baseline.local.json` 照旧进入采样直至被 timeout 截断。守卫面本身无回归——tracked 本名 / 新流名 `:brandnewstream` / `mklink /H` 硬链接别名三形态各自 refuse，三种文案分支（无后缀 / `(an NTFS alternate data stream of it)` / `(same file identity via an alias path)`）逐字正确；探针后 `bench/baseline.json` md5 `3ebfaa9f6a71ecf7cb7b0d91355e2525` 不变、无 `bench/baseline.local.json` 残留、`git status` 干净。**R10 R4 增补两支**：**① 流名字面约束**（R10R4-A-m2）——上一条里的 `file:` / `file::` / `file:a:b` / `file:a:b:c` 四型此前穿过守卫、跑满采样才在 `open` 处 ENOENT（"宿主折叠后为空串"只覆盖 `baseline.json:` 一型，多级流的宿主非空故不触发该支）；现由 `assertWritableOutPath()` 在 win32 上按"流名非空且不含 `:`"即刻 throw，措辞直接说明该形态**即使宿主存在也必然失败**（实测四型各自 0.x s 截停，合法流名 `:tag` / `:$DATA` 零误伤）。**② 目录腿的平台边界**（R10R4-B-m2，成文而非整改）：`accessSync(dir, W_OK)` 在 win32 近乎恒真——libuv 的只读位检查对目录忽略，ACL deny 会假阳性放行；故本预检的目录可写性只在 posix 上有意义，父目录**存在性**在本地盘的典型失败（缺目录 / 只读卷）两平台都可靠；**例外是 UNC**（R10R5-C-m2）：不可达或无权限的共享根会让 `existsSync` 报 false 而 `accessSync` 抛 `EACCES`，落进后一条腿的 catch，故该支文案只说"无法确认可写"并带出原始 errno，不断言"该目录被设为不可写"。文件腿（目标若存在须是可写普通文件）两平台均可靠。据此不在 win32 上假装测 ACL，测试面以 `it.skipIf` 标注该能力探测而不写恒真断言。
- **tracked 侧定向告警实跑**（R10R3-A-m4）：把 cwd 换到没有 `bench/` 的目录（`var/`）令 `statSync("bench/baseline.json")` 真实抛错 → 打印 `[record-baseline] WARNING: stat on bench/baseline.json failed; the identity criterion is disabled for this run and only the path-name check protects the tracked baseline`，随后被上一条预检 fail-loud 截停；仓根正常 cwd 下该告警**零输出**（负向自证：健康路径不刷屏）。`ino === 0`（文件系统不报 ID）一支按设计不告警，靠 `statThrows()` 与"stat 抛错"分开。
- **登记处守卫的判别力（变异 + 负例，全程不触 tracked 文件）**：把 shipped parser 按花括号配平抠出后在 `var/` 的**内存副本**上逐条删规则——删"闭合行须纯 marker"→ info-string 用例回归为 1 张幻影表 / 幻影 ID 入列；删"缩进 ≤3 空格"→ 4 空格缩进用例的真表被吞（`tables=0`）；两条各自只红自己那面，证明 fixture 有判别力而非空转（R10R3-A-m2/B-m1/B-m2）。负例：人为删一行登记处 → 棘轮 81→80、超集 83→82、缺 ID 三项**同时**为假（R10R3-A-m3/C-m1 的"下界恒=实测"即以此形态成立）。

- **R10 R4 判别力实测（守卫模块 11 条变异 + 登记处 parser 4 条，全程不触 tracked 判据语义）**：判据抽入 `bench/out-path-guard.ts` 后逐条变异并跑 `bench/out-path-guard.test.ts`（`--reporter=json` 取权威红名单，脚本 `var/mut-guard-r4.mjs`）：M-a `hostPath` 不剥流后缀 → 红 7 条；M-b `canonicalPath` 无条件小写折叠 → 1；M-c 取消 `ino === 0` 哨兵退让 → 2；M-d `identityAbsent` 与"正常降级"混类 → 1；M-e argv 的 `-` 前缀分支 → 1；M-f NTFS 流名字面约束 → 1；M-g 空宿主分支 → 1；M-h 宿主折叠只认正斜杠分隔符 → 1；M-i 盘符前缀识别失效 → 1；M-j `refusal` 的 stream 支退化成 tracked → 1；M-k `identityAbsent` 恒假 → 1。**11/11 全杀，且每条只红自己那面**（M-f 只河流名字面 4 型那条、M-i 只红包符/UNC 冒号那条）。**这批变异首跑时 M-c 与 M-d 双双存活**，暴露的不是探针问题而是真缺口：`ino === 0` 那半条判据当时藏在 `fileIdentity` 的 `try` 里，只有"造一个报 0 的文件系统"才可达。据此做两件收口：① 抽出纯函数 `identityOf({dev, ino})` 作为注入点（与 `plat` 形参同一动机——CI 在 linux，win32 专有分支不注入就永远只剩人工探针），`fileIdentity` 只负责 `statSync` + 转调；② 实测发现 **win32 的 `\\.\NUL` 是一个真实存在、`statSync` 成功且报 `dev=0 ino=0` 的路径**（`var/probe-ino0.mjs`），于是"哨兵 → 身份退让**且不告警**"这一整链在 `it.runIf(win32)` 用例里端到端成立，把 M-d 也杀了。CI（linux）只跑 `identityOf` 那半，故 M-d 在 linux 上仍存活——这是**已命名的平台专有覆盖**，不是假绿（同一事实记在该测试文件头「已命名的 uncovered 面」第 2 条）。登记处 parser 侧另出 4 条变异（N-a 闭合行允许带 info string / N-b 取消缩进 ≤3 空格限制 / N-c 闭合长度不必 ≥ 开启长度 / N-d 闭合可不匹配开启字符，脚本 `var/mut-backlog-r5.mjs`），**各杀恰好 1 条**、且 N-c 与 N-d 红的是同一用例的**不同支**（R10R4-B-m1 的配平断言此前被一条"长度"变异同时掩盖）。**棘轮与锁清单随批上移**：`MIN_BACKLOG_ROWS` 81→90（= R10 R4 后实测数据行数，10 张 `ID` 表）、`LOCKED_IDS` 83→92（新增本批 9 个 ID）。探针纪律沿用上一批教训：一律 node 字符串替换（Git Bash 的 `cat <<'EOF'` 会剥反斜杠并破坏 `:?` 正则，写出静默坏文件），每次替换先做 span 计数与 no-op 检查（`occurrences ≠ 1` 或产物与原文等字节即判"无效探针"，本轮 N-c/N-d 首跑就是这样被抓出来的），结束写回原文并 `cmp` 校验还原。

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

## 补遗三（2026-09-22）：相对门判定分位数改用 p50（尾部只观测不判定）

### 背景（Context）

补遗二（min-of-10）落地并提交 CI 权威基准（`730f82e`）后，相对门在 CI 的**首次真实强制比较即判红**，且被测代码零变更：

- 触发：push `9942fcd..d334503`（backlog 登记处整改，纯文档）→ run [`35724569406`](https://github.com/boyingliu01/llmveto/actions/runs/35724569406)（bench · push · main）；
- 唯一阻断步 `Regression check vs baseline` exit 1：`FAIL G1 TTFT p95: base=1.554 pr=1.867 (min of 10; median=2.148) → p95_pr (1.867ms) > p95_base × 1.2 (1.86ms)`，**超限 0.002ms（≈+0.13%）**；第二条 `pr − base > 2ms` 差 0.313ms 未触发；
- 被测面零改动：`git diff --stat 8bb8020..d334503 -- src/ bench/ .github/` 仅含 `bench/baseline.json`（基线数据本身），且可比性门（`_environment` 与 `_repeats`/`_estimator`）全等 → 这是一次"合法比较"，问题在判据本身而非环境误配。

三次 CI 采样（同 `linux/x64/ci`、同 `_estimator=min`、`_repeats=10`、`_measured_on` 同报 AMD EPYC 7763、被测代码逐字节相同）：

| 来源 | run | G1 p50 | G1 p95 | G2 8/64/512 p95 |
|---|---|---|---|---|
| 已提交 v4 基线 | `35713318131`（record） | 0.252 | **1.554** | 0.92 / 1.47 / 3.60 |
| push 后 check 采样 | `35724569406` | （旧门不打印） | **1.867**（median 2.148） | 0.950 / 1.640 / 3.750 |
| 诊断性重录（未提交、未替换基线） | `35724920387`（record） | 0.233 | **1.948** | 0.70 / 1.62 / 3.59 |

G1 p95 三次跨度 1.554 → 1.948（**+25%**）已超 20% 容差；而 **p50 稳定**：G1 两次记录的 min-of-10 p50 为 0.252 / 0.233（−7.5%），G2 三档 p50 为 0.39/0.54/1.8 → 0.40/0.55/1.78（漂移 ≤2.7%）。同一 job 内 G1 runner（print-only 步骤，单次采样）报 p95=2.798ms，而 check 自身 min-of-10 为 1.867ms——同环境同码同口径，单次与重复采样相差约 50%，与基线 `_note` 所记"尾部双峰（快/慢模式）"一致。

结论：min-of-10 已消除补遗二的"模式抽签"假红，但 **p95 尾部的跨实例波动幅度本身 ≈ 1.2× 容差本身**（G1 档容差 0.31ms vs 实测跨实例差 0.39ms）——尾部由偶发停顿支配时，1–2ms 量级上的 20% 相对容差没有判别力。本轮**未改动任何阈值/口径**，先按观测纪律如实记录（`var/delphi-r7/ci-observation-r7.md`，含 A–E 候选方向与各自代价），交用户决策；用户于同日选定**"判定分位数改用 p50"**。

### 决策（Decision）

1. **相对门判定分位数：p95 → p50**（`bench/check-regression.ts`）。判定量 = 每档 N=10 次独立运行 **p50** 的最小值；公式（`> base × 1.2` 或 `− base > 2ms`）与全部冻结阈值常量**零改动**。理由：p50 是配对策差的分布中心，反映网关真实增量；实测跨实例漂移 ≤7.5%（p95 为 +25%），距 20% 容差有真实余量。
2. **命名去口径化**：`isRegression` 入参由 `{p95_base_ms, p95_pr_ms}` 改为 `{base_ms, pr_ms}`——分位数由调用方决定，函数只表达"相对上升超过容差"的语义；判定逻辑逐字不变。
3. **尾部（p95/p99）降为只观测**：`check-regression.ts` 逐档增打印一行 p95 对照（base/pr/median，标注 `info only, not judged`）；绝对门 runner（AC-013-01/02/03）行为不变、仍 print-only。这是有意识的能力取舍，见"影响"。
4. **规格同步**：`specification.yaml` AC-VETO-013-04 的 when/then 改为 p50 判定量并注明本 ADR 依据；冻结常量与 record job 的 `git diff --exit-code bench/regression-formula.ts` 守卫均不受影响。`docs/issues/4-test-validation.md` §回退定义 的 p95 文本保留为历史，operative 文本以 spec AC 为准；本 ADR 正文与补遗二中的 p95 判据描述亦按其时代口径保留。
5. **可比性不变、无需重录**：schema v4 基准自 v4 起就随录制写入 `p50/p95/p99` 三字段（`record-baseline.ts` 逐分位取 min），故**已提交的 CI 权威基准可直接被 p50 判据消费：无 schema bump、无零强制窗口**。已提交基线（`730f82e`）的数字与标记**一个字节未改**（保 artifact 保真，其摘要锚点见下）；其 `_purpose`/`_note` 文案属 v4 录制期文本（描述 p95 判定），随下次按 `_refresh_policy` 重录自动刷新。
6. **顺带落地两条已登记 Minor**（同一函数面，随本次一并消除）：`R6-B2`——判定数值（日志解析与基准字段两侧）一律经 `Number.isFinite` 守卫 fail-loud（NaN 经两条条件皆 false 会**静默 PASS**；本次换统计量恰好把"基准缺 p50"变成新的静默通过面，故同步消除）；`R6-B4`——G1/G2 档位正则行首锚定。
7. **不引入任何形态的放宽**：容差、地板、阈值、N、估计量、可比性判据全部不动。本批判据侧的改动面为**两处收紧**——(a) 被比较的分位数 p95 → p50（本补遗主体），(b) 决策 6 的两条防护（`finite()` fail-loud 守卫、正则行首锚定）——其余为文案/规格同步（R8-C-R2 收口：原"改的只是被比较的分位数"自述偏窄，未计 (b)）。尾部分位数仍在日志逐档呈现，供后续复审取数。

### 影响（Consequences）

- ✅ 消除已实测的 G1 相对门假红（0.002ms 超限）：p50 侧同码三次 CI 实测 0.252 / 0.233，判据稳定。
- ✅ 规格、代码、ADR 三处口径一致；`isRegression` 不再自称 p95，未来再换分位数时字段语义不误导。
- ⚠️ **尾部回归不再具备阻断力**：本门现在只拦**中心平移**（p50）；只抬高尾部分散度的回归仅在日志中可见。此前这类回归至多也只是"在 p95 判据里偶然命中"——真正的尾部拦截应来自绝对门升级（补遗一"后续决策点"，需单独修订本 ADR）。本补遗不改变该决策点的状态。
- ⚠️ **残余假红风险（p50 版）**：1.2× 的绝对宽度随 p50 变小（G1 ≈0.05ms、G2 三档 ≈0.08/0.11/0.36ms），若 PR 侧 10 次采样恰落在持续慢窗口而基线侧在快窗口，仍可判红（机制同补遗二的"持续漂移"，加大 N 不可解）。实测未出现（三次 CI 间 p50 漂移 ≤7.5%）；若观测到，按数据复审本 ADR（候选：为相对条件加显式噪声地板——那会改动判定公式，须单独修订），**不得静默放宽**。
  **量化上界（R8-A-M2 收口）**：同构 CI 环境现有实例给出两个方向的界——(a) 同估计量（min-of-10）跨实例漂移 ≤7.5%（G1 0.252→0.233）与 ≤+2.7%（G2 三档 0.39/0.54/1.8→0.40/0.55/1.78）；(b) **慢窗口包络**：run `35724569406` 内单次采样实例 p50=0.435ms 对同环境 min-of-10 基线（0.233–0.252ms）达 **1.73–1.87×**，即"PR 侧 10 次全落慢窗口"的理论上界可越过 1.2× 容差（单次 vs min-of-10 非同估计量，仅作包络参考，非本门的可达判定路径；本门两侧皆为 min-of-10）。
  **近零基线变体（R8-B-M1 收口）**：若 base 侧 min-of-10 的 p50 取整为 0，则 1.2×0=0 且 +2ms 地板为 OR 条件不构成保护——任何 pr>0 都确定性判红。本地实测 10 次 record 中 2 次打印 `p50=0.000ms`（`var/delphi-r8/probe-baseline-b.json`：base=0、pr=0.295 → FAIL exit 1）；CI 侧未观测（G1 p50 稳定 0.23–0.25）。已登记 backlog `R8-B-M1` 并纳入 OC-1 观测，`record-baseline.ts` 对判定档 p50 min=0 加 print-only 告警（不改判据）；**若 CI 复现，按上文"显式噪声地板"候选走新 ADR 修订**，不得静默放宽。
- ⚠️ **灵敏度交换的另一面**：p50 判据对"确定性成本平移"（新增一次拷贝/加密/校验）依旧敏感（min-of-10 的物理论证不变），对"纯尾部恶化"不敏感——这与"门拦显著性能回退、不测真成本"的既有取舍一致。
- ✅ 零强制窗口不存在：合并后 CI 直接进入 p50 判据下的强制比较（新代码消费既有 v4 基准的 p50 字段）。
- ✅ Minor 收敛：`R6-B2`（fail-loud 守卫）与 `R6-B4`（正则锚定）随本次落地，从 backlog 表移除。

### 验证

- 单元（`bunx vitest run bench/`）：`regression-formula.test.ts` AC-04 用例改用去口径化字段，新增"p50 量级的 CI 实测对不判回退"用例（`{base_ms: 0.252, pr_ms: 0.233}`，即本补遗两个 record run 的 G1 p50 实测对）；`env-gate.test.ts` 补 `NaN`/`±Infinity` 畸形 `_repeats` 用例（R6-B1）。
- `check-regression.ts` 实跑输出逐档两行：判定行（`p50`，含 min/median/全部采样）+ 对照行（`p95 [info only, not judged]`）。
- 本地端到端（win32-x64，2026-09-22 实跑）：`bun run bench:record bench/baseline.local.json` → `LLMVETO_BENCH_BASELINE=bench/baseline.local.json bun run bench/check-regression.ts` 同口径对拍，四档 p50 全部 PASS（G1 0.618→0.280、8KB 0.71→0.66、64KB 1.07→0.99、512KB 4.54→4.29）；并核对提交的 CI 基准在本机仍走 environment-SKIP 分支（SKIP 文案 + exit 0）。同轮 p95 对照行给出反向证据：64KB 档 p95 base=2.71 → pr=9.95（min-of-10，median 14.62）——**+267%**，在旧 p95 判据下该档会确定性假红，而 p50 侧同轮漂移 −7.4%。
- 静态门：`bunx tsc --noEmit`、`bun run lint`、`bunx vitest run` 全绿。
- CI 端到端（合并后观测）：push 触发 bench → 期望 4 档 p50 判定 PASS（基线 p50 0.252 / 0.39 / 0.54 / 1.8 vs 诊断重录 0.233 / 0.40 / 0.55 / 1.78）；判红则按"残余假红风险"节复审本 ADR。观测结果随提交说明记录。
- 解析契约单测（R8-B-M3 收口）：`bench/runner-format.test.ts` 6 用例——行首锚定（`8KB` 不误命中 `128KB` 行）、捕获组顺序 p50/p95/p99、`1.2.3` 可匹配但 `Number` 得 NaN（数值合法性归调用侧守卫 fail-loud）。
- 写入路径守卫实跑（win32-x64，2026-09-22）：`bun run bench:record`（无参、非 CI）→ exit 1 + 拒绝文案；`bun run bench:record bench/baseline.local.json` → exit 0。
- 写入路径守卫·归一升级实跑（win32-x64，2026-09-22，R9 收口）：九形态全部 refuse exit 1——无参、`./bench/baseline.json`、`bench/./baseline.json`、`bench\baseline.json`、`bench/BASELINE.JSON`、`BENCH/baseline.json`、`BENCH/BASELINE.JSON`、绝对路径、`--help`（未知 flag 文案）；目录 junction 实测（`mklink /J var/probe-junction bench`）下 `bun run bench:record var/probe-junction/baseline.json` 亦 refuse——reparse point deref 生效（文件级 symlink 需特权，本机未实测，语义同源）。允许面零改动：`CI=true bun run bench:record var/delphi-r9/probe-ci-allow.json` → exit 0（写 `var/` 下未 tracked 产物，并复现零值告警）。
- 残余面的核验分工（R10 成文）：③UNC 与 ④ADS 由 B 在 R9 交换轮探针证实、⑤硬链接由 C 触发并经出题方独立复现（`mklink /H var/probe-hardlink.json bench/baseline.json` 后传该路径 → 守卫放行；链接随即删除，基线 blob 未变）——**登记为已知残余，不以代码收口**（见决策 6 的"名字 vs 身份"理由）；短名折叠为**已证实生效**：`realpathSync.native("bench/BASELI~1.JSO")` → 长名，且 `bun bench/record-baseline.ts bench/BASELI~1.JSO` → refuse exit 1。
- 近零基线实跑（R8-B-M1 佐证）：本轮本地 record 实际打印 `⚠ G1 p50 min = 0`；随后的本地对拍 `LLMVETO_BENCH_BASELINE=bench/baseline.local.json bun run bench/check-regression.ts` 四档全 PASS（G1 base=0/pr=0.000；G2 p50 0.58/0.87/3.66 → 0.57/0.86/3.72，min-of-10）——本轮 pr 侧同为 0 故未判红；base=0 且 pr>0 的组合会确定性判红，见"残余假红风险·近零基线变体"与 backlog `R8-B-M1`。

### 权威基线的 repo 内可核验锚点（R7-A-M3 收口）

走查 A 指出："CI 录制"主张此前依赖 GitHub API 外部验证——repo 内只有 artifact 逐字一致 + producer 模板一致 + record job 实存 + 阈值守卫四重间接证据。现补上 repo 内可复算的摘要值：

| 项 | 值 | 复现命令 |
|---|---|---|
| record run | `35713318131`（bench · workflow_dispatch · success · headSha `8bb8020`） | `gh run view 35713318131` |
| artifact | `bench-baseline`（内含 `baseline.json`） | `gh run download 35713318131 -n bench-baseline -D /tmp/b` |
| 提交文件 blob（sha1） | `d5b3077c2bc096bf9342029bc6d88ff9fa55f253` | `git hash-object bench/baseline.json` |
| 提交文件 sha256 | `2fef932e6e1be4cd26a1a5b3a742bec7edc8f4fb8b0807b298a5bd8f06e13aac` | `sha256sum bench/baseline.json` |

下载 artifact 后 `sha256sum` 应得同一值（`2fef932e…`）；`_environment`、`_repeats`、`_estimator` 随文件自证。该锚点把"CI 录制"的主张从纯外部依赖降为"repo 内可复算的摘要 + 一条可选 API 复核命令"。注意：`var/delphi-r7/ci-baseline-r7/baseline.json` 是**另一次**诊断性 record run（`35724920387`）的产物，数值与本锚点不同，未提交、未替换权威基线。

### SKIP 两种子因与各自的收尾证据（R7-A-M2 收口）

相对门的 SKIP 有两个**不同**子因，其"闭环证据"不同源、不可互替（避免"SKIP 即闭环"误读）：

| 子因 | 判据 | 闭环证据（须落到 repo） |
|---|---|---|
| **environment-SKIP** | 基准 `_environment` 与当前环境不同构 | 一次**同构环境**（即 CI/ubuntu-latest）运行里出现真实比较结果（PASS/FAIL 均可），而不是在本地看到 SKIP 消失 |
| **method-SKIP** | 基准 `_repeats`/`_estimator` 与门口径不一致（或缺标记，schema < 4） | 以**当前口径**重录基准并提交 `bench/baseline.json`（本地重录不算，须 CI record job 产物） |

`check-regression.ts` 的 SKIP 输出按子因分支打印不同 remediation（口径漂移 → 按当前口径重录；基线已是 CI 录制 → 判定权在同构 CI 运行；基线仍是本地占位 → 待办是录权威基线并提交）。历史教训：`730f82e` 之前的重录待办以"本地重录后 SKIP 消失"作为收尾凭据，但那只是 environment-SKIP 在本地消失，与 method-SKIP 的收尾（CI 重录 + 提交）不是同一件事。

## 补遗四（2026-09-23）：`plat` 注入的可达边界 —— 宿主绑定的 API 折不动，平台事实源不许有两个

### 背景（Context）

R10 批（五轮才过一次共识门，终局 HEAD `4bbea37`）推送后，bench job 在 **16 秒**内转红：守卫步 `Unit + registry integrity guard` 抓到 `bench/out-path-guard.test.ts` 的 **2 条**用例（198 passed / 2 failed / 2 skipped）。失败发生在**阻断步的最前面**、三台 runner 之前，正是该步的设计用途。值得注意的是它的方向：本批把守卫段抽成受测模块并让 `plat` 成为测试注入点，动机就是"CI 在 linux，win32 专有分支否则永不可达"；结果注入点本身漏了两处，而这两处**在 win32 本机全绿**。

两条红灯各自的第一手事实（`gh run view 35794494636 --log-failed`）：

1. `AssertionError: expected [ 'bench\\baseline.json::$DATA', null ] to deeply equal [ 'bench\\baseline.json::$DATA', 'stream' ]`（`out-path-guard.test.ts:122`）——win32 分隔符写法的宿主折叠后 `sameName` 为假。
2. `AssertionError: expected [Function] to throw an error`（`out-path-guard.test.ts:314`）——`assertWritableOutPath` 对空流名/含冒号流名**不拒**。

### 决策（Decision）

**根因 ①：`plat` 形参改得动我们写的判据，改不动宿主绑定的 API。** `realpathSync.native` 与 `node:path` **默认导出**的 `resolve`/`dirname` 一律按**宿主**解释 `\`：linux 上 `bench\\baseline.json` 是一个含反斜杠的**单个文件名**，posix 的 `resolve` 不会把它折成 `bench/baseline.json`。于是"反斜杠变体折进 tracked 家族"这条判据在 CI 上从未真正走过——本机之所以看着对，是因为 win32 的 `realpathSync.native` 直接成功，压根没进词法回退分支。

- 修法：新增私有 `lexicalForPlat(p, plat)`，在 **win32 建模**下把 `\` 规范化为 `/`，**只**接入 `canonicalPath` 的**词法回退分支**与 `assertWritableOutPath` 的 `dirname` 取父处。
- **为什么不接 realpath 分支**：win32 上 `\\?\\d:\\…`（设备命名空间）与 UNC 形态由 `realpathSync.native` 自己折回宿主长名，那是 `plat` 之外的**独立防线**；把它们也改写成 `/` 可能让 realpath 失配，等于把一条真实存在的保护换成"认不出别名 → 放行"。改写方向因此限定为"只在本来就已经失败的分支上补齐语义"，**只增拒绝**。
- 该等价性（真实 win32 宿主上"把 `\` 换成 `/`"不改变任何判定）不当作显然，钉成 `it.runIf(win32)` 用例。
- **该等价性的可验范围与守护边界（`R11R2-C-m1` 成文，不再只活在措辞里）**：`it.runIf(win32)` 在 linux CI
  上被 skip，故**这条"不改变任何判定"的承诺只有 win32 宿主能验，CI 不守护它**。能被 CI 守护的是被拆出来的
  另一半——"改写规则本身"（win32 建模下 `\`→`/`、其余平台恒等）那条平台无关的纯字符串断言（导出动机见本补遗
  影响节首条 ②，`R11R1-A-m1`）。两半的分工写死在此，避免读者把"CI 绿"读成"等价性已被守护"。本残余并入既有观测项
  `R10R2-A-m2`（OPEN，期限 2026-09-30）名下复审，不另立无人认领的孤儿项。**不采的出路**：在 pre-push 里
  强制跑一次 win32 宿主用例——xp-gate 的 pre-push 是**全局**钩子（`~/.config/xp-gate/hooks`），不在本仓
  diff 管辖内、且会波及其他仓库；而"本机 win32 实跑"本就是每次收口的既有动作（登记处各批的"本机 win32"行
  即其痕迹），只是它天然不可被一个仓库内脚本机器强制。

**根因 ②：同一个平台事实有两个源，二者可以不一致。** `assertWritableOutPath(fate, plat = platform())` 的第二个形参与 `fate.outHost` 的折叠平台构成**隐式契约**；用例只给 `inspectOutPath` 传了 `plat`，预检便按宿主平台取默认值 → 流名判据整条跳过。这是 R5 走查意见 `R10R5-A-m3` 预言的失效形态，被 CI 以真实红灯兑现（多轮走查的价值实证：意见在推送前判为 Minor，推送后立刻是唯一的红源）。

- 修法：`OutPathFate` 携带 `readonly plat`，由 `inspectOutPath` 与 `outHost` **同源产出**；`assertWritableOutPath(fate)` **删去**第二形参。调用方自此拿不到第二个平台入口，不一致在类型层不可表达。生产侧 `record-baseline.ts` 无改动（本来就是单参调用）。

**预推送复现路径：CI 是唯一 linux 执行环境这一事实本身就是盲区。** vitest 的原生绑定（rolldown）随宿主平台分发，无法在 win32 的 `node_modules` 里跑 linux 版；本机 WSL 提供了一条**不依赖测试框架**的复现通道：`node --experimental-strip-types` 直接装载 `bench/out-path-guard.ts` 的判据模块，对 linux 宿主复跑那 2 条红灯用例的等价断言。它不进 CI、不被任何门依赖，只是把"只有 CI 能证的东西"提前到推送前。

### 影响（Consequences）

- **R11 走查轮（Round 1）在本条决策上追加两项结构改动**：① 期望值单点化——形态清单与期望判定从
  "测试里一份、探针里另一份"合并为 `bench/out-path-guard.cases.ts` 一张表（A-M2：预推送通道与 CI
  执行面自此共用同一批判据结论，"探针绿"可蕴含"那族判据在 posix 宿主上绿"）；② `lexicalForPlat`
  本批新增并**导出**（首笔提交里是私有函数，同批第二笔改为导出 —— 压成区间 diff 看时整条是新增行，
  故以此处为准而非以"改动了谁"为准），配平台无关的纯字符串断言（A-m1：本 ADR 承诺的"等价性"此前只由一条
  `it.runIf(win32)` 用例钉住，而那条在 linux CI 上被 skip = 写进 tracked 文档的承诺在 CI 零守护）。
  导出理由与 `identityOf` 同族：判据里平台相关的那半条要有平台无关的可测面，不是为不存在的需求加抽象。
- **共因失效面的处置（R11 Round 1 三家同源意见：C-M2 / A-m6 / B-m4）**：单点化的代价是"表错则 CI 与
  探针同绿"。不采"定期人工审核"那类不可操作建议，改为在**消费者侧**加一族结构元断言
  （`out-path-guard.test.ts` 的「期望表自身的结构元断言」一节）：分组守恒（表长 = 四族之和、各族不少于登记
  下界 `MIN_FORMS`、形态全局唯一）、每族一条"定义性特征"（`stream` 族末段必含 `:`；`tracked` 族词法名必恰为
  `bench/baseline.json`；放行族末段必不是 `baseline.json`）、预检族自洽（win32 必 throw 者的流后缀必为
  空串或含冒号；posix 对照组与 win32 拒族同形）。这些表达式与 `hostPath`/`canonicalPath` **不共享代码**，
  故不是"断言表等于自己"；同族另加一条机制断言（`refusal="stream"` 只能来自 `outHost !== outPath`）。
  下界沿用登记处 `MIN_BACKLOG_ROWS` 的惯例（合法裁剪须同批下调并进 diff、走查可见），能力边界一并成文：
  **挡净减与误标；等量替换只挡"撞名"那一类**（`R11R3-B-m1` 把"不挡等量替换"收窄到此，见下文 M2 段的分类）。
  三条变异的实测判别力（临时改本表 → 跑消费侧 → 逐字节还原）：
  M1 删 `ADS_FORMS` 一条 → 红在「分组守恒」；M2 把名字变体 `bench/BASELINE.JSON` **等量**换成
  `bench/BASELINE.OTHER`（表长、各族长、唯一性全不变）→ 红在「`tracked` 族词法名必恰为本名」，消费者侧的
  tracked 矩阵同时红；M3 把 `PRECHECK_PASS_POSIX_FORMS` 首条改成 win32 合法形态（**消费者侧全绿**）→ 只红在
  「预检族自洽」，即元断言确实覆盖到消费者到不了的那一面。
  **M2 这条不要读成"元断言能判等量替换"**（`R11R2-B-m1`）：它红是因为换进去的形态**恰好破坏了 `tracked` 族的
  定义性词法名**。若换成另一条**同样折到本名**的等量变体（例如 `bench/./BASELINE.JSON` —— 词法名仍是
  `bench/baseline.json`，只是与表内既有的 `bench/./baseline.json` 不重复），元断言与消费者矩阵**同时**绿。
  所以 M2 证明的是"误标会被抓到"，**不是**"这一类等量替换被抓到"；边界的准确表述见紧接其下的分类。
  - **但"不挡等量替换"也不能读成"任何等量替换都不挡"**（`R11R3-B-m1`，与上条同族、方向相反的过读）：
    等量替换在此分两类，且**只有第二类**是盲区。① **撞名类**——换进来的串与表内既有形态逐字相同
    （例：把 `NAME_VARIANT_FORMS` 的 `bench/./baseline.json` 换成 `./bench/baseline.json`，后者已是该族首条）
    → 红在「分组守恒」的**形态全局唯一**断言（`out-path-guard.test.ts` 按 `form` **字面串**去重，
    `new Set(forms).size === forms.length`）。② **不撞名类**——换成另一条同样折到本名、但不与任何既有条目
    重复的变体（上面那个 `bench/./BASELINE.JSON`）→ 元断言与消费者矩阵**同时**绿，字符串层无从区分。
    故边界的准确写法是"**不挡不撞名的等量替换**"，把元断言说成"等量替换全盲"是夸大它的弱、说成"能判等量替换"
    是夸大它的强，两个方向的过读都已在本次修订内钉住。
- **建模边界补一条（`R11R1-B-m1`，拒绝"补齐"并成文）**：`lexicalForPlat` 只接**词法**面（回退分支与
  `dirname` 取父），**不接** `existsSync`/`statSync`/`accessSync`。理由不是漏接：预检问的是"待会儿
  `writeFileSync` 那个字面名开得开吗"，改写后再探探的是另一个文件。词法可按建模平台解释、宿主文件系统
  不可——与本 ADR 反复出现的 `plat` 可达边界（补遗四·决策）同一条，现已写进测试头 uncovered 第 5 条。
- 判据冻结面零改动：`bench/regression-formula.ts` 与 `bench/baseline.json` 全程 `git diff --exit-code` 为空，`* 1.2` / `> 2` 与三台门阈值常量未被触碰。
- CI 守卫步顺带收口 R5 两家独立提出的同族邻居面：`R10R5-A-m1` + `R10R5-B-m2`（三个 `[ -d ]` 锚点只证"目录在"、不证"目录里有货"→ 每根加"至少匹配 1 个 `*.test.ts`"断言，取**零漂移**形态而非断计数，并保持为一道**有意的绊线**：某个根的测试被合法迁走时，本步要求在同一笔提交里删掉该锚点）、`R10R5-A-m2`（`sort -z -o F F` 的 in-place 同时性依赖改为两个 `mktemp` 文件）。
- **如实披露**：`-o F F` 在本机 coreutils 上与异文件形态**逐字节相同**（21 文件 / 750 字节，未复现损坏），该条是**预防性**收口而非缺陷修复；判据是不把正确性压在未承诺的实现细节上。
- `identityAbsent` 的 `false` 端到端腿（M-k）与 `identityOf` 混类（M-d）在 linux CI 上**都**存活，此前只命名了一条；现两条一起写进测试头（`R10R5-C-m1`）。
- 两处**叙述**订正（非代码缺陷）：`R10R5-B-m1`——`f:` / `f:a:b` 与 `file:` / `file:a:b` 不是一回事，单字母前缀是**盘符相对**形态（实测 cwd 置于 `var/` 下 `openSync("D:h.txt:w9","wx")` 创建成功），恒 ENOENT 的只是**多字母宿主**那一组；代码行为本就正确（`f:a:b` 折到宿主 `f:a` + 流名 `b`，是合法可写形态——
  R11 Round 1 有专家按 `start = sep + 1` 读过并断言会切成 `f:`，实跑 `hostPath("f:a:b","win32")` 得 `f:a`，
  证否；该折叠自此不只活在注释里，测试「盘符相对与 UNC 共享根里的冒号…」两条断言钉住），故只改注释与措辞。`R10R5-B-m3`——R5 卷面把唯一 skip 用例归因为"W_OK 可观测性自校准"，实测 skip 的是**符号链接**用例（该 shell 无建链特权）；文件腿 `chmod 0` 后 `accessSync(W_OK)` 在 node/bun 双运行时均 EPERM（可观测且真实通过），目录腿才近乎恒真（与 `R10R4-B-m2` 成文一致）。
- `R10R5-C-m2`：不可达/无权限的 **UNC 共享根**在 win32 上是 `existsSync=false` + `accessSync` 抛 EACCES，落进 catch 却被表述成"not writable"，诊断失真（后果良性：仍采样前 fail-fast）。文案改为 `cannot be verified as writable` 并带出原始 errno；上文验证节"父目录存在性两平台都可靠"一句补 UNC 限定。旧 `record-baseline.ts` 即存在此措辞，非本批回归。

### 验证

- 本机 win32：`bunx vitest run bench/out-path-guard.test.ts` → 37 passed / 1 skipped（skip 的是符号链接用例，见上条归因订正；38 为该文件用例总数——34 是 R11 ①②③ 面的收口数，Round 1 处置又加 4 条结构元断言）；`bunx tsc --noEmit` 干净。
- **真实 linux 正向**：WSL Ubuntu + node v24（`wsl.exe bash var/negctl-linux-r11.sh`，一条命令同时跑正/负
  两个沙箱；探针本体是 `node --experimental-strip-types var/probe-linux-r11.ts`，仓库根为 cwd）→
  `platform=linux`，**104 条断言全过 / 0 失败 / rc=0**（node v24.21.0）。覆盖：CI 红灯 ①（六种流形态
  win32 建模下 `refusal='stream'` 且 `sameName` 为真，含 `bench\\baseline.json::$DATA`）、CI 红灯 ②
  （`fate.plat === "win32"` 且空流名/含冒号流名/反斜杠宿主尾冒号各即刻 throw）、posix 建模对照组（同一批
  `:` 形态 `refusal=null`，win32 判据不得越平台误伤）、词法回退按 plat 解释 `\`、宿主折叠的字符串层。
- **真实 linux 负向对照**（判别力自证，同一脚本的第二支）：把 `4bbea37`（R10 终局、推送后转红的那个 HEAD）
  的 `bench/out-path-guard.ts` 经 `git show` 现取放进 `mktemp -d` 沙箱，复跑**同一支探针、同一张期望表**
  → **61 passed / 43 failed / rc=1**，红在 `[win32/refusal] bench\baseline.json::$DATA`（expected
  `"stream"` got `null`）与 `[win32/sameName]` 同形、全部 `[*/fatePlat]`（`fate.plat` 为 `undefined`）、
  四条 `[precheck/throw]`（预检不 throw）与四条 `[lex/*]`（该函数当时**尚未导出**，探针取
  `<<not exported>>` 哨兵 → 必红）。脚本以"正向必须 rc=0、负向必须有红"为退出条件，否则自身报错——
  即探针不是恒真堆。
- **探针与 CI 用例共用一张期望表**（R11 R1 对 A-M2 的处置）：上两支跑的**不再是两套断言**——形态清单与
  期望判定住在 `bench/out-path-guard.cases.ts`，`bench/out-path-guard.test.ts`（CI 执行面）与
  `var/probe-linux-r11.ts`（预推送 linux 面）都只读它。因此"探针绿"现在**蕴含**"那族字符串判据在 posix
  宿主上也绿"，两者无从各自漂移。仍未闭的残余（本通道不声称）：vitest 自身的 `runIf`/`skipIf` 分支选择、
  `chmod 0` 的 EPERM 可观测性、符号链接能力探测——这些仍只由 CI 的 linux runner 兑现（`R10R2-A-m2`）。
- **可复跑口径**（`R11R2-C-m2`：上一支的 104/0 与负向的 61/43 都出自 gitignored scratch，故把"什么才算复跑"钉死）：
  - **正向那一半入库、一键可复，且不需要 WSL**：`bunx vitest run bench/out-path-guard.test.ts` —— 形态清单与
    期望判定住在 `bench/out-path-guard.cases.ts`，两张表与测试文件**全部 tracked**，任何 clone、任何平台同一条命令。
    CI 的 linux job 本来就是它的执行环境，所以"linux 上这批字符串判据为绿"这件事**有入库面守护**，不依赖本节数字。
  - **负向那一半不入库，且是刻意的**：修复前模块经 `git show 4bbea37:bench/out-path-guard.ts` 现取，本补遗
    影响节那三条变异（M1/M2/M3，当时是临时改 `cases.ts` → 跑消费侧 → 逐字节还原）同理。入库会 ① 被 jscpd
    当代码克隆告警（同一判据函数在库里出现两份），② 把"评审当时的临时证据"升格成
    受管入口，与 `R11R1-A-M1` 的判据（`var/` 是 scratch，不是 entry point）相抵。复跑它的成本已被上条压到很低：
    期望表在库，探针只是 import 那张表换个 runner。
  - 所以本节 linux 数字的性质是**一次性观测**，不是可回归断言；跨平台回归保护恒以入库面（`bench/out-path-guard.test.ts`
    + `cases.ts` 跑在 CI linux runner）为准。
  - **linux 实跑锚点 = `de727ab`**（`R11R4-SR-1` 成文；登记处头部「触发条件」的 linux 重跑义务以本行为准）：
    本条为该值的**唯一**定义处，登记处只指向本条、不复制数值（同一事实两个源是 `R11-CI-1` 根因 ② 的同一族）。
    上面两支数字（104/0 与 61/43）跑的是 `de727ab` 那两份字节。此后探针读的两件只变过一次（`e946a0f`），且该次
    改动**不含任何非注释行**——`git diff -U0 de727ab..HEAD -- bench/out-path-guard.ts bench/out-path-guard.cases.ts`
    过滤掉 `+++`/`---` 与以 `//`、`*`、`/*` 开头（含缩进）的行后为空，故判据与期望表的**语义**自上次实跑以来未变，
    本节点数对它仍成立。两句限定：① 锚点是"上次实跑所读的 commit"，**不是**"上一批 HEAD"——按批次取基准会让每批
    各自的"本批未变"同时为真而链条整体失真（这正是 `R11R4-SR-1` 兑现的缺陷）；② 比较取语义面而非字节面，因为
    注释也算字节变、而本机的 WSL 通道被权限层拦下，触发即无法兑现。判据或表数据**真的**再变时：推送前必须重跑
    正/负双向、把数字回写本条并把锚点下移到实跑所读的 commit，且首次重跑要一并记录 node/WSL 版本与探针脚本 hash
    作为比对基线（`R11R4-C-m2`）。
- 守卫步沙箱：`node var/probe-workflow-guard-r11.cjs` → 从 `bench.yml` **原文抽取** `run:` 体（只替换末行 `bunx vitest run`，避免探针与真文件漂移），六路径实跑全过：① 真实仓三根齐 → rc=0 / `WOULD-RUN count=21`；② 同一体在 `bash -n`、`bash -e`、`bash -eo pipefail` 三口径下语法与退出码双过（runner 的 `shell: bash` 实为 `--noprofile --norc -eo pipefail`，本地默认只有 `-e`，`| grep -q .` 这类管道的退出码差异只在 pipefail 口径下才暴露）；③ 沙箱三根齐 → rc=0（证明下面两条红来自断言而非环境噪声）；④ 整根缺失 → rc=1 且 stderr 指名 `'tests/utils' is missing`；⑤ 锚点在但用例被迁走 → rc=1 且指名 `'bench' holds no *.test.ts`；⑥ `sort` 的异文件形态与 in-place 形态在本机 21 行逐字节相同（承上条：预防性对照，非缺陷复现）。**④⑤ 同时是本批新加 `trap … EXIT` 的退出码自证**——两条红必须以 rc=1 抵达 runner，若 trap 吞掉失败状态则这两条立刻变绿。
- **`var/` 引用的性质 = 本机 scratch，不是可复跑入口**（R11R1-A-M1 与 A-m5 的处置）：本 ADR 与登记处里
  凡写作 `var/…` 的路径都是 **gitignored 的评审探针**，除 `!var/*.ts` 外不入库，随时可能不在本机之外被任何
  人复得；引用它们只是为了说明"当时用什么形态得到的结论"，**不**作为回归保护。本批现役三支：
  `var/probe-linux-r11.ts` 与 `var/negctl-linux-r11.sh`（linux 正/负双向，重建成本很低——期望表已入库，
  探针只是 import 它并换个 runner；负向支的修复前模块由 `git show <red-head>:bench/out-path-guard.ts`
  现取，**不落 tracked 副本**，否则被 jscpd 当代码克隆告警），外加上一条的
  `var/probe-workflow-guard-r11.cjs`（守卫步六路径）。**回归保护一律以入库面为准**：跨平台断言住在
  `bench/out-path-guard.test.ts` + `bench/out-path-guard.cases.ts`，CI 的 linux runner 就是它们的执行环境
  ——R11 那两条红灯正是由该测试文件自己抓到的。历史批次里未加此限定的 `var/…` 引用（如
  `var/probe-workflow-guard.sh`、`var/mut-guard-r4.mjs`）按本条同解：它们是当时的实跑记录，不是入口。
