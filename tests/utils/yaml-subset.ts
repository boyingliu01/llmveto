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

export function parseYamlSubset(src: string): { [k: string]: YamlValue } {
  const lines = src.split(/\r?\n/).filter((l) => !/^\s*#/.test(l) && l.trim().length > 0);
  const root: { [k: string]: YamlValue } = {};
  parseBlock(lines, 0, 0, root);
  return root;
}

function indentOf(l: string): number { return l.length - l.trimStart().length; }

function parseBlock(lines: string[], start: number, indent: number, out: { [k: string]: YamlValue } | YamlValue[]): number {
  let i = start;
  const isArray = Array.isArray(out);
  while (i < lines.length) {
    const line = lines[i]!;
    const ind = indentOf(line);
    if (ind < indent) return i;
    if (ind > indent) { i++; continue; }
    const trimmed = line.trim();
    if (isArray && trimmed.startsWith("- ")) {
      const inline = trimmed.slice(2);
      const obj: { [k: string]: YamlValue } = {};
      (out as YamlValue[]).push(obj);
      if (inline.includes(":")) {
        // 首行 kv 与该 obj 同一缩进层
        const sub = indent + 2;
        // 将 inline 视作第一行 key:value 塞回 lines
        lines[i] = " ".repeat(sub) + inline;
        i = parseBlock(lines, i, sub, obj);
      } else {
        (out as YamlValue[]).pop();
        (out as YamlValue[]).push(scalar(inline));
        i++;
      }
      continue;
    }
    if (!isArray && trimmed.includes(":")) {
      const idx = trimmed.indexOf(":");
      const key = trimmed.slice(0, idx).trim();
      const rest = trimmed.slice(idx + 1).trim();
      if (rest.length === 0) {
        // nested block
        const next = lines[i + 1];
        if (next && indentOf(next) > ind) {
          const childIndent = indentOf(next);
          if (next.trim().startsWith("- ")) {
            const arr: YamlValue[] = [];
            out[key] = arr;
            i = parseBlock(lines, i + 1, childIndent, arr);
          } else {
            const obj: { [k: string]: YamlValue } = {};
            out[key] = obj;
            i = parseBlock(lines, i + 1, childIndent, obj);
          }
        } else {
          out[key] = null;
          i++;
        }
        continue;
      }
      out[key] = scalar(rest);
      i++;
      continue;
    }
    i++;
  }
  return i;
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
