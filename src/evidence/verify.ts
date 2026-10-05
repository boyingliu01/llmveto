import { existsSync, readFileSync } from "node:fs";
import { verifyRecord } from "./chain.ts";
import { validateEvidence, type EvidenceRecord } from "./schema.ts";

/**
 * @test REQ-VETO-010
 * @intent verify 核心算法：读 JSONL → 逐条 schema 断言 → 链式重算 → 位置一致性。
 *         失败模式（AC-VETO-010-02/03/04 + 空链）。
 *
 * 完整性边界（REQ §evidence 信任边界，逐字同源）：
 *   ✅ **保证**：单条记录被改写（record_hash 不符）；**中间**记录被删除（prev_hash 断链）；
 *              记录被重新编号（seq 与行号不符）；崩溃残半行（JSON 解析失败）；整体清空（empty_chain）。
 *   ❌ **不保证**：尾部截断 / 整链删除或重置。删掉末尾 N 条后，剩余前缀**本身就是一条自洽的短链**
 *              （prev_hash 两两匹配、seq 自 0 连续），任何纯本地校验都无法把它与"这条链本来就短"
 *              区分开——要判红必须有链长/链尾的**外部锚定**（远程 witness / RFC3161），而该项在
 *              REQ 中登记为"未排期"。本函数**不假装**能检测它，该方向由
 *              `tests/unit/evidence/verify.test.ts` 的 negative-contract 用例钉住。
 *   同权限对手可读写磁盘时，亦可整链重算重签——本层的对抗对象是"意外损坏与廉价篡改"。
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
  // 空文件/仅空白 = 链被整体清空。这不是"0 条记录的合法链"：writer 从不产出空文件，
  // 故它与尾部截断同族（AC-VETO-010-05）。
  if (lines.length === 0) {
    return { ok: false, kind: "chain_broken", first_bad_seq: 0, reason: "empty_chain" };
  }
  let prev: EvidenceRecord | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
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
    // 位置一致性：writer 以 0 起步、每条 +1 单调写 seq，故合法链恒有 seq === 行号(0-based)。
    // 它拦的是"记录被重新编号"（改大/改小）与中段错位；**拦不住尾部截断**（前缀本身合法，见文件头边界）。
    if (parsed.seq !== i) {
      return { ok: false, kind: "chain_broken", first_bad_seq: i, reason: "seq_position_mismatch" };
    }
    const cr = verifyRecord(parsed, prev);
    if (!cr.ok) {
      return { ok: false, kind: "chain_broken", first_bad_seq: parsed.seq, reason: cr.reason ?? "unknown" };
    }
    prev = parsed;
  }
  return { ok: true, records: lines.length };
}
