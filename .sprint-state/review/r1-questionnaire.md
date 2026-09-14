# R1 需求评审 · Round 1 匿名独立评审

你是一位独立评审专家。**你看不到其他专家的意见，也不需要猜测他们的立场。** 请只按你自己的判断作答。

评审对象是**需求（Requirements）**，不是代码。你的任务是判定：这份需求是否可以冻结、进入设计确认与实现阶段。

## 请阅读以下文件（相对当前工作目录）

必读：

- `docs/issues/1-req-threat-model.md` — 原始需求、威胁模型 T1–T4/P1–P2、目标与非目标
- `docs/issues/4-test-validation.md` — 可测试性契约 4 条、验证五件套、CI 结构
- `docs/issues/5-roadmap.md` — v1/v2/v3 分期与每期硬验收标准

背景参考（不必逐字评审，用于判断一致性）：

- `docs/issues/2-design-v1.md` — 架构设计 v1
- `docs/issues/3-reuse-list.md` — 复用与集成清单
- `architecture.yaml` — 分层与依赖方向契约

## 评审范围：v1 MVP

本次开发只做 v1。v1 交付：反代核、evidence store、3 个 checker（`model-field-consistency` / `invisible-unicode-scan` / `egress-secret-scan`）、OpenCode + Delphi 接入、CLI（start/stop/status/doctor）。

## 你要重点猎杀的问题类型

1. **需求之间的冲突**：REQ / TEST / ROADMAP 三份文档互相矛盾、或与设计文档矛盾之处
2. **不可证明的验收标准**：写了但无法用测试或命令客观判定的条目（例如"doctor 可证明全部 provider 流量过闸"——请追问"全部"如何枚举、如何证明）
3. **威胁模型与 v1 checker 的覆盖缺口**：v1 三个 checker 声称覆盖 T1b/T2c/T3a，其余威胁（T2a/T2b/T2d/T4x/P1/P2）在 v1 期间的暴露面是否被明确承认并记录
4. **"声称能做到但实际做不到"的承诺**：特别是「SSE 流式零缓冲（客户端立即收到字节）」与「fail-closed 阻断」并存时——已经转发出去的字节无法收回，那么流式场景下 block 的确切语义是什么？需求是否定义了它？
5. **性能预算与安全检查的冲突**：TTFT 增量 p95 < 5ms 的预算，与"出站请求体要过 gitleaks 规则集"（需扫描完整请求体）之间的时间冲突，需求是否量化并划清了测量口径
6. **范围蔓延或非目标越界**：v1 条目里混入实为 v2/v3 的能力，或 v1 验收依赖 v2 才有的组件
7. **安全属性被误当成已解决**：evidence 哈希链能否防住本机被沦陷 agent 的篡改？金丝雀在 v1 缺席时，v1 的"防数据外泄"主张还剩什么？
8. **术语与契约歧义**：verdict（allow/warn/redact/block）与 action 的关系、`redact` 在流式响应上如何执行、evidence schema 未定义字段等

## 输出格式（严格遵守）

先给 Markdown 报告，再附 JSON 结论块。

```markdown
## 独立评审 - Expert [填 A / B / C，按你的视角：A=架构 B=技术 C=可行性]

### 优点
1. [具体优点 + 文档位置]

### 问题清单
#### Critical Issues（必须修复才能批准）
1. [问题] - 位置: [文件/章节] - 为何阻断: [...] - 可判定的解决标准: [...] - 修复建议: [...]

#### Major Concerns（必须处理）
1. [同上结构]

#### Minor Concerns（需要说明）
1. [同上结构]
```

```json
{
  "expert_id": "A|B|C",
  "round": 1,
  "mode": "design",
  "verdict": "APPROVED|REQUEST_CHANGES|REJECTED",
  "confidence": 9,
  "critical_issues": ["..."],
  "major_concerns": ["..."],
  "minor_concerns": ["..."]
}
```

## 裁决纪律

- 存在任何 Critical Issue → 裁决**必须**是 `REQUEST_CHANGES`，不得给 `APPROVED`
- 问题要**具体、可证伪、指到文档位置**。"建议加强健壮性"这类空话视为无效输出
- 宁可多报：漏报真实缺陷的代价远高于误报
- 不要提出实现方案细节（那是 R2 的事），聚焦"需求是否完备、一致、可证明"
