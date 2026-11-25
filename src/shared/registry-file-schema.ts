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
/**
 * 校验一个条目（session → 条目）。返回 null 表示结构不合法。
 *
 * 与下面三段拆开是为了让每个函数只表达**一个**判定面：条目内部、文件头、
 * 条目集合。合在一起时 CCN 15，读的人要在同一屏里同时跟踪三种失败。
 */
function entryOf(value: unknown): RegistryEntry | null {
  if (!isPlainObject(value)) return null;
  const canary = value["canary"];
  const lastSeen = value["last_seen"];
  if (typeof canary !== "string") return null;
  if (typeof lastSeen !== "number" || !Number.isFinite(lastSeen)) return null;
  return { canary, last_seen: lastSeen };
}

/** `last_rotated_at` 合法：null，或可被 Date.parse 解析的字符串。 */
function validRotatedAt(value: unknown): boolean {
  if (value === null) return true;
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/** 文件头的三个字段（version / rotation_count / last_rotated_at）。 */
function validHeader(v: Record<string, unknown>): boolean {
  if (v["version"] !== REGISTRY_VERSION) return false;
  const rotation = v["rotation_count"];
  if (typeof rotation !== "number" || !Number.isFinite(rotation) || rotation < 0) return false;
  return validRotatedAt(v["last_rotated_at"]);
}

/** 全部条目；任一条目不合法返回 null。 */
function entriesOf(raw: unknown): Record<string, RegistryEntry> | null {
  if (!isPlainObject(raw)) return null;
  const out: Record<string, RegistryEntry> = {};
  for (const [session, value] of Object.entries(raw)) {
    const entry = entryOf(value);
    if (entry === null) return null;
    out[session] = entry;
  }
  return out;
}

export function validateRegistryFile(v: unknown): RegistryFile | RegistryUnavailableCause {
  if (!isPlainObject(v)) return "malformed_structure";
  // 版本是唯一能与"结构坏了"区分的失败：旧文件要能被识别成旧格式，
  // 而不是被当成损坏而不给升级路径。
  if (v["version"] !== REGISTRY_VERSION) return "unknown_version";
  if (!validHeader(v)) return "malformed_structure";

  const entries = entriesOf(v["entries"]);
  if (entries === null) return "malformed_structure";

  return {
    version: REGISTRY_VERSION,
    rotation_count: v["rotation_count"] as number,
    last_rotated_at: v["last_rotated_at"] as string | null,
    entries,
  };
}
