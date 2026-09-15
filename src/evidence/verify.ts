import { existsSync, readFileSync } from "node:fs";
import { verifyRecord } from "./chain.ts";
import { validateEvidence, type EvidenceRecord } from "./schema.ts";

/**
 * @test REQ-VETO-010
 * @intent verify 核心算法：读 JSONL → 逐条 schema 断言 → 链式重算。
 *         三种失败模式（AC-VETO-010-02/03/04）。
 */

export type VerifyResult =
  | { ok: true; records: number }
  | { ok: false; kind: "no_file"; message: string }
  | { ok: false; kind: "unsupported_version"; evidence_version: unknown }
  | { ok: false; kind: "schema_violation"; seq: number; errors: readonly string[] }
  | { ok: false; kind: "chain_broken"; first_bad_seq: number; reason: string };

export function verifyEvidenceFile(path: string): VerifyResult {
  if (!existsSync(path)) {
    return { ok: false, kind: "no_file", message: `evidence file not found: ${path}` };
  }
  const raw = readFileSync(path, "utf8");
  const lines = raw.split("\n").filter((l) => l.length > 0);
  let prev: EvidenceRecord | null = null;
  for (const line of lines) {
    let parsed: EvidenceRecord;
    try {
      parsed = JSON.parse(line) as EvidenceRecord;
    } catch {
      // 末行残半：verify 视为文件被截断 → chain_broken
      return { ok: false, kind: "chain_broken", first_bad_seq: prev ? prev.seq + 1 : 0, reason: "truncated_line" };
    }
    // AC-VETO-010-04 evidence_version 优先断言
    if ((parsed as { evidence_version?: unknown }).evidence_version !== 1) {
      return { ok: false, kind: "unsupported_version", evidence_version: (parsed as { evidence_version?: unknown }).evidence_version };
    }
    const sv = validateEvidence(parsed);
    if (!sv.ok) {
      return { ok: false, kind: "schema_violation", seq: parsed.seq ?? -1, errors: sv.errors };
    }
    const cr = verifyRecord(parsed, prev);
    if (!cr.ok) {
      return { ok: false, kind: "chain_broken", first_bad_seq: parsed.seq, reason: cr.reason ?? "unknown" };
    }
    prev = parsed;
  }
  return { ok: true, records: lines.length };
}
