// @no-test-required: 测试在 tests/unit/adapters/codex.test.ts（定点编辑原语由适配器用例覆盖）（本项目测试布局为 tests/ 目录；Gate 5a 仅识别同目录/根 tests/ 六种路径）
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * @test REQ-V2bA-07 / AC-V2bA-07a~c / REQ-V2bA-08a2
 * @intent TOML 受管配置的**定点编辑**原语。
 *
 * 与 `config-io.ts` 的 JSON 原语刻意分开：TOML 有表头、内联表、多行数组等形态，
 * 用解析-重写会把注释与排版全部丢掉。这里只做三件事：
 *   1. 解析原文找到目标表与目标键的**行号**；
 *   2. 修改/插入那几行；
 *   3. 其余字节原样不动（行尾风格按原文决定，不做归一化）。
 *
 * 失败语义：任何"定位不确定"的情况（目标键重复、目标表重复）都**拒绝写入**并报错，
 * 绝不猜一个位置去改——改错一个用户的配置文件比报错危险得多。
 */

/** 写盘前的备份后缀（覆盖已有文件时保留一份）。 */
const BACKUP_SUFFIX = ".bak";

/** 读原文；文件不存在返回空串（= 全新安装）。 */
export function readCodexToml(path: string): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}

/** 一行是否是某个 `[table]` 表头；是则返回表名。 */
function tableHeaderOf(line: string): string | null {
  const m = /^\s*\[([^[\]]+)\]\s*(?:#.*)?$/.exec(line);
  return m === null ? null : (m[1] ?? "").trim();
}

/** 一行是否是 `key = value`；是则返回键名。 */
function keyOf(line: string): string | null {
  const m = /^\s*([A-Za-z0-9_-]+)\s*=/.exec(line);
  return m === null ? null : (m[1] ?? null);
}

/** 目标表区间：从表头行到下一个表头之前（表头不存在时为 null）。 */
function tableRange(lines: readonly string[], table: string): { header: number; end: number } | null {
  const header = lines.findIndex((l) => tableHeaderOf(l) === table);
  if (header === -1) return null;
  let end = lines.length;
  for (let i = header + 1; i < lines.length; i += 1) {
    if (tableHeaderOf(lines[i]!) !== null) {
      end = i;
      break;
    }
  }
  return { header, end };
}

/**
 * 该表是否以内联表写法存在（父表里一行 `leaf = { ... }`）。
 * 例：`[model_providers]` 段内出现 `llmveto = { name = "x" }`。
 */
function hasInlineTable(lines: readonly string[], table: string): boolean {
  const dot = table.lastIndexOf(".");
  if (dot === -1) return false;
  const parent = table.slice(0, dot);
  const leaf = table.slice(dot + 1);
  const parentRange = tableRange(lines, parent);
  if (parentRange === null) return false;
  for (let i = parentRange.header + 1; i < parentRange.end; i += 1) {
    if (new RegExp(`^\\s*${leaf}\\s*=\\s*\\{`).test(lines[i]!)) return true;
  }
  return false;
}

/** 在给定区间里找某个键的所有行号（用于检出重复）。 */
function keyLines(lines: readonly string[], from: number, to: number, key: string): number[] {
  const out: number[] = [];
  for (let i = from; i < to; i += 1) if (keyOf(lines[i]!) === key) out.push(i);
  return out;
}

/** 检测原文的行尾风格（CRLF 或 LF），写回时沿用。 */
function eolOf(raw: string): string {
  return raw.includes("\r\n") ? "\r\n" : "\n";
}

/** 把原文切成不含行尾的行数组（保留原始行尾风格供 join 时恢复）。 */
function splitLines(raw: string): string[] {
  return raw.length === 0 ? [] : raw.split(/\r?\n/);
}

/** TOML 字符串值的安全引号化（受管值都是可打印 ASCII，仍做转义以防配置异常）。 */
function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** 受管写入的请求：目标表 + 目标键值。 */
export interface ManagedTableEdit {
  readonly table: string;
  readonly keys: Readonly<Record<string, string>>;
}

/** 把 keys 写进目标表区间；返回新的行数组。 */
function applyKeys(lines: string[], range: { header: number; end: number }, keys: Readonly<Record<string, string>>): string[] {
  const out = [...lines];
  for (const [key, value] of Object.entries(keys)) {
    const hits = keyLines(out, range.header + 1, range.end, key);
    if (hits.length > 1) {
      throw new Error(`多处同形目标键：${range.header} 行起的表里出现 ${hits.length} 个 ${key}，拒绝写入`);
    }
    const line = `${key} = ${quote(value)}`;
    if (hits.length === 1) {
      const indent = /^\s*/.exec(out[hits[0]!]!)?.[0] ?? "";
      out[hits[0]!] = indent + line;
    } else {
      out.splice(range.end, 0, line);
      range = { ...range, end: range.end + 1 };
    }
  }
  return out;
}

/** 创建一个新的目标表块（追加在文件末尾）。 */
function appendTable(lines: string[], edit: ManagedTableEdit): string[] {
  const out = [...lines];
  while (out.length > 0 && out[out.length - 1]!.trim() === "") out.pop();
  if (out.length > 0) out.push("");
  out.push(`[${edit.table}]`);
  for (const [key, value] of Object.entries(edit.keys)) out.push(`${key} = ${quote(value)}`);
  return out;
}

/**
 * 定点写入：目标表存在则改/插目标键，不存在则追加新表。
 *
 * @returns 是否真的写了盘（值本来就对时返回 false，一个字节都不动）
 */
export function writeCodexToml(path: string, edit: ManagedTableEdit): boolean {
  const raw = readCodexToml(path);
  const eol = eolOf(raw);
  const lines = splitLines(raw);
  const range = tableRange(lines, edit.table);
  const headers = lines.filter((l) => tableHeaderOf(l) === edit.table).length;
  if (headers > 1) throw new Error(`多处同形目标表：${edit.table} 出现 ${headers} 次，拒绝写入`);
  // 内联表写法（`[model_providers]` + `llmveto = { ... }`）无法用行级编辑安全改写：
  // 追加同名表会生成非法 TOML。定位不确定就拒绝写入——这是本模块自己的原则。
  if (range === null && hasInlineTable(lines, edit.table)) {
    throw new Error(`目标表 ${edit.table} 以内联表写法出现，无法安全定点编辑；请改成 [${edit.table}] 表头后重试`);
  }
  const next = range === null ? appendTable(lines, edit) : applyKeys(lines, range, edit.keys);
  const text = joinLikeOriginal(next, raw, eol);
  if (text === raw) return false;
  persist(path, text);
  return true;
}

/**
 * 用与原文一致的方式拼回去。
 *
 * 行尾是**唯一**要小心的地方：原文以换行结尾时，`split` 会多出一个空元素，
 * 直接 `join` 正好还原；原文不以换行结尾时则不能凭空补一个（那会让"逐字节相同"失效）。
 */
function joinLikeOriginal(lines: readonly string[], raw: string, eol: string): string {
  const joined = lines.join(eol);
  if (raw.length === 0) return joined + eol;
  return raw.endsWith(eol) || raw.endsWith("\n") || raw.endsWith("\r\n") ? joined : joined.replace(new RegExp(`${eol}$`), "");
}

/** 原子落盘：先写临时文件再 rename；覆盖已有文件前留一份 .bak。 */
function persist(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) copyFileSync(path, path + BACKUP_SUFFIX);
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, path);
}
