I'll review the requirements documents systematically. Let me start by reading all the specified files.
Now let me read the background reference documents to assess consistency.
I now have a complete picture. Let me cross-check specific consistency claims before finalizing, particularly around verdict/action semantics, SSE streaming, and the evidence schema.
I have enough to produce the review. Let me analyze the key contradictions carefully.

**Key findings from cross-referencing:**

1. **SSE zero-buffering vs. fail-closed block contradiction**: DESIGN line 21 says "客户端立即收字节" (client receives bytes immediately), and line 45 says checkers exceeding budget degrade to async. But `invisible-unicode-scan` is declared for streaming (DESIGN line 24). If bytes are forwarded immediately, a `block` verdict on a mid-stream chunk cannot retract already-forwarded bytes. No document defines block semantics for streaming.

2. **`redact` scope**: REQ/TEST/DESIGN list `redact` as a verdict/action, but v3 (ROADMAP line 30) says policy engine per-checker actions are a v3 deliverable. So `redact` exists in v1 schema (TEST line 23 lists it in the enum) but the policy engine that executes it is v3.

3. **v1 acceptance depends on v2/v3 components**: ROADMAP v1 acceptance (line 16) requires "block path fail-closed E2E"; but TEST validation five-piece set (canary, drift, etc.) is v2. Also `doctor` "可证明全部 provider 流量过闸" — no enumeration/proof method defined.

4. **Golden canary absent in v1**: REQ line 52 says mitigation for T1a relies on "最小暴露 + 金丝雀检测" but canary is v2 (ROADMAP line 21). v1 has no canary, so the anti-exfiltration claim has no detection mechanism in v1.

5. **Performance budget vs. egress-secret-scan**: `egress-secret-scan` scans the full outbound request body; TTFT is a *response* metric. The request-body scan happens before upstream send, so it adds request latency, not TTFT — yet no budget is defined for request-side latency. Measurement basis ambiguous.

6. **Evidence hash chain vs. local compromised agent**: append-only SHA-256 chain does not defend against a local process that rewrites the file. REQ non-goal (line 56) only excludes "完全沦陷的 agent 自改配置绕过网关" but doesn't address tamper-proofing of evidence against local attackers.

Let me write the report.

---

## 独立评审 - Expert A（架构视角）

### 优点

1. **威胁模型与检测器的映射是可追溯的**：REQ 威胁表（T1a–P2）在 DESIGN 第 22–26 行逐条落到 checker 名称与威胁编号（`model-field-consistency`→T3a、`invisible-unicode-scan`→T2c、`egress-secret-scan`→T1b），TEST fixture schema（第 15–23 行）用 `threat:` 字段强制对齐。三条文档共享同一编号体系，这是可评审性的基础，值得保留。

2. **明确划定了不可承诺的理论边界**：REQ 第 29 行区分了"不可证伪"（上游是否记录/训练）与"可阳性检测"（金丝雀回流），并明确本项目定位为"证据流"而非"根除"。这是避免过度承诺的负责任做法。

3. **架构契约与需求解耦**：`architecture.yaml` 把"checker = 纯函数"这一可测试性不变量（TEST 契约 #2）提升为可执行的 import 边界（第 8–10 行），并要求 pre-commit 断言。需求层的不变量有落地检查点，方向正确。

4. **性能即安全属性**的论证（DESIGN 第 45 行）把 TTFT 预算与"用户绕过"的对抗性后果挂钩，而非当成普通 SLA，这是合理的威胁驱动取舍。

### 问题清单

#### Critical Issues（必须修复才能批准）

1. **流式场景下 `block` 与 `redact` 的语义未定义，与"零缓冲立即转发"直接冲突**
   - 位置：DESIGN 第 21 行（"客户端立即收字节"）、第 24 行（`invisible-unicode-scan` 作用于流式 chunk）、第 27 行（block = fail-closed）；TEST 第 23 行（verdict 枚举含 `block`/`redact`）；ROADMAP 第 16 行（v1 验收含"block 路径 fail-closed E2E"）
   - 为何阻断：需求同时主张（a）SSE chunk **零缓冲**立即交付客户端，（b）checker 可在**流式 chunk 上**判 `block`/`redact`。一旦某 chunk 已转发，追加的 `block` 无法收回已送出的字节——"fail-closed 阻断"在流式场景下没有可满足的定义。而 `redact`（TEST enum 中列出、架构层 `policy` 已声明）在流式响应上同样无定义：是改写已转发的 chunk、截断后续、还是仅记录？三个文档没有任何一处说明。
   - 可判定的解决标准：需求必须给出**逐场景判定表**，对 {stream, non-stream} × {block, redact} 明确：判定发生在首个字节转发前还是后；若是后，阻断的确切可见效果（连接终止/TLS reset/后续 chunk 注入 error event/仅 evidence 标记）是什么，以及该效果如何被 TEST 的 E2E 断言逐项验证。
   - 修复建议：冻结前在 REQ 或 DESIGN 增加"流式裁决语义"小节，规定 v1 流式路径下唯一可满足的行为（例如：`invisible-unicode-scan` 为**同步预检**，仅在 chunk 转发前可判；一旦进入转发态，判决降级为 `warn`+evidence，需求需显式承认此降级而非宣称 fail-closed）；并使 ROADMAP v1 验收的"fail-closed E2E"限定为 non-stream 或转发前预检。

2. **v1 验收标准"OpenCode 全部 provider 流量过闸（doctor 可证明）"不可证明**
   - 位置：ROADMAP 第 16 行、DESIGN 第 52 行、REQ 目标 #1（第 43–45 行，全文强调"所有流量"）
   - 为何阻断："全部 provider"未被枚举（是 OpenCode 配置中的 provider 集合？动态新增 provider 如何处理？），也未定义"可证明"的判定方法。`doctor` 的职责在 DESIGN 第 29 行仅描述为"配置是否仍指向网关 / CA 信任 / 端口连通"——**这是"配置指向网关"的证明，不是"流量确实过闸"的证明**。存在配置指向但流量旁路（如直连 URL、缓存命中、SDK 内置端点）时 doctor 无法识别。该条是 v1 进 v2 的硬门槛，不可判定的门槛等于没有门槛。
   - 可判定的解决标准：给出可执行的判定程序，例如：对 OpenCode 配置中的所有 `provider.<id>` 做**枚举**并断言每个 `options.baseURL` 等于网关地址；并定义"过闸证明"的可观测证据（evidence store 中出现该 provider 标识的请求记录 + 时间窗口覆盖），二者都要能被 `doctor` 输出为机器可读结论且被 CI 断言。
   - 修复建议：将"全部"替换为可枚举集合的定义（OpenCode 配置文件解析出的 provider ID 全集的并集），将"可证明"替换为两项具体断言（配置覆写断言 + evidence 覆盖断言），并把无法覆写的客户端明确移出 v1 承诺（见 Major #1）。

3. **v1 验收依赖 v2/v3 才存在的组件（范围越界/依赖倒置）**
   - 位置：ROADMAP 第 16 行 vs 第 21 行（金丝雀=v2）、第 24 行（evil-relay 双矩阵 CI=v2）、第 30 行（策略引擎 per-checker 动作=v3）；TEST 第 49–58 行（E2E、金丝雀、漂移、审计缺口测试）
   - 为何阻断：ROADMAP v1 验收要求"block 路径 fail-closed E2E 通过"，但 TEST 的端到端演练（第 49–51 行）与 evil-relay 模拟器（第 41 行）被 ROADMAP 第 24 行归入 v2。同时 `policy` 层的完整 per-checker 动作（含 block 的可配置性）被列为 v3。即 v1 的硬验收依赖 v2/v3 的交付物，分期边界自相矛盾，无法独立验收 v1。
   - 可判定的解决标准：v1 验收只能引用 v1 范围内的可交付物。需明确：evil-relay 最小可用版本是否在 v1 提供（若提供，ROADMAP 第 24 行的措辞需修正为"全量双矩阵"在 v2）；block 作为硬编码/最小策略是否在 v1 可用（若可用，第 30 行需说明 v1 已有不可配置的 block）。
   - 修复建议：在 ROADMAP 增加 v1/v2 能力矩阵，逐条标注 TEST 五件套中哪些属于 v1 门槛、哪些属于 v2；消除"v3 才有 policy 动作"与"v1 要求 block E2E"的冲突。

4. **金丝雀在 v1 缺席，导致 REQ 的"防数据外泄"主张在 v1 无任何检测机制**
   - 位置：REQ 第 52 行（非目标："靠最小暴露 + 金丝雀检测缓解"）、REQ 第 29 行（"只能靠金丝雀回流做阳性检测"）、ROADMAP 第 21 行（金丝雀引擎=v2）
   - 为何阻断：REQ 把金丝雀作为 T1a（prompt/凭据外泄）的唯一**检测性**缓解手段，但金丝雀被排到 v2。v1 的三个 checker 中，`egress-secret-scan` 只扫出站**请求**里的密钥（防你把 key 发出去），`invisible-unicode-scan` 与 `model-field-consistency` 均与 T1a 无关。因此 v1 对 T1a（17/428 触碰蜜罐凭据这一最严重威胁之一）**没有任何检测能力**，但 REQ/TEST 未明确承认这一暴露窗口。
   - 可判定的解决标准：REQ 或 ROADMAP 必须显式声明"v1 对 T1a 的检测能力 = 无，仅依赖出站密钥扫描这一预防措施；阳性检测推迟到 v2 金丝雀"，并相应修正 REQ 第 39 行"验证所需三件单件"的表述（金丝雀在 v1 并不在流量路径上）。
   - 修复建议：在 ROADMAP v1 区块增加"v1 未覆盖威胁及其暴露窗口"小节（见 Major #2 的同一要求），明确 T1a/T2a/T2b/T2d/T4x/P1/P2 在 v1 的处置。

#### Major Concerns（必须处理）

1. **"所有流量"目标与 v1 接入清单不自洽：TLS 拦截模式被推到 v3，但 REQ 目标 #1 是无条件的**
   - 位置：REQ 第 43–45 行（"使 agent 与 LLM API 之间的**所有**流量"）、DESIGN 第 33–40 行（列出 6 类接入，第 40 行"无法覆写 baseURL 的工具"走 HTTPS_PROXY + CA）、ROADMAP 第 31 行（TLS 拦截模式=NODE_EXTRA_CA_CERTS 路线=v3）；v1 接入仅 OpenCode + Delphi（第 14 行）
   - 为何阻断：REQ 的顶层目标是全称量词"所有流量"，而 v1 只接入 2 个客户端、且唯一能覆盖"无法覆写 baseURL"的 TLS 拦截模式被推迟到 v3。这不必然是缺陷（分期是合理的），但需求没有把目标从"所有"降级为"受支持接入路径的流量"，导致 v1 验收与顶层目标之间没有可对齐的判据。评审也无法判断"v1 达成多少比例的全量覆盖"。
   - 可判定的解决标准：REQ 目标 #1 需量化为"通过已支持接入路径（v1=OpenCode/Delphi）重定点的流量过闸"，并在 ROADMAP 明确各版本的接入路径覆盖面；未接入客户端的流量需在 v1 明确声明为**未覆盖暴露面**。
   - 修复建议：改为"分版本声明覆盖集合"的目标表述，禁止剩余项用"所有"含糊。

2. **威胁模型与 v1 checker 的覆盖缺口未被系统性承认/记录**
   - 位置：REQ 第 17–27 行（T1a–P2 全表）、DESIGN 第 22–26 行（v1 三 checker）、ROADMAP 第 13 行
   - 为何阻断：v1 三 checker 仅覆盖 T1b/T2c/T3a（部分，因 `model-field-consistency` 只比对响应 model 字段，不覆盖 T3b 量化降级与 T3c 路由波动）。T2a/T2b/T2d/T4a–d/P1/P2 在 v1 无任何检测。这些缺口分散在 v2/v3 计划中，但没有任何文档以"v1 暴露面清单"的形式集中承认，读者容易把 REQ 的完整威胁表误认为 v1 已覆盖。安全项目必须显式记录未覆盖项，否则"存在威胁模型"会被误读为"已缓解"。
   - 可判定的解决标准：ROADMAP v1 增加"v1 覆盖矩阵"：每行一个威胁编号，标注 {检测 checker 或 None}、{缓解措施或 None}、{计划版本}、{v1 暴露窗口影响}。
   - 修复建议：同上；并修正 DESIGN 第 23 行 `model-field-consistency`(T3a) 的标注，说明其只覆盖 T3a 的子集（请求/响应 model 不一致），不覆盖 T3b/T3c。

3. **性能预算的测量口径未定义，与 `egress-secret-scan` 的全量扫描存在未量化的延迟冲突**
   - 位置：DESIGN 第 45 行、TEST 第 55 行（TTFT 增量 p95 < 5ms）、DESIGN 第 25 行（`egress-secret-scan` 用 gitleaks 规则扫出站）
   - 为何阻断：TTFT 是**响应**首字节指标，而 `egress-secret-scan` 扫描的是**出站请求体**，其耗时发生在网关→upstream 之前，不体现在 TTFT 中。需求既没有为请求侧延迟定义预算，也没有说明 TTFT 的测量基线（是否含 gitleaks 扫描、DNS/TLS 建连、是否对请求体大小归一化）。结果：一个延迟很高的出站扫描可以在 TTFT < 5ms 全绿的同时，实际拖慢每个请求，而验收无法发现。此外"p95"未定义样本量、并发度、payload 规模、以及基准"回退阻断合并"的判定阈值。
   - 可判定的解决标准：给出测量口径——(a) 定义请求侧端到端增量预算（如"网关→upstream 首字节 vs 直连"p95 < X ms，且含 `egress-secret-scan`），(b) 定义 TTFT 基准的负载模型（并发、payload 大小分布、样本数、运行环境），(c) 定义"回退"阈值与比较基线。
   - 修复建议：在 TEST 第 55 行拆分"请求侧延迟预算"与"流式 TTFT 增量预算"两项，并各自给出可复现基准参数。

4. **evidence 哈希链被默认当作防篡改，但本机威胁模型下不成立（安全属性被误当已解决）**
   - 位置：DESIGN 第 28 行、ROADMAP 第 12 行（"append-only JSONL + SHA-256 哈希链"）、REQ 第 56 行（非目标仅排除"完全沦陷的 agent 自改配置绕过网关"）
   - 为何阻断：SHA-256 链式哈希能检测**事后**对中间记录的修改，但若攻击者是与网关同权限的本机进程（正是本项目要防的沦陷 agent 场景），它可以改写文件并**重算整条链**，链式哈希不提供防伪造保证。REQ 只把"完全沦陷的 agent 自改配置"列为非目标，没有声明"evidence 在本地同权限攻击者面前不可信"这一关键边界。测试方案也未提出任何篡改检测（如外部锚定、签名、append-only 文件系统约束）。这会让消费者（XP-Gate Gate LS）误以为证据链具有对抗性保证。
   - 可判定的解决标准：需求必须明确 evidence 的信任边界与威胁模型（防谁）：是防意外的日志损坏/朴素篡改，还是防本机同权限对手？并明确 v1 不提供的保证（例如"不防本机同权限重写；链仅提供完整性自检"）；若声称防篡改，需给出可验证的锚定/签名机制及对应测试。
   - 修复建议：REQ/DESIGN 加一句明确的信任声明，并让 TEST 增加"链完整性自检"与"同权限重写不可检测"的**诚实边界说明**，避免消费者过度信任。

5. **`verdict` 与 `action` 的关系在需求层未定型，导致 TEST fixture 与 v3 策略冲突**
   - 位置：TEST 第 23 行（fixture 的 `expected.verdict: block`）、DESIGN 第 27 行（"每 checker 可配动作 allow/warn/redact/block"）、architecture.yaml 第 24–27 行（policy：verdict → action）、ROADMAP 第 30 行（v3"per-checker verdict 动作"）
   - 为何阻断：术语在 4 处被混用为同一枚举。架构契约（policy 层）已声明存在 **verdict → action** 两个概念，但 TEST fixture 把 `block` 放在 `expected.verdict` 下，暗示 verdict 直接等于动作；而 ROADMAP 又把"per-checker verdict 动作"整体推到 v3。因此 v1 的 fixture 期望值到底比对的是 checker 输出的 verdict，还是策略引擎映射后的 action，没有定义——这直接影响"checker 纯函数"边界的可测性（checker 不该知道策略）。
   - 可判定的解决标准：在 REQ/DESIGN 固定术语：checker 输出**只有** `verdict`（检出强度，如 pass/flag），策略引擎输出 `action`（allow/warn/redact/block）；TEST fixture 的期望字段必须指明比对的是哪个阶段产物，并在 v1 明确策略映射的默认值。
   - 修复建议：统一术语并修正 TEST schema 示例（区分 `expected.verdict` 与 `expected.action`），明确 v1 是否已实现最小策略映射。

#### Minor Concerns（需要说明）

1. **evidence schema 仅以示例形式存在，字段未定义**
   - 位置：TEST 契约 #4（第 26 行"断言可编程（CI 直接查 JSONL 字段）"）、DESIGN 第 28 行（声称含"请求/响应元数据、checker verdicts、canary 状态、usage、时延"）
   - 为何阻断（非阻断，但需说明）：CI 要直接断言 JSONL 字段，却没有任何文件给出字段名、类型、嵌套结构。TEST fixture schema 有明确形状，evidence schema 没有。v1 的"审计留痕"验收（REQ 目标 #4）与 v3 的 Gate LS 消费接口都依赖它。
   - 可判定的解决标准：给出最小 evidence schema（JSON 示例 + 必需字段清单），或明确声明 v1 schema 未冻结、消费者不得依赖。
   - 修复建议：在 TEST 契约 #4 中补一份示例记录与必需字段表。

2. **金丝雀相关验收在 TEST 中出现在 v1 语境的验证五件套里，但能力属于 v2**
   - 位置：TEST 第 58 行（金丝雀专项：注入位置/回流告警/轮换）、ROADMAP 第 21 行（v2）
   - 为何阻断：TEST 把金丝雀列为"验证五件套"的第 5 件组成部分，读者会认为它是 v1 门槛；ROADMAP 明确 v1 无金丝雀。需标注版本归属。
   - 可判定的解决标准：TEST 每件套标注适用版本。
   - 修复建议：同上。

3. **"doctor 可证明"与 `doctor` 的实际职责范围不匹配**
   - 位置：DESIGN 第 29 行（doctor = 配置漂移/CA/端口）、ROADMAP 第 16 行（doctor 可证明流量过闸）
   - 为何阻断：doctor 现有定义证明不了"流量过闸"（见 Critical #2），措辞需收敛为 doctor 能做的事（配置漂移 + evidence 覆盖联合断言）。
   - 可判定的解决标准：统一 doctor 的验收输出字段与断言项。
   - 修复建议：并入 Critical #2 的修复。

4. **证据链的并发/崩溃一致性未在需求层提及**
   - 位置：DESIGN 第 28 行、ROADMAP 第 12 行
   - 为何阻断：append-only JSONL + 哈希链在并发写入或进程崩溃时会产生断链或半行记录；"append-only"是否含 fsync 语义未定义，影响"全量审计留痕"（REQ 目标 #4）的成立条件。
   - 可判定的解决标准：声明崩溃/并发下的证据完整性保证等级，或明确 v1 为 best-effort。
   - 修复建议：在需求层补一句完整性等级声明。

---

```json
{
  "expert_id": "A",
  "round": 1,
  "mode": "design",
  "verdict": "REQUEST_CHANGES",
  "confidence": 8,
  "critical_issues": [
    "流式场景下 block/redact 语义未定义，与 DESIGN 第21行'零缓冲立即转发客户端字节'及第24行'流式 chunk 扫隐形字符'直接冲突：已转发字节无法收回，fail-closed 阻断在流式下无可满足定义（DESIGN 21/24/27, TEST 23, ROADMAP 16）",
    "ROADMAP 第16行验收'OpenCode 全部 provider 流量过闸（doctor 可证明）'不可证明：'全部'未枚举，'可证明'无判定方法，doctor 职责（DESIGN 29）仅证明配置指向而非流量过闸（ROADMAP 16, DESIGN 29/52, REQ 43-45）",
    "v1 硬验收依赖 v2/v3 才存在的组件：v1 要求 block fail-closed E2E，但 evil-relay/TEST 五件套为 v2（ROADMAP 24），策略引擎 per-checker 动作含 block 为 v3（ROADMAP 30），分期边界自相矛盾（ROADMAP 16/21/24/30, TEST 41/49-58）",
    "金丝雀在 v1 缺席（ROADMAP 21 = v2），但 REQ 将金丝雀作为 T1a 唯一阳性检测手段（REQ 29/52），v1 对 T1a 无任何检测能力而文档未显式承认该暴露窗口（REQ 29/52, ROADMAP 21）"
  ],
  "major_concerns": [
    "REQ 目标'所有流量'（REQ 43-45）与 v1 接入仅 OpenCode+Delphi、TLS 拦截模式推迟到 v3（ROADMAP 14/31, DESIGN 40）不自洽，顶层全称目标无分版本对齐判据",
    "v1 checker 仅覆盖 T1b/T2c/T3a 子集，T2a/T2b/T2d/T4x/P1/P2 无检测且无集中'v1 暴露面清单'，读者易将威胁全表误读为已覆盖（REQ 17-27, DESIGN 22-26, ROADMAP 13）",
    "性能预算口径未定义：TTFT 是响应指标而 egress-secret-scan 扫描出站请求体（DESIGN 25），请求侧延迟无预算；TTFT 基线/并发/payload/样本量/回退阈值均未量化（DESIGN 45, TEST 55）",
    "evidence SHA-256 哈希链被默认当作防篡改，但对本机同权限沦陷 agent 可整链重写而不被检测；REQ 非目标（56）仅排除配置绕过，未声明 evidence 信任边界，消费者（Gate LS）会过度信任（DESIGN 28, ROADMAP 12, REQ 56）",
    "verdict 与 action 关系未定型：TEST fixture 将 block 置于 expected.verdict（23），DESIGN 27 与 architecture.yaml 24-27 区分 verdict→action，ROADMAP 30 又将 per-checker 动作列为 v3，checker 纯函数边界与 fixture 断言阶段不明确"
  ],
  "minor_concerns": [
    "evidence schema 仅以示例/描述存在，无字段名、类型与嵌套定义，但 TEST 契约 #4 要求 CI 直接断言 JSONL 字段（TEST 26, DESIGN 28）",
    "TEST 验证五件套第5件含金丝雀专项（58）出现在 v1 语境但能力属 v2（ROADMAP 21），未标注版本归属",
    "doctor 的'可证明流量过闸'措辞超出其定义职责（配置漂移/CA/端口，DESIGN 29），需收敛或扩展职责定义",
    "append-only JSONL + 哈希链的并发写入与崩溃一致性/fsync 语义未在需求层声明，影响全量审计留痕的成立条件（DESIGN 28, ROADMAP 12, REQ 48）"
  ]
}
```

**裁决理由**：存在 4 项 Critical Issue（流式 block 语义不可满足、流量过闸不可证明、v1 验收依赖 v2/v3 组件、金丝雀缺席下 T1a 无检测且未声明），按裁决纪律必须 `REQUEST_CHANGES`，不得 `APPROVED`。这些问题均为需求完备性/一致性缺陷而非实现细节，可在冻结前通过补充"流式裁决语义""v1 覆盖与暴露矩阵""可判定验收判据"三节修复。
