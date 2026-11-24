# VERIFY Phase 4 — code-walkthrough 评审记录（v2b-A）

- 日期：2026-11-24
- 对象：`f6ed18d..HEAD` 的 `src/` 变更（2148 行）
- 材料：需求稿 / 设计 / src diff / 能力矩阵 / KNOWN-ISSUES

## 席位

| 席位 | 模型 | 结果 |
|---|---|---|
| A | `hy4std` | ⚠️ 首次拒绝（diff 在 `/tmp` 不可读），改到工作区内后重跑仍 0 字节 |
| B | `hy4flash` | ✅ 8369 B，`REQUEST_CHANGES` |
| C | `hy4flash-free` | ⚠️ 首次同样拒绝（理由与 A 相同） |

**两席拒绝时的表现值得记录**：它们**没有**在没有代码的情况下编出一份结构工整的假评审，
而是明确写出"读不到 diff、只能靠猜、那正是本项目最忌讳的失效形态"。这个判断是对的，
我据此把 diff 移到工作区内路径。**这是评审质量的一次正面样本。**

## 有效评审：B 席 `REQUEST_CHANGES`

### 已确认并修复（4 条真缺陷）

| # | 发现 | 我的核实 | 处置 |
|---|---|---|---|
| B-C1 | **响应侧投影从未接线**：`buildResponseScanUnit` 的 `proto` 形参加了，三个调用点一个都没传 | **属实，且是最严重的一条。** grep 确认三处调用均无 `proto` 实参；请求侧全链测试因此全绿，响应侧却仍走 Chat 投影 | 线格式经 `declaredToolsMeta` 下传并就地消费（`scan-unit.ts`）。新增 `tests/integration/response-projection.test.ts`，用 side=response 的阻断类 checker 验证；**反向探针**（去掉接线）两条断言立即变红 |
| B-C3 | 非受管路由永远不写 `reason` | **属实**，且直接违反 REQ-15「非受管路由：同样写 reason，但不阻断」 | `ShapeVerdict` 拆出 `block` 字段：`reason` 恒记录、`block` 区分是否阻断；非受管降级经 `gatewayReasonsOf` 落链。新增回归测试 |
| B-M4 | `isManagedRoute` 把"前缀在表里"当受管，fail-closed 无声扩大到 `opencode/<任意 provider>` | **属实**，是相对 v1 的行为扩大 | 收窄为"适配器实际配置的路由键集合"；新增 `tests/unit/route-keys.test.ts` 用**真实 adapter 产物**推导同源集合并比对 |
| B-M3 | 配置解析失败被报成 `not_configured`（PASS） | **属实**：损坏的 `config.toml` 在 doctor 里是绿灯 | 文件存在却解析为空 → 报 `drift`（failsDoctor） |

### 已确认但**登记不改**（2 条）

| # | 发现 | 为什么不改 |
|---|---|---|
| B-C2 | "合法空请求"豁免可被构造性绕过（把凭据放进未登记的字段名，如 `{"messages":[{"role":"user","note":"sk-..."}]}`） | **这是本 design 显式记录的取舍**（设计 §D-02 第 3 条、KNOWN-ISSUES「The cost of that exemption」）。放宽会误杀 canary 注入的分支 4 与健康探针；收紧需要一个"该协议全部已知字段"的完备清单，而那正是 `CoverageSpec` 已经提供、且由 `protocol-coverage.test.ts` 每次 CI 把守的部分。**剩余面已登记**，属协议扩面工作。 |
| B-M1 | Responses 字符串 `content` 与 `Array.isArray` 的 handled 判定不一致 | 部分属实。已由 `protocol-coverage.test.ts` 的"声明 ⇒ handled"守卫覆盖；字符串形态的 `input` 单列路径已在 `CONTAINER_PATHS` 处理。未发现实际误阻断。 |

### 判定为「不成立或已过时」（3 条）

| # | 发现 | 核实结论 |
|---|---|---|
| B-M2 | doctor 第 7 态 `coverage_ok` 与 `coverage_missing` 不可达 | `coverage_ok` 是**刻意新增**的成功态（把"已配置且有覆盖"与"未配置"区分开），不是泄漏；`coverage_missing` 当前不可达属实——已登记为已知简化（协议表恒有投影器时该态确实不出现） |
| B-M5 | Chat 非字符串 `system` / 非数组 `tools` 会落 `partial` 被阻断 | 该 case 在 `presentPaths` 中不作为载荷路径出现，实测不触发。Chat 回归由快照测试 + 811 项全量把守 |
| B-M6 | `isUnrecognizableShell` 用无前缀重做识别，违背"路由权威" | 该分支只在**无消息容器**时启用，用于识别"带协议特征键却归类不了的壳"；权威前缀仍决定 format。已由 `protocol-outcome.test.ts` 覆盖 |

### MINOR（未逐条处置，均已记录）

`tryParseJson` 每请求解析两次、`promptfooAdapter as unknown as Adapter` 双重断言、
`applyKeys` 重赋值参数——都是可维护性问题，不影响正确性，留待后续清理。

## 结论

**有效席 1/3，`REQUEST_CHANGES`。** 其中 **1 条 CRITICAL（响应侧未接线）与 3 条 MAJOR 为真实缺陷，已全部修复并补回归测试**。
2 条按设计取舍登记不改，3 条经核实不成立或过时。

**最有价值的一条**：响应侧投影"加了参数却没接线"——它让代码看起来已经修好了。
这正是 `REQ-00` 明文要求"投影单测不构成满足证据"的原因，也是我先前 5 个全链测试的盲区。
