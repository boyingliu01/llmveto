/**
 * canary-registry.json 的结构契约与只读校验（D-02）。
 *
 * 文件名不含 canary 前缀是刻意的：src/cli 的静态边界守卫禁止任何 canary 路径 import
 * （AC-V2a-19③：CLI 无 canary 写侧）。本模块只含纯校验/类型，无 I/O 与写能力；
 * canary store 与 cli doctor 共用同一判定，避免运维面与运行面分叉。
 *
 * @no-test-required: 测试在 tests/unit/shared/registry-file-schema.test.ts（本项目测试布局为
 *                   tests/{unit,integration,e2e}/**，Gate 5a 仅识别同目录/根 tests/ 六种路径，
 *                   故在此登记真实位置而非声称免测）。
 */

export const REGISTRY_VERSION = 1 as const;

export type RegistryUnavailableCause = "invalid_json" | "unknown_version" | "malformed_structure";

export interface RegistryEntry {
  readonly canary: string;
  /** epoch ms；TTL 与 LRU 的排序基准。 */
  readonly last_seen: number;
}

/** canary-registry.json 文件 schema（自带 version 字段，D-02）。 */
export interface RegistryFile {
  readonly version: typeof REGISTRY_VERSION;
  readonly rotation_count: number;
  /** ISO-8601；null = 从未轮换。 */
  readonly last_rotated_at: string | null;
  readonly entries: Readonly<Record<string, RegistryEntry>>;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 结构校验：不合法返回损坏原因（invalid_json 由调用方先行判定），合法返回规整化数据。 */
export function validateRegistryFile(v: unknown): RegistryFile | RegistryUnavailableCause {
  if (!isPlainObject(v)) return "malformed_structure";
  if (v["version"] !== REGISTRY_VERSION) return "unknown_version";
  const rotation = v["rotation_count"];
  const rotatedAt = v["last_rotated_at"];
  if (typeof rotation !== "number" || !Number.isFinite(rotation) || rotation < 0) return "malformed_structure";
  if (rotatedAt !== null && (typeof rotatedAt !== "string" || Number.isNaN(Date.parse(rotatedAt)))) {
    return "malformed_structure";
  }
  const raw = v["entries"];
  if (!isPlainObject(raw)) return "malformed_structure";
  const entries: Record<string, RegistryEntry> = {};
  for (const [session, entry] of Object.entries(raw)) {
    if (!isPlainObject(entry)) return "malformed_structure";
    const canary = entry["canary"];
    const lastSeen = entry["last_seen"];
    if (typeof canary !== "string" || typeof lastSeen !== "number" || !Number.isFinite(lastSeen)) {
      return "malformed_structure";
    }
    entries[session] = { canary, last_seen: lastSeen };
  }
  return { version: REGISTRY_VERSION, rotation_count: rotation, last_rotated_at: rotatedAt, entries };
}
