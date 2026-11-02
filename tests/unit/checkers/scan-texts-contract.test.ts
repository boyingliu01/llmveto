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
  /**
   * PWR2-B-m1：豁免理由若是"该文件根本不触碰 text"，则理由本身必须机械可核 ——
   * 登记 touch_free 后，守卫额外断言该文件**零** text 触碰；日后有人在该文件
   * 新读 `unit.text` 时，即使触碰形态恰好被同文件另一条豁免遮蔽，touch_free 也会红。
   */
  readonly touch_free?: boolean;
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
    // 纯 meta 比对（model_requested vs model_responded）：meta 是反代核 JSON 解析产物，
    // 转义在 parse 时已还原，不存在字面转义规避面。登记 touch_free 让"不触碰 text"从
    // 人工申报变成机械断言（PWR2-B-m1）。
    pattern: /unit\.meta\b/,
    reason: "只读 meta 结构字段（model 标签），不读 text（PWR1-A-M1 审查批准豁免）",
    touch_free: true,
  },
  {
    file: "usage-reconcile.ts",
    // estimateTokens(unit.text) —— metering 口径，只取全文本做字符计数，非安全扫描。
    // 对手无法通过转义写法改变 UTF-16 码元长度，故不需 scanTexts 双投影。
    pattern: /^unit\.text$/,
    reason: "metering 口径（字符/token 比估算），非安全扫描（SL-11/REQ-V2a-04）",
  },
  {
    file: "tool-call-shape.ts",
    // `chunk.text.length` in stream checker —— window overflow 累积字节计数，
    // `chunk.text` 用于流式文本累积（非安全判定）；实际 tool call 提取与三子规则
    // 扫描经 scanTexts(unit) 双投影执行。
    pattern: /chunk\.text(?:\.length)?/,
    reason: "window overflow 累积计数 + 流式文本累积，非安全判定（SL-09/REQ-V2a-02）",
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

    // PWR2-B-m1：touch_free 豁免的"根本不触碰 text"理由必须机械成立——
    // 否则豁免登记表就只是自我声明，登记一条 meta 豁免即可掩护未来的 text 直读。
    for (const e of ALLOWLIST.filter((x) => x.touch_free)) {
      const hits = [...srcs.get(e.file)!.matchAll(TEXT_TOUCH)].map((m) => m[0]!);
      expect(
        hits,
        `src/checkers/${e.file} 登记为 touch_free（理由：${e.reason}），但源码存在 text 触碰：${hits.join(", ")}`,
      ).toEqual([]);
    }
  });

  it("③ 读取 unit.text 做内容扫描的 checker 必须导入 scanTexts 函数本体", () => {
    const srcs = checkerSources();
    for (const [name, src] of srcs) {
      if (!/unit\.text\b/.test(src)) continue;
      // 豁免列表中的文件（如 metering 口径）不强制要求 scanTexts
      const isExempted = ALLOWLIST.some((e) => e.file === name);
      if (isExempted) continue;
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
    // metering 豁免（如 usage-reconcile）允许匹配 unit.text，但非 metering 豁免不得匹配
    const nonMeteringExemptions = ALLOWLIST.filter((e) => !e.reason.includes("metering"));
    expect(nonMeteringExemptions.some((e) => e.pattern.test("unit.text"))).toBe(false);
    // 非 `unit` 的迭代变量名同样必须落入捕获面（防止模式退化为只认 unit.*）
    const variant = `const seg = evt.text.slice(0, 3);`;
    expect([...variant.matchAll(TEXT_TOUCH)].map((m) => m[0])).toEqual(["evt.text.slice"]);
    // touch_free 判别面：把 model-label 豁免文件换成含 text 直读的样本源码，断言必被拒
    const tfSample = `const m = readString(unit.meta, "x"); const t = unit.text.length;`;
    expect([...tfSample.matchAll(TEXT_TOUCH)].map((m) => m[0])).toContain("unit.text.length");
  });
});
