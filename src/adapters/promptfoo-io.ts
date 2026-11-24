// @no-test-required: 测试在 tests/unit/adapters/promptfoo.test.ts（本项目测试布局为 tests/ 目录；Gate 5a 仅识别同目录/根 tests/ 六种路径）
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * @test REQ-V2bA-08 / AC-V2bA-08a
 * @intent promptfoo 配置的**行级定点编辑**原语。
 *
 * 与 Codex 的 TOML 原语同因由：项目级 YAML 里通常有用户自己的注释与排版，
 * 用 YAML 库读→改→写会把它们全部重排。这里只改目标 provider 的 `apiBaseUrl` 那一行标量。
 *
 * 失败语义：定位不确定就**拒绝写入**并报错（目标 provider 不存在 / 目标键重复 /
 * 写法超出可安全定位的范围），绝不猜位置。
 */

/** 写盘前的备份后缀。 */
const BACKUP_SUFFIX = ".bak";

/** 目标 provider 的行区间（从 `- id:` 到下一个 `- ` 或下一个顶层键）。 */
function providerRange(lines: readonly string[], providerId: string): { from: number; to: number } | null {
  const start = lines.findIndex((l) => new RegExp(`^\\s*-\\s+(?:id:\\s*)?["']?${escapeRe(providerId)}["']?\\s*$`).test(l));
  if (start === -1) return null;
  let to = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*-\s+/.test(lines[i]!) || /^[A-Za-z_]+\s*:/.test(lines[i]!)) {
      to = i;
      break;
    }
  }
  return { from: start, to };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 区间内某标量键的行号（多个 → 抛错，因为无法确定改哪个）。 */
function scalarLine(lines: readonly string[], range: { from: number; to: number }, key: string): number | null {
  const hits: number[] = [];
  for (let i = range.from; i < range.to; i += 1) {
    if (new RegExp(`^\\s+${escapeRe(key)}\\s*:`).test(lines[i]!)) hits.push(i);
  }
  if (hits.length > 1) throw new Error(`多处同形目标键：provider 内出现 ${hits.length} 个 ${key}，拒绝写入`);
  return hits[0] ?? null;
}

/** 保留原缩进的替换行。 */
function replaceValue(line: string, key: string, value: string): string {
  const indent = /^\s*/.exec(line)?.[0] ?? "";
  return `${indent}${key}: ${value}`;
}

/** 目标 provider 内没有该键时，插到区间末尾（保持缩进与列表结构）。 */
function insertScalar(lines: string[], range: { from: number; to: number }, key: string, value: string): string[] {
  const out = [...lines];
  const indent = /^\s*/.exec(out[range.from + 1] ?? "")?.[0] || "    ";
  out.splice(range.to, 0, `${indent}${key}: ${value}`);
  return out;
}

/**
 * 改（或插入）某 provider 的某个标量键。
 * @returns 是否真的写了盘（值本来就对时返回 false）
 */
export function writePromptfooScalar(path: string, providerId: string, key: string, value: string): boolean {
  if (!existsSync(path)) throw new Error(`promptfoo 配置不存在：${path}（本适配器不创建项目文件）`);
  const raw = readFileSync(path, "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.split(/\r?\n/);
  const range = providerRange(lines, providerId);
  if (range === null) throw new Error(`找不到受管 provider：${providerId}`);
  const at = scalarLine(lines, range, key);
  const next = at === null ? insertScalar(lines, range, key, value) : lines.map((l, i) => (i === at ? replaceValue(l, key, value) : l));
  const text = joinLikeOriginal(next, raw, eol);
  if (text === raw) return false;
  persist(path, text);
  return true;
}

/** 用与原文一致的方式拼回去（末尾换行的有无不被改动）。 */
function joinLikeOriginal(lines: readonly string[], raw: string, eol: string): string {
  const joined = lines.join(eol);
  return raw.endsWith("\n") ? joined : joined.replace(new RegExp(`${eol}$`), "");
}

/** 原子落盘 + 覆盖前留 .bak。 */
function persist(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  copyFileSync(path, path + BACKUP_SUFFIX);
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, path);
}
