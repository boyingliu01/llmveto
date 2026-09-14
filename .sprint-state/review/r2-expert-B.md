
> delphi-reviewer-technical · g-glm-5.3-flash

→ Read .sprint-state/review/r2-questionnaire.md
→ Read .sprint-state/review/r1-consensus.md
→ Read .sprint-state/decisions.md
→ Read docs/issues/1-req-threat-model.md
已读评审卷、r1-consensus 与 decisions。现在读取待评审文档。
→ Read docs/issues/2-design-v1.md
→ Read docs/issues/4-test-validation.md
→ Read docs/issues/5-roadmap.md
→ Read docs/issues/3-reuse-list.md
→ Read architecture.yaml
✱ Grep "response_body_ref|partial_response_delivered|terminated_stream|目录快照哈希" in .
已完成评审卷、r1-consensus、decisions 与全部待评审文档的阅读。对几处关键字段名与引用路径做精确核对后再下结论：
✱ Grep "not-applicable|\.sprint-state|\.sprint_state|sprint-state" in docs
## 独立评审 - Round 2（技术视角，Expert B）

### 一、逐条处置裁定

| 问题ID | 级别(原/现) | 裁定 | 依据（文件+章节） | 若不成立，最小修复动作 |
|---|---|---|---|---|
| P-01 | Critical/— | resolved | REQ §裁决与动作语义·行为矩阵场景3/4 + 场景4明文承诺；TEST 契约#3 `expected.observables`（`terminated_after_delivery`/`delivered_chunks`/`error_event_code` 与 REQ 场景4 `llmveto:veto-mid-stream` 逐字一致）；ROADMAP 验收4；README 架构图注 | — |
| P-02 | Critical/— | resolved | DESIGN §性能预算与降级规则（安全类禁止降级、超时→`error→block`）；三台门 G1/G2/G3 独立口径；TEST §5 测量协议；ROADMAP 验收6 + G-BENCH 前置门；REUSE llm-verify 行 | — |
| P-03 | Critical/Major(残留) | resolved | DR-008；ROADMAP 验收1(a)(b)(c) 可判定化；DESIGN §接入适配器 `MANAGED_CONFIG_IDS`；REQ 目标#1 分版本覆盖集合。残留：验收1(b) 探测过闸在 TEST 无落点（见新问题 NC-2） | TEST §4 E2E 断言表补“受管枚举探测过闸”行 |
| P-04 | Critical/— | resolved | ROADMAP v1 交付含 mock-upstream/verify/样本库，验收6条零引用 v2/v3；TEST 五件套逐项 `@v1/@v2/@v3` 且 evil-relay 明确“不阻塞 v1 验收”；TEST §2 | — |
| P-05 | Critical/Critical(残留) | partially_resolved | REQ §v1 残余风险登记表已建立且缓解列诚实（T1a/T2a/T2b/T2d/T3b/T3c/T4x 如实标未缓解）；但 T2a/T2b 行取证列声称 `response_body_ref` 事后取证，TEST 契约#4 无此字段且默认仅哈希（见新问题 NC-1） | 登记 T2a/T2b 取证列改为“`response_body_sha256`（明文仅 `body_capture=full`）”或契约#4 补字段，两处对齐 |
| P-06 | Critical/— | resolved | REQ §术语定案两层表；TEST 契约#2 `CheckerResult.verdict ∈ clean\|finding\|error` + 契约#3 `expected.verdict`/`expected.action` 双断言；architecture.yaml checkers/policy 层注释；DESIGN 组件2/3 | — |
| P-07 | Critical/— | resolved | REQ §evidence 信任边界（明写不抵抗本机同权限整链重写）；`verify` 入 v1（DESIGN CLI/ROADMAP 交付）；ROADMAP 验收5；README 架构图信任声明 | — |
| P-08 | Major/— | resolved | TEST 契约#4 `evidence_version:1` 冻结字段表（类型/必填/说明齐备）；ROADMAP v3 Gate LS 消费契约引用该表。但本轮出现登记表/fixture 引用未登记字段的回潮（见 NC-1/NC-3） | — |
| P-09 | Major/— | resolved | DESIGN §扫描单元定义（request_body/response_body/sse_event 三单元、meta 随单元传入）；TEST 契约#2 两态签名；architecture.yaml 注释与之一致 | — |
| P-10 | Major/— | resolved | DESIGN `invisible-unicode-scan` 跨 chunk 滚动窗口（携带未完成多字节序列）；TEST 契约#3 “每内容型 checker ≥1 跨 chunk 切分对抗样本否则流式实现不予验收”；mock-upstream 可注入 chunk 边界（DR-009） | — |
| P-11 | Major/— | resolved | TEST §3（fixture 检出率 100% 硬、benign≥50、告警类 FP≤2% 逐条裁决留痕、阻断类 FP=0、回退公式 n=200/×1.2/2ms/baseline.json）；ROADMAP 验收3 | — |
| P-12 | Major/— | resolved | DESIGN 组件2 改名 `model-label-consistency` + 能力边界声明；REQ 登记表 T3a 行“只抓忘改字段的低级对手”；TEST fixture `adversarial_note`；README “T3a 子集”——四处一致 | — |
| P-13 | Major/— | resolved | ROADMAP 验收2；TEST §4 E2E “Delphi 路径”行（`client="delphi"` 可观测）；DESIGN 适配器表 `.delphi-config` 由网关写入 | — |
| P-14 | Major/— | resolved | REUSE 表新增期次/许可核实/运行时依赖三列；gitleaks “MIT”降级为“未核实”+ G-LIC 门 + 自建 top-N 回退；fpverify 离线生成器、CI 零 Python（G-FP） | — |
| P-15 | Major/— | resolved | REQ 目标#1 显式弃用“所有流量”全称承诺；README “经由已支持接入路径重定向的”；ROADMAP 验收1(c) 旁路清单 | — |
| P-16 | Minor/— | resolved | TEST 五件套逐项标注 + CI 结构图（@v1 单测→集成→E2E→性能→@v2/@v3） | — |
| P-17 | Minor/Minor | resolved | README 架构图标期次（“仅 v1/v2：loopback baseURL 反代，v1 不实现 TLS 拦截”）；CLI 三处（README/DESIGN/ROADMAP）均为 5 命令无 stub | — |
| P-18 | Minor/Minor | resolved | DESIGN“不在 doctor 检查项内”与 README“输出 `not-applicable@v1`”承诺强度等价，但措辞不一致（见 NC-4） | 统一为“检查项存在、v1 恒输出 not-applicable” |
| P-19 | Minor/— | resolved | REQ §evidence 信任边界表：单写者、fsync best-effort、末行半行容忍；ROADMAP 验收5“重启/崩溃后纯追加” | — |
| P-20 | Minor/— | resolved | DESIGN §脱敏与留痕范围（`body_capture` 三态、默认 metadata_only、full 模式风险标注）；TEST 契约#4 哈希字段说明引用该开关；benign 语料经 `redactSink`+人工复核 | — |
| P-21 | Minor/— | resolved | DESIGN 适配器表“由谁写入=网关 doctor --write-managed-config”；`experimental.policies` 写入失败降级为告警、不作验收前置；REQ 登记表 P1 行同步 | — |
| P-22 | Minor/— | resolved | DESIGN 关键决策“运行时仅 Node stdlib、禁 Bun-only”；README §分发与 runtime 承诺分列两个承诺 | — |

### 二、DR-006 ~ DR-010 五项 ADR 的独立意见

- **DR-006（零缓冲+终止流）：同意。** 技术判断：可实现。成立的物理前提是流式 checker 为同步纯函数（TEST 契约#2 已锁签名）且反代核在**同一事件循环 tick 内**完成“收到 chunk→同步扫描→写客户端”，Node 单线程模型下“命中后下一个 chunk 不再转发”可保证；场景3（首字节前命中）因此可实现真响应级阻断。fixture 的 `delivered_chunks: N` 断言恰好能把“实现悄悄异步化导致 N 变大”抓住，闭环成立。对判据5的回退评估：请求侧（T1b）与非流式响应侧仍保留真前置阻断，“fail-closed 阻断”的市场主张未被掏空；流式降级为止损+取证已成文为明文承诺而非隐含。数字方面 DR-006 本身不含性能数字，无需背书。
- **DR-007：同意。** 两层分离 + v1 固定映射表 + fixture 双断言，把“v3 才有 action”的历史矛盾澄清干净，architecture.yaml 边界与之一致。
- **DR-008：同意。** 封闭枚举把不可证伪命题改为可 CI 断言命题，且枚举可随 v2/v3 扩展，承诺强度与能力始终对齐；“v1 不具备发现旁路能力”同步写入三处，无过度声明。
- **DR-009：同意。** mock-upstream 同时解决“v1 验收自洽”与“跨 chunk 样本需控制 chunk 边界”两个问题；evil-relay 归 v2 不阻塞 v1。
- **DR-010（G2 分档 3/10/40ms + G3 50ms）：有条件同意。** G1 p95<5ms/p99<12ms 在 loopback tee + 线性扫描下量级合理。G2 三档阈值是**承诺值而非实测值**——gitleaks 全量规则（100+ 条正则）跑 8KB body 在 JS 正则引擎下可能贴近甚至超过 3ms，3ms 偏激进；但 G-BENCH 前置门 + “不达标走 ADR、禁止静默放宽” + G-LIC 自建 top-N 回退路径，使方法学成立，数字来源已诚实标注。**真正的问题在 G2 与 G3 的联合分布**：G2 上档 p95=40ms 与 G3 每请求硬超时 50ms 之间仅 10ms 余量，且 G3 非 p95 口径；用户开发机通常比 CI 慢 2-5 倍，大请求超时→block 会把可用性问题转嫁给部署者（超时阻断不落入 FP 口径，但体验上即“网关断流”）。条件：(1) G-BENCH 实测必须报告 G3 口径 p99 而非仅 p95，且 512KB 档 p99 < G3×0.5（为慢机留余量），否则按 ADR 同步修订 G2/G3；(2) 建议 G3 按 body 分档（如 8KB:20ms/64KB:35ms/512KB:80ms）或在 DESIGN 显式登记“慢环境下大请求可能被超时阻断”为已知运行时行为。

### 三、新引入的问题（Critical / Major / Minor）

**NC-1（Critical）**：位置：REQ §v1 残余风险登记表 T2a 行（T2b 行“同上”继承）↔ TEST 契约#4 evidence 冻结字段表。为何是问题：登记表声称 v1 取证可得性为“`response_body_ref` 落盘可事后取证”，但契约#4 无该字段，且默认 `body_capture=metadata_only` 下仅存 SHA-256——哈希在无原文时无法支撑“事后人工对账注入内容”。这是把未做成的取证能力写成做成了（判据4 过度承诺），也是两份冻结件间的承诺强度矛盾（判据2）。解决标准：二选一并对齐——(a) 契约#4 登记 `request_body_ref`/`response_body_ref`（明确仅 `body_capture=redacted/full` 时非空），同步登记表措辞；(b) 登记表 T2a/T2b 取证列改写为“`response_body_sha256`（明文留存仅当 `body_capture≠metadata_only`，默认无明文）”。

**NC-2（Major）**：位置：ROADMAP §v1 验收1(b) ↔ DESIGN §CLI（doctor 职责清单）+ TEST §4 E2E 断言表。为何是问题：验收1(b)“对枚举内每条路径回放 ≥1 条探测请求、evidence 出现对应 `client`+`provider_id` 记录”是新增验收形态，但 DESIGN 的 doctor 职责（覆写/漂移断言+端口连通+写入托管配置）与 TEST E2E 六行断言均无执行落点——验收条目存在而验证方案无载体，属处置传播不完整。解决标准：TEST §4 E2E 表补“受管枚举探测过闸”行（harness 逐条路径回放探测并断言 evidence 命中），或在 DESIGN 给 doctor 增加 probe 子命令并同步 CLI 行。

**NC-3（Major）**：位置：DESIGN §扫描单元定义（request_body 含 `extra_headers`，无排除清单）↔ TEST §3 / ROADMAP 验收3（阻断类 FP=0）。为何是问题：真实录制会话的请求必含 `Authorization`/`x-api-key` 等认证头，其值恰为高置信凭据模式（`sk-…`/`sk-ant-…`）；若扫描单元不显式排除认证头，`egress-secret-scan` 将对几乎每条 benign 流量命中，阻断类 FP=0 在实现层面不可满足，验收3 直接不可达。解决标准：DESIGN 扫描单元定义补充排除清单（认证类头不进扫描单元，或明确定义 `extra_headers` = 排除认证头后的自定义头），并加一条 benign 含认证头的 fixture。

**NC-4（Major）**：位置：TEST 契约#3 fixture 示例 `expected.evidence{codepoint, terminated_stream}` ↔ TEST 契约#4 冻结字段表。为何是问题：示例自称“对齐契约#4”，但 `codepoint`、`terminated_stream` 均非已登记字段（`findings` 仅含 `offsets[]/rule_id`；流式终止的登记形态是 `action_taken=terminated_after_delivery` + `response_delivered.partial`）——P-06 要消灭的字段级二义在新增 fixture 示例中回潮，实现者将无所适从。同族还包括 REQ 登记表 T2c 行“命中码点+样本”、P1 行“目录快照哈希”均无 schema 字段。解决标准：契约#3 示例 evidence 键全部改用契约#4 已登记字段；T2c/P1 取证列措辞与字段表一一对齐（如“命中码点+偏移”落 `findings.offsets[]` 或为其增补 `codepoint` 字段并登记）。

**Minor**：(1) DESIGN“TLS 拦截不在 doctor 检查项内” vs README“doctor CA 信任项输出 `not-applicable@v1`”——措辞不一致（承诺强度等价）；(2) ROADMAP 验收6 标题“三台门”正文仅列 G1/G2（G3 落在验收4），建议交叉引用；(3) DESIGN `pending_bytes`（snake_case）vs TEST `ScanWindow.pendingBytes`（camelCase）；(4) REQ 登记表 T1a 行“请求体摘要哈希（可对账‘发过什么’）”——仅哈希在无原文时不可对账，措辞略夸大；(5) REQ 目标#3 概括“阻断粒度=响应级”，与场景4“已开始流=终止流（部分响应）”存在粒度措辞张力，建议改为“响应级（未开始转发）/ 流终止级（已开始转发）”。

### 四、剩余风险与 v2/v3 边界

**虚报（已发现）**：登记表“缓解”列整体诚实——T1a/T2a/T2b/T2d/T3b/T3c/T4x 如实标未缓解，T3a 甚至用“部分（弱）+ 只抓忘改字段的低级对手”自我否定，是全文档最诚实的段落。虚报集中在**“v1 取证可得性”列**：T2a/T2b 的 `response_body_ref`（NC-1，schema 无支撑）、T2c 的“命中码点+样本”与 P1 的“目录快照哈希”（NC-4，字段未登记）、T1a 的“哈希可对账”（Minor-4，metadata_only 默认下哈希不可独立对账）。**漏报（未发现实质项）**：没有找到“把已做的写成未做”的行；README“v1 能做什么/不能做什么”表与登记表、ROADMAP 交付三处口径一致。结论：登记表立节方向正确，需对“取证列”做一次逐行 schema 对账后才能作为冻结件。

### 五、总体判断

本轮修订在结构上是成功的：Round 1 五条 3/3 Critical（流式语义、fail-open 降级、不可证伪验收、v2/v3 循环依赖、风险登记缺失）的处置全部成立，DR-006/DR-008 的取舍以诚实成文方式保住了“确定性验证 + fail-closed 阻断”的立项主张，未出现为过评审而掏空承诺的回退。但按本轮判据，仍存在两个新引入的 Critical（NC-1 取证能力虚报、NC-2 所列字段名矛盾——均为两冻结件间的承诺/术语不一致），且均为低修复成本的纯文档改动。**本轮尚不足以支撑 v1 冻结；完成 evidence 字段三方对账（REQ 登记表↔REQ 行为矩阵↔TEST 契约#3/#4）并补齐验收1(b) 的 TEST 落点后，可进入冻结。**

### 六、JSON 结论块

```json
{
  "expert_id": "B",
  "round": 2,
  "mode": "design",
  "verdict": "REQUEST_CHANGES",
  "confidence": 8,
  "resolutions": {
    "P-01": "resolved", "P-02": "resolved", "P-03": "resolved", "P-04": "resolved",
    "P-05": "partially_resolved", "P-06": "resolved", "P-07": "resolved", "P-08": "resolved",
    "P-09": "resolved", "P-10": "resolved", "P-11": "resolved", "P-12": "resolved",
    "P-13": "resolved", "P-14": "resolved", "P-15": "resolved", "P-16": "resolved",
    "P-17": "resolved", "P-18": "resolved", "P-19": "resolved", "P-20": "resolved",
    "P-21": "resolved", "P-22": "resolved"
  },
  "adr_opinions": {
    "DR-006": "agree",
    "DR-007": "agree",
    "DR-008": "agree",
    "DR-009": "agree",
    "DR-010": "conditional"
  },
  "critical_issues": [
    "NC-1: REQ §v1残余风险登记表 T2a/T2b 行取证列声称 response_body_ref 事后取证，TEST 契约#4 字段表无该字段且默认 body_capture=metadata_only 仅存哈希——取证能力过度承诺 + 两冻结件承诺强度矛盾（登记表改措辞或契约#4补字段，两处对齐）",
    "NC-2: REQ §行为矩阵 场景4 warn 列写 evidence 字段 partial_response_delivered，TEST 契约#4 冻结字段名为 response_delivered{partial,delivered_chunks}——同一取证概念两个名字，跨冻结件术语不一致（统一为契约#4 字段名）"
  ],
  "major_concerns": [
    "ROADMAP 验收1(b) 探测过闸断言在 DESIGN doctor 职责清单与 TEST §4 E2E 断言表均无执行落点",
    "DESIGN §扫描单元定义 request_body 含 extra_headers 但未排除 Authorization/x-api-key 等认证头，与阻断类 FP=0（TEST §3/ROADMAP 验收3）在实现层冲突，验收3 可能不可达",
    "TEST 契约#3 示例 evidence 键 codepoint/terminated_stream 未在契约#4 登记（P-06 类二义回潮）；REQ 登记表 T2c'命中码点+样本'、P1'目录快照哈希'同样无 schema 字段",
    "DR-010 条件：G2 512KB 档 p95=40ms 与 G3 每请求硬超时 50ms 仅 10ms 余量且 G3 非 p95 口径，慢机环境大请求超时→block 的可用性后果未登记；G-BENCH 须报告 G3 口径 p99"
  ],
  "minor_concerns": [
    "DESIGN'TLS拦截不在doctor检查项内' vs README'doctor CA信任项输出 not-applicable@v1'措辞不一致",
    "ROADMAP 验收6 标题'三台门'正文仅列 G1/G2，G3 藏于验收4",
    "DESIGN pending_bytes 与 TEST ScanWindow.pendingBytes 命名风格漂移",
    "REQ 登记表 T1a 行'哈希可对账发过什么'在 metadata_only 默认下措辞略夸大",
    "REQ 目标#3'阻断粒度=响应级'与场景4'已开始流=流终止级'粒度措辞张力"
  ]
}
```
