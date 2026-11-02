// @no-test-required: 测试在 tests/unit/checkers/canary-return-scan.test.ts（Gate 5a 仅识别同目录/根 tests/ 六种路径）
import type {
  CheckerResult,
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

export const checkCanaryReturnScan: NonStreamChecker = (unit: ScanUnit): CheckerResult => {
  const candidates = readStringArray(unit.meta, "canary_candidates");
  if (candidates.length === 0) {
    return { verdict: "clean", evidence: [] };
  }

  // scanTexts 契约：返回 [text] 或 [text, decoded]，任一命中即为 finding
  for (const text of scanTexts(unit)) {
    for (const candidate of candidates) {
      if (text.includes(candidate)) {
        return {
          verdict: "finding",
          evidence: [{
            checker: CHECKER_ID,
            threat: "T1a",
            verdict: "finding",
            severity: "high",
            rule_id: "canary-detected-in-response",
          }],
        };
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
