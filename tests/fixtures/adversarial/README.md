# tests/fixtures/adversarial/

fpverify（Python 项目）的 9 种对手响应由**开发者机器**离线跑一次 `sim/adversaries.py`
生成 YAML 后入仓。**CI 不引入 Python 运行时**，仅消费本目录 YAML 数据（G-FP 前置门）。

## 对手清单（fpverify 语义）

| # | 对手 | 场景 | v1 是否使用 |
|---|---|---|---|
| 1 | honest | 诚实上游，字段一致 | ✅ benign 参考 |
| 2 | drift | temperature 漂移 | ⚠️ v2 才断言（v1 无 usage/温度对账） |
| 3 | quantized | 量化降级响应风格 | ⚠️ v2 fingerprint-probe |
| 4 | swap | 定向替换模型但回写字段 | ❌ 明确登记 T3a 部分（label-consistency 对回写一致无效） |
| 5 | pin | 固定 top-k 采样 | ⚠️ v2 |
| 6 | filter_en | 英文过滤 | ⚠️ v2 |
| 7 | true_random | 温度=2 随机 | ⚠️ v2 |
| 8 | cache | 假缓存 | ⚠️ v2 usage-reconcile |
| 9 | partial_mimic | 部分模仿 | ⚠️ v2 |

## v1 消费方式

- 只有 `honest.yaml`（作 benign 参考）与 `swap.yaml`（作 label-mismatch 反面样本，
  即 swap 但**未回写字段**的低级对手 → 命中 model-label-consistency）进入 v1 CI 断言。
- 其余作为 v2 预留数据，v1 CI **不对其断言**（分期纪律）。

## 生成脚本

见 `.sprint-state/tools/gen-fpverify-fixtures.sh`（若需，v2 前补齐）；本目录内容由该脚本或
手工方式产出后入库，`git log` 可追溯。

## 手写样本已入仓情况

v1 首批以手写 YAML 形态提供（不依赖 fpverify 是否可跑），语义与 fpverify 输出对齐。见同目录
`*.yaml` 文件。
