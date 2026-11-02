// @no-test-required: 测试在 tests/unit/evidence/aggregate.test.ts（Gate 5a 仅识别同目录/根 tests/ 六种路径）
import { existsSync, readFileSync } from "node:fs";
import type { EvidenceRecord } from "./schema.ts";

/**
 * @test REQ-V2a-06
 * @intent durable 计数从链聚合（D-14）：遮蔽语义按登记——链缺失/损坏不 throw，
 *         收敛为显式 degraded 结果（doctor [DEGRADED] 前缀消费）。
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

export function aggregateEvidence(path: string): AggregateResult {
  if (!existsSync(path)) return { status: "degraded", reason: "no_file" };
  let raw: string;
  try { raw = readFileSync(path, "utf8"); } catch { return { status: "degraded", reason: "parse_error" }; }
  const lines = raw.split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) return { status: "ok", counts: ZERO };
  let allowed = 0, blocked = 0, warned = 0, terminated = 0, degraded = 0;
  for (const line of lines) {
    let rec: EvidenceRecord;
    try { rec = JSON.parse(line) as EvidenceRecord; } catch { return { status: "degraded", reason: "parse_error" }; }
    const a = rec.action_taken;
    if (a === "allowed") allowed++;
    else if (a === "blocked_before_forward" || a === "blocked_before_deliver") blocked++;
    else if (a === "warned") warned++;
    else if (a === "terminated_after_delivery") terminated++;
    if (a === "degraded_observational") degraded++;
  }
  return { status: "ok", counts: { total: lines.length, allowed, blocked, warned, terminated, degraded } };
}
