#!/usr/bin/env node
// check-orphan-exports.mjs — "写了但没接线"门禁（Gate ORPHAN）。
//
// 背景：v2b-C 里的真实缺陷。`verdictFor`（整个判定链）、`dimensionFor`（轮转）、
// `CatchUpPlanner`（补齐/分片）、`baselineKey`（换代隔离）四个模块各有测试、
// 测试全绿，却**从未被任何生产代码调用**。测试证明了它们"能工作"，
// 没人问过"谁调用它"。整条判定链一行都没执行过。
//
// 人工阅读抓不住这类缺陷——它不报错、不崩、测试还是绿的。
// 判据必须机械：一个导出符号在 src/ 里若除定义处外**零引用**，
// 它要么该接上，要么该删掉。两种情况都不该安静地留着。
//
// 用法：
//   node scripts/check-orphan-exports.mjs            # 检查，有孤儿则 exit 1
//   node scripts/check-orphan-exports.mjs --list     # 只列出，不失败（排查用）
//
// 豁免（ORPHAN_ALLOW）：只允许"**有据可查**的测试辅助接口"。新增豁免必须写明理由，
// 且该符号必须确实只被 tests/ 使用。豁免表是白名单不是垃圾桶——
// 一个符号能被生产代码用上时，把它从表里删掉。

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 允许"只被测试引用"的导出。
 *
 * 判据：它们是**测试自己需要**的观测点，生产路径上调用它们没有意义。
 * 加进来必须给出理由；说不出理由的，说明它是漏接线的功能，该接上或删掉。
 *
 * **零引用的符号不接受豁免**：连测试都不用的导出，注释里写着"供测试使用"
 * 也不成立（`coverageOf` 就是这样——注释这么说，实际无人引用）。这类一律删。
 */
const ORPHAN_ALLOW = new Map([
  ["assertNoV2Stubs", "断言 v1 未注册 stub 的守卫，只在测试里作为断言入口"],
  ["probeDigest", "载荷指纹，供 AC-01a『载荷与会话无关』做机械断言"],
  ["TRUST_MIN", "信任分下界常量，测试用于边界断言"],
  ["EMPTY_PROJECTION", "空投影常量，测试用于构造未识别形态"],
]);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** 收集一个目录下所有源码内容，拼成一段用于计数的文本。 */
function readAll(files) {
  return files.map((f) => readFileSync(f, "utf8")).join("\n");
}

/** 一个符号在给定文本里出现的次数（词边界）。 */
function countRefs(text, name) {
  const re = new RegExp(`\\b${name}\\b`, "g");
  return (text.match(re) ?? []).length;
}

/**
 * 找出 src 里所有导出符号。
 *
 * 只认 `export function|const|class`。`export type` / `export interface` 是**类型**，
 * 不会被运行时调用，把它们算进来只会制造假阳性。
 */
function exportedNames(text) {
  const names = [];
  for (const m of text.matchAll(/^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.push(m[1]);
  }
  return names;
}

/** 扫描一个符号的分类结果。 */
function classify(srcText, testText, otherText, name) {
  // 定义处本身算 1 次
  if (countRefs(srcText, name) - 1 > 0) return "wired";
  const inTests = countRefs(testText, name);
  const inOthers = countRefs(otherText, name);
  if (inTests === 0 && inOthers === 0) return "orphan";
  if (inTests > 0 && inOthers === 0) return "tests-only";
  return "wired";
}

/** 逐个源文件收集导出及其分类。 */
function collect(srcFiles, texts) {
  const orphans = [];
  const testsOnly = [];
  for (const file of srcFiles) {
    const rel = relative(ROOT, file);
    const text = readFileSync(file, "utf8");
    for (const name of exportedNames(text)) {
      const kind = classify(texts.src, texts.tests, texts.others, name);
      if (kind === "orphan") orphans.push({ rel, name });
      else if (kind === "tests-only") testsOnly.push({ rel, name });
    }
  }
  return { orphans, testsOnly };
}

/** 组装人类可读的问题清单；无问题返回空数组。 */
function buildReport({ orphans, testsOnly }) {
  const report = [];
  const unwaived = testsOnly.filter((o) => !ORPHAN_ALLOW.has(o.name));
  const known = new Set([...orphans, ...testsOnly].map((o) => o.name));
  const stale = [...ORPHAN_ALLOW.keys()].filter((n) => !known.has(n));

  if (orphans.length > 0) {
    report.push("零引用导出（src/tests/scripts 全无引用；注释声称'供测试使用'也不豁免）：");
    for (const o of orphans) report.push(`  ${o.rel}::${o.name}`);
  }
  if (unwaived.length > 0) {
    report.push("只被测试引用的导出（疑似漏接线，且未登记豁免）：");
    for (const o of unwaived) report.push(`  ${o.rel}::${o.name}`);
  }
  if (stale.length > 0) {
    report.push("豁免表里的符号已不存在（应删除该豁免）：");
    for (const n of stale) report.push(`  ${n}`);
  }
  return report;
}

function main() {
  const listOnly = process.argv.includes("--list");
  const srcFiles = walk(join(ROOT, "src"));
  const texts = {
    src: readAll(srcFiles),
    tests: readAll(walk(join(ROOT, "tests"))),
    others: readAll(walk(join(ROOT, "scripts")).concat(walk(join(ROOT, "bench")))),
  };
  const report = buildReport(collect(srcFiles, texts));

  if (report.length === 0) {
    console.log(`[orphan-exports] OK — ${srcFiles.length} 个源文件，无零引用导出`);
    return 0;
  }
  console.error(report.join("\n"));
  if (listOnly) {
    console.error("\n(--list：只报告，不失败)");
    return 0;
  }
  console.error("\n处置：接上调用点、删掉死代码，或（仅限测试辅助）在 ORPHAN_ALLOW 里写明理由。");
  return 1;
}

process.exit(main());
