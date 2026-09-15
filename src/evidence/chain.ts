import { createHash } from "node:crypto";
import type { EvidenceRecord } from "./schema.ts";

/**
 * @test REQ-VETO-007
 * @intent SHA-256 链式哈希：record_hash = H(prev_hash ‖ canonical_json(record_minus_hashes))
 *
 * canonical_json：递归对象键按 Unicode code unit 升序排序，数组保持顺序，
 *   数字使用 JSON.stringify 输出（v1 记录内数值字段全部为整数或标准 double）。
 *
 * record_minus_hashes：排除 `record_hash` 与 `prev_hash` 两个字段（`prev_hash` 已作为
 *   哈希输入前缀参与计算，避免重复计入）。
 */

export const GENESIS_HASH = "0".repeat(64);

export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) parts.push(JSON.stringify(k) + ":" + canonicalJson(obj[k]));
    return "{" + parts.join(",") + "}";
  }
  return "null";
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 返回 record_hash（不修改入参）。 */
export function computeRecordHash(rec: Omit<EvidenceRecord, "record_hash">): string {
  const { prev_hash, ...minus } = rec as Omit<EvidenceRecord, "record_hash"> & { prev_hash: string };
  const payload = prev_hash + canonicalJson(minus);
  return sha256Hex(payload);
}

export interface ChainInput {
  readonly prev_hash: string;
  readonly record: Omit<EvidenceRecord, "record_hash" | "prev_hash"> & { readonly prev_hash?: string };
}

/** 生成完整链上的记录（含 prev_hash + record_hash）。 */
export function sealRecord(input: ChainInput): EvidenceRecord {
  const withPrev: Omit<EvidenceRecord, "record_hash"> = {
    ...(input.record as Omit<EvidenceRecord, "record_hash">),
    prev_hash: input.prev_hash,
  };
  const record_hash = computeRecordHash(withPrev);
  return { ...withPrev, record_hash } as EvidenceRecord;
}

/**
 * verify 用：重算 record_hash，判定与文件内是否一致。
 * 同时校验 prev_hash 与上一条 record_hash 相等。
 */
export function verifyRecord(rec: EvidenceRecord, prev: EvidenceRecord | null): { ok: boolean; reason?: string } {
  const expectedPrev = prev ? prev.record_hash : GENESIS_HASH;
  if (rec.prev_hash !== expectedPrev) return { ok: false, reason: "prev_hash_mismatch" };
  const { record_hash: _drop, ...minus } = rec;
  const recomputed = computeRecordHash(minus as Omit<EvidenceRecord, "record_hash">);
  if (recomputed !== rec.record_hash) return { ok: false, reason: "record_hash_mismatch" };
  return { ok: true };
}
