import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * PWR1-A-M1 处置：scanTexts 契约的机械守卫。
 *
 * `src/shared/types.ts` 冻结的契约「checker 不得直接读 unit.text 做安全判定」此前
 * 只存在于 JSDoc，无任何执行面强制 —— 新 checker 直接读 `unit.text`、或绕过转义
 * 投影做判定，测试全绿也无人拦截（编码层回归会静默复现）。本文件把契约变成
 * 可失败的门：
 *   ① 任何 src/checkers/*.ts 触碰 text 字段（unit.text / chunk.text 的读取或长度）
 *      必须逐字命中 ALLOWLIST 中一条带理由的豁免；
 *   ② 豁免双向陈旧检查：新增触碰未登记 → 红；登记了但代码里已不存在 → 红；
 *   ③ 触碰 `unit.text` 做内容扫描的文件必须从 shared/types 导入 scanTexts 函数本体。
 */

const CHECKERS_DIR = fileURLToPath(new URL("../../../src/checkers/", import.meta.url));

/** 触碰扫描面文本的字面模式（含长度读取；覆盖任意迭代变量名如 tp/seg/evt 等）。
 * 变量名首字符限定小写/下划线，且前置负向断言排除 `…e`（scanTexts 的 `.text` 子串）与
 * 大写（ScanUnit.text 类型名引用）—— 只拦真实的实例字段读取。 */
const TEXT_TOUCH = /(?<=[^a-zA-Z0-9e_$])[a-z_$][\w$]*\.text(?:\.(?:length|charCodeAt|codePointAt|slice|substring|at)\b)?/g;

interface Exemption {
  readonly file: string;
  readonly pattern: RegExp;
  readonly reason: string;
}

const ALLOWLIST: readonly Exemption[] = [
  {
    file: "invisible-unicode-scan.ts",
    // `window.cursor + chunk.text.length` —— 只取长度推进全局偏移游标，不读取任何字符
    // 内容做安全判定；隐形字符命中经 scanTexts(unit) 双投影后在 text/decoded 上执行。
    pattern: /chunk\.text\.length/,
    reason: "cursor 长度推进，无内容判定（PWR1-A-M1 审查批准豁免）",
  },
  {
    file: "model-label-consistency.ts",
    // `unit.meta.model_requested/model_responded` —— meta 是反代核解析后的**结构性字段**
    // （JSON 解析产物），转义在 JSON.parse 时已还原，不存在字面转义规避面；本 checker
    // 完全不触碰 text 字段，登记以防未来误判为豁免缺失。
    pattern: /unit\.meta\b/,
    reason: "只读 meta 结构字段（model 标签），不读 text（PWR1-A-M1 审查批准豁免）",
  },
];

function checkerSources(): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const name of readdirSync(CHECKERS_DIR).filter((f) => f.endsWith(".ts"))) {
    out.set(name, readFileSync(CHECKERS_DIR + name, "utf8"));
  }
  return out;
}

describe("scanTexts 契约机械守卫（PWR1-A-M1）", () => {
  it("①+② 所有 text 字段触碰逐字命中豁免，且豁免无死条目", () => {
    const srcs = checkerSources();
    const touched = new Map<string, string[]>(); // file -> 触碰字面串
    for (const [name, src] of srcs) {
      const hits = [...src.matchAll(TEXT_TOUCH)].map((m) => m[0]!);
      if (hits.length > 0) touched.set(name, hits);
    }

    // 正向：每个触碰都必须被同文件的某条豁免完整覆盖
    for (const [name, hits] of touched) {
      const exemptions = ALLOWLIST.filter((e) => e.file === name);
      for (const hit of hits) {
        const covered = exemptions.some((e) => e.pattern.test(hit));
        expect(
          covered,
          `src/checkers/${name} 触碰扫描面文本 "${hit}" 未在 ALLOWLIST 登记豁免。` +
            `若这是正当只读长度/meta 用途，请附理由登记；否则改用 scanTexts(unit)。`,
        ).toBe(true);
      }
    }

    // 反向：豁免条目不得陈旧（登记了但对应字面串已不在源码中 = 死条目）
    for (const e of ALLOWLIST) {
      const src = srcs.get(e.file);
      expect(src, `豁免登记指向不存在的文件 src/checkers/${e.file}`).toBeDefined();
      let found = false;
      for (const m of src!.matchAll(TEXT_TOUCH)) {
        if (e.pattern.test(m[0]!)) { found = true; break; }
      }
      if (!found) {
        // meta 类豁免不走 text-touch 口径，直接全文核对
        found = new RegExp(e.pattern.source).test(src!);
      }
      expect(found, `豁免条目（${e.file} / ${e.pattern.source}）已无对应代码，属死登记`).toBe(true);
    }
  });

  it("③ 读取 unit.text 做内容扫描的 checker 必须导入 scanTexts 函数本体", () => {
    const srcs = checkerSources();
    for (const [name, src] of srcs) {
      if (!/unit\.text\b/.test(src)) continue;
      expect(
        /import\s*\{[^}]*\bscanTexts\b[^}]*\}\s*from\s*"\.\.\/shared\/types\.ts"/.test(src),
        `src/checkers/${name} 直接引用 unit.text 却未导入 scanTexts —— 转义投影面会被静默绕过`,
      ).toBe(true);
    }
  });

  it("守卫自身可判别：注入违规样本必被拒（防正则腐化）", () => {
    const sample = `export const bad = (unit: ScanUnit) => unit.text.includes("x");`;
    const hits = [...sample.matchAll(TEXT_TOUCH)].map((m) => m[0]!);
    expect(hits).toContain("unit.text");
    expect(ALLOWLIST.some((e) => e.pattern.test("unit.text"))).toBe(false);
    // 非 `unit` 的迭代变量名同样必须落入捕获面（防止模式退化为只认 unit.*）
    const variant = `const seg = evt.text.slice(0, 3);`;
    expect([...variant.matchAll(TEXT_TOUCH)].map((m) => m[0])).toEqual(["evt.text.slice"]);
  });
});
