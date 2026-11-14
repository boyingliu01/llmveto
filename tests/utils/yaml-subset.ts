/**
 * @test REQ-VETO-012
 * @intent 极简 YAML 子集解析器：仅支持 key: value / list of maps / 字符串字面量。
 *         避免引入第三方 yaml 依赖（DD-VETO-009 Node stdlib only）。
 *
 * 支持：
 *   - 顶层 map（scalar / nested map / indented list）
 *   - indented list of scalars 或 list of maps（`- key: value` 起手，同 obj 其他字段缩进 +2）
 *   - scalar：number / boolean / null / 'quoted' / "quoted" / bare string
 *   - 注释行（`# ...`）与空行
 *
 * 不支持（本项目 fixture 约定不使用）：
 *   - 同缩进 list（`key:\n- a`）、flow syntax（`[a, b]` / `{k: v}`）、多行块标量（`|` / `>`）、anchor / alias
 */

export type YamlValue = string | number | boolean | null | YamlValue[] | { [k: string]: YamlValue };

type YamlMap = { [k: string]: YamlValue };

export function parseYamlSubset(src: string): YamlMap {
  const lines = src.split(/\r?\n/).filter((l) => !/^\s*#/.test(l) && l.trim().length > 0);
  const root: YamlMap = {};
  parseBlock(lines, 0, 0, root);
  return root;
}

function indentOf(l: string): number { return l.length - l.trimStart().length; }

/** 逐行推进到缩进回收（`ind < indent`）为止；列表项与 kv 行各交一个专职函数。 */
function parseBlock(lines: string[], start: number, indent: number, out: YamlMap | YamlValue[]): number {
  let i = start;
  const isArray = Array.isArray(out);
  while (i < lines.length) {
    const line = lines[i]!;
    const ind = indentOf(line);
    if (ind < indent) return i;
    if (ind > indent) { i++; continue; }
    const trimmed = line.trim();
    if (isArray && trimmed.startsWith("- ")) {
      i = parseListItem(lines, i, indent, trimmed, out as YamlValue[]);
    } else if (!isArray && trimmed.includes(":")) {
      i = parseKeyLine(lines, i, indent, trimmed, out);
    } else {
      i++;
    }
  }
  return i;
}

/** `- 标量` 或 `- key: value` 起手的列表项；返回下一行游标。 */
function parseListItem(lines: string[], i: number, indent: number, trimmed: string, out: YamlValue[]): number {
  const inline = trimmed.slice(2);
  if (!inline.includes(":")) {
    out.push(scalar(inline));
    return i + 1;
  }
  const obj: YamlMap = {};
  out.push(obj);
  // 首行 kv 与该 obj 同一缩进层：把 inline 视作第一行塞回 lines，递归继续吃后续字段。
  const sub = indent + 2;
  lines[i] = " ".repeat(sub) + inline;
  return parseBlock(lines, i, sub, obj);
}

/** `key: value` / `key:`（嵌套块或 null）；返回下一行游标。 */
function parseKeyLine(lines: string[], i: number, indent: number, trimmed: string, out: YamlMap): number {
  const idx = trimmed.indexOf(":");
  const key = trimmed.slice(0, idx).trim();
  const rest = trimmed.slice(idx + 1).trim();
  if (rest.length > 0) {
    out[key] = scalar(rest);
    return i + 1;
  }
  const next = lines[i + 1];
  if (next === undefined || indentOf(next) <= indent) {
    out[key] = null; // 空值键：下一个兄弟缩进已回收
    return i + 1;
  }
  const childIndent = indentOf(next);
  const child: YamlValue[] | YamlMap = next.trim().startsWith("- ") ? [] : {};
  out[key] = child;
  return parseBlock(lines, i + 1, childIndent, child);
}

function scalar(raw: string): YamlValue {
  const s = raw.trim();
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~" || s === "") return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
}
