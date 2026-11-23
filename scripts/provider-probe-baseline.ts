#!/usr/bin/env bun
// @no-test-required: 开发者手工运行的探针基线工具，不进 dist、不在 package.json files 白名单内。
/**
 * provider-probe-baseline — provider 探针结果的基线固化与漂移对比（TODO §7 / P1-7）。
 *
 * 解决的问题：`provider-probe.ts` 只往 stdout 打印一次结果，跑完即丢。没有基线时
 * 「这个 provider 今天比上周慢了 3 倍」「通过率从 100% 掉到 60%」都看不出来，
 * 只能靠人肉记数字。
 *
 * 用法：
 *   bun run scripts/provider-probe-baseline.ts save   [--from var/provider-probe-result.json] [--baseline var/provider-probe-baseline.json]
 *   bun run scripts/provider-probe-baseline.ts check  [--from var/provider-probe-result.json] [--baseline var/provider-probe-baseline.json]
 *
 * 判定口径（与 provider-probe.ts 的 printTarget 完全一致，避免两处各算一套）：
 *   - okRate   = ok 的条数 / 总条数
 *   - passRate = pass===true / pass 已判定（pass !== undefined）的条数
 *   - p50Ms    = 所有条目 ms 的中位数
 *
 * 漂移阈值（check 子命令）：
 *   - okRate 下降 >= 10 个百分点        → 报 DRIFT
 *   - passRate 下降 >= 10 个百分点      → 报 DRIFT
 *   - p50Ms 上涨 >= 50% 且 绝对增量 >= 50ms → 报 DRIFT（双条件抑制小样本抖动）
 *   - 基线与本次的 prompt 集合不同       → 报 NOTE（提示可比性受限，不算漂移）
 *
 * 退出码：0 = 无漂移；1 = 有漂移；2 = 输入不可用（文件缺失/格式错）。
 *
 * 有意的边界：本工具只做统计对比，**不判定供应商是否投毒**。模型自述、token 指纹等
 * 都只是信号，不是证据（见 docs/KNOWN-ISSUES.md 与 TODO-PLAN P1-5 的实测结论）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

interface ProbeResult {
  readonly target: string;
  readonly prompt: string;
  readonly ok: boolean;
  readonly pass?: boolean;
  readonly ms: number;
}

interface ProbePayload {
  readonly generatedAt: string;
  readonly results: readonly ProbeResult[];
}

/** 单个 target 的稳定指标（只收可比字段；text/error 等易变内容不入基线）。 */
interface TargetStats {
  readonly ok: number;
  readonly total: number;
  readonly pass: number;
  readonly judged: number;
  readonly p50Ms: number;
  readonly prompts: readonly string[];
}

interface BaselineFile {
  readonly version: 1;
  readonly recordedAt: string;
  readonly source: string;
  readonly targets: Record<string, TargetStats>;
}

const OK_RATE_DROP_PP = 10;
const PASS_RATE_DROP_PP = 10;
const P50_RATIO = 1.5;
const P50_MIN_ABS_MS = 50;

function argOf(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] !== undefined ? resolve(process.argv[i + 1]!) : resolve(fallback);
}

/** 与 provider-probe.ts 的 median 同口径（含偶数个时取中间靠后一位）。 */
function median(rows: readonly ProbeResult[]): number {
  const lat = rows.map((r) => r.ms).sort((a, b) => a - b);
  return lat.length === 0 ? 0 : lat[Math.floor(lat.length / 2)]!;
}

/** 读并解析 JSON；不可用一律 exit 2（输入问题不是漂移）。 */
function readJsonOrExit(path: string, missingHint: string): unknown {
  if (!existsSync(path)) {
    console.error(`probe result not found: ${path}\n${missingHint}`);
    process.exit(2);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (e) {
    console.error(`probe result unreadable: ${path}: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
}

function readPayload(path: string): ProbePayload {
  const parsed = readJsonOrExit(
    path,
    `先跑: bun run scripts/provider-probe.ts --config var/provider-probe.json --out ${path}`,
  ) as Partial<ProbePayload>;
  if (!Array.isArray(parsed.results)) {
    console.error(`probe result has no results[]: ${path}`);
    process.exit(2);
  }
  return {
    generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : "(unknown)",
    results: parsed.results,
  };
}

/** 按 target 汇总出稳定指标。 */
function summarize(results: readonly ProbeResult[]): Record<string, TargetStats> {
  const byTarget = new Map<string, ProbeResult[]>();
  for (const r of results) {
    const rows = byTarget.get(r.target) ?? [];
    rows.push(r);
    byTarget.set(r.target, rows);
  }
  const out: Record<string, TargetStats> = {};
  for (const [target, rows] of byTarget) {
    const judged = rows.filter((r) => r.pass !== undefined);
    out[target] = {
      ok: rows.filter((r) => r.ok).length,
      total: rows.length,
      pass: judged.filter((r) => r.pass === true).length,
      judged: judged.length,
      p50Ms: median(rows),
      prompts: [...new Set(rows.map((r) => r.prompt))].sort(),
    };
  }
  return out;
}

function pct(num: number, den: number): number {
  return den === 0 ? 0 : (num / den) * 100;
}

function fmtPct(num: number, den: number): string {
  return den === 0 ? "n/a" : `${pct(num, den).toFixed(1)}%`;
}

function save(fromPath: string, baselinePath: string): void {
  const payload = readPayload(fromPath);
  const baseline: BaselineFile = {
    version: 1,
    recordedAt: new Date().toISOString(),
    source: fromPath,
    targets: summarize(payload.results),
  };
  try {
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  } catch (e) {
    console.error(`cannot write baseline ${baselinePath}: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
  const names = Object.keys(baseline.targets);
  console.log(`baseline 已写入 ${baselinePath}`);
  console.log(`  来源: ${fromPath}（探针跑于 ${payload.generatedAt}）`);
  console.log(`  target: ${names.length} 个 —— ${names.join(", ")}`);
  for (const [name, s] of Object.entries(baseline.targets)) {
    console.log(`    ${name.padEnd(24)} ok ${s.ok}/${s.total}  pass ${s.pass}/${s.judged}  p50 ${s.p50Ms}ms`);
  }
}

/** 单个 target 的漂移判定；返回人类可读的漂移描述（空数组 = 无漂移）。 */
/** 比率下降判定的入参（用对象而非 7 个位置参数：可读性 + 免 Long Parameter List）。 */
interface RateDropSpec {
  readonly name: string;
  readonly label: string;
  readonly base: { readonly num: number; readonly den: number };
  readonly cur: { readonly num: number; readonly den: number };
  readonly thresholdPp: number;
}

/** 单条比率下降判定（pp 口径）；未达阈值返回 null。 */
function rateDrop(spec: RateDropSpec): string | null {
  const drop = pct(spec.base.num, spec.base.den) - pct(spec.cur.num, spec.cur.den);
  if (drop < spec.thresholdPp) return null;
  const from = fmtPct(spec.base.num, spec.base.den);
  const to = fmtPct(spec.cur.num, spec.cur.den);
  return `${spec.name}: ${spec.label} ${from} → ${to}（降 ${drop.toFixed(1)}pp）`;
}

/** p50 上涨判定：比率与绝对增量双条件同时满足才算（抑制小样本抖动）。 */
function p50Drift(name: string, base: TargetStats, cur: TargetStats): string | null {
  const ratio = base.p50Ms === 0 ? 1 : cur.p50Ms / base.p50Ms;
  const slowEnough = ratio >= P50_RATIO && cur.p50Ms - base.p50Ms >= P50_MIN_ABS_MS;
  return slowEnough ? `${name}: p50 ${base.p50Ms}ms → ${cur.p50Ms}ms（×${ratio.toFixed(2)}）` : null;
}

function driftOf(name: string, base: TargetStats, cur: TargetStats): string[] {
  const passRate = base.judged > 0 && cur.judged > 0
    ? rateDrop({
        name,
        label: "passRate",
        base: { num: base.pass, den: base.judged },
        cur: { num: cur.pass, den: cur.judged },
        thresholdPp: PASS_RATE_DROP_PP,
      })
    : null;
  const candidates = [
    rateDrop({
      name,
      label: "okRate",
      base: { num: base.ok, den: base.total },
      cur: { num: cur.ok, den: cur.total },
      thresholdPp: OK_RATE_DROP_PP,
    }),
    passRate,
    p50Drift(name, base, cur),
  ];
  return candidates.filter((x): x is string => x !== null);
}

/** prompt 集合变化提示（可比性受限，但不判漂移）。 */
function promptNotes(name: string, base: TargetStats, cur: TargetStats): string[] {
  if (base.prompts.join(",") === cur.prompts.join(",")) return [];
  const added = cur.prompts.filter((p) => !base.prompts.includes(p));
  const removed = base.prompts.filter((p) => !cur.prompts.includes(p));
  const parts: string[] = [];
  if (added.length > 0) parts.push(`新增 [${added.join(", ")}]`);
  if (removed.length > 0) parts.push(`移除 [${removed.join(", ")}]`);
  return [`${name}: prompt 集合变化（${parts.join("；") || "顺序不同"}），比率类指标可比性下降`];
}

/** 基线与本次结果的比对结论（纯数据，不含打印）。 */
interface Comparison {
  readonly baseline: BaselineFile;
  readonly payload: ProbePayload;
  readonly current: Record<string, TargetStats>;
  readonly drifts: readonly string[];
  readonly notes: readonly string[];
  readonly missing: readonly string[];
  readonly added: readonly string[];
}

function compareAgainst(baseline: BaselineFile, payload: ProbePayload): Comparison {
  const current = summarize(payload.results);
  const drifts: string[] = [];
  const notes: string[] = [];
  const missing: string[] = [];
  for (const [name, base] of Object.entries(baseline.targets)) {
    const cur = current[name];
    if (cur === undefined) {
      missing.push(name);
      continue;
    }
    drifts.push(...driftOf(name, base, cur));
    notes.push(...promptNotes(name, base, cur));
  }
  const added = Object.keys(current).filter((n) => baseline.targets[n] === undefined);
  return { baseline, payload, current, drifts, notes, missing, added };
}

function tagFor(c: Comparison, name: string): string {
  if (c.baseline.targets[name] === undefined) return "NEW ";
  return c.drifts.some((d) => d.startsWith(`${name}:`)) ? "DRIFT" : " ok  ";
}

function printComparison(c: Comparison): void {
  console.log(`== 基线 ${c.baseline.recordedAt}（${Object.keys(c.baseline.targets).length} targets）`);
  console.log(`== 本次 ${c.payload.generatedAt}（${Object.keys(c.current).length} targets）`);
  for (const [name, cur] of Object.entries(c.current)) {
    console.log(`  [${tagFor(c, name)}] ${name.padEnd(22)} ok ${cur.ok}/${cur.total}  pass ${cur.pass}/${cur.judged}  p50 ${cur.p50Ms}ms`);
  }
  printFootnotes(c);
}

/** 非漂移类的补充信息：缺失 target、新增 target、可比性提示。 */
function printFootnotes(c: Comparison): void {
  if (c.missing.length > 0) console.log(`\n  本次缺失的 target: ${c.missing.join(", ")}`);
  if (c.added.length > 0) console.log(`  基线中没有的新 target: ${c.added.join(", ")}`);
  if (c.notes.length === 0) return;
  console.log("\n  NOTE（仅提示可比性，不计为漂移）:");
  for (const n of c.notes) console.log(`    ${n}`);
}

function check(fromPath: string, baselinePath: string): void {
  const payload = readPayload(fromPath);
  if (!existsSync(baselinePath)) {
    console.error(`baseline not found: ${baselinePath}\n先建立基线: bun run scripts/provider-probe-baseline.ts save`);
    process.exit(2);
  }
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as BaselineFile;
  if (baseline.version !== 1 || typeof baseline.targets !== "object") {
    console.error(`baseline 格式不支持（version=${String(baseline.version)}）: ${baselinePath}`);
    process.exit(2);
  }
  const c = compareAgainst(baseline, payload);
  printComparison(c);
  reportDrift(c.drifts);
}

/** 漂移结论与退出码（1 = 有漂移）。无漂移时打印通过并返回，由调用方正常结束。 */
function reportDrift(drifts: readonly string[]): void {
  if (drifts.length === 0) {
    console.log("\n✅ 无漂移。");
    return;
  }
  console.log("\n❌ DRIFT 检出:");
  for (const d of drifts) console.log(`    ${d}`);
  console.log("\n阈值: okRate/passRate 降 >=10pp；p50 涨 >=50% 且 >=50ms。");
  console.log("这是统计信号，不是供应商投毒的证明；确认前不要改基线。");
  process.exit(1);
}

const cmd = process.argv[2];
const fromPath = argOf("--from", "var/provider-probe-result.json");
const baselinePath = argOf("--baseline", "var/provider-probe-baseline.json");

if (cmd === "save") save(fromPath, baselinePath);
else if (cmd === "check") check(fromPath, baselinePath);
else {
  console.error("用法: provider-probe-baseline.ts <save|check> [--from <result.json>] [--baseline <baseline.json>]");
  process.exit(2);
}
