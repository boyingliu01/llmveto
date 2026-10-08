#!/usr/bin/env node
// check-readme-parity.mjs — 中英 README 结构对等机器核对（DD-2 同步机制 / AC-REL-03a）。
// 核对三件事：① 中英标题序列逐对相等（冻结对表，任一侧改标题即红，强制双文件同改）；
// ② 两文件 markdown 表格按出现序逐张行数相等（能力表/环境变量表/CLI 表行级核对的机器面）；
// ③ --check-migration：README.zh-CN.md 标题序列 vs 迁移前原 README.md（git 冻结清单）diff=0（R1 A-MN-03 迁入自检）。
// 用法：node scripts/check-readme-parity.mjs [--check-migration]

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// 迁移前原 README.md 的标题序列（git show 3becce3:README.md 冻结；RL-05 迁入基线）
const ORIGINAL_HEADINGS = [
  "H1 llmveto",
  "H2 v1 能做什么、不能做什么（必读）",
  "H2 文档",
  "H2 架构（v1）",
  "H2 分发与 runtime 承诺（两个不同的承诺，勿混用）",
  "H2 快速开始（安装 · 部署 · 试用）",
  "H2 开发环境",
  "H2 CLI",
  "H2 状态",
  "H3 2026-09-27 安全修复（DeepSeek harness 接管审计发现）",
];

// 中英标题冻结对表（zh → en）；双文件同 PR 同改，改任一侧标题必须同步此处
const HEADING_PAIRS = [
  ["llmveto", "llmveto"],
  ["v1 能做什么、不能做什么（必读）", "What v1 does and does not do (read this first)"],
  ["文档", "Documentation"],
  ["架构（v1）", "Architecture (v1)"],
  ["分发与 runtime 承诺（两个不同的承诺，勿混用）", "Distribution and runtime promises (two different promises — do not conflate)"],
  ["快速开始（安装 · 部署 · 试用）", "Quick start (install · deploy · try)"],
  ["开发环境", "Development environment"],
  ["CLI", "CLI"],
  ["状态", "Status"],
  ["2026-09-27 安全修复（DeepSeek harness 接管审计发现）", "2026-09-27 security fixes (found by the DeepSeek-harness takeover audit)"],
];

function stripFences(text) {
  const out = [];
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (!inFence) out.push(line);
  }
  return out;
}

function headings(text) {
  const seq = [];
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.*?)\s*$/.exec(line);
    if (m) seq.push(`H${m[1].length} ${m[2].replace(/\s+#+\s*$/, "")}`);
  }
  return seq;
}

function tableRowCounts(text) {
  const counts = [];
  let cur = 0;
  let inFence = false;
  for (const line of stripFences(text)) {
    if (/^\s*\|/.test(line)) cur += 1;
    else if (cur > 0) { counts.push(cur); cur = 0; }
  }
  if (cur > 0) counts.push(cur);
  return counts;
}

function die(msg) {
  console.error(`[readme-parity] FAIL: ${msg}`);
  process.exit(1);
}

const zhPath = join(ROOT, "README.zh-CN.md");
const enPath = join(ROOT, "README.md");
const zh = readFileSync(zhPath, "utf8");
const en = readFileSync(enPath, "utf8");

if (args().includes("--check-migration")) {
  const zhSeq = headings(zh);
  if (JSON.stringify(zhSeq) !== JSON.stringify(ORIGINAL_HEADINGS)) {
    die(`迁移自检失败：README.zh-CN.md 标题序列与迁移前原 README.md 不一致（A-MN-03 diff≠0）\n  原序列: ${JSON.stringify(ORIGINAL_HEADINGS)}\n  现序列: ${JSON.stringify(zhSeq)}`);
  }
  console.log(`[readme-parity] 迁移自检 PASS：README.zh-CN.md 标题序列与原 README.md diff=0（${zhSeq.length} 个标题）`);
}

const zhSeq = headings(zh);
const enSeq = headings(en);
if (zhSeq.length !== enSeq.length) {
  die(`标题数量不等：zh=${zhSeq.length} en=${enSeq.length}\n  zh: ${JSON.stringify(zhSeq)}\n  en: ${JSON.stringify(enSeq)}`);
}
// 逐对核对：冻结对表 vs 两文件实测序列（含级别）
for (let i = 0; i < Math.max(HEADING_PAIRS.length, zhSeq.length, enSeq.length); i++) {
  const pair = HEADING_PAIRS[i];
  const zActual = zhSeq[i];
  const eActual = enSeq[i];
  if (!pair) die(`标题序列超出冻结对表（index ${i}）：zh=${zActual ?? "—"} en=${eActual ?? "—"}——改标题须同步脚本 HEADING_PAIRS`);
  const zhLevel = zActual?.slice(0, zActual.indexOf(" "));
  const zhText = zActual?.slice(zActual.indexOf(" ") + 1);
  const enLevel = eActual?.slice(0, eActual.indexOf(" "));
  const enText = eActual?.slice(eActual.indexOf(" ") + 1);
  if (zActual !== `${zhLevel} ${pair[0]}`) die(`zh 标题 ${i} 偏离冻结对表：got ${JSON.stringify(zActual)}, want ${JSON.stringify(zhLevel + " " + pair[0])}`);
  if (eActual !== `${enLevel} ${pair[1]}`) die(`en 标题 ${i} 偏离冻结对表：got ${JSON.stringify(eActual)}, want ${JSON.stringify(enLevel + " " + pair[1])}`);
  if (zhLevel !== enLevel) die(`标题级别不齐 index ${i}: zh=${zhLevel} en=${enLevel}`);
}

const zhTables = tableRowCounts(zh);
const enTables = tableRowCounts(en);
if (JSON.stringify(zhTables) !== JSON.stringify(enTables)) {
  die(`表格行数序列不等：zh=${JSON.stringify(zhTables)} en=${JSON.stringify(enTables)}`);
}

console.log(`[readme-parity] PASS：${zhSeq.length} 标题逐对相等；${zhTables.length} 张表行数序列相等 ${JSON.stringify(zhTables)}`);

function args() {
  return process.argv.slice(2);
}
