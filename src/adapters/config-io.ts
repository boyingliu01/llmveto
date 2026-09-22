import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * @test REQ-VETO-009
 * @intent adapters 层受管配置文件的真实读写原语（M1.2）。
 *         doctor 不再对 {} 做门面漂移检测，而是读取用户真实配置文件。
 *
 * 契约：
 *   - readJsonConfig：文件缺失 / 空 / 不可解析 → 返回 {}（检测侧据此判"全漂移"，fail-closed）。
 *   - writeJsonConfig：递归建父目录后原子写（.tmp → rename 非必需，v1 直接覆写）。
 *   - deepMerge：仅合并纯对象；数组 / 标量按 patch 覆盖（不并集，保证幂等）。
 */

export type Env = Readonly<Record<string, string | undefined>>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function readJsonConfig(path: string): Record<string, unknown> {
  try {
    if (!existsSync(path)) return {};
    const raw = readFileSync(path, "utf8").trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {}; // 不可解析：视作全漂移，交由 doctor 报 FAIL
  }
}

export function writeJsonConfig(path: string, data: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const cur = out[k];
    out[k] = isPlainObject(v) && isPlainObject(cur) ? deepMerge(cur, v) : v;
  }
  return out;
}
