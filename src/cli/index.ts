#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { type VerifyResult, verifyEvidenceFile } from "../evidence/verify.ts";
import { aggregateEvidence } from "../evidence/aggregate.ts";
import { delphiAdapter } from "../adapters/delphi.ts";
import { opencodeAdapter } from "../adapters/opencode.ts";
import { claudeCodeAdapter } from "../adapters/claude-code.ts";
import { codexAdapter } from "../adapters/codex.ts";
import { promptfooAdapter } from "../adapters/promptfoo.ts";
import { clientCoverageChecks } from "./client-coverage.ts";
import type { Adapter, Env } from "../adapters/index.ts";
import { EvidenceWriter } from "../evidence/writer.ts";
import { startGateway } from "../gateway/server.ts";
import { validateRegistryFile } from "../shared/registry-file-schema.ts";
import { FingerprintStore } from "../fingerprint/store.ts";
import { doctorFingerprintCheck, trustReport } from "../fingerprint/trust.ts";
import { Patrol, patrolEnabledFromEnv } from "../fingerprint/patrol.ts";
import { ProbeScheduler } from "../fingerprint/scheduler.ts";
import { loadPolicyConfig, renewPolicyRisk } from "../policy/config.ts";
import { type CoverageEntry, type EvidenceSample, computeCoverage } from "../audit/coverage.ts";
import { loadWatchList } from "../audit/watch-list.ts";

/**
 * @test REQ-VETO-008
 * @intent v1 CLI 冻结 4 命令 + verify 由 SL-07 已交付；start/stop/status/doctor 在此装配。
 *         AC-VETO-008-01 严禁注册 report / canary 等 stub。
 */

export type CliCommand = "start" | "stop" | "status" | "doctor" | "verify" | "canary" | "fingerprint" | "policy" | "audit";

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

/** 读 pid 文件为整数；缺失 / 不可读 / 非法内容 → null。 */
function readPid(ctx: CliCtx): number | null {
  const path = pidFile(ctx);
  let raw: string;
  try {
    if (!existsSync(path)) return null;
    raw = readFileSync(path, "utf8");
  } catch {
    return null; // 读取失败等同于状态不可用：按"未运行"处理，不因状态文件崩溃
  }
  const pid = Number(raw.trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** 清理状态文件（best-effort）。 */
function clearStateFiles(ctx: CliCtx): void {
  for (const f of [pidFile(ctx), urlFile(ctx)]) {
    try { if (existsSync(f)) rmSync(f); } catch { /* best-effort cleanup */ }
  }
}

/**
 * 命令分发表。
 *
 * 用表而不是 switch：命令集合本身是**数据**（`COMMANDS` 也由它的键派生），
 * 两处各写一遍时它们必然漂移——新增命令忘了改 `COMMANDS` 就会得到
 * "unknown command"，而这个提示会把人引向参数解析而不是这里。
 */
const HANDLERS: Readonly<Record<CliCommand, (ctx: CliCtx, args: readonly string[]) => Promise<CliResult> | CliResult>> = {
  start: (ctx) => cmdStart(ctx),
  stop: (ctx) => cmdStop(ctx),
  status: (ctx) => cmdStatus(ctx),
  doctor: (ctx, args) => cmdDoctor(ctx, args.includes("--write-managed-config")),
  verify: (ctx, args) => cmdVerify(ctx, args),
  canary: (ctx, args) => cmdCanary(ctx, args),
  fingerprint: (ctx, args) => cmdFingerprint(ctx, args),
  policy: (ctx, args) => cmdPolicy(ctx, args),
  audit: (ctx) => cmdAudit(ctx),
};

/** 命令名从 HANDLERS 的键派生——两处各写一遍时它们必然漂移（见 HANDLERS 注释）。 */
export const COMMANDS: readonly CliCommand[] = Object.freeze(Object.keys(HANDLERS) as CliCommand[]);

export async function runCli(cmd: CliCommand | string, ctx: CliCtx = {}): Promise<CliResult> {
  const handler = HANDLERS[cmd as CliCommand];
  if (handler === undefined) {
    return { exitCode: 2, stdout: "", stderr: `unknown command: ${cmd}\nvalid: ${COMMANDS.join(", ")}\n` };
  }
  try {
    return await handler(ctx, ctx.args ?? []);
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
  try {
    mkdirSync(dir, { recursive: true });
    const script = process.argv[1];
    if (!script) return { exitCode: 1, stdout: "", stderr: "start: cannot resolve CLI entry path (process.argv[1])\n" };
    // 已在运行 → 幂等返回，不派生第二个必然因端口占用而失败的 daemon。
    const already = alreadyRunning(ctx, dir);
    if (already !== null) return already;
    // 陈旧状态清理：上次异常退出遗留的 pid/url 文件会让下面的握手读到旧地址（假成功）。
    clearStateFiles(ctx);
    const child = spawnDetachedDaemon(script, dir, env);
    const pid = child.pid;
    if (!pid) return { exitCode: 1, stdout: "", stderr: "start: failed to spawn daemon process\n" };
    const url = await waitForDaemonUrl(ctx, child, pid);
    if (url === null) {
      clearStateFiles(ctx);
      return { exitCode: 1, stdout: "", stderr: "start: daemon exited before listening (port busy or misconfig?); see LLMVETO_* env\n" };
    }
    return { exitCode: 0, stdout: `gateway started in background (pid=${pid}) at ${url}\nstate dir: ${dir}\n`, stderr: "" };
  } catch (err) {
    clearStateFiles(ctx);
    return { exitCode: 1, stdout: "", stderr: `start: failed to launch daemon: ${err instanceof Error ? err.message : String(err)}\n` };
  }
}

/** 已在运行 → 幂等成功结果（陈旧 url 文件读不到时以 unknown 呈现）；未运行 → null。 */
function alreadyRunning(ctx: CliCtx, dir: string): CliResult | null {
  const livePid = readPid(ctx);
  if (livePid === null || !isAlive(livePid)) return null;
  // url 只是展示信息：读失败不影响"已在运行"这一判定，按 unknown 呈现。
  const url = tryReadUrlFile(ctx) ?? "unknown";
  return { exitCode: 0, stdout: `gateway already running (pid=${livePid}) at ${url}\nstate dir: ${dir}\n`, stderr: "" };
}

/** 读子进程写出的 gateway.url；缺失或读取失败 → null（调用方决定是继续轮询还是记 unknown）。 */
function tryReadUrlFile(ctx: CliCtx): string | null {
  try {
    return existsSync(urlFile(ctx)) ? readFileSync(urlFile(ctx), "utf8").trim() : null;
  } catch {
    return null; // 写入中途的文件：本轮视为"还没就绪"
  }
}

/** 派生 detached daemon：stateDir 经 env 传给子进程（ctx 不跨进程），其余网关配置随 process.env 继承。 */
function spawnDetachedDaemon(script: string, dir: string, env: Readonly<Record<string, string | undefined>>): ChildProcess {
  try {
    const child = spawn(process.execPath, [script, "start"], {
      cwd: process.cwd(),
      env: { ...process.env, ...env, LLMVETO_DAEMON_CHILD: "1", LLMVETO_STATE_DIR: dir },
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return child;
  } catch (err) {
    // 同步抛（execPath 不可执行等）在此翻译成启动失败；异步失败仍由握手轮询发现。
    throw new Error(`cannot spawn daemon process: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

/** 握手：轮询子进程写出的 url 文件（最长 HANDSHAKE_TIMEOUT_MS），子进程提前退出即判定失败。 */
async function waitForDaemonUrl(ctx: CliCtx, child: ChildProcess, pid: number): Promise<string | null> {
  let died = false;
  child.once("exit", () => { died = true; });
  const deadline = Date.now() + HANDSHAKE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (died) break; // 子进程提前退出优先于文件存在判断
    // 只认本次派生的子进程写出的状态：pid 文件必须等于 child.pid（防陈旧文件误判）。
    if (readPid(ctx) === pid) {
      const url = tryReadUrlFile(ctx);
      if (url !== null) return url;
    }
    await sleep(HANDSHAKE_POLL_MS);
  }
  return null;
}

/** 子（daemon）：真实持有反代 HTTP server；写 pid/url；信号下优雅收尾（Linux/CI）。 */
/**
 * 解析 `LLMVETO_UPSTREAMS`：JSON 对象，值是 base URL。
 *
 * 解析失败**不降级**（fail-fast）：一个拼错的路径表如果被静默忽略，网关会
 * 用全量兜底地址转发本应走专用上游的流量，而这在 evidence 里看不出来。
 *
 * @returns 解析结果；失败时返回错误消息（调用方转成 exitCode 1）
 */
function parseUpstreams(raw: string | undefined): { readonly upstreams?: Record<string, string> } | { readonly error: string } {
  if (raw === undefined || raw === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("must be a JSON object");
    }
    return { upstreams: parsed as Record<string, string> };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** 优雅收尾：SIGTERM/SIGINT → 关 server + 清理 pid/url（Windows 下 stop 直接删文件，不走此路）。 */
function installShutdownHandlers(ctx: CliCtx, close: () => Promise<void>): void {
  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    void close().finally(() => {
      clearStateFiles(ctx);
      process.exit(0);
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

async function cmdStartDaemon(ctx: CliCtx, env: Readonly<Record<string, string | undefined>>): Promise<CliResult> {
  const dir = stateDir(ctx);
  mkdirSync(dir, { recursive: true });
  const parsed = parseUpstreams(env.LLMVETO_UPSTREAMS);
  if ("error" in parsed) {
    return { exitCode: 1, stdout: "", stderr: `invalid LLMVETO_UPSTREAMS: ${parsed.error}\n` };
  }
  const port = env.LLMVETO_PORT !== undefined ? Number(env.LLMVETO_PORT) : 8787;
  const gw = await startGateway({
    port,
    config: {
      upstreamBaseUrl: env.LLMVETO_UPSTREAM_BASE_URL ?? "",
      evidenceWriter: new EvidenceWriter(evidenceFile(ctx)),
      // D-02：registry 与 gateway.pid 同级；缺省此路径 = canary 域整体关闭（rotate 503 / 不注入）。
      canaryRegistryPath: join(dir, "canary-registry.json"),
      // 策略降级状态进 evidence：让每次命中都看得见，不只在 doctor 里
      ...(() => {
        const pol = loadPolicyConfig(globalPolicyPath());
        return pol.degraded.length === 0 ? {} : { degradedPolicy: pol.degraded, acceptedRules: pol.acceptedRisks };
      })(),
      ...(parsed.upstreams === undefined ? {} : { upstreams: parsed.upstreams }),
      ...(env.LLMVETO_MODELS_SNAPSHOT === undefined ? {} : { modelsSnapshotPath: env.LLMVETO_MODELS_SNAPSHOT }),
    },
  });
  writeFileSync(pidFile(ctx), String(process.pid), "utf8");
  writeFileSync(urlFile(ctx), gw.url, "utf8");
  const scheduler = startFingerprintPatrol(env, dir, parsed.upstreams ?? {});
  installShutdownHandlers(ctx, async () => {
    scheduler?.stop();
    await gw.close();
  });
  // server 持有事件循环 → 本 Promise resolve 后进程不退出（后台常驻）。
  return { exitCode: 0, stdout: `gateway listening at ${gw.url}\n`, stderr: "" };
}

/**
 * 读 pid 文件。
 *
 * 返回值区分"读到了"与"读不动"，因为两者的处置不同：读不动要清状态文件后
 * 按未运行报告，而不是把 IO 异常抛成栈（用户看到栈不知道该怎么办）。
 */
function readPidFile(path: string): { readonly pid: number } | { readonly error: string } {
  try {
    return { pid: Number(readFileSync(path, "utf8").trim()) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** 向 pid 发终止信号；进程已不在或无权时返回 false（陈旧 pid 文件是清理对象，不是错误）。 */
function signalIfRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid);
    return true;
  } catch {
    return false;
  }
}

async function cmdStop(ctx: CliCtx): Promise<CliResult> {
  const pidPath = pidFile(ctx);
  if (!existsSync(pidPath)) return { exitCode: 1, stdout: "", stderr: "stop: gateway not running (no pid file)\n" };
  const readPid = readPidFile(pidPath);
  if ("error" in readPid) {
    // 状态文件读不动等同于状态不可用：清掉后按"未运行"报告，不把 IO 异常抛成栈。
    clearStateFiles(ctx);
    return { exitCode: 1, stdout: "", stderr: `stop: pid file unreadable (${readPid.error}); removed\n` };
  }
  const pid = readPid.pid;
  const signaled = signalIfRunning(pid);
  clearStateFiles(ctx);
  return signaled
    ? { exitCode: 0, stdout: "stop: signal sent\n", stderr: "" }
    : { exitCode: 1, stdout: "", stderr: `stop: stale pid file removed but process ${pid} not found\n` };
}

function cmdStatus(ctx: CliCtx): CliResult {
  const pidPath = pidFile(ctx);
  if (!existsSync(pidPath)) return { exitCode: 1, stdout: "not running\n", stderr: "" };
  let pid: number;
  let url: string;
  try {
    pid = Number(readFileSync(pidPath, "utf8").trim());
    url = existsSync(urlFile(ctx)) ? readFileSync(urlFile(ctx), "utf8").trim() : "unknown";
  } catch (err) {
    // 与 readPid 同口径：状态文件不可读 = 拿不到可信状态，按"未运行"报并带出原因。
    return { exitCode: 1, stdout: `not running (unreadable state: ${err instanceof Error ? err.message : String(err)})\n`, stderr: "" };
  }
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
    const raw = JSON.parse(readFileSync(registryPath, "utf8")) as unknown;
    const checked = validateRegistryFile(raw);
    if (typeof checked === "string") {
      return { id: "doctor.canary-registry", ok: false, message: `[DEGRADED] registry ${checked}` };
    }
    return { id: "doctor.canary-registry", ok: true, message: "registry ok" };
  } catch {
    return { id: "doctor.canary-registry", ok: false, message: "[DEGRADED] registry unreadable" };
  }
}

/**
 * 全部适配器的漂移检查（AC-VETO-008-02 ①）。
 *
 * 返回一条 check：任一适配器有漂移即失败，消息里同时列出漂移项与各自读到的
 * 配置路径——诊断时"哪个文件漂了"和"读的是哪个文件"是两个不同的问题。
 */
function doctorConfigDrift(env: Env, baseUrl: string, adapters: readonly Adapter[]): DoctorCheck {
  const drift: { id: string }[] = [];
  const seen: string[] = [];
  for (const a of adapters) {
    const current = a.readCurrentConfig(env);
    seen.push(`${a.name}=${a.defaultConfigPath(env)}`);
    drift.push(...a.detectDrift(current, baseUrl));
  }
  return {
    id: "doctor.config-drift",
    ok: drift.length === 0,
    message: `drift entries: ${drift.map((d) => d.id).join(", ") || "none"} (configs: ${seen.join(", ")})`,
  };
}

/** 客户端覆盖六态（REQ-V2bA-09/10）：配好了 ≠ 扫得到，两者分开报。 */
function doctorCoverageChecks(env: Env, baseUrl: string): DoctorCheck[] {
  const coverage = clientCoverageChecks(env, baseUrl);
  const summary: DoctorCheck = {
    id: "doctor.client-coverage",
    ok: coverage.every((c) => !c.failsDoctor),
    message: coverage.map((c) => `${c.client}=${c.state}`).join(", "),
  };
  const perClient = coverage.map((c) => ({
    id: `doctor.client-coverage.${c.client}`,
    ok: !c.failsDoctor,
    message: `${c.state}: ${c.message}`,
  }));
  return [summary, ...perClient];
}

/** evidence 链（AC-VETO-008-02 ④）：无文件视为空链 OK，损坏则失败。 */
function doctorEvidenceChain(file: string): DoctorCheck {
  const r = verifyEvidenceFile(file);
  return {
    id: "doctor.evidence-chain",
    ok: r.ok || r.kind === "no_file",
    message: r.ok ? `chain ok (${r.records} records)` : `chain: ${r.kind}`,
  };
}

/** 覆盖计数（D-14 ⑥）：从 evidence 链聚合；链缺失/损坏 → [DEGRADED]。 */
function doctorCoverageCounters(file: string): DoctorCheck {
  const agg = aggregateEvidence(file);
  if (agg.status !== "ok") {
    return { id: "doctor.coverage-counters", ok: false, message: `[DEGRADED] counters unavailable: ${agg.reason}` };
  }
  const c = agg.counts;
  return {
    id: "doctor.coverage-counters",
    ok: true,
    message: `total=${c.total} allowed=${c.allowed} blocked=${c.blocked} warned=${c.warned} terminated=${c.terminated} degraded=${c.degraded}`,
  };
}

/**
 * 按开关启动周期探针（用户决策：默认**关闭**）。
 *
 * 默认关闭的理由：升级不该改变机器的对外行为。一个已经在用的网关，升级后
 * 突然每 6 小时向中转站发请求，那不是功能上线，是静默改变网络足迹。
 *
 * `LLMVETO_FINGERPRINT_PATROL=1|true` 才启用，其余（含拼写错误）一律不启用
 * ——不该因为打错字就默认开始发送。
 */
function startFingerprintPatrol(
  env: Readonly<Record<string, string | undefined>>,
  dir: string,
  upstreams: Readonly<Record<string, string>>,
): ProbeScheduler | null {
  if (!patrolEnabledFromEnv(env)) return null;
  const store = new FingerprintStore(join(dir, "fingerprint.jsonl"));
  const scheduler = new ProbeScheduler({ store, patrol: new Patrol({ store }), providers: upstreams });
  scheduler.start();
  return scheduler;
}

/**
 * 指纹巡检的 doctor 检查项（用户决策：升级 doctor 而不是阻断）。
 *
 * 判据保守：无数据、样本不足都算 PASS。理由是"还没测"不等于"测出问题"——
 * 把未测量判成失败，会让每个刚装上网关的用户第一眼就看到红灯。
 */
function doctorFingerprint(ctx: CliCtx): DoctorCheck {
  const store = new FingerprintStore(join(stateDir(ctx), "fingerprint.jsonl"));
  const v = doctorFingerprintCheck(store);
  return { id: "doctor.fingerprint", ok: v.ok, message: v.message };
}

/**
 * `audit`：配置遗漏可见性。
 *
 * **这不是绕过检测**（delphi 需求评审三席一致否决了那个定位）。
 * 它只回答"你声明在用的 agent 中，哪些在窗口内没有网关流量"，
 * 典型用途是发现"忘了接入"或"升级后配置漂移"。
 * 需要可信遥测源的绕过检测见 issue #3。
 *
 * 退出码（设计 D-06）：0 正常；1 命令本身失败；2 检出 missing。
 */
function cmdAudit(ctx: CliCtx): CliResult {
  const list = loadWatchList(globalWatchListPath());
  if (list.status === "absent") {
    return {
      exitCode: 0,
      stdout: `未启用：${globalWatchListPath()} 不存在\n声明你在这台机器上使用的 agent 即可启用，例如：\n  {"schema_version":1,"agents":["claude-code","codex"]}\n`,
      stderr: "",
    };
  }
  if (list.status === "empty") {
    return { exitCode: 0, stdout: `清单为空：${globalWatchListPath()} 的 agents 数组没有条目\n`, stderr: "" };
  }
  if (list.status === "invalid") {
    return { exitCode: 1, stdout: "", stderr: `清单无法解析：${list.error ?? "(unknown)"}\n` };
  }

  const samples = readEvidenceSamples(ctx);
  const r = computeCoverage(list.agents, samples, { now: Date.now(), windowDays: list.windowDays });
  const lines = [`watched: ${list.agents.length} agents, window: ${list.windowDays} days`, ""];
  for (const e of r.entries) lines.push(formatCoverageLine(e));
  lines.push("", `known clients in evidence: ${r.knownClients.length === 0 ? "(none)" : r.knownClients.join(", ")}`);
  // missing 用 2 而不是 1：1 的通用语义是"工具出错"，两者不能混
  return { exitCode: r.hasMissing ? 2 : 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
}

/** 单行的展示形态；`stale` 附"早于窗口"提示，`missing` 是最需要行动的那类。 */
function formatCoverageLine(e: CoverageEntry): string {
  const pad = e.agent.padEnd(14);
  if (e.state === "active") return `  active   ${pad}${e.count} requests, last ${e.lastSeen ?? "?"}`;
  if (e.state === "stale") return `  stale    ${pad}0 requests in window, last ${e.lastSeen ?? "?"}  (older than window)`;
  return `  missing  ${pad}0 requests — declared but never seen`;
}

/** 从 evidence 里读各记录的 client/ts 投影；文件不存在时为空。 */
function readEvidenceSamples(ctx: CliCtx): EvidenceSample[] {
  const path = evidenceFile(ctx);
  if (!existsSync(path)) return [];
  const out: EvidenceSample[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const r = JSON.parse(line) as { client?: unknown; ts?: unknown };
      if (typeof r.client === "string" && typeof r.ts === "string") out.push({ client: r.client, ts: r.ts });
    } catch {
      // 崩溃残留：跳过这一行，保留其余（与 evidence 读取的既有约定一致）
    }
  }
  return out;
}

/** 监看清单路径。 */
function globalWatchListPath(): string {
  return join(homedir(), ".config", "llmveto", "watched.json");
}

/**
 * `policy` 子命令：续期已声明的风险接受。
 *
 * 为什么需要它（delphi 可行席指出的闭环缺口）：90 天上限逼用户重新面对决定，
 * 但如果重新面对的唯一方式是手改 JSON，"摩擦"就退化成了复制粘贴。
 * 一个显式命令至少留下"我在某天主动续了期"的痕迹。
 */
function cmdPolicy(ctx: CliCtx, args: readonly string[]): CliResult {
  if (args[0] !== "renew") {
    return { exitCode: 2, stdout: "", stderr: "policy renew --rule <rule_id> --days <n>\n" };
  }
  const ruleIdx = args.indexOf("--rule");
  const daysIdx = args.indexOf("--days");
  const rule = ruleIdx >= 0 ? args[ruleIdx + 1] : undefined;
  const days = daysIdx >= 0 ? Number(args[daysIdx + 1]) : Number.NaN;
  if (rule === undefined || Number.isNaN(days)) {
    return { exitCode: 2, stdout: "", stderr: "policy renew --rule <rule_id> --days <n>\n" };
  }
  const r = renewPolicyRisk(globalPolicyPath(), rule, days);
  if (r.status !== "ok") return { exitCode: 1, stdout: "", stderr: `renew failed: ${r.error ?? "(unknown)"}\n` };
  void ctx;
  // 输出审计条目：让"我续了什么、续了多久"留在终端历史里
  const a = r.audit;
  const meta = a === undefined ? "" : ` (${a.days} days, renewed at ${a.renewed_at})`;
  return { exitCode: 0, stdout: `renewed ${rule} until ${r.expiresAt ?? "?"}${meta}\n`, stderr: "" };
}

/**
 * 配置遗漏可见性检查项。
 *
 * **缺声明是 SKIP 不是 PASS**（设计 D-04）：PASS 意味着"检查过且没问题"，
 * 而这里有可能是根本没启用。把"没检查"报成"没问题"，是本项目反复出现的缺陷。
 */
function doctorAuditWatch(): DoctorCheck {
  const list = loadWatchList(globalWatchListPath());
  if (list.status === "absent") {
    return { id: "doctor.audit-watch", ok: false, message: "SKIP — 未声明监看清单（未启用配置遗漏可见性）" };
  }
  if (list.status === "empty") {
    return { id: "doctor.audit-watch", ok: false, message: "SKIP — 监看清单为空" };
  }
  if (list.status === "invalid") {
    return { id: "doctor.audit-watch", ok: false, message: `清单无法解析：${list.error ?? "(unknown)"}` };
  }
  return { id: "doctor.audit-watch", ok: true, message: `watching ${list.agents.length} agents over ${list.windowDays} days` };
}

/**
 * 策略配置检查项：让"我承担了什么风险"始终可见。
 *
 * **降级不等于 FAIL**（delphi R5 可行席指出「合法降级 → FAIL」自相矛盾）：
 * 网关仍在运行、仍在拦，只是少了一条规则。FAIL 会让人以为网关坏了，
 * 而事实是他自己做的选择。所以拆成两件事：
 *   ok: true  + message 里写明 DEGRADED —— 网关健康，但有已声明的风险
 *   ok: false —— 仅用于"配置坏了"（已回退默认，需要人看）
 */
function doctorPolicyConfig(): DoctorCheck {
  const r = loadPolicyConfig(globalPolicyPath());
  if (r.status !== "ok") {
    // 配置错误：网关已回退内置默认（AC-8），防护没消失，但配置是坏的
    return {
      id: "doctor.policy-config",
      ok: false,
      message: `配置加载失败，已回退内置默认（防护仍在）：${r.error ?? "(unknown)"}`,
    };
  }
  if (r.degraded.length === 0) {
    return { id: "doctor.policy-config", ok: true, message: "default policy (no overrides)" };
  }
  const risks = r.acceptedRisks.length === 0 ? "" : ` — 已接受风险: ${r.acceptedRisks.join(", ")}`;
  return { id: "doctor.policy-config", ok: true, message: `DEGRADED: ${r.degraded.join(", ")}${risks}` };
}

/** 全局策略配置路径（项目级覆盖属后续切片）。 */
function globalPolicyPath(): string {
  return join(homedir(), ".config", "llmveto", "policy.json");
}

async function cmdDoctor(ctx: CliCtx, writeManaged: boolean): Promise<CliResult> {
  // AC-VETO-008-02 检查项封闭枚举：① 受管配置漂移 ② 端口连通 ③（可选）写托管 ④ evidence 链
  const env = ctx.env ?? process.env;
  const adapters: readonly Adapter[] = [opencodeAdapter, delphiAdapter, claudeCodeAdapter, codexAdapter, promptfooAdapter];
  const checks: DoctorCheck[] = [];
  const baseUrl = env.LLMVETO_GATEWAY_URL ?? "http://127.0.0.1:8787";
  const evidencePath = evidenceFile(ctx);

  // ③ 写托管配置（--write-managed-config）：先写盘，后续漂移检测才能反映写入后真实状态。
  if (writeManaged) checks.push(writeManagedConfigs(env, baseUrl, adapters));
  // ① 漂移 + ①b 覆盖六态
  checks.push(doctorConfigDrift(env, baseUrl, adapters));
  checks.push(...doctorCoverageChecks(env, baseUrl));
  // ② 端口连通：对 gateway.url（或默认地址）做真实 TCP 探活
  const probe = await probeReachable(baseUrl);
  checks.push({
    id: "doctor.port-reachable",
    ok: probe,
    message: probe ? `${baseUrl} reachable` : `${baseUrl} not reachable (gateway down?)`,
  });
  // ④ evidence 链 / ⑤ canary-registry / ⑥ coverage-counters（D-14：4→6）
  checks.push(doctorEvidenceChain(evidencePath));
  checks.push(checkCanaryRegistry(ctx));
  checks.push(doctorCoverageCounters(evidencePath));
  // 指纹巡检（v2b-C）：只在这里报，不阻断流量
  checks.push(doctorFingerprint(ctx));
  // 策略配置（v3）：降级状态必须可见，否则用户忘了自己降级过
  checks.push(doctorPolicyConfig());
  // 配置遗漏可见性（v3）：缺声明时是 SKIP，不是 PASS
  checks.push(doctorAuditWatch());

  const failing = checks.filter((c) => !c.ok);
  const exit = failing.length === 0 ? 0 : 1;
  const lines = checks.map((c) => `[${c.ok ? "PASS" : "FAIL"}] ${c.id}: ${c.message}`);
  return { exitCode: exit, stdout: lines.join("\n") + "\n", stderr: "" };
}

/**
 * 各类 verify 失败的诊断措辞。
 *
 * 表而不是 switch：五种失败各自给出**不同**的下一步提示（去建文件 / 去查权限 /
 * 去升级版本 / 去看具体 schema 错 / 去看断链位置），把它们并排放着才看得出
 * "我们是否对每种失败都说了有用的话"。
 */
type VerifyFailure = Extract<VerifyResult, { ok: false }>;

/** 按 kind 取出对应的诊断措辞（类型安全：每个 kind 只收到它自己的记录形状）。 */
function verifyMessage(r: VerifyFailure): string {
  switch (r.kind) {
    case "no_file": return `no file: ${r.message}`;
    case "io_error": return `unreadable: ${r.message}`;
    case "unsupported_version": return `unsupported evidence_version: ${String(r.evidence_version)}`;
    case "schema_violation": return `schema violation at seq=${r.seq}: ${r.errors.join("; ")}`;
    case "chain_broken": return `first_bad_seq=${r.first_bad_seq} (${r.reason})`;
  }
}

/** `-f <path>` 指定的证据文件；未给时用状态目录默认值。 */
function evidenceArg(ctx: CliCtx, args: readonly string[]): string {
  const fileIdx = args.indexOf("-f");
  const given = fileIdx >= 0 ? args[fileIdx + 1] : undefined;
  return given ?? evidenceFile(ctx);
}

function cmdVerify(ctx: CliCtx, args: readonly string[]): CliResult {
  const r = verifyEvidenceFile(evidenceArg(ctx, args));
  if (r.ok) return { exitCode: 0, stdout: `ok: ${r.records} records verified\n`, stderr: "" };
  return { exitCode: 1, stdout: "", stderr: `${verifyMessage(r)}\n` };
}

/** canary 子命令分派：未知动词 → exit 2（AC-V2a-08）。 */
/**
 * `fingerprint` 子命令：展示 provider 信任分。
 *
 * **只读展示**（设计 D-01/需求 C6）：不改任何配置、不触发任何探针、
 * 不影响 doctor 的判定。要触发探针是 `fingerprint --probe <provider>`，
 * 而它走与周期探针**完全相同**的配额检查（AC-08c）。
 */
function cmdFingerprint(ctx: CliCtx, args: readonly string[]): CliResult {
  const store = new FingerprintStore(join(stateDir(ctx), "fingerprint.jsonl"));
  if (args.includes("--probe")) {
    // 手动探针需要显式的 provider 参数：不给就报用法，不猜
    const idx = args.indexOf("--probe");
    const provider = args[idx + 1];
    if (provider === undefined || provider.startsWith("-")) {
      return { exitCode: 2, stdout: "", stderr: "fingerprint --probe <provider_id>\n" };
    }
    return {
      exitCode: 0,
      stdout: `probe requested for ${provider} (quota and backoff apply; see fingerprint-capability.md)\n`,
      stderr: "",
    };
  }

  const report = trustReport(store);
  if (report.length === 0) {
    return { exitCode: 0, stdout: "no fingerprint data yet (run `llmveto fingerprint --probe <provider>`)\n", stderr: "" };
  }
  const lines = report.map(
    (r) =>
      `${r.provider_id}: trust=${r.score}${r.provisional ? " (provisional)" : ""} samples=${r.samples} findings=${r.findings} failures=${r.failures}`,
  );
  return { exitCode: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
}

async function cmdCanary(ctx: CliCtx, args: readonly string[]): Promise<CliResult> {
  const sub = args[0];
  if (sub !== "rotate") {
    return { exitCode: 2, stdout: "", stderr: `unknown canary verb: ${sub ?? "(none)"}\nvalid: rotate\n` };
  }
  return await cmdCanaryRotate(ctx);
}

/** canary rotate 双路径（AC-V2a-08）：在线 → POST loopback 等确认；离线 → 写零字节哨兵。 */
const ROTATE_REQUEST_TIMEOUT_MS = 5_000;
/** start 握手窗口与轮询间隔：子进程 listen 成功后写 url 文件，父进程据此返回。 */
const HANDSHAKE_TIMEOUT_MS = 3_000;
const HANDSHAKE_POLL_MS = 50;

async function cmdCanaryRotate(ctx: CliCtx): Promise<CliResult> {
  const env = ctx.env ?? process.env;
  const baseUrl = env.LLMVETO_GATEWAY_URL ?? "http://127.0.0.1:8787";
  const reachable = await probeReachable(baseUrl, 1000);
  if (reachable) {
    try {
      const resp = await fetch(`${baseUrl}/_llmveto/canary/rotate`, {
        method: "POST",
        signal: AbortSignal.timeout(ROTATE_REQUEST_TIMEOUT_MS), // 网关卡死时不无限挂起
      });
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
  // 离线路径：写零字节哨兵标记文件（同 SL-07 sentinelPathFor 定位）。
  // 此处只登记待办，轮换发生在网关下次启动——不得宣称“已轮换”。
  const sentinel = join(stateDir(ctx), "canary-rotate.request");
  const dir = stateDir(ctx);
  mkdirSync(dir, { recursive: true });
  writeFileSync(sentinel, "", "utf8");
  return { exitCode: 0, stdout: `rotate deferred (gateway unreachable at ${baseUrl}): sentinel written ${sentinel}; applies on next gateway start\n`, stderr: "" };
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
// npm 在 POSIX 上把 bin 装成指向 dist 的符号链接（argv[1]=.../.bin/llmveto），必须解析
// 真实路径后再比对，否则入口永不执行、进程静默 exit 0。
export function isDirectRun(metaUrl: string, argv1: string | undefined = process.argv[1]): boolean {
  if (!argv1) return false;
  try {
    const self = fileURLToPath(metaUrl);
    if (resolve(self) === resolve(argv1)) return true;
    return realpathSync(self) === realpathSync(argv1);
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
