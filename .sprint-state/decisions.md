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

## Decision DR-006
- **Phase**: 2/6 DESIGN（设计拍板项 DD-11）
- **Question**: 内部端点历史处置口径？（已识别 4 文件含 `https://internal-gateway.invalid/redacted`，均已合并 main；仓库仍 PRIVATE，处置窗口存在）
- **Options**: ① filter-repo 全量改写（全库新 SHA）② 前瞻脱敏新提交 + 接受历史残留
- **Choice**: ① filter-repo 全量改写
- **Rationale**: 用户拍板（采推荐项）——"安全、透明性"优先级下历史零残留最干净；代价（SHA 映射登记 / worktree 作废 / PR 引用悬链）在设计 D-07 显式登记为义务；执行时点 = merge 后 flip 前由用户确认
- **Timestamp**: 2026-10-08T20:40+08:00

## Decision DR-007
- **Phase**: 2/6 DESIGN（设计拍板项 DD-10）
- **Question**: README 主文件方向？
- **Options**: ① README.md = 英文全量 + README.zh-CN.md 中文镜像 ② 反之（README.md 保持中文）
- **Choice**: ① README.md = 英文全量 + README.zh-CN.md 中文镜像
- **Rationale**: 用户拍板（采推荐项）——GitHub 默认展示面为英文受众；中文全量镜像保底中文开发者；同步机制随 DD-2（DR-010）
- **Timestamp**: 2026-10-08T20:40+08:00

## Decision DR-008
- **Phase**: 2/6 DESIGN（设计拍板项 DD-3）
- **Question**: 首个公开发布版本号？
- **Options**: ① 0.2.0 直发 ② bump 0.2.1 ③ 0.3.0 ④ 1.0.0-rc
- **Choice**: ① 0.2.0 直发
- **Rationale**: 用户拍板（采推荐项）——VERSION 与 package.json 已一致（Gate 0 绿），v1 验收 6/6 + 296 测试基线支撑；公开发布 = v0.1 → v0.2 的既有演进线，无 bump 必要
- **Timestamp**: 2026-10-08T20:40+08:00

## Decision DR-009
- **Phase**: 2/6 DESIGN（设计拍板项 DD-6 + DD-7）
- **Question**: 外部贡献口径（DD-6）与 Support Policy 口径（DD-7）？
- **Options**: ① 保守承诺（PR 须过全部门禁与走查链；漏洞私下报告 + best-effort 响应）② 积极社区承诺（SLA / 快速响应）
- **Choice**: ① 保守承诺
- **Rationale**: 用户拍板（采推荐项）——个人维护的开源项目，承诺超出维护能力即失信；"自用守门员"定位下 PR 全门禁恰好复用项目自身的质量体系（12 门 + Gate MW + #367）
- **Timestamp**: 2026-10-08T20:40+08:00

## Decision DR-010
- **Phase**: 2/6 DESIGN（锁默认批 DD-1/2/4/5/8/9 + 新披露决策）
- **Question**: 其余拍板项未提请用户时按何口径锁默认？（随设计文档一并披露，用户可在评审中挑战）
- **Options**: 锁默认并披露 vs 全部逐项再问
- **Choice**: 锁默认并披露：DD-1 设立 CHANGELOG（Keep a Changelog 轻量、英文）；DD-2 中文为技术口径基准 + 同 PR 同改 + 人工检查单，不建 CI 机器核对；DD-4 ruleset 防删防移、公开化后配置、本迭代交付 runbook；DD-5 files 保持 ["dist","README.md","LICENSE"]；DD-8 不加 SPDX 文件级头；DD-9 双保险（本机门链 + runner 冒烟）不引 Docker。新披露：SECURITY/CONTRIBUTING/CHANGELOG = 英文；术语对照表落 CONTEXT.md；门链脚本 scripts/release-gate.mjs + prepublishOnly 双层防跳过；07c 占位符 = https://internal-gateway.invalid/redacted
- **Rationale**: 六项默认均为低争议高惯例口径，逐项提问稀释用户注意力；披露即接受挑战，R2 设计评审三专家为第一道挑战面
- **Timestamp**: 2026-10-08T20:40+08:00

## Decision DR-011
- **Phase**: 2/6 DESIGN（R2 设计评审 Round 1 处置）
- **Question**: 设计 v1 评审 A=APPROVED(8) / B=REQUEST_CHANGES(8) / C=REQUEST_CHANGES(8)，3 Critical + 9 Major + 9 Minor 如何处置？
- **Options**: ① 逐条处置落设计 v2 后交换轮重评 ② 挑选 Critical 处置、Major 登记 ③ 上报用户仲裁
- **Choice**: ① 逐条处置落设计 v2 后交换轮重评
- **Rationale**: 零容忍纪律（Critical/Major 全部处理）；处置要点 = 冒烟判据按 CLI 实况冻结（CLI 无 --help、干净环境 doctor 必漂移两处按实况修正）、"纯 Node"判定改 PATH 剥离 Bun、门链 teardown 化、release.yml 显式单一真源 + publish 幂等、filter-repo 三段式（bundle 备份 + 预演审查）+ message 改写轮、双语加 parity 脚本；全表见设计 v2 §8 处置台账
- **Timestamp**: 2026-10-09T00:30+08:00

## Decision DR-012
- **Phase**: 6/6 CLOSE（USER ACCEPTANCE）
- **Question**: 「GitHub 开源发布」迭代交付是否验收通过（npm 发布转正门链 + 双语 README + 开源卫生件 + 公开化 runbook，src/ 零改动）？
- **Options**: ① 验收通过，清理收尾 ② 验收不通过（登记返工）
- **Choice**: ① 验收通过，清理收尾
- **Rationale**: 用户手动确认（AskUserQuestion，2026-10-09）；验收材料 = PR #9/#10（CI 全绿）+ rel-cw 共识 3/3 APPROVED consensus 1.0 + #367 对齐 PASS 98.5 + release:gate 重跑 PASS ×2
- **Timestamp**: 2026-10-09T01:50:00+08:00
