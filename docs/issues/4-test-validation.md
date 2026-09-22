# [TEST] 验证方案 — 可测试性契约 + evil-relay 验证五件套

> 来源: https://github.com/boyingliu01/llmveto/issues/4
> 本文档已经过 delphi-review R1 修订（2026-09-14）。`verdict` / `action` 语义与 transport 行为矩阵以 [REQ] §裁决与动作语义 为准。

## 原则

安全能力不可验证 = 不存在。验证方案独立成文（VALIDATION.md），但以下可测试性契约必须在架构设计期固化——**可测试性无法事后补**。

## 可测试性契约（进架构，见 DESIGN issue）

1. **upstream 可替换**：网关上游端点为配置注入接口，测试时可指向 mock 服务器喂任意（恶意）响应。v1 交付 `mock-upstream`（纯 TS，声明式脚本回放，见 §2）。
2. **checker = 可独立单测的纯 reducer**（两态签名，`src/checkers/**` 不得 import `gateway`/`evidence`/`policy`，由 `architecture.yaml` + `tests/unit/architecture-boundaries.test.ts` 双重断言）：

   ```ts
   // 非流式：无状态纯函数
   type NonStreamChecker = (unit: ScanUnit) => CheckerResult

   // 流式：窗口归约。状态由 fixture 框架注入/回传，checker 自身不持单例 → 仍表驱动可单测
   type StreamChecker = (window: ScanWindow, chunk: ScanUnit) => [CheckerResult, ScanWindow]

   interface ScanWindow { readonly pendingBytes: Uint8Array; readonly cursor: number; /* checker 自定义只读快照 */ }
   interface CheckerResult {
     readonly verdict: "clean" | "finding" | "error"   // ← 不含 block/redact：那是 action 域
     readonly evidence: readonly Finding[]             // 命中码点/偏移/规则 id，不含策略结论
   }
   ```

   **禁止** checker 从配置、时钟、网络、环境变量取值（同输入必同输出）。
3. **fixture schema（声明式，v1 冻结）**：

```yaml
id: T3a-model-label-mismatch-01
threat: T3a
transport: non-stream        # stream | non-stream
checker: model-label-consistency
upstream_response:           # 喂给 mock-upstream 的内容（stream 时为 chunk 数组）
  ...
adversarial_note: "对手忘改响应 model 字段；字段回写一致的替换由 v2 fingerprint-probe 覆盖"
expected:
  verdict: finding           # clean | finding | error   ← 断言 checker 纯函数输出
  action: warn               # allow | warn | block      ← 断言 v1 固定映射结果（redact 属 v3，v1 fixture 禁用）
  evidence:                  # 可选：断言 evidence 字段（键必须为契约 #4 已登记字段）
    findings:                # 契约 #4: {checker, threat, verdict, severity, offsets[], rule_id}
      - {checker: model-label-consistency, threat: T3a, verdict: finding, rule_id: model-label-mismatch}
    response_delivered: {partial: false, delivered_chunks: 0}   # 非流式，未转发
```

   - 流式 block 样本必须带 `expected.observables`：`{terminated_after_delivery: true, delivered_chunks: N, error_event_code: "llmveto:veto-mid-stream"}` —— 使"已转发字节不可撤回"这一语义成为可断言对象，而非口号。**注**：`expected.observables` 是 **fixture-only 断言容器**，其键非 evidence 字段（故不受上文"键必须为契约 #4 已登记字段"约束），但其断言目标均映射到已登记项：`terminated_after_delivery`→`action_taken` 枚举值、`delivered_chunks`→`response_delivered.delivered_chunks`、`error_event_code`→DESIGN §组件1 客户端事件。
   - **每个内容型 checker 必须至少含 1 个跨 chunk 切分对抗样本**（如把 U+200B 的 `E2 80 8B` 三字节拆到相邻两个 chunk、把码点写成 SSE `\u200b` 转义形态），否则该 checker 的流式实现不予验收。
4. **evidence schema（v1 冻结，`evidence_version: 1`）**：CI 与 Gate LS 直接查 JSONL 字段，故字段名/类型/必填性在此定案。

   | 字段 | 类型 | 必填 | 说明 |
   |---|---|---|---|
   | `evidence_version` | int | ✅ | 固定 `1`；消费方须先校验此值 |
   | `event_id` / `seq` | string / int | ✅ | 全局事件 id / 链内单调序号 |
   | `ts` | string(ISO8601) | ✅ | 网关本地写入时刻 |
   | `session_id` / `turn_id` / `request_id` | string | ✅ | 会话/回合/请求关联 |
   | `client` | string | ✅ | `"opencode"` \| `"delphi"` \| 适配器 id |
   | `provider_id` / `endpoint_host` / `model_requested` / `model_responded` | string | ✅ | 过闸归属与模型字段（`model_responded` 可为 `null`） |
   | `transport` | string | ✅ | `stream` \| `non-stream` |
   | `request_bytes` / `response_bytes` / `chunk_count` | int | ✅ | 体量观测 |
   | `latency` | object | ✅ | `{ttft_ms, total_ms, request_gate_ms, scan_ms}`（对齐 DESIGN §性能预算三台门） |
   | `findings` | array | ✅ | `{checker, threat, verdict, severity, offsets[], rule_id}` |
   | `action_taken` | string | ✅ | `allowed` \| `warned` \| `blocked_before_forward` \| `blocked_before_deliver` \| `terminated_after_delivery` \| `degraded_observational`（末值 **@v2 起可达**：v1 无观测类 checker，verify schema 须允许该枚举但 v1 fixture 不覆盖） |
   | `reason` | string | ❌ | 如 `checker_timeout` / `scanner_error` |
   | `response_delivered` | object | ✅ | `{partial: bool, delivered_chunks: int}`（流式撤回边界的取证依据） |
   | `usage` / `cache_reported` | object | ❌ | 上游自报值原样落盘（仅取证，不判定；v1 无对账逻辑） |
   | `request_body_sha256` / `response_body_sha256` | string | ✅ | 默认仅哈希；明文受 `evidence.body_capture` 控制（DESIGN §脱敏与留痕范围） |
   | `prev_hash` / `record_hash` | string | ✅ | SHA-256 链；`record_hash = H(prev_hash ‖ canonical_json(record_minus_hashes))` |
   | `canary` | null | ✅ | v1 恒为 `null`（字段占位，能力属 v2）——**不得**因字段存在而声称 v1 有金丝雀 |

   链完整性与 schema 由 `llmveto verify` 在 **v1 内**提供校验（否则 v1 写出的证据在 v1 内不可验证）。

## 验证五件套（逐项标注期次与 v1 替代物）

> R1 定案：v1 验收不得引用 v2/v3 交付物。以下 `@v1` 为 v1 门槛，`@v2`/`@v3` 为其增强。

### 1. 威胁样本库 `@v1`（v2 扩充）

每个 **v1 已缓解/部分缓解** 的威胁（T1b / T2c / T3a-label-mismatch）≥3 个正样本；benign 语料 **≥50 条**作负样本（v1 最低规模，见 §3 门槛）。未缓解威胁（T2a/T2b/T4x…）的样本入库但**只作为 v2 预留**，v1 CI 不对其断言（避免"有样本即有防护"的错觉）。来源：

- UCSB 论文公开的 payload 模式（tool-call 注入、依赖定向）→ 标记 `@v2`
- hub.linux.do 中转站取证事件复现（隐形字符 U+200B/FEFF 指纹、trace:UUID 跨会话追踪、max_tokens 20→300 篡改）→ `@v1`（隐形字符部分）
- fpverify 9 种对手响应（swap/quantize/cache/filter 等）→ **由 fpverify 离线生成 YAML fixture 入仓**，CI 不跑 Python（见 REUSE）
- 自录真实 agent 会话（经 `redactSink()` + 人工复核后作 benign 负样本）→ `@v1`

### 2. mock-upstream `@v1` / evil-relay 模拟器 `@v2`

- **`mock-upstream`（v1 交付）**：纯 TS 声明式脚本回放服务器，按 fixture 的 `upstream_response` 逐 chunk 吐出（可注入自定义 chunk 边界以构造跨切分样本）。v1 所有集成/E2E 的上游。
- **evil-relay（v2 交付）**：本地恶意中转模拟器（docker 一键起），复用 fpverify 9 对手 + 自补 T2 类（tool-call 注入、第 N 次请求条件投递、隐形字符水印、假缓存字段）。**v1 不依赖、不阻塞 v1 验收**；v1 的"恶意上游"需求由 mock-upstream 满足。

### 3. 双矩阵回归（CI 强制）`@v1`（全量双矩阵 `@v2`）

- **检出矩阵**：正样本 × checker → 预期 `verdict` + `action`。
  - **v1 门槛：fixture 集内检出率 = 100%**（逐条期望匹配，零漏报，无例外）。
- **误报矩阵**：benign 语料全量过 checker → 误报率。
  - **v1 门槛**：告警类 checker（`model-label-consistency`，v1 唯一 action=warn 的 checker）FP ≤ **2%**，且每条 FP 必须显式进 `tests/fixtures/false-positives.json` 并由人工裁决留痕；
  - **阻断类 checker（`egress-secret-scan` / `invisible-unicode-scan`）FP = 0**（二者 v1 策略映射均为 `action=block`，阻断误报直接破坏可用性，白名单豁免须逐条写明理由与来源）。
  - **强制 benign 子集**：benign 语料必须含 ≥1 条带标准认证头（`Authorization: Bearer …` / `x-api-key: sk-…`）的真实形态请求，用于断言扫描单元已按 DESIGN §扫描单元定义排除认证头、`egress-secret-scan` 对其 FP=0（若实现未排除认证头，本条必然 FAIL——这是把"认证头不入扫描"锁为可回归约束）。
- **合并门槛**：新增 checker 必须携带正负 fixture（含 ≥1 跨 chunk 样本），否则 PR 不合并。
- **"回退"定义**（此前缺失，导致"回退阻断合并"不可判定）：同一 runner 连续 `n=200` 次，`p95_pr > p95_base × 1.2` **或** `p95_pr − p95_base > 2ms` → 判回退、阻断合并；`p95_base` 取 main 分支最近一次绿色基准（存 `bench/baseline.json`）。（**口径已修订（2026-09-22）**：判定分位数 p95 → p50、判定量 = 每档 N=10 次独立运行 p50 的**最小值**；operative 文本见 `specification.yaml` AC-VETO-013-04 与 `docs/adr/0002` 补遗三，本段保留为历史。）

### 4. 端到端演练 `@v1`（evil-relay 版 `@v2`）

OpenCode + Delphi 穿 **mock-upstream** 全链路，逐项断言：

| 断言 | v1 内容 |
|---|---|
| 告警路径 | benign 流量全绿 + evidence `action_taken=allowed` |
| 阻断路径（请求侧） | 含凭据请求 → 客户端收 `502 llmveto:rejected`，`blocked_before_forward`，mock-upstream **未收到**该请求（零出境证明） |
| 阻断路径（流式·场景4） | chunk N（N≥2）命中 → 前 N-1 chunk 已送达（断言客户端确实收到）+ `event: error`（`{"error":{"code":"llmveto:veto-mid-stream","delivered_chunks":N-1}}`）+ 连接关闭 + `terminated_after_delivery` + `response_delivered:{partial:true,delivered_chunks:N-1}` |
| 阻断路径（流式·场景3） | chunk 1 即命中且 checker 在 tee 前返回 → **未转发任何字节**（断言客户端收到 0 个 data chunk）+ 直接 `event: error` + 关闭 + `response_delivered:{partial:false,delivered_chunks:0}`（等同非流式响应级阻断，验证 M2"零缓冲下场景3 可达"主张） |
| 审计落盘 | `llmveto verify` 对演练产生的链返回 `ok`；篡改任一条中间记录 → `verify` 报 `first_bad_seq` |
| doctor 漂移 | 把受管枚举内任一 provider 的 baseURL 改走 → `doctor` 必须 `FAIL` 并指出条目 id |
| 受管枚举探测过闸（ROADMAP 验收 1(b) 落点） | harness 遍历 `MANAGED_CONFIG_IDS` 每条接入路径，各回放 ≥1 条探测请求经 mock-upstream，断言 evidence 中出现对应 `client` + `provider_id` 记录（时间窗口内）；枚举内任一条路径无记录 → 该验收 FAIL（探测由测试 harness 经该客户端适配器发起，非 doctor 自查） |
| Delphi 路径 | `.delphi-config.json` 覆写后 Delphi 请求在 evidence 中 `client="delphi"` 可观测 |

### 5. 性能与防绕过回归

- `@v1` G1 流式 TTFT 增量（每 PR）；`@v1` G2 请求侧端到端增量按 body 分档（≤8KB/≤64KB/≤512KB，每 PR）；`@v1` G3 扫描超时 → 必须 `block`（每 PR）
- `@v1` 配置漂移检测测试（限定受管枚举内）
- `@v2` 金丝雀专项：注入位置覆盖（system/tool/RAG 区）+ 回流告警 E2E + 轮换验证 —— **v1 无金丝雀，v1 CI 不含此项**
- `@v3` 审计缺口检测测试（声称有 LLM 工作、网关无流量 → 必须告警）—— **v1 不具备旁路发现能力**

**性能测量协议（v1 冻结，回应"无测量方法学"）**：固定环境（本机 loopback、mock-upstream 响应模板化、关闭其它监听）；预热 50 次；样本 n=200/档；报告 p50/p95/p99；噪声容差与回退公式见 §3；`bench/` 输出机器可读 JSON 并在 CI 上传工件。

## CI 结构（标注 v1 实际范围）

```
@v1 单测（checker 表驱动，含跨 chunk 窗口用例）
  → @v1 集成（网关 × mock-upstream × fixture 集）
  → @v1 E2E（OpenCode/Delphi × mock-upstream，PR 触发；nightly 重复）
  → @v1 性能基准（G1/G2/G3，每 PR）
  → @v2 E2E（evil-relay 双矩阵，nightly）
  → @v3 审计缺口 / TLS 拦截路径
```

## 评审修订记录

| 轮次 | 日期 | 本文档变更（问题 ID 见 `.sprint-state/review/r1-consensus.md`） |
|---|---|---|
| R1 | 2026-09-14 | 契约#2 改为两态签名 + 禁止 checker 输出 action（P-06/P-10）；契约#3 fixture 拆分 `expected.verdict` / `expected.action` + 流式可观测断言 + 跨 chunk 样本强制（P-01/P-06/P-09/P-10）；契约#4 落 v1 冻结字段表含 `evidence_version`/`canary=null` 占位（P-08）；五件套逐项标 `@v1/@v2/@v3` + v1 替代物（P-04/P-16）；新增 mock-upstream 承接 v1 E2E、evil-relay 明确 v2（P-04）；检出率/误报率给出数值门槛与回退公式（P-11）；性能测量协议成文（P-11/P-02）；E2E 补 Delphi 路径与 evidence verify 断言（P-07/P-13） |
