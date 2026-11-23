import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * @test REQ-VETO-009
 * @intent adapters 层受管配置文件的真实读写原语（M1.2）。
 *         doctor 不再对 {} 做门面漂移检测，而是读取用户真实配置文件。
 *
 * 契约：
 *   - readJsonConfig（检测侧）：文件缺失 / 空 / 不可解析 → 返回 {}（据此判"全漂移"，fail-closed）。
 *   - readJsonConfigStrict（写路径）：文件缺失 / 空白 → {}；存在但不可解析或顶层非对象 → throw。
 *     写路径禁止复用"读失败 → 空对象"语义：否则 deepMerge 基对象为空，会把用户真实配置
 *     覆写成仅含受管字段的 patch（非受管内容静默丢失），且写后漂移检测自洽（假 PASS）。
 *   - writeJsonConfig：递归建父目录后原子写（.tmp → rename 非必需，v1 直接覆写）。
 *   - deepMerge：仅合并纯对象；数组 / 标量按 patch 覆盖（不并集，保证幂等）。
 */

export type Env = Readonly<Record<string, string | undefined>>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function readJsonConfig(path: string): Record<string, unknown> {
  try {
    return readJsonConfigStrict(path);
  } catch {
    return {}; // 不可解析：视作全漂移，交由 doctor 报 FAIL
  }
}

/** 写路径专用读取：读失败必须显式抛出，绝不以空基覆写用户配置。 */
/** 读取配置原文并 trim；不可读时抛错（携带 path 与原始原因）。 */
function readTrimmedOrThrow(path: string): string {
  try {
    return readFileSync(path, "utf8").trim();
  } catch (err) {
    throw new Error(`config exists but is unreadable: ${path} (${describeError(err)})`);
  }
}

/** JSON 解析；失败时抛错（携带 path 与原始原因）。 */
function parseJsonOrThrow(path: string, raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    throw new Error(`config is not valid JSON: ${path} (${describeError(err)})`);
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function readJsonConfigStrict(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const raw = readTrimmedOrThrow(path);
  if (!raw) return {};
  const parsed = parseJsonOrThrow(path, raw);
  if (!isPlainObject(parsed)) throw new Error(`config exists but is not a JSON object: ${path}`);
  return parsed;
}

export function writeJsonConfig(path: string, data: Record<string, unknown>): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
  } catch (err) {
    throw new Error(`failed to write config: ${path} (${err instanceof Error ? err.message : String(err)})`);
  }
}

export function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const cur = out[k];
    out[k] = isPlainObject(v) && isPlainObject(cur) ? deepMerge(cur, v) : v;
  }
  return out;
}

/**
 * 受管配置的读取原语：适配器各自只提供 defaultConfigPath，
 * 读盘这一层两个适配器曾逐字重复（jscpd 14 行克隆），收拢到这里。
 */
export function readManagedConfig(adapter: {
  readonly defaultConfigPath: (env: Env) => string;
}, env: Env): Record<string, unknown> {
  return readJsonConfig(adapter.defaultConfigPath(env));
}

/**
 * 受管配置的写回原语（深度合并后落盘，返回写入路径）。
 * 与 readManagedConfig 同因由：避免适配器之间复制粘贴同一段合并-写入流程。
 */
export function applyManagedPatch(
  adapter: {
    readonly defaultConfigPath: (env: Env) => string;
    readonly buildPatch: (gatewayBaseUrl: string) => Record<string, unknown>;
  },
  env: Env,
  gatewayBaseUrl: string,
): string {
  const path = adapter.defaultConfigPath(env);
  const merged = deepMerge(readJsonConfigStrict(path), adapter.buildPatch(gatewayBaseUrl));
  writeJsonConfig(path, merged);
  return path;
}
