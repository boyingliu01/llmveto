import type {
  CheckerResult,
  NonStreamChecker,
  ScanUnit,
} from "../shared/types.ts";

/**
 * @test REQ-VETO-005
 * @intent 模型标签一致性（T3a label-mismatch 子集）：
 *         对比 ScanUnit.meta.model_responded 与 ScanUnit.meta.model_requested；
 *         不一致 → finding；由 policy 层映射为 warn（非阻断）。
 *
 * 能力边界（REQ-VETO-005 / AC-VETO-005-03 显式声明）：
 *   v1 仅覆盖"字段一致性"，对"定向替换模型但回写一致字段"的对手**无效**；
 *   后者属 v2 fingerprint-probe 覆盖范围。README/文档描述本 checker 时必须复制本段声明。
 *
 * 关键不变量：
 *   1. 纯函数：不 import gateway/evidence/policy；不读配置/时钟/网络/env。
 *   2. checker 不解析 JSON —— 网关在扫描单元组装阶段已把 model 字段解出并放入 meta。
 *   3. 响应 model 缺失 → v1 定为 finding（不阻断，仅告警），语义见 edge_case。
 */

export const CHECKER_ID = "model-label-consistency";

function readString(meta: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const v = meta[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export const modelLabelConsistency: NonStreamChecker = (unit: ScanUnit): CheckerResult => {
  const requested = readString(unit.meta, "model_requested");
  const responded = readString(unit.meta, "model_responded");

  // 双侧都缺失 → 无从判定，视为 clean（不产生噪声）
  if (requested === undefined && responded === undefined) {
    return { verdict: "clean", evidence: [] };
  }
  // 任一侧缺失或两侧不等 → finding（AC-VETO-005-01 + edge_case：响应字段缺失→finding）
  if (requested === undefined || responded === undefined || requested !== responded) {
    return {
      verdict: "finding",
      evidence: [{
        checker: CHECKER_ID,
        threat: "T3a",
        verdict: "finding",
        severity: "low",
        rule_id: "model-label-mismatch",
      }],
    };
  }
  return { verdict: "clean", evidence: [] };
};

/**
 * 流式：首块 vs 完成块 model 字段（AC-VETO-005-01 + edge_case：任一块不一致即 finding）。
 * 每次 runStream 仅对当前 chunk 的 meta 做检查；不跨 chunk 累积（网关在 tee 层
 * 对每 chunk 都调用，任一次 finding 即视为整体 finding，与 policy 层严者胜规则一致）。
 */
export const modelLabelConsistencyStream = modelLabelConsistency;

export const MODEL_LABEL_CONSISTENCY_SPEC = {
  id: CHECKER_ID,
  side: "response",
  synchronous: true,
  safetyClass: false, // → policy 层 finding=warn（观测/告警类）
  runNonStream: modelLabelConsistency,
} as const;
