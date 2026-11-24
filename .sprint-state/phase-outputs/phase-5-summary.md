# Phase 5/6 SHIP 小结 — llmveto v2b-A

- 日期：2026-11-24
- **状态：blocked（等用户决定）** —— 推送被 Gate MW 拦下，拦截理由我已拒绝绕过

## 1. 已经完成的

| 项 | 状态 |
|---|---|
| VERSION / package.json | `0.7.0`（一致） |
| 分支 | `sprint/2026-11-24-01`，24 个提交，工作区干净 |
| 测试 | **828 passed / 52 skipped** |
| release gate | **10/10 PASS**（含 install-tarball、smoke 8 行、publish-dry-run） |
| Gate 3 复杂度棘轮 | PASS，存量零回归 |
| 需求对齐 | 21/21 REQ，49 AC，score 100 |
| CHANGELOG | v0.7.0 条目已写 |
| README / FAQ / ROADMAP / 威胁登记表 | 已订正 |

## 2. 卡点：Gate MW 要求顶层 verdict = APPROVED

推送时 `pre-push` 的 Gate MW 读取 `.code-walkthrough-result.json`，校验器
`~/.config/xp-gate/hooks/lib/validate-code-walkthrough.cjs:431…` 要求：

```
Invalid code walkthrough evidence: top-level verdict must be APPROVED.
```

而我写入的是 `PASS_WITH_CAVEATS`，因为**事实就是如此**：

| 席位 | 结果 |
|---|---|
| `hy4flash` | 5 轮，**每轮都 REQUEST_CHANGES** |
| `hy4std` | 2 次尝试，输出 0 字节 |
| `hy4flash-free` | 拒绝（diff 不在工作区）→ 重跑无输出 |

**共识比例 0%，远低于 90% 阈值。** 把文件改成 APPROVED 就能推上去，但那是伪造评审结论。

## 3. 这五轮评审实际产出了什么

虽然没达成共识，走查抓到了 **6 条 CRITICAL + 5 条 MAJOR**，**全部实测复现后修复**，
每一条都补了回归测试：

| 轮 | 缺陷 | 性质 |
|---|---|---|
| 1 | 响应侧投影加了参数却没接线 | 看起来修好了，实际没修 |
| 2 | 非受管路由不写 reason | 覆盖降级不可观测 |
| 2 | `isManagedRoute` 按前缀过宽 | fail-closed 无声扩大 |
| 2 | 坏配置报绿灯 | doctor 假通过 |
| 3 | 兜底判据在豁免之后（C1） | 豁免条件本身就是绕过面 |
| 3 | 裸键名豁免（C2） | `id` 键藏凭据 |
| 4 | 值形态启发式（`url`/大写/短串） | 启发式必被枚举出反例 |
| 5 | 扫的是重建副本（重复键/PEM） | `JSON.stringify` 丢数据 |
| 5 | 认证头未同源排除 | 正常请求被打 502 |

**其中 4 条是上一轮修复方式本身引入的。** 这比"通过评审"更有价值。

## 4. 需要你决定

| 选项 | 含义 |
|---|---|
| **A. 接受现状，把 verdict 写为 APPROVED** | 承认"单席 5 轮 REQUEST_CHANGES + 全部修复 + 828 测试 + 10/10 发布门"足以替代形式上的三席共识。需要你明确授权，我不会自己改。 |
| **B. 补足第二/第三席** | 换可用的模型（`library` 里 0 输出问题可能是 prompt 长度）；达到 3 席真实评审后再推。 |
| **C. 不推 PR，先在本地合并到 main** | 绕过 PR 流程，保留提交历史；CI 不会跑。 |
| **D. 保持 blocked** | 分支留在本地，等你安排。 |

## status

```
status: blocked
blocked_reason: Gate MW requires top-level verdict APPROVED in .code-walkthrough-result.json; actual consensus is 0% (1 seat, 5 rounds REQUEST_CHANGES; 2 seats produced no output). Writing APPROVED would falsify the review.
done: 0.7.0 version bump, CHANGELOG, docs, release gate 10/10, 828 tests, ratchet clean, alignment 21/21, 24 commits on sprint/2026-11-24-01
remaining: PR creation + merge + tag + GitHub Release
```
