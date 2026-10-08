# ADR-0004 · 金丝雀命中写成 findings 条目；`canary` 字段为保留位，网关注入且不扩 evidence schema

- 状态：Accepted
- 日期：2026-09-28
- 相关：`CONTEXT.md` §保留位 / §注入（金丝雀注入）/ §跨会话串流；TEST 契约 #4（`evidence_version: 1` 字段表冻结）；`src/evidence/schema.ts`（`CANARY_V1: null`、`canary must be null in v1`）；REQ §裁决与动作语义；`docs/plans/2026-09-27-v2a-requirements.md` Q1/Q2/Q3、REQ-V2a-05/06/07/11、§4.2/§4.3/§4.4、§9、AC-V2a-06~08/16~21

## 背景（Context）

v1 把 evidence 字段表冻结为 `evidence_version: 1`，其中 `canary` 字段占位恒 `null`，并有断言把这条钉住（AC-VETO-007-05）。v2a 引入金丝雀引擎后，命中结果必须有地方落进链里，否则不可取证、不可 verify。

三个约束互相顶：

1. **契约冻结**：同 `evidence_version` 下字段形状不得变（TEST 契约 #4 的立约理由就是让 `verify` 与 v3 的 Gate LS 能只认一个形状）。
2. **checker 纯函数**（TEST 契约 #2）：checker 禁止从配置/时钟/网络/环境变量取值——而 canary 的匹配域是**跨会话的有状态集合**。
3. **最小暴露**（T1a 承诺）：evidence 默认 `body_capture = metadata_only`，不得把 canary 明文写进链，否则链本身成为可匹配的敏感库。

## 决策（Decision）

1. **不扩 schema**：canary 命中写成 `findings[]` 的一条，`checker = "canary-return-scan"`、`rule_id = "canary-<id>"`；`evidence_version` 保持 1。
2. **`canary` 字段永久恒 `null`，定性为保留位**：`CONTEXT.md` 明确"它的存在不构成已具备该能力的证据"，防止后来者拿字段存在当能力申报。
3. **注入方 = 网关**，位置固定为最后一条 message 的 `content` 尾部（不碰 `system`），按 session 轮换；注入是**新增**字节，因此不属 `redact`、不受"改写属 v3"的限制（`CONTEXT.md` §注入 的 `_Avoid_` 就是把"改写/插桩"排掉）。
4. **匹配域不进链**：registry 落 state 目录，唯一写者是常驻网关；`canary rotate` CLI 运行时经控制通道请求轮换，不并发写文件。
5. **checker 只见快照**：registry 属新域 `src/canary/**`，由 gateway 注入 `ScanUnit.meta.canary_candidates` 只读快照；`architecture.yaml` 的 `allowed_imports` 相应扩展，并由 import 图断言禁止 `checkers → canary`。

## 备选与被否理由（Options）

| 方案 | 否因 |
|---|---|
| (a) 加 `canary` 对象字段并升 `evidence_version` 为 2 | 同一版本号下新旧链形状分叉；v3 Gate LS 要背双版本断言；字段表冻结契约的意义即被废除 |
| (b) 同版本下偷偷加字段（不升 version） | 比 (a) 更糟：`verify` 的 schema 断言要么放行未知字段（契约失效）要么判旧记录非法（回归破坏） |
| (c) 把 canary 原文写进 evidence 便于事后核对 | 与 `body_capture=metadata_only` 冲突；链变成本机历史 prompt 的可匹配库，把 T1a 的防护变成 T1a 的暴露面 |
| (d) 让 checker 直接读 registry | 违反 TEST 契约 #2 纯函数约束，fixture 不可复现，且破坏 `architecture.yaml` 单向依赖 |
| (e) 注入进 `system` 字段 | `system` 是对话语义骨架且常被上游单独处理，注入它改变请求类别；也无法用"既有字节不变"证伪 |

## 后果（Consequences）

- ✅ `verify` 无需按版本分派：形状不变，`findings[]` 早就是既有字段；v1 记录集仍可被 v2a 的验证器读取。
- ✅ 三处不变式可分别断言：AC-V2a-08（`canary` 恒 `null` 不回归）、AC-V2a-06（链中 grep 不到 canary 明文，`rule_id` 只含 id 不含原文）、AC-V2a-19③（CLI 无写能力，静态 import 断言 + 运行时并发完整性两路把守）。
- ⚠️ 新增 P4 登记行：注入自身是派生面（改 prompt 可能干扰模型输出或触发 provider 内容政策），registry 留存是本机敏感状态。G-CANARY 门以三项量化判据把关，禁止静默注入。
- ⚠️ 三条已登记漏检（§7 P4 行）：回退 session 键在相同首条 prompt 上共享 canary；64 bit 截断的生日碰撞量级；registry 不可用 / body 不可解析时不注入不匹配——均为 false negative，属**可观测的覆盖降级**而非防护，不得写成"已检测"。
- ⚠️ CLI 命令集 5 → 6（新增 `canary rotate`）。v1 的纪律是"未实现的命令不得注册 stub"（`src/cli/index.ts` 里就有那条 throw），故本条是**实现后**注册，不是解禁 stub。README §CLI 与"不提供"清单同步由 AC-V2a-16④ 把守。
