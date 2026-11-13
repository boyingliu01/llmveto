# Sprint Summary — llmveto v2a detection core (sprint-20260927-46)

```yaml
Sprint ID: sprint-20260927-46
开始日期: 2026-09-27
结束日期: 2026-11-02
MVP 版本: v0.3.1 (v2a detection core)
最终状态: completed
```

## 阶段执行统计

| Phase | 状态 | 备注 |
|-------|------|------|
| 1/6 PREP | ✅ | worktree + 规模评估（complex） |
| 2/6 DESIGN | ✅ | 设计文档 + R1 requirements Round 5（100% 共识）+ R2 design Round 3（100% 共识）+ 15 切片 |
| 3/6 BUILD | ✅ | ralph-loop TDD，15/15 切片，666 tests，coverage ≥80% |
| 4/6 VERIFY | ✅ | code-walkthrough 5 轮收敛（最终 3/3 APPROVED）+ 测试-规格对齐 96 分 + xp-gate 10/10 |
| 5/6 SHIP | ✅ | PR #13（v2a→main）→ v0.3.0；PR #14（0.3.1 CLI 修复）→ v0.3.1 |
| 6/6 CLOSE | ✅ | 人工 UAT 通过（emergent issues = 0）+ 状态备份 + worktree 清理 |

## 交付物

- **v2a 检测核心**：4 个新 checker（canary-return-scan / tool-call-shape 为阻断类；
  thinking-signature-presence / usage-reconcile 为观察类）、canary 引擎与轮换、
  流式窗口与预算、evil-relay testkit、门禁与文档。
- **发布**：v0.3.0（v2a 主体）+ v0.3.1（Linux 已安装 bin 符号链接修复）。
- **仓库状态**：main@d4e1632，PR #13 与 #14 均已合并，工作区干净。

## 关键指标

| 指标 | 值 |
|---|---|
| 切片 | 15/15 |
| 测试 | 642 passed / 51 conditional skipped（59 files） |
| 覆盖率 | statements 91.11% · branches 88.13% · functions 91.74% · lines 92.94% |
| 对齐评分 | 96（15/15 REQ，25/25 AC） |
| Gate MW | 3/3 APPROVED（v2a 主体 5 轮收敛；0.3.1 增量一轮 3/3） |
| release gate | 10/10（本地 + Linux CI） |
| main CI | Tests success；bench success（一次噪声门重跑后） |

## 发布面遗留（用户触发）

1. ~~**npm publish 未完成**：仓库未配置 `NPM_TOKEN` secret，release workflow 在 publish 步
   fail-closed（release gate 与版本一致性均已通过）。配置 token 后重跑 tag workflow 或手动
   `npm publish` 即可；GitHub Release v0.3.1 已手工创建。~~
   **已解决（2026-11-10）**：`npm llmveto@0.3.1` 已发布并成为 `latest`，doctor 烟测通过。
   发布通过 tag worktree 本地执行 `release:gate` 后 `npm publish`（CI 路径当时因 tag 的
   lockfile 钉在区域镜像而不可用，详见 `docs/release/publication-runbook.md`）。
2. **v0.3.0 的 tag workflow 失败**：原因即 0.3.1 修复的 Linux bin 符号链接缺陷；v0.3.0
   Release 仍存在，0.3.1 为推荐版本。
3. **G-CANARY 判据①②③**：原始录制已被覆盖，重放登记为接受残差（见 `docs/KNOWN-ISSUES.md`）。

## 经验

- 安装形态（npm bin symlink）必须纳入 smoke：源码直跑与安装后运行是两条执行路径。
- 发布 workflow 的 YAML 需要在推送前用 actionlint 校验，否则 0-job 失败会伪装成"CI 静默"。
- 相对性能门（min-of-10, 1.2×）在共享 runner 上有噪声；PR 与 main 同代码结论不一致时应重跑，
  并以绝对门 + 多次复跑为准，不静默放宽阈值。
