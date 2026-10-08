# Sprint 决策记录 — sprint-20261008-26（GitHub 开源发布）

## Decision DR-001
- **Phase**: 1/6 PREP
- **Question**: v2a BUILD（15 切片检测核心，BUILD 解锁依赖 G-CANARY #E 录制 0/10）在本迭代中如何处置？
- **Options**: ① 先发布 v1，v2a 独立挂起 ② 并入本迭代一起发 ③ 只并入不依赖录制的切片
- **Choice**: ① 先发布 v1，v2a 独立挂起
- **Rationale**: 发布不被用户侧录制进度阻塞；15 切片冻结件（SPEC-V2A-001）已并入 main 不会丢；发布后 v2a BUILD 作为独立 v2 迭代继续
- **Timestamp**: 2026-10-08T12:35+08:00

## Decision DR-002
- **Phase**: 2/6 DESIGN（需求访谈）
- **Question**: 发布/分发形态？现状 = 本地 clone + npm link，package.json 有意 private:true（ADR-0001 预留转正路径）
- **Options**: ① npm registry + GitHub Release ② 仅 GitHub 源码仓 + Release tag ③ npm + 单二进制（bun --compile）
- **Choice**: ① npm registry + GitHub Release
- **Rationale**: 兑现 ADR-0001 预留的转正路径；开发人员 `npm i -g llmveto` 即用，最贴合"自用守门员"定位；npm 名 `llmveto` 已核实未被占用（registry E404）
- **Timestamp**: 2026-10-08T12:35+08:00

## Decision DR-003
- **Phase**: 2/6 DESIGN（需求访谈）
- **Question**: 上游容错深度？现状 = T0 已缓解（单请求 502 + 留痕，daemon 存活，fail-closed），无重试/备用上游
- **Options**: ① 维持 fail-closed 现状 + 登记边界（零运行时改动）② 实现重试/备用上游
- **Choice**: ① 维持 fail-closed 现状 + 登记边界
- **Rationale**: 重试/备用上游属 v2 运营面；本迭代保持 src/ 零改动，发布最快最稳；边界文档化符合"透明性"优先级
- **Timestamp**: 2026-10-08T12:35+08:00

## Decision DR-004
- **Phase**: 2/6 DESIGN（需求访谈）
- **Question**: 文档语言策略？现状 = README + docs/issues 全套中文
- **Options**: ① 中文为主 + README 英文简介段 ② 双语完整（README.en 全量镜像）③ 仅中文
- **Choice**: ② 双语完整（README.en.md 全量镜像）
- **Rationale**: 用户拍板（未采推荐项①）——国际开源受众全覆盖；同步维护成本以设计口径控制（同步基准与漂移检查留设计拍板）
- **Timestamp**: 2026-10-08T12:35+08:00

## Decision DR-005
- **Phase**: 1/6 PREP
- **Question**: xp-gate 登记处活动 sprint 为 v2a（sprint-20260927-46，BUILD 未启动），新 sprint 初始化被阻断
- **Options**: ① --force 退役 v2a 活动登记（状态备份 .sprint-history/）② 先关闭 v2a sprint 再初始化
- **Choice**: ① --force 退役
- **Rationale**: v2a 冻结产物已全部并入 main（PR #8），活动登记仅占用状态机；旧状态已备份至 .sprint-history/sprint-state-sprint-20260927-46-2026-10-08T12-20-11.json；v2a BUILD 归属由 DR-001 承接（独立挂起）
- **Timestamp**: 2026-10-08T12:20+08:00
