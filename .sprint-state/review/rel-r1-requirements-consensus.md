# R1 需求评审共识记录 — sprint-20261008-26「GitHub 开源发布」

> 链：Round 1（3×GAPS_FOUND）→ 需求陈述 v2 修订 → Round 2 交换核验（3×APPROVED，共识比 1.0）。
> 判据：delphi-review requirements 模式，三专家（三 distinct 模型）+ 四执行器 checks。

## Round 1（2026-10-08，卷面 var/delphi-r11/input-rel-r1.md，结果 rel-experts-r1.json）

三家 GAPS_FOUND（A=9 / B=8 / C=9），0 Critical。缺口去重后：

| # | 缺口 | 来源 |
|---|---|---|
| G1 | 仓库公开化前敏感信息/git 历史扫描缺失（阻断性） | A GAP-SEC-SCAN / B A2 / C GAP-SEC-01 |
| G2 | npm 凭据/账号安全口径缺失（2FA、token 最小权限、轮换） | A CONC-NPM-SECURITY / B A1 / C GAP-PROC-01 |
| G3 | tag 触发健壮性（可移动/可删除 = 发布可重放） | B C2 / C GAP-PROC-01 后半 |
| G4 | 多条 AC 判据不可客观判定（01a/01b/03a/04a/05a/06a） | B B1..B6 / C CONC-DOC-01 |
| G5 | 维护模式/支持政策口径缺失 | B D1/A5 / C minor |
| G6 | REQ 依赖未显式化 + 公开化硬时序 | B E1 |
| G7 | scripts 实况未核（CONTRIBUTING 会与实况矛盾） | C CONC-DEP-01 |
| G8 | 长尾：Node/Bun 支持矩阵、SPDX 策略、CHANGELOG、双语同步机制、演练固化 | A/B/C minor |

## 修订（v2）

REQ-REL-07 新增（阻断性、时序第一：gitleaks 全量历史 + git ls-files 公开面 + 内部端点处置 +
提交信息扫描）；AC-REL-01c 新增（npm 凭据安全）；AC 判据全部客观化（关键行清单/核对基准/
定位基准/tag 严格一致）；R-1 拆 R-1a/R-1b、R-5/R-6 新增；依赖时序五条显式声明；
非目标补两条（社区运营、npm 包签名）；设计拍板项 DD-1..DD-11 清单化。
出题方补核事实：repo PRIVATE、npm 名未占用、scripts 全清单（无 sync-version，版本门 = Gate 0）、
**内部端点已入库真实实例**（internal-gateway.invalid/redacted × 4 文件）→ DD-11 处置对象。

## Round 2 交换核验（卷面 input-rel-r2.md，结果 rel-experts-r2.json）

三家 **APPROVED**（A=9 / B=8 / C=9），0 Critical / 0 Major，共识比 1.0。
执行事故记录：Round 2 首两跑 C 槽（local-qwen3.8-27b）「回复末尾无可解析 JSON 裁决块」ERROR——
定位为 8192 max-tokens 输出预算在核验轮长输出下截断（执行器默认 18000）；按契约整轮重跑
（无单家重跑），18000 预算下第三跑全绿。非内容变更，卷面仅加输出预算纪律一行。

## R2 残留 minor（已入设计拍板项或设计期确认）

- A：CHANGELOG 强制引入建议（→ DD-1）；双语同步机制尽早定（→ DD-2）
- B：演练固化为可重复脚本（→ R-3 已更新）；SPDX 策略（→ DD-8）
- C：npm 包签名排除（→ 非目标已列）；Support Policy 章节（→ DD-7）

## 结论

R1 需求评审 **APPROVED**（共识比 1.0 ≥ 0.90）。需求冻结件 = docs/plans/2026-10-08-release-requirements.md
（requirements_hash 510273de…，head_commit c01acaf）。
