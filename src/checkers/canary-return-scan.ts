// @no-test-required: 测试在 tests/unit/checkers/canary-return-scan.test.ts（Gate 5a 仅识别同目录/根 tests/ 六种路径）
import type {
  CheckerResult,
  Finding,
  NonStreamChecker,
  ScanUnit,
} from "../shared/types.ts";
import { scanTexts } from "../shared/types.ts";

/**
 * @test REQ-V2a-05 / SL-08
 * @intent T1a 安全类：跨会话串流检出——扫描响应文本是否包含其他会话的 canary（快照匹配）。
 *         verdict=finding → policy 层映射为 block（AC-V2a-06）。
 *
 * 关键不变量：
 *   1. 纯函数：不 import gateway/evidence/policy；只读 unit.meta.canary_candidates 快照。
 *   2. 自排除保证 FP=0：快照由 SL-07 编排时 store.snapshot(selfSession) 生成，已排除请求方自身 canary。
 *   3. 在途语义：快照一旦取出即固定，轮换不影响当前请求判定（AC-V2a-08/AC-V2a-19②）。
 *   4. 明文不进链：D-05 保证 canary 不会出现在证据体中，仅通过 meta 通道传递。
 *   5. scanTexts 契约：使用 scanTexts(unit) 同时扫原始文本与转义还原投影，防止编码绕过。
 */

export const CHECKER_ID = "canary-return-scan";

function readStringArray(meta: Readonly<Record<string, unknown>>, key: string): readonly string[] {
  const v = meta[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.length > 0);
}

/** 非空字符串判定（归因字段的取值约束）。 */
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/**
 * 单条目形状判定：{canary: 非空串, origin: 非空串}；其余一律视为形状不符。
 * 用"提前判否"把每个条件拆成独立的返回点，避免一串 && 堆出复杂度。
 */
function asOriginEntry(x: unknown): { canary: string; origin: string } | null {
  const entry = x as { canary?: unknown; origin?: unknown } | null;
  if (typeof entry !== "object" || entry === null) return null;
  const ok = isNonEmptyString(entry.canary) && isNonEmptyString(entry.origin);
  if (!ok) return null;
  return { canary: entry.canary as string, origin: entry.origin as string };
}

/** 带来源的候选（P1-2）：形状 {canary, origin}；无该键或形状不符时返回空集（退化为只报命中）。 */
function readCandidatesWithOrigin(
  meta: Readonly<Record<string, unknown>>,
): readonly { canary: string; origin: string }[] {
  const v = meta["canary_candidates_with_origin"];
  if (!Array.isArray(v)) return [];
  const entries = v.map(asOriginEntry);
  return entries.filter((e): e is { canary: string; origin: string } => e !== null);
}

/** 命中 finding：有归因时带上 origin，把「检测到串流」升级为「谁串进了谁」。 */
function hitFinding(origin: string | undefined): Finding {
  const base: Finding = {
    checker: CHECKER_ID,
    threat: "T1a",
    verdict: "finding",
    severity: "high",
    rule_id: "canary-detected-in-response",
  };
  return origin === undefined ? base : { ...base, origin };
}

export const checkCanaryReturnScan: NonStreamChecker = (unit: ScanUnit): CheckerResult => {
  const candidates = readStringArray(unit.meta, "canary_candidates");
  const originOf = new Map(readCandidatesWithOrigin(unit.meta).map((c) => [c.canary, c.origin]));
  if (candidates.length === 0) {
    return { verdict: "clean", evidence: [] };
  }

  // scanTexts 契约：返回 [text] 或 [text, decoded]，任一命中即为 finding
  for (const text of scanTexts(unit)) {
    for (const candidate of candidates) {
      if (text.includes(candidate)) {
        return { verdict: "finding", evidence: [hitFinding(originOf.get(candidate))] };
      }
    }
  }

  return { verdict: "clean", evidence: [] };
};

export const CANARY_RETURN_SCAN_SPEC = {
  id: CHECKER_ID,
  side: "response",
  synchronous: true,
  safetyClass: true, // T1a 安全类 → finding=block
  threat: "T1a",
  runNonStream: checkCanaryReturnScan,
} as const;
