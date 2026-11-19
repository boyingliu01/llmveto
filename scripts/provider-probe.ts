#!/usr/bin/env bun
// @no-test-required: 开发者手工运行的探针脚本，不进 dist、不在 package.json files 白名单内，无可自动断言的契约
/**
 * provider-probe — 多 provider 差分探针（dev 工具，不进 dist / 不进测试门）。
 *
 * 用途：用固定 prompt 集打同一批目标（经网关的 OpenAI 兼容 provider、或 trae/codebuddy 这类
 * ACP agent），横向比较 回答正确性 / prompt_tokens 指纹 / 上下文召回 / 时延，用于发现
 * 「挂羊头卖狗肉」「静默降级小模型」「砍上下文」「改写输出」这类供应商侧异常。
 *
 * 用法：
 *   bun run scripts/provider-probe.ts --config var/provider-probe.json [--out var/provider-probe-result.json]
 *     [--only gemini,codebuddy] [--prompts arith-1,echo-tag] [--repeat 1] [--max-tokens 1024] [--timeout 120000]
 *
 * 判定口径：
 *   - expectContains / expectNotContains 命中 → pass/fail；未配置 → 仅记录（人工复核）。
 *   - finish_reason=length 且带 reasoning_content 时，正文被推理 token 挤占 → 用 --max-tokens 放大重测，
 *     不得据此判模型不可用。
 *   - prompt_tokens 同一 prompt 在同一模型家族内应一致；跨家族不同属正常（tokenizer 差异），
 *     但同一 target 两次运行出现漂移 = 可疑（供应商换模型/改 tokenizer）。
 *   - 本工具只做统计检测，不能证明供应商未投毒。
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

interface PromptSpec {
  readonly id: string;
  readonly text: string;
  readonly maxTokens?: number;
  readonly expectContains?: string;
  readonly expectNotContains?: string;
}

interface OpenAiTarget {
  readonly kind: "openai";
  readonly name: string;
  readonly baseURL: string;
  readonly model: string;
  readonly apiKeyEnv?: string;
  readonly apiKeyFile?: string;
  /** apiKeyFile 是 JSON 时的取值路径，如 "keys.0.key"。 */
  readonly apiKeyJsonPath?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

interface AcpTarget {
  readonly kind: "acp";
  readonly name: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly model: string;
  readonly cwd?: string;
}

type Target = OpenAiTarget | AcpTarget;

interface ProbeConfig {
  readonly prompts: readonly PromptSpec[];
  readonly targets: readonly Target[];
  readonly timeoutMs?: number;
}

interface ProbeResult {
  readonly target: string;
  readonly prompt: string;
  readonly ok: boolean;
  readonly pass?: boolean;
  readonly ms: number;
  readonly text?: string;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly modelField?: string | null;
  readonly finishReason?: string;
  readonly reasoningChars?: number;
  readonly error?: string;
}

const RECALL_MARKER = "MID-7F3A";
const RECALL_FILLER_CHARS = 4000;

/** 把 {{LONG_RECALL}} 展开成 4k 字符中英混排文本，标记埋在正中间。 */
function expandPrompt(p: PromptSpec): string {
  if (!p.text.includes("{{LONG_RECALL}}")) return p.text;
  const half = Math.floor(RECALL_FILLER_CHARS / 2);
  const unit = "The quick brown fox jumps over the lazy dog. 网关金丝雀回落测试。";
  const filler = (n: number): string => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
  return `以下是一段长文本，读完只回答文本正中间的标记（形如 MID-XXXX），不要解释：\n${filler(half)}${RECALL_MARKER}${filler(half)}`;
}

function envKey(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.length === 0) throw new Error(`env ${name} is empty`);
  return v;
}

function jsonAtPath(raw: string, path: string): string {
  let cur: unknown = JSON.parse(raw);
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object") throw new Error(`apiKeyJsonPath ${path} not found`);
    cur = (cur as Record<string, unknown>)[seg];
  }
  if (typeof cur !== "string" || cur.length === 0) throw new Error(`apiKeyJsonPath ${path} not a string`);
  return cur;
}

function readKeyFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    throw new Error(`cannot read apiKeyFile ${path}: ${String(e instanceof Error ? e.message : e)}`);
  }
}

function readKey(t: OpenAiTarget): string {
  if (t.apiKeyEnv !== undefined) return envKey(t.apiKeyEnv);
  if (t.apiKeyFile === undefined) return "";
  const raw = readKeyFile(t.apiKeyFile);
  return t.apiKeyJsonPath === undefined ? raw.trim() : jsonAtPath(raw, t.apiKeyJsonPath);
}

function judge(p: PromptSpec, text: string): boolean | undefined {
  if (p.expectContains !== undefined) return text.includes(p.expectContains);
  if (p.expectNotContains !== undefined) return !text.includes(p.expectNotContains);
  return undefined;
}

function requestHeaders(t: OpenAiTarget): Record<string, string> {
  const key = readKey(t);
  return {
    "content-type": "application/json",
    ...(key === "" ? {} : { authorization: "Bearer " + key }),
    ...(t.headers ?? {}),
  };
}

function requestBody(t: OpenAiTarget, p: PromptSpec, maxTokensOverride?: number): string {
  return JSON.stringify({
    model: t.model,
    messages: [{ role: "user", content: expandPrompt(p) }],
    max_tokens: maxTokensOverride ?? p.maxTokens ?? 96,
    temperature: 0,
    stream: false,
  });
}

interface ChatParse {
  readonly text: string;
  readonly pass?: boolean;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly finishReason?: string;
  readonly reasoningChars?: number;
  readonly modelField: string | null;
}

function parseChat(raw: string, p: PromptSpec): ChatParse {
  const parsed = safeJson(raw);
  const choice = parsed === null ? undefined : firstChoice(parsed);
  const content = choice?.message?.content;
  const reasoning = choice?.message?.reasoning_content;
  const usage = parsed === null ? undefined : (parsed["usage"] as Record<string, unknown> | undefined);
  const modelField = parsed === null ? null : (typeof parsed["model"] === "string" ? parsed["model"] : null);
  const text = typeof content === "string" ? content : "";
  const pass = judge(p, text);
  return {
    text,
    ...(pass === undefined ? {} : { pass }),
    ...(typeof usage?.["prompt_tokens"] === "number" ? { promptTokens: usage["prompt_tokens"] } : {}),
    ...(typeof usage?.["completion_tokens"] === "number" ? { completionTokens: usage["completion_tokens"] } : {}),
    ...(choice?.finishReason === undefined ? {} : { finishReason: choice.finishReason }),
    ...(typeof reasoning === "string" ? { reasoningChars: reasoning.length } : {}),
    modelField,
  };
}

function chatResult(t: OpenAiTarget, p: PromptSpec, ms: number, raw: string): ProbeResult {
  const parsed = parseChat(raw, p);
  const empty = parsed.text.length === 0;
  return {
    target: t.name, prompt: p.id, ms,
    ...parsed,
    ok: !empty,
    text: clip(parsed.text, 400),
    ...(empty ? { error: "empty content: " + clip(raw, 160) } : {}),
  };
}

async function probeOpenAi(t: OpenAiTarget, p: PromptSpec, timeoutMs: number, maxTokensOverride?: number): Promise<ProbeResult> {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(t.baseURL.replace(/\/+$/, "") + "/chat/completions", {
      method: "POST",
      headers: requestHeaders(t),
      body: requestBody(t, p, maxTokensOverride),
      signal: ctl.signal,
    });
    const raw = await r.text();
    const ms = Date.now() - t0;
    if (!r.ok) return { target: t.name, prompt: p.id, ok: false, ms, error: `HTTP ${r.status}: ${clip(raw, 200)}` };
    return chatResult(t, p, ms, raw);
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return { target: t.name, prompt: p.id, ok: false, ms: Date.now() - t0, error: aborted ? `timeout ${timeoutMs}ms` : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}

function firstChoice(body: Record<string, unknown>): { message?: { content?: unknown; reasoning_content?: unknown }; finishReason?: string } | undefined {
  const choices = body["choices"];
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const first = choices[0];
  if (first === null || typeof first !== "object") return undefined;
  const rec = first as Record<string, unknown>;
  const msg = rec["message"];
  const finish = typeof rec["finish_reason"] === "string" ? rec["finish_reason"] : undefined;
  return {
    ...(msg !== null && typeof msg === "object" ? { message: msg as { content?: unknown; reasoning_content?: unknown } } : {}),
    ...(finish !== undefined ? { finishReason: finish } : {}),
  };
}

function clip(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "…";
}

function startProcess(t: AcpTarget): ReturnType<typeof spawn> {
  try {
    // t 来自本脚本读取的 var/provider-probe.json（开发者自填本机 ACP 命令），无网络输入汇入。
    return spawn(t.command, [...(t.args ?? [])], { stdio: ["pipe", "pipe", "pipe"], cwd: t.cwd ?? "/tmp" }); // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
  } catch (e) {
    throw new Error(`cannot start ${t.command}: ${String(e instanceof Error ? e.message : e)}`);
  }
}

/** 极简 ACP 客户端：spawn 一次，逐 prompt 新建会话并选模型（避免历史污染）。 */
class AcpClient {
  private readonly child: ReturnType<typeof spawn>;
  private readonly stdin: NonNullable<ReturnType<typeof spawn>["stdin"]>;
  private readonly t: AcpTarget;
  private buf = "";
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private updates: Array<Record<string, unknown>> = [];
  private readonly stderrTail: string[] = [];

  constructor(t: AcpTarget) {
    this.t = t;
    const child = startProcess(t);
    if (child.stdout === null || child.stderr === null || child.stdin === null) {
      throw new Error("acp child stdio unavailable");
    }
    this.child = child;
    this.stdin = child.stdin;
    child.stdout.on("data", (d: Buffer) => this.onData(d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => {
      this.stderrTail.push(d.toString("utf8"));
      if (this.stderrTail.length > 40) this.stderrTail.shift();
    });
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    for (;;) {
      const idx = this.buf.indexOf("\n");
      if (idx < 0) return;
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (line === "") continue;
      const msg = safeJson(line);
      if (msg === null) continue;
      if (this.settle(msg)) continue;
      this.handleServerRequest(msg);
    }
  }

  private settle(msg: Record<string, unknown>): boolean {
    const id = msg["id"];
    if (typeof id !== "number") return false;
    const p = this.pending.get(id);
    if (p === undefined) return false;
    if (!("result" in msg) && !("error" in msg)) return false;
    this.pending.delete(id);
    clearTimeout(p.timer);
    const err = msg["error"];
    if (err !== undefined) p.reject(new Error(err !== null && typeof err === "object" && typeof (err as Record<string, unknown>)["message"] === "string" ? String((err as Record<string, unknown>)["message"]) : JSON.stringify(err)));
    else p.resolve(msg["result"]);
    return true;
  }

  private handleServerRequest(msg: Record<string, unknown>): void {
    const method = msg["method"];
    const id = msg["id"];
    if (method === "session/update") {
      const params = msg["params"];
      if (params !== null && typeof params === "object") this.updates.push(params as Record<string, unknown>);
      return;
    }
    if (typeof id !== "number") return;
    if (method === "session/request_permission") {
      const params = msg["params"];
      const options = params !== null && typeof params === "object" ? (params as Record<string, unknown>)["options"] : undefined;
      const list = Array.isArray(options) ? options : [];
      const first = list.find((o) => o !== null && typeof o === "object" && typeof (o as Record<string, unknown>)["optionId"] === "string");
      const optionId = first !== undefined ? (first as Record<string, unknown>)["optionId"] : undefined;
      this.reply(id, typeof optionId === "string" ? { outcome: { outcome: "selected", optionId } } : { outcome: { outcome: "cancelled" } });
      return;
    }
    this.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "not supported by probe" } }) + "\n");
  }

  private reply(id: number, result: unknown): void {
    this.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  }

  request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => { this.pending.delete(id); rej(new Error(`timeout ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve: res, reject: rej, timer });
      this.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  async start(): Promise<void> {
    await new Promise((r) => setTimeout(r, 1200));
    await this.request("initialize", { protocolVersion: 1, clientCapabilities: {} }, 60_000);
  }

  async promptOnce(p: PromptSpec, timeoutMs: number): Promise<ProbeResult> {
    const t0 = Date.now();
    try {
      const session = await this.request("session/new", { cwd: this.t.cwd ?? "/tmp", mcpServers: [] }, 60_000);
      const { sessionId, configId, hasConfig } = sessionInfo(session);
      if (sessionId === undefined) return { target: this.t.name, prompt: p.id, ok: false, ms: Date.now() - t0, error: "session/new returned no sessionId" };
      if (hasConfig && configId !== undefined) {
        await this.request("session/set_config_option", { sessionId, configId, value: this.t.model }, 20_000);
      } else {
        await this.request("session/set_model", { sessionId, modelId: this.t.model }, 20_000);
      }
      const mark = this.updates.length;
      const r = await this.request("session/prompt", { sessionId, prompt: [{ type: "text", text: expandPrompt(p) }] }, timeoutMs);
      const text = textOf(this.updates.slice(mark));
      const stop = r !== null && typeof r === "object" ? (r as Record<string, unknown>)["stopReason"] : undefined;
      const pass = judge(p, text);
      return {
        target: this.t.name, prompt: p.id, ok: text.length > 0, ms: Date.now() - t0, text: clip(text, 400),
        ...(pass !== undefined ? { pass } : {}),
        ...(text.length > 0 ? {} : { error: `empty agent text (stopReason=${String(stop)}); stderr=${clip(this.stderrTail.join("").replace(/\s+/g, " "), 200)}` }),
      };
    } catch (e) {
      return { target: this.t.name, prompt: p.id, ok: false, ms: Date.now() - t0, error: String(e instanceof Error ? e.message : e) };
    }
  }

  close(): void { this.child.kill("SIGKILL"); }
}

function sessionInfo(session: unknown): { sessionId?: string; configId?: string; hasConfig: boolean } {
  if (session === null || typeof session !== "object") return { hasConfig: false };
  const s = session as Record<string, unknown>;
  const id = typeof s["sessionId"] === "string" ? s["sessionId"] : undefined;
  const opts = Array.isArray(s["configOptions"]) ? s["configOptions"] : [];
  const modelOpt = opts.find((o) => o !== null && typeof o === "object" && ((o as Record<string, unknown>)["category"] === "model" || (o as Record<string, unknown>)["id"] === "model"));
  const configId = modelOpt !== undefined ? (modelOpt as Record<string, unknown>)["id"] : undefined;
  return { ...(id !== undefined ? { sessionId: id } : {}), hasConfig: modelOpt !== undefined, ...(typeof configId === "string" ? { configId } : {}) };
}

function textOf(updates: readonly Record<string, unknown>[]): string {
  const out: string[] = [];
  for (const u of updates) {
    const body = u["update"] !== null && typeof u["update"] === "object" ? (u["update"] as Record<string, unknown>) : u;
    const content = body["content"];
    if (content !== null && typeof content === "object" && typeof (content as Record<string, unknown>)["text"] === "string") {
      out.push(String((content as Record<string, unknown>)["text"]));
    }
  }
  return out.join("").replace(/\s+/g, " ").trim();
}

function argOf(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

function setOf(raw: string | undefined): Set<string> | null {
  return raw === undefined ? null : new Set(raw.split(",").map((s) => s.trim()));
}

function loadConfig(): ProbeConfig {
  const cfgPath = resolve(argOf("--config", "var/provider-probe.json")!);
  if (!existsSync(cfgPath)) {
    console.error(`config not found: ${cfgPath}`);
    process.exit(2);
  }
  try {
    return JSON.parse(readFileSync(cfgPath, "utf8")) as ProbeConfig;
  } catch (e) {
    console.error(`config unreadable: ${cfgPath}: ${String(e instanceof Error ? e.message : e)}`);
    process.exit(2);
  }
}

async function probeOpenAiTarget(t: OpenAiTarget, prompts: readonly PromptSpec[], repeat: number, timeoutMs: number, maxTokens?: number): Promise<ProbeResult[]> {
  const out: ProbeResult[] = [];
  for (let i = 0; i < repeat; i++) for (const p of prompts) out.push(await probeOpenAi(t, p, timeoutMs, maxTokens));
  return out;
}

async function probeAcpTarget(t: AcpTarget, prompts: readonly PromptSpec[], repeat: number, timeoutMs: number): Promise<ProbeResult[]> {
  const out: ProbeResult[] = [];
  let client: AcpClient | null = null;
  try {
    client = new AcpClient(t);
    await client.start();
    for (let i = 0; i < repeat; i++) for (const p of prompts) out.push(await client.promptOnce(p, timeoutMs));
  } catch (e) {
    out.push({ target: t.name, prompt: "-", ok: false, ms: 0, error: `startup failed: ${String(e instanceof Error ? e.message : e)}` });
  } finally {
    client?.close();
  }
  return out;
}

async function probeTarget(t: Target, prompts: readonly PromptSpec[], repeat: number, timeoutMs: number, maxTokens?: number): Promise<ProbeResult[]> {
  return t.kind === "openai"
    ? probeOpenAiTarget(t, prompts, repeat, timeoutMs, maxTokens)
    : probeAcpTarget(t, prompts, repeat, timeoutMs);
}

function writeResults(outPath: string, results: readonly ProbeResult[]): void {
  const payload = JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2) + "\n";
  try {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, payload, "utf8");
  } catch (e) {
    console.error(`cannot write ${outPath}: ${String(e instanceof Error ? e.message : e)}`);
    process.exit(2);
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const promptFilter = setOf(argOf("--prompts"));
  const only = setOf(argOf("--only"));
  const prompts = cfg.prompts.filter((p) => promptFilter === null || promptFilter.has(p.id));
  const targets = cfg.targets.filter((t) => only === null || only.has(t.name));
  const repeat = Number(argOf("--repeat", "1"));
  const timeoutMs = Number(argOf("--timeout", String(cfg.timeoutMs ?? 120_000)));
  const maxTokensRaw = argOf("--max-tokens");
  const maxTokens = maxTokensRaw === undefined ? undefined : Number(maxTokensRaw);

  const results: ProbeResult[] = [];
  for (const t of targets) results.push(...(await probeTarget(t, prompts, repeat, timeoutMs, maxTokens)));

  const outPath = resolve(argOf("--out", "var/provider-probe-result.json")!);
  writeResults(outPath, results);
  printSummary(results);
  console.log(`\nresult: ${outPath}`);
}

function groupByTarget(results: readonly ProbeResult[]): Map<string, ProbeResult[]> {
  const byTarget = new Map<string, ProbeResult[]>();
  for (const r of results) {
    const arr = byTarget.get(r.target) ?? [];
    arr.push(r);
    byTarget.set(r.target, arr);
  }
  return byTarget;
}

function median(rows: readonly ProbeResult[]): number {
  const lat = rows.map((r) => r.ms).sort((a, b) => a - b);
  return lat.length === 0 ? 0 : lat[Math.floor(lat.length / 2)]!;
}

function statusFlags(r: ProbeResult): string {
  const okFlag = r.ok ? "ok" : "FAIL";
  return r.pass === undefined ? okFlag : `${okFlag} ${r.pass ? "pass" : "MISMATCH"}`;
}

function formatRow(r: ProbeResult): string {
  const tokens = r.promptTokens === undefined ? "" : ` pt=${r.promptTokens}`;
  const detail = r.error !== undefined ? ` ${r.error}` : ` ${clip(r.text ?? "", 70)}`;
  return `  ${r.prompt.padEnd(14)} ${statusFlags(r).padEnd(14)} ${String(r.ms).padStart(6)}ms${tokens}${detail}`;
}

function printTarget(target: string, rows: readonly ProbeResult[]): void {
  const ok = rows.filter((r) => r.ok).length;
  const pass = rows.filter((r) => r.pass === true).length;
  const judged = rows.filter((r) => r.pass !== undefined).length;
  console.log(`\n== ${target}  ok ${ok}/${rows.length}  pass ${pass}/${judged}  p50 ${median(rows)}ms`);
  for (const r of rows) console.log(formatRow(r));
}

function printTokenDrift(results: readonly ProbeResult[]): void {
  const fp = new Map<string, Set<number>>();
  for (const r of results) {
    if (r.promptTokens === undefined) continue;
    const set = fp.get(r.prompt) ?? new Set<number>();
    set.add(r.promptTokens);
    fp.set(r.prompt, set);
  }
  const drift = [...fp.entries()].filter(([, s]) => s.size > 1);
  if (drift.length === 0) return;
  console.log("\n[norm] prompt_tokens 跨 target 不一致（tokenizer 差异属正常，同家族漂移才可疑）:");
  for (const [prompt, s] of drift) console.log(`  ${prompt}: ${[...s].join(", ")}`);
}

function printSummary(results: readonly ProbeResult[]): void {
  for (const [target, rows] of groupByTarget(results)) printTarget(target, rows);
  printTokenDrift(results);
}

await main();
