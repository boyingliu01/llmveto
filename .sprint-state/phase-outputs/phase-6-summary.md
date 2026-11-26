# Phase 6/6 CLOSE — llmveto v2b-C

- 日期：2026-11-26
- 状态：**等待用户验收（UAT）**

## 交付

| 项 | 结果 |
|---|---|
| 版本 | `0.10.0` |
| Tag / Release | [`v0.10.0`](https://github.com/boyingliu01/llmveto/releases/tag/v0.10.0) |
| 提交 | `597e3b3` |
| 切片 | **15/15** |
| 测试 | **947 passed / 52 skipped** |
| 覆盖率 | 91% |
| lint | 0 警告 |
| CCN | 无函数 > 7 |

## 交付内容

`src/fingerprint/` 8 个模块 + `docs/fingerprint-capability.md`：

- 四维探针（tokenizer / 格式遵循 / 知识边界 / 拒绝措辞），每次测一维轮转
- 每维独立中位数基线（K=10）
- 版本变更看方向判定
- 补齐探针（2 维）+ 分片识别
- 熔断跨重启持久化 + 配额共享
- 信任分（**只展示**）
- `llmveto fingerprint` CLI

## 评审历程

**需求 5 轮 + 设计 2 轮 + 走查 3 轮**，共 10 轮。每一轮都改掉了实质内容：

| 轮 | 发现 |
|---|---|
| 需求 R1 | 把安全边界写成"待答问题"= 把决定推给实现 |
| 需求 R2 | `model` 变→clean 与版本回退检测**逻辑矛盾** |
| 需求 R3 | 256B 装不下四项特征（物理互斥）；多维无中位数（数学错误） |
| 需求 R4 | **时间分片欺骗**：四维不同时测，无法证明同源 |
| 设计 R1 | 特征提取规则未定义；**补齐探针可能触发 Provider 封禁** |
| 走查 R1 | **persistState 从未被调用**（熔断不跨重启）；配额内存 Map |
| 走查 R3 | 回放用"最后一行"而非"最新状态"，乱序可清空熔断 |

## 我犯的三个错

1. **覆盖了 `specification.yaml`**——脚本重建时把 v2b-A 的 REQ 弄乱，从 git 恢复后改为追加
2. **`slices-manifest.json` 一直是 v2b-A 的**——`sprint-init --force` 没覆盖它，我做了 14 个切片才检查
3. **走查材料截断**——43KB diff 只发 9KB，两席都说"无法审计"，浪费一轮

## 最值得记的一条

**AC-09c 的测试显式调用了 `persistState()`**，验证了一条真实路径上不存在的调用。测试绿，功能坏。这是"测试证明了不存在的东西"的典型形态——比没有测试更危险。

## UAT 检查单（需要你手动做）

| # | 项 | 怎么验 |
|---|---|---|
| 1 | CLI 可用 | `llmveto fingerprint` → 应输出 "no fingerprint data yet..." |
| 2 | 参数校验 | `llmveto fingerprint --probe` → exit 2 + 用法 |
| 3 | 能力边界文档 | 读 `docs/fingerprint-capability.md`，确认三条代价你能接受 |
| 4 | 只 warn | 确认 `doctor` 不会因指纹失败而 FAIL |

## status

```
status: user_decision_required
outputs: [v0.10.0 已发布, 15 切片, 947 测试]
blocked_reason: Phase 6 CLOSE 需要用户手动 UAT，流程禁止自动化
```
