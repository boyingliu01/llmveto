// @no-test-required: 测试在 tests/unit/evidence/aggregate.test.ts（Gate 5a 仅识别同目录/根 tests/ 六种路径）
import { existsSync, readFileSync } from "node:fs";
import type { EvidenceRecord } from "./schema.ts";
import type { ActionTaken } from "../shared/types.ts";

/**
 * @test REQ-V2a-06
 * @intent durable 计数从链聚合（D-14）：遮蔽语义按登记——链缺失/损坏不 throw，
 *         收敛为显式 degraded 结果（doctor [DEGRADED] 前缀消费）。
 */

/**
 * degraded 与 allowed/blocked/warned/terminated 互斥：它统计 action_taken 恰为
 * degraded_observational 的记录，五桶之和 = total。action_taken 优先级保证 block 胜过
 * degraded，因此「block ∧ degraded」只体现为 blocked（最终动作）+ findings[] 里的观察类
 * error 条目，不计入 degraded。
 */
export interface AggregateCounts {
  readonly total: number;
  readonly allowed: number;
  readonly blocked: number;
  readonly warned: number;
  readonly terminated: number;
  readonly degraded: number;
}

export type AggregateResult =
  | { readonly status: "ok"; readonly counts: AggregateCounts }
  | { readonly status: "degraded"; readonly reason: "no_file" | "parse_error" };

const ZERO: AggregateCounts = Object.freeze({ total: 0, allowed: 0, blocked: 0, warned: 0, terminated: 0, degraded: 0 });

interface MutableCounts {
  allowed: number;
  blocked: number;
  warned: number;
  terminated: number;
  degraded: number;
}

/** action_taken → 桶。五桶与 ActionTaken 一一对应，degraded 独占自身桶。 */
const ACTION_BUCKETS: Readonly<Record<ActionTaken, keyof MutableCounts>> = {
  allowed: "allowed",
  blocked_before_forward: "blocked",
  blocked_before_deliver: "blocked",
  warned: "warned",
  terminated_after_delivery: "terminated",
  degraded_observational: "degraded",
};

function countAction(action: ActionTaken, counts: MutableCounts): void {
  const bucket = ACTION_BUCKETS[action];
  if (bucket !== undefined) counts[bucket]++;
}

function parseRecord(line: string): EvidenceRecord | null {
  try { return JSON.parse(line) as EvidenceRecord; } catch { return null; }
}

export function aggregateEvidence(path: string): AggregateResult {
  if (!existsSync(path)) return { status: "degraded", reason: "no_file" };
  let raw: string;
  try { raw = readFileSync(path, "utf8"); } catch { return { status: "degraded", reason: "parse_error" }; }
  const lines = raw.split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) return { status: "ok", counts: ZERO };
  const counts: MutableCounts = { allowed: 0, blocked: 0, warned: 0, terminated: 0, degraded: 0 };
  for (const line of lines) {
    const rec = parseRecord(line);
    if (rec === null) return { status: "degraded", reason: "parse_error" };
    countAction(rec.action_taken, counts);
  }
  return { status: "ok", counts: { total: lines.length, ...counts } };
}
