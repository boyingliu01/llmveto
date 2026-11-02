#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { verifyEvidenceFile } from "../evidence/verify.ts";
import { aggregateEvidence } from "../evidence/aggregate.ts";
import { delphiAdapter } from "../adapters/delphi.ts";
import { opencodeAdapter } from "../adapters/opencode.ts";
import type { Adapter, Env } from "../adapters/index.ts";
import { EvidenceWriter } from "../evidence/writer.ts";
import { startGateway } from "../gateway/server.ts";

/**
 * @test REQ-VETO-008
 * @intent v1 CLI 冻结 4 命令 + verify 由 SL-07 已交付；start/stop/status/doctor 在此装配。
 *         AC-VETO-008-01 严禁注册 report / canary 等 stub。
 */

export type CliCommand = "start" | "stop" | "status" | "doctor" | "verify" | "canary";
export const COMMANDS: readonly CliCommand[] = Object.freeze(["start", "stop", "status", "doctor", "verify", "canary"]);

export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CliCtx {
  readonly stateDir?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
}

function stateDir(ctx: CliCtx): string {
  return ctx.stateDir ?? process.env.LLMVETO_STATE_DIR ?? join(homedir(), ".llmveto");
}
function pidFile(ctx: CliCtx): string { return join(stateDir(ctx), "gateway.pid"); }
function evidenceFile(ctx: CliCtx): string { return join(stateDir(ctx), "evidence.jsonl"); }
function urlFile(ctx: CliCtx): string { return join(stateDir(ctx), "gateway.url"); }

/** 读 pid 文件为整数；缺失 / 非法内容 → null。 */
function readPid(ctx: CliCtx): number | null {
  if (!existsSync(pidFile(ctx))) return null;
  const pid = Number(readFileSync(pidFile(ctx), "utf8").trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** 清理状态文件（best-effort）。 */
function clearStateFiles(ctx: CliCtx): void {
  for (const f of [pidFile(ctx), urlFile(ctx)]) {
    try { if (existsSync(f)) rmSync(f); } catch { /* best-effort cleanup */ }
  }
}

export async function runCli(cmd: CliCommand | string, ctx: CliCtx = {}): Promise<CliResult> {
  const args = ctx.args ?? [];
  if (!COMMANDS.includes(cmd as CliCommand)) {
    return { exitCode: 2, stdout: "", stderr: `unknown command: ${cmd}\nvalid: ${COMMANDS.join(", ")}\n` };
  }
  try {
    switch (cmd) {
      case "start":  return await cmdStart(ctx);
      case "stop":   return await cmdStop(ctx);
      case "status": return cmdStatus(ctx);
      case "doctor": return await cmdDoctor(ctx, args.includes("--write-managed-config"));
      case "verify": return cmdVerify(ctx, args);
      case "canary": return await cmdCanary(ctx, args);
      default:
        return { exitCode: 2, stdout: "", stderr: `unknown command: ${cmd}\n` };
    }
  } catch (e) {
    return { exitCode: 1, stdout: "", stderr: `error: ${(e as Error).message}\n` };
  }
}

async function cmdStart(ctx: CliCtx): Promise<CliResult> {
  const env = ctx.env ?? process.env;
  // 守护化：用户态 `start` 为父进程，派生一个脱离终端的后端子进程运行反代；
  // 子进程带 LLMVETO_DAEMON_CHILD=1 重入本命令，在前台（自身事件循环）持有 server。
  if (env.LLMVETO_DAEMON_CHILD === "1") return await cmdStartDaemon(ctx, env);
  return await cmdStartSpawn(ctx, env);
}

/** 父：spawn detached 后端子进程，握手等待其写出 gateway.url 后返回。 */
async function cmdStartSpawn(ctx: CliCtx, env: Readonly<Record<string, string | undefined>>): Promise<CliResult> {
  const dir = stateDir(ctx);
  mkdirSync(dir, { recursive: true });
  const script = process.argv[1];
  if (!script) return { exitCode: 1, stdout: "", stderr: "start: cannot resolve CLI entry path (process.argv[1])\n" };
  // 已在运行 → 幂等返回，不派生第二个必然因端口占用而失败的 daemon。
  const livePid = readPid(ctx);
  if (livePid !== null && isAlive(livePid)) {
    const url = existsSync(urlFile(ctx)) ? readFileSync(urlFile(ctx), "utf8").trim() : "unknown";
    return { exitCode: 0, stdout: `gateway already running (pid=${livePid}) at ${url}\nstate dir: ${dir}\n`, stderr: "" };
  }
  // 陈旧状态清理：上次异常退出遗留的 pid/url 文件会让下面的握手读到旧地址（假成功）。
  clearStateFiles(ctx);
  // 把 stateDir 经 env 传给子进程（ctx 不跨进程）；其余网关配置（UPSTREAM/PORT/…）随 process.env 继承。
  const child = spawn(process.execPath, [script, "start"], {
    cwd: process.cwd(),
    env: { ...process.env, ...env, LLMVETO_DAEMON_CHILD: "1", LLMVETO_STATE_DIR: dir },
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  const pid = child.pid;
  if (!pid) return { exitCode: 1, stdout: "", stderr: "start: failed to spawn daemon process\n" };
  // 握手：轮询子进程写出的 url 文件（最长 ~3s），期间若子进程提前退出则判定启动失败。
  let died = false;
  child.once("exit", () => { died = true; });
  const deadline = Date.now() + 3000;
  let url: string | null = null;
  while (Date.now() < deadline) {
    if (died) break; // 子进程提前退出优先于文件存在判断
    // 只认本次派生的子进程写出的状态：pid 文件必须等于 child.pid（防陈旧文件误判）。
    if (readPid(ctx) === pid && existsSync(urlFile(ctx))) { url = readFileSync(urlFile(ctx), "utf8").trim(); break; }
    await sleep(50);
  }
  if (!url) {
    clearStateFiles(ctx);
    return { exitCode: 1, stdout: "", stderr: `start: daemon exited before listening (port busy or misconfig?); see LLMVETO_* env\n` };
  }
  return { exitCode: 0, stdout: `gateway started in background (pid=${pid}) at ${url}\nstate dir: ${dir}\n`, stderr: "" };
}

/** 子（daemon）：真实持有反代 HTTP server；写 pid/url；信号下优雅收尾（Linux/CI）。 */
async function cmdStartDaemon(ctx: CliCtx, env: Readonly<Record<string, string | undefined>>): Promise<CliResult> {
  const dir = stateDir(ctx);
  mkdirSync(dir, { recursive: true });
  const writer = new EvidenceWriter(evidenceFile(ctx));
  const upstreamBaseUrl = env.LLMVETO_UPSTREAM_BASE_URL ?? "";
  // 路径路由表：LLMVETO_UPSTREAMS='{"opencode/openai":"https://api.openai.com/v1", ...}'；解析失败 → 启动失败（fail-fast，不默默降级）
  let upstreams: Record<string, string> | undefined;
  const upstreamsEnv = env.LLMVETO_UPSTREAMS;
  if (upstreamsEnv) {
    try {
      const parsed = JSON.parse(upstreamsEnv) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("must be a JSON object");
      upstreams = parsed as Record<string, string>;
    } catch (e) {
      return { exitCode: 1, stdout: "", stderr: `invalid LLMVETO_UPSTREAMS: ${(e as Error).message}\n` };
    }
  }
  const modelsSnapshotPath = env.LLMVETO_MODELS_SNAPSHOT;
  const port = env.LLMVETO_PORT !== undefined ? Number(env.LLMVETO_PORT) : 8787;
  const gw = await startGateway({ port, config: { upstreamBaseUrl, evidenceWriter: writer, ...(upstreams ? { upstreams } : {}), ...(modelsSnapshotPath ? { modelsSnapshotPath } : {}) } });
  writeFileSync(pidFile(ctx), String(process.pid), "utf8");
  writeFileSync(urlFile(ctx), gw.url, "utf8");
  // 优雅收尾：SIGTERM/SIGINT → 关 server + 清理 pid/url（Windows 下 stop 直接删文件，不依赖此路）。
  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    void gw.close().finally(() => {
      clearStateFiles(ctx);
      process.exit(0);
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  // server 持有事件循环 → 本 Promise resolve 后进程不退出（后台常驻）。
  return { exitCode: 0, stdout: `gateway listening at ${gw.url}\n`, stderr: "" };
}

async function cmdStop(ctx: CliCtx): Promise<CliResult> {
  const pidPath = pidFile(ctx);
  if (!existsSync(pidPath)) return { exitCode: 1, stdout: "", stderr: "stop: gateway not running (no pid file)\n" };
  const pid = Number(readFileSync(pidPath, "utf8").trim());
  let signaled = false;
  if (Number.isInteger(pid) && pid > 0) {
    try { process.kill(pid); signaled = true; } catch { /* stale pid or permission: fall through to cleanup */ }
  }
  clearStateFiles(ctx);
  return signaled
    ? { exitCode: 0, stdout: "stop: signal sent\n", stderr: "" }
    : { exitCode: 1, stdout: "", stderr: `stop: stale pid file removed but process ${pid} not found\n` };
}

function cmdStatus(ctx: CliCtx): CliResult {
  const pidPath = pidFile(ctx);
  if (!existsSync(pidPath)) return { exitCode: 1, stdout: "not running\n", stderr: "" };
  const pid = Number(readFileSync(pidPath, "utf8").trim());
  const url = existsSync(urlFile(ctx)) ? readFileSync(urlFile(ctx), "utf8").trim() : "unknown";
  // 守护化后 status 必须真实探活：pid 文件存在不代表进程存活（崩溃/被外部杀死会遗留僵尸文件）。
  if (!isAlive(pid)) return { exitCode: 1, stdout: `not running (stale pid file: ${pid})\n`, stderr: "" };
  return { exitCode: 0, stdout: `running pid=${pid} url=${url}\n`, stderr: "" };
}

/** liveness 探活：signal 0 不投递，仅检验进程存在与否。 */
function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

interface DoctorCheck { readonly id: string; readonly ok: boolean; readonly message: string }

/** ③ 写托管配置：先写盘，后续漂移检测才能反映写入后真实状态。
 *  写失败仅告警（AC-VETO-008-03），本项恒 PASS。 */
function writeManagedConfigs(env: Env, baseUrl: string, adapters: readonly Adapter[]): DoctorCheck {
  const results: string[] = [];
  let failures = 0;
  for (const a of adapters) {
    try {
      results.push(`${a.name}→${a.applyManagedConfig(env, baseUrl)}`);
    } catch (e) {
      failures += 1;
      results.push(`${a.name} write failed: ${(e as Error).message}`);
    }
  }
  // AC-VETO-008-03：写失败仅告警。本项恒 PASS，故消息必须显式标注失败计数，
  // 避免运维把 [PASS] 读成"配置已生效"；未写入的漂移由 doctor.config-drift 如实报 FAIL。
  const warn = failures > 0 ? ` [WARN: ${failures}/${adapters.length} write failed — warn-only per AC-VETO-008-03; see doctor.config-drift]` : "";
  return { id: "doctor.write-managed-config", ok: true, message: (results.join("; ") || "no adapters") + warn };
}

/** ⑤ canary-registry（D-14）：文件可解析 → PASS；缺失 = 未配置（PASS）；损坏 → DEGRADED。 */
function checkCanaryRegistry(ctx: CliCtx): DoctorCheck {
  const registryPath = join(stateDir(ctx), "canary-registry.json");
  if (!existsSync(registryPath)) {
    return { id: "doctor.canary-registry", ok: true, message: "registry not configured (no file)" };
  }
  try {
    const raw = JSON.parse(readFileSync(registryPath, "utf8")) as Record<string, unknown>;
    const ok = typeof raw["version"] === "number" && typeof raw["entries"] === "object";
    return { id: "doctor.canary-registry", ok, message: ok ? "registry ok" : "[DEGRADED] registry malformed" };
  } catch {
    return { id: "doctor.canary-registry", ok: false, message: "[DEGRADED] registry unreadable" };
  }
}

async function cmdDoctor(ctx: CliCtx, writeManaged: boolean): Promise<CliResult> {
  // AC-VETO-008-02 检查项封闭枚举：① 受管配置漂移 ② 端口连通 ③（可选）写托管 ④ evidence 链
  const env = ctx.env ?? process.env;
  const adapters: readonly Adapter[] = [opencodeAdapter, delphiAdapter];
  const checks: DoctorCheck[] = [];
  const baseUrl = env.LLMVETO_GATEWAY_URL ?? "http://127.0.0.1:8787";
  // ③ 写托管配置（--write-managed-config）：先写盘，后续漂移检测才能反映写入后真实状态。
  if (writeManaged) checks.push(writeManagedConfigs(env, baseUrl, adapters));
  // ① 漂移：真实读取每个适配器的受管配置文件（缺失 / 不可解析 → 全漂移）
  const drift: { id: string }[] = [];
  const seen: string[] = [];
  for (const a of adapters) {
    const current = a.readCurrentConfig(env);
    seen.push(`${a.name}=${a.defaultConfigPath(env)}`);
    drift.push(...a.detectDrift(current, baseUrl));
  }
  checks.push({
    id: "doctor.config-drift",
    ok: drift.length === 0,
    message: `drift entries: ${drift.map((d) => d.id).join(", ") || "none"} (configs: ${seen.join(", ")})`,
  });
  // ② 端口连通：对 gateway.url（或默认地址）做真实 TCP 探活
  const probe = await probeReachable(baseUrl);
  checks.push({
    id: "doctor.port-reachable",
    ok: probe,
    message: probe ? `${baseUrl} reachable` : `${baseUrl} not reachable (gateway down?)`,
  });
  // ④ evidence 链可跑通
  const verifyResult = verifyEvidenceFile(evidenceFile(ctx));
  checks.push({
    id: "doctor.evidence-chain",
    ok: verifyResult.ok || verifyResult.kind === "no_file", // 无文件视为空链 OK
    message: verifyResult.ok ? `chain ok (${verifyResult.records} records)` : `chain: ${verifyResult.kind}`,
  });
  // ⑤ canary-registry（D-14 doctor 扩枚举 4→6）：registry 文件存在且可解析 → PASS；缺失/损坏 → [DEGRADED]
  checks.push(checkCanaryRegistry(ctx));
  // ⑥ coverage-counters（D-14）：从 evidence 链聚合计数；链缺失/损坏 → [DEGRADED]
  const agg = aggregateEvidence(evidenceFile(ctx));
  if (agg.status === "ok") {
    const c = agg.counts;
    checks.push({ id: "doctor.coverage-counters", ok: true, message: `total=${c.total} allowed=${c.allowed} blocked=${c.blocked} warned=${c.warned} terminated=${c.terminated}` });
  } else {
    checks.push({ id: "doctor.coverage-counters", ok: false, message: `[DEGRADED] counters unavailable: ${agg.reason}` });
  }
  const failing = checks.filter((c) => !c.ok);
  const exit = failing.length === 0 ? 0 : 1;
  const lines = checks.map((c) => `[${c.ok ? "PASS" : "FAIL"}] ${c.id}: ${c.message}`);
  return { exitCode: exit, stdout: lines.join("\n") + "\n", stderr: "" };
}

function cmdVerify(ctx: CliCtx, args: readonly string[]): CliResult {
  const fileIdx = args.indexOf("-f");
  const file = fileIdx >= 0 ? args[fileIdx + 1] : evidenceFile(ctx);
  const r = verifyEvidenceFile(file!);
  if (r.ok) return { exitCode: 0, stdout: `ok: ${r.records} records verified\n`, stderr: "" };
  switch (r.kind) {
    case "no_file": return { exitCode: 1, stdout: "", stderr: `no file: ${r.message}\n` };
    case "unsupported_version": return { exitCode: 1, stdout: "", stderr: `unsupported evidence_version: ${String(r.evidence_version)}\n` };
    case "schema_violation": return { exitCode: 1, stdout: "", stderr: `schema violation at seq=${r.seq}: ${r.errors.join("; ")}\n` };
    case "chain_broken": return { exitCode: 1, stdout: "", stderr: `first_bad_seq=${r.first_bad_seq} (${r.reason})\n` };
  }
}

/** canary 子命令分派：未知动词 → exit 2（AC-V2a-08）。 */
async function cmdCanary(ctx: CliCtx, args: readonly string[]): Promise<CliResult> {
  const sub = args[0];
  if (sub !== "rotate") {
    return { exitCode: 2, stdout: "", stderr: `unknown canary verb: ${sub ?? "(none)"}\nvalid: rotate\n` };
  }
  return await cmdCanaryRotate(ctx);
}

/** canary rotate 双路径（AC-V2a-08）：在线 → POST loopback 等确认；离线 → 写零字节哨兵。 */
async function cmdCanaryRotate(ctx: CliCtx): Promise<CliResult> {
  const env = ctx.env ?? process.env;
  const baseUrl = env.LLMVETO_GATEWAY_URL ?? "http://127.0.0.1:8787";
  const reachable = await probeReachable(baseUrl, 1000);
  if (reachable) {
    try {
      const resp = await fetch(`${baseUrl}/_llmveto/canary/rotate`, { method: "POST" });
      if (!resp.ok) {
        const body = await resp.text();
        return { exitCode: 1, stdout: "", stderr: `rotate failed (${resp.status}): ${body}\n` };
      }
      const data = await resp.json() as { rotation_count: number; last_rotated_at: string };
      return { exitCode: 0, stdout: `rotated online: rotation_count=${data.rotation_count} at=${data.last_rotated_at}\n`, stderr: "" };
    } catch (e) {
      return { exitCode: 1, stdout: "", stderr: `rotate online failed: ${(e as Error).message}\n` };
    }
  }
  // 离线路径：写零字节哨兵标记文件（同 SL-07 sentinelPathFor 定位）
  const sentinel = join(stateDir(ctx), "canary-rotate.request");
  const dir = stateDir(ctx);
  mkdirSync(dir, { recursive: true });
  writeFileSync(sentinel, "", "utf8");
  return { exitCode: 0, stdout: `rotated offline: sentinel written ${sentinel}\n`, stderr: "" };
}

/** v2a：CLI 注册 canary 控制通道（AC-V2a-08）；report 仍禁（AC-VETO-008-01 冻结）。 */
export function assertNoV2Stubs(): void {
  if ((COMMANDS as readonly string[]).includes("report")) throw new Error("v1 must not register report");
}

function probeReachable(baseUrl: string, timeoutMs = 500): Promise<boolean> {
  const url = new URL(baseUrl);
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  return new Promise((resolve) => {
    const sock = createConnection({ host: url.hostname, port });
    const timer = setTimeout(() => { sock.destroy(); resolve(false); }, timeoutMs);
    sock.once("connect", () => { clearTimeout(timer); sock.destroy(); resolve(true); });
    sock.once("error", () => { clearTimeout(timer); resolve(false); });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// CLI 真实入口：此前缺少此段，导致 `bun run src/cli/index.ts <cmd>` 静默 no-op（产品不可用）。
// start 已守护化：父进程 spawn 后台 daemon 后立即返回；被 spawn 的子进程带 LLMVETO_DAEMON_CHILD=1
// 重入本入口，走 cmdStartDaemon 常驻持有 server 事件循环。stop/status 基于 pid 文件 + 真实探活。
// 可移植自识别：`import.meta.main` 仅 Bun / Node ≥24 有，Node ≥18 无此属性；
// 改用 import.meta.url 与 process.argv[1] 的路径比对，Bun(源码) 与 Node(dist) 均可。
export function isDirectRun(metaUrl: string, argv1: string | undefined = process.argv[1]): boolean {
  if (!argv1) return false;
  try {
    return resolve(fileURLToPath(metaUrl)) === resolve(argv1);
  } catch {
    return false;
  }
}

if (isDirectRun(import.meta.url)) {
  const [cmd = "", ...rest] = process.argv.slice(2);
  const result = await runCli(cmd, { args: rest });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
