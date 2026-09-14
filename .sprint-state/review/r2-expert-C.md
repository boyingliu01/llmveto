
> delphi-reviewer-feasibility · g-qwen3.8-flash

→ Read .sprint-state/review/r2-questionnaire.md
→ Read .sprint-state/review/r1-consensus.md
→ Read .sprint-state/decisions.md
→ Read docs/issues/1-req-threat-model.md
→ Read docs/issues/2-design-v1.md
→ Read docs/issues/4-test-validation.md
→ Read docs/issues/5-roadmap.md
→ Read docs/issues/3-reuse-list.md
→ Read architecture.yaml
→ Read README.md
✱ Glob "docs/**/*.md"
✱ Grep "llmveto:veto-mid-stream|veto-mid-stream"
✱ Grep "partial_response_delivered|response_delivered"
✱ Grep "502|llmveto:rejected"
✱ Grep "not-applicable@v1|CA 信任"
✱ Grep "doctor.*4 项|四项|确定性结论"
✱ Grep "redactSink|脱敏"
✱ Grep "error_event_code|delivered_chunks|terminated_after_delivery"
✱ Grep "G3|50ms|timeout"
✱ Grep "evidence-version|evidence_version"
✱ Grep "body_capture|metadata_only"
✱ Grep "degraded_observational|warned"
✱ Grep "action_taken"
✱ Grep "partial_response_delivered"
✱ Grep "llmveto:veto-mid-stream|error_event_code"
## 独立评审 - Round 2（角色视角）

### 一、逐条处置裁定

| 问题ID | 级别(原/现) | 裁定 | 依据（文件+章节） | 若不成立，最小修复动作 |
|---|---|---|---|---|
| P-01 | Critical/Critical | resolved | REQ §裁决与动作语义·行为矩阵场景4 + §`redact`期次声明；DESIGN §关键决策"零缓冲优先于字节级阻断"；TEST §契约#3 `expected.observables`；DR-006 | — |
| P-02 | Critical/Critical | resolved | DESIGN §性能预算与降级规则（G1/G2/G3三台独立门 + 安全类超时=block）；TEST §5；ROADMAP §验收第6条；DR-010 | — |
| P-03 | Critical/Critical | partially_resolved | ROADMAP §验收第1条(a)(b)(c)；DESIGN §接入适配器`MANAGED_CONFIG_IDS`；DR-008。但README §CLI仍写doctor含"CA信任检查项输出not-applicable@v1"，与DESIGN §架构图期次标注"TLS拦截不在doctor检查项内（避免检查项空转）"直接矛盾——正是P-18要消除的空转以新形式回归 | 二选一：删除README该行，或在DESIGN §接入适配器显式恢复该检查项并标`not-applicable@v1` |
| P-04 | Critical/Critical | resolved | ROADMAP §v1交付（verify+mock-upstream+封闭枚举入v1）；TEST §2 mock-upstream @v1 / evil-relay @v2；§总原则分期纪律；DR-009 | — |
| P-05 | Critical/Critical | resolved | REQ §v1残余风险登记表（威胁×状态×缓解×缺口理由×期次×取证六列齐备）；README §v1能做什么不能做什么；非目标补三条硬边界 | — |
| P-06 | Critical/Critical | resolved | REQ §术语定案两层表；TEST 契约#2类型定义（verdict不含action域）+契约#3双断言；architecture.yaml checkers/policy层注释；DR-007 | — |
| P-07 | Critical/Critical | resolved | REQ §evidence信任边界与完整性等级（明示不抵抗本机整链重写）；TEST 契约#4 + `llmveto verify`提入v1；ROADMAP §验收第5条 | — |
| P-08 | Major/Minor | resolved | TEST 契约#4 v1冻结字段表（名称/类型/必填性齐备，含`canary:null`占位防误读） | — |
| P-09 | Major/Minor | resolved | DESIGN §扫描单元定义（request_body/response_body/sse_event三形态 + meta随传 + checker不触socket） | — |
| P-10 | Major/Minor | resolved | DESIGN §组件2 invisible-unicode-scan跨chunk滚动窗口（pending_bytes）；TEST 契约#3强制跨chunk切分样本入fixture | — |
| P-11 | Major/Minor | resolved | TEST §3（检出率100%硬门槛、告警FP≤2%、阻断FP=0白名单逐条裁决、回退公式p95×1.2或>2ms）+ §5测量协议（n=200/档、预热、基线快照） | — |
| P-12 | Major/Minor | resolved | checker改名`model-label-consistency`并在REQ登记表/DESIGN §组件2/REUSE三处登记能力边界（仅label-mismatch，真替换属v2指纹） | — |
| P-13 | Major/Minor | resolved | ROADMAP §验收第2条Delphi专条；TEST §4 E2E表Delphi路径行 | — |
| P-14 | Major/Minor | resolved | REUSE §许可与运行时纪律 + G-LIC门（gitleaks未核实→自建top-N回退）+ G-FP门（fpverify离线生成YAML，CI零Python）；docs/licenses.md为关闭条件 | — |
| P-15 | Major/Minor | resolved | REQ §目标#1改分版本覆盖集合声明 + 登记表"未接入客户端=未覆盖暴露面"；ROADMAP §总原则分期纪律 | — |
| P-16 | Minor/Minor | resolved | TEST §五件套逐项`@v1/@v2/@v3`标注 + CI结构图按实际范围裁剪 | — |
| P-17 | Minor/Minor | partially_resolved | README §架构已标期次、CLI已冻结5命令；但README §CLI的CA信任检查项残留与DESIGN冲突（见P-03行），属同一问题的未清理尾巴 | 同P-03修复动作 |
| P-18 | Minor/Minor | unresolved | 处置决议原文承诺"doctor v1仅输出4项确定性结论、CA信任项标not-applicable@v1"，但DESIGN §架构图期次标注写"不在doctor检查项内（避免检查项空转）"，README却保留该项——两处对doctor v1检查集的定义互斥，无权威清单可判定实现应做几项 | 在DESIGN §接入适配器（或新增§doctor职责）冻结v1检查项枚举，README引用之 |
| P-19 | Minor/Minor | resolved | REQ §evidence信任边界崩溃/并发行：单写者+fsync best-effort+末行半行容忍+不承诺多进程/断电 | — |
| P-20 | Minor/Minor | resolved | DESIGN §脱敏与留痕范围（body_capture默认metadata_only + full模式风险标注责任在用户）+ TEST §1 benign语料经redactSink+人工复核 | — |
| P-21 | Minor/Minor | resolved | DESIGN §接入适配器表"由谁写入"列（网关`--write-managed-config`负责，手工步骤仅可选复核）；REQ登记表P1行同步 | — |
| P-22 | Minor/Minor | resolved | README §分发与runtime两承诺分离；DESIGN §关键决策技术栈条目对齐（Node stdlib only，Bun仅compile） | — |

### 二、DR-006 ~ DR-010 五项 ADR 的独立意见

**DR-006（零缓冲+终止流）：有条件同意。** 取舍方向我维持Round 1的判断——在"性能即安全"的威胁模型下，(a)优于(b)缓冲窗口和(c)纯告警，且本轮修订已把它从隐含假设升级为明文承诺（场景4三件套：行为矩阵+登记表T2a行+fixture可观测断言），这是本轮最有价值的改进之一。条件有二：① 该取舍成立的前提是T2c命中主要发生在响应早期，文档未论证此前提，建议在BUILD期用benign语料实测命中位置分布并回填ADR；② README §空白主张中"fail-closed阻断"与场景4"已转发字节不可撤回"之间的张力已通过"阻断粒度=响应级"限定语缓解，可接受。**可实现性**：可行，终止流是连接级操作，无需字节级控制。

**DR-007（verdict/action两层分离）：同意。** (b)是唯一不摧毁可测试性契约#2的选项，fixture双断言（verdict+action）使策略映射本身也成为被测对象，优于我预期的修复强度。

**DR-008（受管配置封闭枚举）：同意。** 把全称命题改写为"遍历域=版本化枚举"的可判定命题，是本轮教科书级的消歧操作；(b)+(c)组合诚实。唯一尾巴是doctor检查项清单未冻结（见P-18）。

**DR-009（mock-upstream进v1）：同意。** 比三个原始选项都好——它顺带解决了跨chunk样本需要控制chunk边界的测试难题（evil-relay作为整体模拟器给不了这个粒度），这一点处置决议里写了，落点也齐（TEST §2、ROADMAP交付、DR正文三处一致）。

**DR-010（超时=拒绝 + 三台门）：有条件同意。** "超时=失败的一种，安全类不许例外"是正确的硬立场，G1/G2/G3拆分消除了口径混用。**数字判断**：G1 p95<5ms在loopback+内存扫描下可实现，有物理余量；G2的3/10/40ms分档**无实测依据，是锚定值而非承诺值**——但文档自己承认了这点（DR-010 rationale"G2阈值是承诺值而非实测值"）并挂G-BENCH前置门强制BUILD期先实测、超阈必须走公开ADR，这个闭环设计使"没有依据的数字"变成了"有依据的待验证假设"，可接受。条件是G-BENCH确实执行，不允许静默放宽。另注意一个实现细节：G3=50ms是单checker上限，而512KB body档的G2预算=40ms < 50ms，意味着大body下超时路径将频繁触发block——建议BUILD期验证该交互是否构成可用性陷阱（见第三节N-05）。

### 三、新引入的问题

**Critical：无。** 逐项排查判据2~4：术语（verdict/action/redact）、期次（evil-relay/canary/TLS/redact/CA）、门槛（G1-G3/FP/检出率）、承诺强度（README提供列表 vs 登记表状态 vs 行为矩阵）四类跨文档一致性均通过；未发现新的不可判定验收条款；未发现过度承诺（登记表T3a行"部分（弱）+对定向替换无效"、evidence"不抵抗整链重写"、canary恒null等反向自我设限反而做得很足）。

**Major：无。**

**Minor：**

- **N-01 doctor v1检查项清单两处互斥**：README §CLI（"CA信任检查项…v1输出not-applicable@v1"，即存在于检查集）vs DESIGN §架构图期次标注（"不在doctor检查项内（避免检查项空转）"，即不存在于检查集）。这是修订过程留下的不对称尾巴，影响实现范围判定。解决标准：DESIGN中冻结doctor v1检查项封闭清单，README改为引用。
- **N-02 evidence投影字段名漂移**：REQ §行为矩阵场景4 warn格写`partial_response_delivered=true`，TEST 契约#4冻结字段为`response_delivered:{partial,delivered_chunks}`。契约#4自declare为唯一权威且"历史混用已修正"，此处漏改。解决标准：REQ改为引用`response_delivered.partial`或删除该字段名。
- **N-03 `degraded_observational`枚举值在v1不可达**：TEST 契约#4 action_taken枚举含该值，但DESIGN §降级规则明确"观测类checker v1=无"。前向兼容占位可以接受，但应在字段说明中标注`@v2起可达`，否则verify的schema断言与fixture覆盖范围产生歧义。
- **N-04 `llmveto:veto-mid-stream`错误码出现在REQ矩阵与TEST fixture两处，DESIGN §反代核未登记该对外可观测契约**：面向客户端的行为承诺应落在实现该行为的组件文档中。解决标准：DESIGN §组件1补一行error事件规格。
- **N-05 G2/G3预算交互未声明**：512KB档G2=40ms但G3=50ms，最坏合法情况（扫描45ms完成）会突破G2而不触发G3，此时判定口径（回退？警告？）未定义。解决标准：DESIGN §性能预算补一句两门交叠时的优先级语义。

### 四、剩余风险与 v2/v3 边界

登记表无虚报：逐行与交付清单交叉核对，T1a"未缓解"与金丝雀v2一致、T3a"部分（弱）"与label-only checker一致、T2c"部分"与归一化变体缺口一致、P2行明示"v1无法发现旁路"。取证列尤其诚实（"哈希只能对账发过什么，无法证明对方是否留存"）。无漏报：verify、mock-upstream、封闭枚举均已从"计划"升格为"v1交付件"并同步进ROADMAP交付清单。v2/v3边界清晰，且v2验收句"流式已转发字节的边界仍按REQ §场景4承诺，不得回改"这一防倒退条款写得好。唯一边界模糊点是N-01（doctor检查项）。

### 五、总体判断

本轮修订质量显著高于我的预期：22条中19条彻底resolved，全部7条Critical的修复都做到了"可判定化"而非"措辞软化"，且没有出现判据5所警示的回退——零缓冲+终止流配合登记表与行为矩阵后，"fail-closed阻断"的市场主张以"响应级阻断"的诚实形态依然成立；redact移出v1反而消除了一个原本就兑现不了的承诺。剩余问题全部是修订尾巴级的文档不一致（N-01~N-05），不构成结构性缺陷，一次机械性文字修订即可关闭。**足以支撑v1冻结**，前提是N-01在冻结前解决（它直接影响BUILD范围）。

### 六、JSON 结论块

```json
{
  "expert_id": "C",
  "round": 2,
  "mode": "design",
  "verdict": "APPROVED_WITH_CONDITIONS",
  "confidence": 8,
  "resolutions": {
    "P-01": "resolved",
    "P-02": "resolved",
    "P-03": "partially_resolved",
    "P-04": "resolved",
    "P-05": "resolved",
    "P-06": "resolved",
    "P-07": "resolved",
    "P-08": "resolved",
    "P-09": "resolved",
    "P-10": "resolved",
    "P-11": "resolved",
    "P-12": "resolved",
    "P-13": "resolved",
    "P-14": "resolved",
    "P-15": "resolved",
    "P-16": "resolved",
    "P-17": "partially_resolved",
    "P-18": "unresolved",
    "P-19": "resolved",
    "P-20": "resolved",
    "P-21": "resolved",
    "P-22": "resolved"
  },
  "adr_opinions": {
    "DR-006": "conditional",
    "DR-007": "agree",
    "DR-008": "agree",
    "DR-009": "agree",
    "DR-010": "conditional"
  },
  "critical_issues": [],
  "major_concerns": [],
  "minor_concerns": [
    "N-01 doctor v1检查项清单：README §CLI 与 DESIGN §架构图期次标注互斥（CA信任项在/不在检查集）",
    "N-02 REQ §行为矩阵场景4 使用 partial_response_delivered，与 TEST 契约#4 冻结字段 response_delivered.partial 名称漂移",
    "N-03 TEST 契约#4 action_taken=degraded_observational 在 v1 不可达（观测类 checker v1=无），未标注 @v2起可达",
    "N-04 llmveto:veto-mid-stream error 事件契约未登记于 DESIGN §组件1",
    "N-05 G2(512KB档40ms) 与 G3(50ms) 预算交叠时的判定语义未定义"
  ]
}
```
