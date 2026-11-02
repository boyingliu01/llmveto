#!/usr/bin/env node
// 发布前置构建门链（SPEC-REL-001 / REQ-REL-01 / AC-REL-01a，设计冻结件 docs/plans/2026-10-08-release-design.md D-01）。
// 链序冻结：clean → install → build → test → typecheck → typecheck:dist → pack → install-tarball → smoke → publish-dry-run。
// 任一步失败即阻断并打印首个失败步；install-tarball / smoke / publish-dry-run 整体 try/finally teardown，
// 门链失败不留全局包与常驻 daemon。冒烟 8 行判据 + seed 步内置为结构化常量（锚定串依据 src/cli/index.ts 实况，
// CLI 无 --help；改 CLI 输出必须同步更新 SMOKE_ROWS）。本文件为 dev 工具，不属于任何既有门的面
// （oxlint=src tests / typecheck=两个 tsconfig / vitest include=tests+bench / coverage include=src）。

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IS_WIN = process.platform === "win32";

// v1 冻结基线（全量 296 passed | 3 skipped）；只设下界，测试增长不阻断。
const TEST_BASELINE_MIN_PASSED = 296;

// 冒烟判据表（D-01 冻结 8 行 + seed 步）。seed 步：向无路由路径 POST → fail-closed 502 + evidence 留痕
// （server.ts no-upstream-route 分支），为 row 5 verify / row 6 doctor.evidence-chain 提供 1 条真实链记录。
const SMOKE_ROWS = [
  { id: 1, args: [], env: null, expect: { exit: 2, stderr: ["valid: start, stop, status, doctor, verify"] } },
  { id: 2, args: ["status"], env: null, expect: { exit: 1, stdout: ["not running"] } },
  { id: 3, args: ["start"], env: () => ({ LLMVETO_PORT: "0" }), expect: { exit: 0, stdout: ["gateway started in background (pid="] } },
  { id: 4, args: ["status"], env: null, expect: { exit: 0, stdout: ["running pid=", "url=http://127.0.0.1:"] }, capture: "gatewayUrl" },
  { id: "seed" },
  { id: 5, args: ["verify"], env: null, expect: { exit: 0, stdout: ["ok: ", "records verified"] } },
  {
    id: 6, args: ["doctor"], env: (c) => ({
      LLMVETO_GATEWAY_URL: c.gatewayUrl,
      LLMVETO_OPENCODE_CONFIG: join(c.ws, "opencode.smoke.json"),
      LLMVETO_DELPHI_CONFIG: join(c.ws, "delphi.smoke.json"),
    }),
    expect: { exit: 0, stdout: ["[PASS] doctor.evidence-chain: chain ok (", "[PASS] doctor.port-reachable"] },
  },
  { id: 7, args: ["stop"], env: null, expect: { exit: 0, stdout: ["stop: signal sent"] } },
  { id: 8, args: ["status"], env: null, expect: { exit: 1, stdout: ["not running"] } },
];

class GateError extends Error {}

function fail(msg, extra = []) {
  throw new GateError(`[release-gate] FAIL: ${msg}${extra.length ? "\n" + extra.join("\n") : ""}`);
}

function tail(s, n = 30) {
  const lines = String(s ?? "").split(/\r?\n/).filter((l) => l.length > 0);
  return lines.length ? lines.slice(-n).join("\n") : "(empty)";
}

function run(cmd, args, opts = {}) {
  const { timeout = 300_000, ...rest } = opts;
  let file = cmd;
  let finalArgs = args;
  if (IS_WIN) {
    // 无 shell 直调（semgrep spawn-shell-true / detect-child-process + Node DEP0190）：
    // .exe（bun/tar）由 CreateProcess 走 PATH 解析；.cmd shim（npm/llmveto）在 Node ≥18.20
    // 无 shell 直调会 EINVAL，改为 node 直调其等价入口 JS——npm → 安装目录自带 npm-cli.js，
    // llmveto → 全局安装的 bin 入口（bin.llmveto 指向的同一文件，等价于 .cmd shim 的转发目标）。
    if (cmd === "npm") {
      file = process.execPath;
      finalArgs = [npmCliJs(), ...args];
    } else if (cmd === "llmveto") {
      file = process.execPath;
      finalArgs = [llmvetoEntry(), ...args];
    }
  }
  // cmd 仅为本脚本内的固定调用名（bun/npm/llmveto/tar，见 steps 与 SMOKE_ROWS），无外部输入汇入。
  const r = spawnSync(file, finalArgs, { // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
    encoding: "utf8",
    cwd: ROOT,
    timeout,
    windowsHide: true,
    ...rest,
  });
  return {
    code: r.status,
    signal: r.signal,
    stdout: String(r.stdout ?? ""),
    stderr: String(r.stderr ?? ""),
    err: r.error,
    timeoutHit: r.signal === "SIGTERM",
  };
}

function npmCliJs() {
  const p = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (!existsSync(p)) fail(`release-gate: npm-cli.js not found at ${p} —— node 安装布局非标准，无法无 shell 调用 npm`);
  return p;
}

let llmvetoEntryCache = null;
function llmvetoEntry() {
  if (llmvetoEntryCache) return llmvetoEntryCache;
  const r = spawnSync(process.execPath, [npmCliJs(), "prefix", "-g"], {
    encoding: "utf8",
    cwd: ROOT,
    timeout: 60_000,
    windowsHide: true,
  });
  if (r.status !== 0) fail("release-gate: `npm prefix -g` 失败，无法定位全局 llmveto 入口", [tail(r.stderr)]);
  const p = join(String(r.stdout).trim(), "node_modules", "llmveto", "dist", "cli", "index.js");
  if (!existsSync(p)) fail(`release-gate: global llmveto entry not found at ${p} —— install-tarball 步是否成功？`);
  llmvetoEntryCache = p;
  return p;
}

function readPkg() {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
}

// ---- smoke 环境：受控 PATH（剥离含 bun 可执行文件的目录）+ 清除所有 LLMVETO_* ambient 干扰 ----
function hasBunExecutable(dir) {
  for (const name of IS_WIN ? ["bun.exe", "bun.cmd", "bun.bat", "bun"] : ["bun"]) {
    try { if (existsSync(join(dir, name))) return true; } catch { /* unreadable dir: keep it */ }
  }
  return false;
}

function buildSmokeEnv() {
  const env = { ...process.env };
  delete env.Path;
  env.PATH = (process.env.PATH ?? process.env.Path ?? "")
    .split(delimiter)
    .filter((seg) => seg && !hasBunExecutable(seg))
    .join(delimiter);
  for (const k of [
    "LLMVETO_STATE_DIR", "LLMVETO_PORT", "LLMVETO_GATEWAY_URL", "LLMVETO_OPENCODE_CONFIG",
    "LLMVETO_DELPHI_CONFIG", "LLMVETO_UPSTREAMS", "LLMVETO_UPSTREAM_BASE_URL",
    "LLMVETO_MODELS_SNAPSHOT", "LLMVETO_DAEMON_CHILD",
  ]) delete env[k];
  return env;
}

// R2 T-R2-01 冻结：doctor 前置受管配置副本最小字段集，与 src/adapters/{opencode,delphi}.ts 的
// detectDrift 期望值一一对应；适配器受管字段演进时必须同步此处。
// 机器校验面（REL-CW R2 T-R2-02 处置）：副本对错并不只靠本注释声明——smoke row 6 以真
// detectDrift 对副本执行（doctor.config-drift 任一失配即 exit 1 → 门红），适配器期望值演进而
// 副本未同步时门链大声失败、非静默失配；row 6 报 drift 时以本函数为诊断起点。
// 注：src/ 本迭代冻结（AC-REL-05a），故不在适配器侧导出常量供本脚本导入。
function managedConfigCopies(gatewayUrl) {
  const base = gatewayUrl.replace(/\/+$/, "");
  return {
    opencode: {
      provider: {
        openai: { options: { baseURL: `${base}/opencode/openai` } },
        anthropic: { options: { baseURL: `${base}/opencode/anthropic` } },
        mock: { options: { baseURL: `${base}/opencode/mock` } },
      },
      env: { OPENCODE_MODELS_URL: `${base}/opencode/models` },
    },
    delphi: {
      endpoint: {
        chat: `${base}/delphi/default/v1/chat/completions`,
        stream: `${base}/delphi/default/v1/chat/completions?stream=1`,
      },
    },
  };
}

function writeManagedCopies(ctx) {
  const copies = managedConfigCopies(ctx.gatewayUrl);
  writeFileSync(join(ctx.ws, "opencode.smoke.json"), JSON.stringify(copies.opencode, null, 2), "utf8");
  writeFileSync(join(ctx.ws, "delphi.smoke.json"), JSON.stringify(copies.delphi, null, 2), "utf8");
}

async function seedEvidenceRecord(gatewayUrl) {
  // 与 run() 的每步超时纪律一致（REL-CW R2 T-R2-01）：daemon 挂起时 fail-closed 而非无限阻塞。
  let res;
  try {
    res = await fetch(`${gatewayUrl}/smoke/seed`, {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purpose: "release-gate smoke: seed one evidence record via fail-closed no-route path" }),
    });
  } catch (e) {
    fail("smoke seed: request failed (daemon hung or unreachable?)", [e?.message ?? String(e)]);
  }
  if (res.status !== 502) {
    const body = await res.text().catch(() => "");
    fail(`smoke seed: expected 502 (no-upstream-route), got ${res.status}`, [tail(body, 5)]);
  }
}

function assertSmokeRow(row, r) {
  const problems = [];
  if (r.code !== row.expect.exit) problems.push(`exit: want ${row.expect.exit}, got ${r.code}${r.timeoutHit ? " (timeout)" : ""}`);
  for (const s of row.expect.stdout ?? []) if (!r.stdout.includes(s)) problems.push(`stdout missing: ${JSON.stringify(s)}`);
  for (const s of row.expect.stderr ?? []) if (!r.stderr.includes(s)) problems.push(`stderr missing: ${JSON.stringify(s)}`);
  if (problems.length) {
    fail(`smoke row ${row.id} (llmveto ${row.args.join(" ")})`, [
      ...problems,
      `--- stdout tail ---`, tail(r.stdout),
      `--- stderr tail ---`, tail(r.stderr),
    ]);
  }
}

async function smokeStep(ctx) {
  mkdirSync(ctx.stateDir, { recursive: true });
  ctx.smokeEnv = buildSmokeEnv();
  // D-01「纯 Node ≥18」判定：bun 在冒烟 PATH 中不可达（node ≥18 已在 preflight 断言）。
  const b = run("bun", ["--version"], { env: ctx.smokeEnv, timeout: 30_000 });
  if (b.code === 0) fail("smoke env: bun 仍可达（PATH 剥离失败）", [tail(b.stdout, 3)]);

  for (const row of SMOKE_ROWS) {
    if (row.id === "seed") {
      await seedEvidenceRecord(ctx.gatewayUrl);
      continue;
    }
    if (row.id === 6) writeManagedCopies(ctx);
    const env = { ...ctx.smokeEnv, LLMVETO_STATE_DIR: ctx.stateDir, ...(row.env ? row.env(ctx) : {}) };
    const r = run("llmveto", row.args, { env, timeout: 120_000 });
    assertSmokeRow(row, r);
    if (row.capture === "gatewayUrl") {
      const m = /url=(\S+)/.exec(r.stdout);
      if (!m) fail("smoke row 4: cannot parse gateway url from status output", [tail(r.stdout, 5)]);
      ctx.gatewayUrl = m[1];
    }
  }
}

function packStep(ctx) {
  const pkg = readPkg();
  const name = `llmveto-${pkg.version}.tgz`;
  const r = run("npm", ["pack", "--pack-destination", ctx.ws]);
  if (r.code !== 0) fail("pack (npm pack)", [tail(r.stdout), tail(r.stderr)]);
  const tgz = join(ctx.ws, name);
  if (!existsSync(tgz)) fail(`pack: tarball ${name} not found in ${ctx.ws}`, [tail(r.stdout, 10)]);
  ctx.tgz = tgz;
  // 内容白名单（DD-5）：package.json + files + main + README.zh-CN.md。
  // 修订注（2026-10-09 实测，npm 11）：npm 默认纳入 README* 全部变体，files 白名单/.npmignore/
  // files 取反（"!x"）均无法排除——README.zh-CN.md 随包为不可消除的既成事实；DD-5 意图
  // （npm 渲染面 = 英文 README）不受影响（npm 取 readme 时用 README.md）。
  // 该例外绑定 npm 11 实测行为（REL-CW R2 T-R2-03）：npm 大版本升级若改变 README* 自动
  // 收录语义，白名单须随其实测结果修订，勿凭记忆改动。
  const t = run("tar", ["-tzf", name], { cwd: ctx.ws, timeout: 60_000 });
  if (t.code !== 0) fail("pack: tar -tzf inspection failed", [tail(t.stderr, 10)]);
  const files = pkg.files ?? [];
  const allowed = (entry) =>
    entry === "package/" ||
    entry === "package/package.json" ||
    (pkg.main ? entry === `package/${pkg.main}` : false) ||
    entry === "package/README.zh-CN.md" ||
    files.some((f) => {
      const prefix = `package/${f.replace(/\/+$/, "")}`;
      return entry === prefix || entry.startsWith(`${prefix}/`);
    });
  const bad = t.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).filter((e) => !allowed(e));
  if (bad.length) fail("pack: tarball 含白名单之外的内容", bad.slice(0, 20));
}

function installTarballStep(ctx) {
  const r = run("npm", ["i", "-g", ctx.tgz]);
  if (r.code !== 0) fail("install-tarball (npm i -g)", [tail(r.stdout), tail(r.stderr)]);
}

function publishDryRunStep() {
  // 防递归两层（REL-CW R1 ARCH-M-01 澄清）：主防线 = --ignore-scripts，本 dry-run 内
  // prepublishOnly（即 release:gate 整链）根本不执行；RELEASE_GATE_RUNNING 是兜底断言，
  // 覆盖主防线失效的情形（如有人删掉该 flag、或从其他 lifecycle 钩子直接调 release:gate）。
  // 真实 publish 的 hook 纵深防御仍由 package.json prepublishOnly 承担（D-01 防跳过定位）。
  const r = run("npm", ["publish", "--dry-run", "--ignore-scripts"], {
    env: { ...process.env, RELEASE_GATE_RUNNING: "1" },
  });
  if (r.code !== 0) fail("publish-dry-run (npm publish --dry-run)", [tail(r.stdout), tail(r.stderr)]);
}

function teardown(ctx) {
  if (ctx.smokeEnv && ctx.stateDir) {
    try {
      run("llmveto", ["stop"], { env: { ...ctx.smokeEnv, LLMVETO_STATE_DIR: ctx.stateDir }, timeout: 30_000 });
    } catch { /* best-effort */ }
  }
  try { run("npm", ["rm", "-g", "--ignore-scripts", "llmveto"], { timeout: 120_000 }); } catch { /* best-effort */ }
  for (const p of [ctx.stateDir, ctx.ws]) {
    try { if (p) rmSync(p, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

function preflight() {
  const major = Number(process.versions.node.split(".")[0]);
  if (!(major >= 18)) fail(`node >= 18 required, running ${process.versions.node}`);
  const pkg = readPkg();
  const versionFile = readFileSync(join(ROOT, "VERSION"), "utf8").trim();
  if (versionFile !== pkg.version) fail(`Gate 0 镜像核对失败: VERSION(${versionFile}) != package.json(${pkg.version})`);
  if (pkg.private) fail("package.json 仍为 private:true —— 元数据转正未完成，npm publish 必被拒");
  if (!pkg.bin?.llmveto) fail("package.json 缺 bin.llmveto");
}

async function main() {
  if (process.env.RELEASE_GATE_RUNNING === "1") {
    // 兜底层：主防线是 publishDryRunStep 的 --ignore-scripts（prepublishOnly 不触发）；
    // 能走到这里说明防线被绕开（flag 丢失/钩子直调本门），此时宁拒不跑。
    fail("递归保护触发：release-gate 正在运行中（publish-dry-run 的 hook 再次进入本门）");
  }
  preflight();
  const ctx = { ws: null, stateDir: null, tgz: null, gatewayUrl: null, smokeEnv: null };
  ctx.ws = mkdtempSync(join(tmpdir(), "llmveto-gate-"));
  ctx.stateDir = join(ctx.ws, "state");

  const steps = [
    // 链序注：D-01 原文为 clean → install，但 fresh checkout 下 rimraf 尚未安装（CI 能跑通仅因
    // 装依赖先行）。改为 install → clean：install 不产 dist，clean-rebuild 保证（dist 先删后建）不变。
    ["install", () => { const r = run("bun", ["install"]); if (r.code !== 0) fail("install (bun install)", [tail(r.stderr)]); }],
    ["clean", () => { const r = run("bun", ["run", "clean"]); if (r.code !== 0) fail("clean (bun run clean)", [tail(r.stderr)]); }],
    ["build", () => {
      const r = run("bun", ["run", "build"]);
      if (r.code !== 0) fail("build (bun run build)", [tail(r.stderr)]);
      if (!existsSync(join(ROOT, "dist", "cli", "index.js"))) fail("build: dist/cli/index.js 未生成");
    }],
    ["test", () => {
      const r = run("bun", ["run", "test"], { timeout: 900_000 });
      if (r.code !== 0) fail("test (bun run test)", [tail(r.stdout), tail(r.stderr)]);
      const combined = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, ""); // 剥 ANSI，否则 \b 不成立（[32m326 无词边界）
      const passed = /\bTests\s+(\d+)\s+passed\b/.exec(combined);
      if (!passed) fail("test: 无法解析 vitest passed 计数（基线核对不可能）——若 vitest 版本升级导致汇总行格式变更，须同步修订本脚本正则", [tail(combined, 10)]);
      if (Number(passed[1]) < TEST_BASELINE_MIN_PASSED) {
        fail(`test 基线倒退: passed=${passed[1]} < 冻结基线 ${TEST_BASELINE_MIN_PASSED}`);
      }
      const skipped = /\bTests\s+\d+\s+passed\s*\|\s*(\d+)\s+skipped\b/.exec(combined);
      console.log(`    baseline: ${passed[1]} passed | ${skipped ? skipped[1] : "?"} skipped (下界 ${TEST_BASELINE_MIN_PASSED})`);
    }],
    ["typecheck", () => { const r = run("bun", ["run", "typecheck"]); if (r.code !== 0) fail("typecheck", [tail(r.stderr)]); }],
    ["typecheck:dist", () => { const r = run("bun", ["run", "typecheck:dist"]); if (r.code !== 0) fail("typecheck:dist", [tail(r.stderr)]); }],
    ["pack", () => packStep(ctx)],
    ["install-tarball", () => installTarballStep(ctx)],
    ["smoke", () => smokeStep(ctx)],
    ["publish-dry-run", () => publishDryRunStep()],
  ];

  let failed = false;
  try {
    for (let i = 0; i < steps.length; i++) {
      const [name, fn] = steps[i];
      const t0 = Date.now();
      try {
        await fn();
        console.log(`[gate ${String(i + 1).padStart(2, "0")}/${steps.length}] ${name} ... ok (${Date.now() - t0}ms)`);
      } catch (e) {
        failed = true;
        const extra = e instanceof GateError ? `\n${e.message}` : `\n${e?.stack ?? String(e)}`;
        console.error(`\n[release-gate] 首个失败步 = ${name}${extra}`);
        throw e;
      }
    }
    console.log(`\n[release-gate] PASS — 10 步门链全过；smoke 8 行判据全过（含 seed 留痕）；tarball: ${ctx.tgz}`);
  } catch (e) {
    process.exitCode = 1;
    if (!failed && !(e instanceof GateError)) console.error(`[release-gate] UNEXPECTED: ${e?.stack ?? String(e)}`);
  } finally {
    teardown(ctx);
  }
}

await main();
