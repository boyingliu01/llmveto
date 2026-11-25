# Phase 4/6 VERIFY 小结 — llmveto v2b-A

- 日期：2026-11-24
- 结论：**通过**，但**发现 1 个 CRITICAL 级真实缺陷并已修复**

## 1. 验证结果

| 项 | 结果 |
|---|---|
| 全量测试 | **817 passed / 52 skipped**（81 文件） |
| 类型检查（源码 + 构建面） | PASS |
| xp-gate check --all | 10 passed / 9 skipped（与基线一致） |
| Gate 3 复杂度棘轮 | PASS（存量 0 回归，新代码全部 CCN ≤ 5） |
| release-gate | **10/10 全过**（含 install-tarball / smoke 8 行 / publish-dry-run） |
| README 中英对齐 | PASS（10 标题、5 张表行数相等） |
| 需求覆盖 | 21/21 REQ 均有测试引用（补了此前缺失的 REQ-V2bA-04b） |

## 2. code-walkthrough 结果

- 席位：`hy4std`（失败）、`hy4flash`（有效，REQUEST_CHANGES）、`hy4flash-free`（拒绝：diff 不在工作区）
- **两席在拿不到代码时拒绝编造评审**，这个行为本身是对的；据此把 diff 移到工作区内路径重跑
- 有效评审 1 条 `REQUEST_CHANGES`，**4 条真实缺陷已修**、2 条按取舍登记、3 条经核实不成立

### 已修的真实缺陷（按严重度）

| 级别 | 缺陷 | 影响 |
|---|---|---|
| CRITICAL | 响应侧投影**加了参数却没接线** | Anthropic `content[]` / Responses `output[]` 仍不可见；我的 5 个全链测试是请求侧的，抓不到 |
| MAJOR | 非受管路由不写 `reason` | 覆盖降级在 evidence 层不可观测，违反 REQ-15 |
| MAJOR | `isManagedRoute` 按前缀判定 | fail-closed 无声扩大到 `opencode/<任意 provider>` |
| MAJOR | 配置解析失败 = `not_configured`（PASS） | 损坏的配置在 doctor 里是绿灯 |

每条都补了回归测试，且对 CRITICAL 那条做了**反向探针**（去掉接线 → 断言变红）。

## 3. 这次走查最值得记住的一句

> 一个加了却从没被调用的参数，比没加更危险——它让代码看起来已经修好了。

`REQ-V2bA-00` 早就写了"投影函数单测不构成满足证据"，但我的全链测试只覆盖了请求侧，
所以 817 个测试全绿仍然带着这个洞。**验证的价值在于找错，不在于证明自己对。**

## status

```
status: completed
outputs:
  - .sprint-state/review/cw-consensus.md
  - tests/integration/response-projection.test.ts（含反向探针）
  - tests/unit/route-keys.test.ts（受管域与 adapter 产物同源）
  - tests/integration/route-passthrough.test.ts
decisions:
  - 响应侧线格式经 declaredToolsMeta 下传
  - ShapeVerdict 拆出 block 字段（reason 恒记录）
  - 受管域收窄为适配器实际写入的路由键
residuals:
  - 「合法空请求」豁免的剩余绕过面（设计取舍，已登记 KNOWN-ISSUES）
  - coverage_missing 当前不可达（协议表恒有投影器）
next_phase_context:
  - 版本已 bump 到 0.7.0；release gate 10/10
  - SHIP 需要：PR + 合并 + tag + Release
```
