// @no-test-required: var/ 一次性本地采集工具（sprint gate 工具，非 src/ 运行时代码）
// var/canary-split.ts — G-CANARY #E 录制切分与校验：raw-exchanges.jsonl → session-NN.json
//
// 格式契约与字段→判据对应见 .sprint-state/g-canary-recording-spec.md。
// 用法：
//   node var/canary-split.ts                 # 切分 + 写 var/canary-sessions/session-NN.json + 出核对清单
//   node var/canary-split.ts --dry-run       # 只出报告，不写文件
//   node var/canary-split.ts --require 10    # 少于 10 个会话则退出码 1（门关判据）
//   node var/canary-split.ts --check         # 校验已落盘的 session-NN.json 是否符合规格，不回读 jsonl
// 选项：--in <jsonl> --out-dir <dir> --client <opencode|delphi>（强制标注全部会话）

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";

const argv = process.argv.slice(2);
const flagOf = (f: string) => argv.includes(f);
const argOf = (f: string, def: string) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};

const IN = argOf("--in", "var/canary-sessions/raw-exchanges.jsonl");
const OUT_DIR = argOf("--out-dir", "var/canary-sessions");
const REQUIRE = Number(argOf("--require", "10"));
const DRY_RUN = flagOf("--dry-run");
const CHECK_ONLY = flagOf("--check");
const FORCE_CLIENT = (() => {
  const v = argOf("--client", "");
  return v === "opencode" || v === "delphi" ? (v as "opencode" | "delphi") : null;
})();

type Raw = {
  capture_seq?: number;
  ts: string;
  method: string;
  path: string;
  request_headers?: Record<string, string>;
  request_body: string;
  response_status: number;
  content_type?: string | null;
  response_body: string;
  truncated?: boolean;
};

type Exchange = {
  request_body: Record<string, unknown>;
  response_status: number;
  response: Record<string, unknown>;
};

type Session = { key: string; model: string; client: string; exchanges: Exchange[] };

// 会话归组：真实 agent 循环的上下文单调增长，故"上一轮的 messages 是本轮的真前缀"即同会话；
// 单轮重复请求（如 delphi 三家各一次）不构成前缀延长，各成一会话。
// 合并另要求 model 与 client 同时一致：client 判定不同的请求不并入既有会话，避免跨客户端误并。
// 两侧先各自 stringify 成串再比较（stringify 是确定性计算，缓存不改变结果）。
function isContinuation(prev: string[], cur: string[]): boolean {
  if (cur.length <= prev.length) return false;
  for (let i = 0; i < prev.length; i++) {
    if (prev[i] !== cur[i]) return false;
  }
  return true;
}

function looksLikeChat(path: string, method: string): boolean {
  if (method.toUpperCase() !== "POST") return false;
  return /\/(chat\/completions|completions|messages)\/?$/.test(path);
}

function detectClient(rec: Raw, body: Record<string, unknown>): string {
  if (FORCE_CLIENT) return FORCE_CLIENT;
  const path = rec.path ?? "";
  if (path.includes("/opencode/")) return "opencode";
  const ua = (rec.request_headers?.["user-agent"] ?? "").toLowerCase();
  if (/opencode/.test(ua)) return "opencode";
  if (/node|undici|axios/.test(ua)) return "delphi";
  const msgs = JSON.stringify(body.messages ?? body.system ?? "");
  if (/Delphi|delphi-review|专家|APPROVED/.test(msgs)) return "delphi";
  return "unknown";
}

type Parsed = { response: Record<string, unknown>; finish: string | null; streamed: boolean };

function sseFrames(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .filter((d) => d.length > 0 && d !== "[DONE]");
}

/** 响应解析入口：SSE / 非流式两路各自成函数（原文的判定与解析混在一处 CCN 超 15）。 */
function parseResponse(rec: Raw): Parsed {
  const text = rec.response_body ?? "";
  return isSse(rec, text) ? parseStreamed(text) : parseNonStreamed(text);
}

function isSse(rec: Raw, text: string): boolean {
  const ct = (rec.content_type ?? "").toLowerCase();
  return ct.includes("text/event-stream") || text.startsWith("data:") || text.includes("\ndata:");
}

function parseStreamed(text: string): Parsed {
  const frames = sseFrames(text);
  let finish: string | null = null;
  for (const f of frames) finish = finishOfFrame(f) ?? finish;
  return { response: { chunks: frames }, finish, streamed: true };
}

/** 单帧 finish_reason（非 JSON 帧忽略——原文仍保留在 chunks 里）。 */
function finishOfFrame(frame: string): string | null {
  try {
    const o = JSON.parse(frame) as Record<string, any>;
    const r = o?.choices?.[0]?.finish_reason ?? o?.delta?.stop_reason ?? o?.stop_reason ?? null;
    return r ? String(r) : null;
  } catch {
    return null;
  }
}

function parseNonStreamed(text: string): Parsed {
  const o = parseJsonObject(text);
  if (o === null) return { response: { raw: text }, finish: null, streamed: false };
  const choice = o.choices?.[0];
  const finish = choice?.finish_reason ?? o.stop_reason ?? null;
  const response: Record<string, unknown> = { finish_reason: finish, content: contentOf(o, choice) };
  const reasoning = choice?.message?.reasoning_content;
  if (reasoning) response.reasoning_content = reasoning;
  if (choice?.message?.tool_calls) response.tool_calls = choice.message.tool_calls;
  return { response, finish: finish ?? null, streamed: false };
}

function parseJsonObject(text: string): Record<string, any> | null {
  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    return null;
  }
}

/** content 提取：message.content 优先，其次顶层 content（字符串或 blocks 数组拼接）。 */
function contentOf(o: Record<string, any>, choice: any): string {
  const content =
    choice?.message?.content ??
    (Array.isArray(o.content) ? o.content.map((b: any) => b?.text ?? "").join("") : o.content) ??
    "";
  return typeof content === "string" ? content : JSON.stringify(content);
}

function sha(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

let corruptLines = 0;

// 逐行流式读：录制文件已达数百 MB，readFileSync 整体成串会撞 V8 单字符串 512MB 上限（ERR_STRING_TOO_LONG）
async function loadRaw(): Promise<Raw[]> {
  if (!existsSync(IN)) {
    console.error(`[split] 找不到 ${IN}——capture-proxy 未采集或路径不对`);
    process.exit(1);
  }
  const out: Raw[] = [];
  const rl = createInterface({
    input: createReadStream(IN, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const l of rl) {
    if (!l.trim()) continue;
    try {
      out.push(JSON.parse(l) as Raw);
    } catch {
      // 整机被硬切（WSL panic / 断电）时最后半行会留在文件里；坏行剔除，其余照常成判据
      corruptLines++;
    }
  }
  return out;
}

function buildSessions(raws: Raw[]): { sessions: Session[]; skipped: string[] } {
  const sessions: Session[] = [];
  const skipped: string[] = [];
  // 800+ 条交换 × MB 级 body 下逐次 stringify 是平方级开销；每会话缓存其末轮 messages 的串
  const prevCache = new Map<Session, string[]>();
  const strsOf = (s: Session): string[] => {
    let c = prevCache.get(s);
    if (!c) {
      c = lastMessages(s).map((m) => JSON.stringify(m));
      prevCache.set(s, c);
    }
    return c;
  };

  const chat = raws
    .filter((r) => {
      if (r.truncated) {
        skipped.push(`#${r.capture_seq ?? "?"} ${r.path} -> ${r.response_status}（客户端中断/截断，不计入判据）`);
        return false;
      }
      if (looksLikeChat(r.path, r.method)) return true;
      skipped.push(`#${r.capture_seq ?? "?"} ${r.method} ${r.path} -> ${r.response_status}（非 chat 请求）`);
      return false;
    })
    .sort((a, b) => String(a.ts).localeCompare(String(b.ts)));

  for (const rec of chat) {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rec.request_body) as Record<string, unknown>;
    } catch {
      skipped.push(`#${rec.capture_seq} ${rec.path}：request_body 非 JSON，丢弃`);
      continue;
    }
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const model = String(body.model ?? "unknown-model");
    const client = detectClient(rec, body);
    const ex: Exchange = {
      request_body: body,
      response_status: rec.response_status,
      response: parseResponse(rec).response,
    };
    const curStrs = messages.map((m) => JSON.stringify(m));
    const cand = [...sessions]
      .reverse()
      .find(
        (s) =>
          s.client === client && s.model === model && isContinuation(strsOf(s), curStrs),
      );
    if (cand) {
      cand.exchanges.push(ex);
      prevCache.delete(cand);
    } else {
      sessions.push({
        key: sha(`${model}|${sessions.length}|${rec.ts}`),
        model,
        client,
        exchanges: [ex],
      });
    }
  }
  return { sessions, skipped };
}

function lastMessages(s: Session): unknown[] {
  const b = s.exchanges[s.exchanges.length - 1]?.request_body as Record<string, unknown> | undefined;
  return Array.isArray(b?.messages) ? (b!.messages as unknown[]) : [];
}

function pick(sessions: Session[], n: number): Session[] {
  return [...sessions]
    .sort((a, b) => b.exchanges.length - a.exchanges.length || (a.client === "unknown" ? 1 : 0) - (b.client === "unknown" ? 1 : 0))
    .slice(0, n);
}

function validate(sessions: Session[]): string[] {
  const problems: string[] = [];
  for (const s of sessions) {
    if (s.client !== "opencode" && s.client !== "delphi") {
      problems.push(`${s.key}: client=${s.client}（规格要求 opencode|delphi，用 --client 标注）`);
    }
    if (s.exchanges.length < 1) problems.push(`${s.key}: exchanges 为空`);
    for (const [i, ex] of s.exchanges.entries()) {
      const r = ex.response as Record<string, any>;
      if (r.chunks) {
        const hasTerm = r.chunks.some((c: string) => /"(finish_reason|stop_reason)"\s*:\s*"[^"]+"/.test(c));
        if (!hasTerm) problems.push(`${s.key} exchange#${i + 1}: 流式 chunks 缺含 finish_reason 的终止帧`);
      } else if (!("finish_reason" in r)) {
        problems.push(`${s.key} exchange#${i + 1}: 非流式响应缺 finish_reason（raw 体？)`);
      }
      if (typeof ex.response_status !== "number") problems.push(`${s.key} exchange#${i + 1}: response_status 缺失`);
    }
  }
  return problems;
}

function report(sessions: Session[], skipped: string[], problems: string[]): void {
  const all = sessions.flatMap((s) => s.exchanges);
  const fr = new Map<string, number>();
  let streamed = 0;
  for (const ex of all) {
    const r = ex.response as Record<string, any>;
    if (r.chunks) streamed++;
    const f = r.chunks
      ? [...r.chunks].reverse().find((c: string) => /"(finish_reason|stop_reason)"\s*:\s*"[^"]+"/.test(c))
      : null;
    let label: string;
    if (f) {
      const m = String(f).match(/"(?:finish_reason|stop_reason)"\s*:\s*"([^"]+)"/);
      label = m ? m[1] : "?";
    } else label = String(r.finish_reason ?? "none");
    fr.set(label, (fr.get(label) ?? 0) + 1);
  }
  const rejected = all.filter((ex) => ex.response_status < 200 || ex.response_status >= 300);

  console.log("── G-CANARY #E 录制核对清单 ──");
  console.log(`会话数: ${sessions.length}（要求 ≥${REQUIRE}）  交换数: ${all.length}  其中流式: ${streamed}`);
  for (const s of sessions) {
    const first = s.exchanges[0]?.response as Record<string, any>;
    console.log(
      `  ${s.key} client=${s.client} model=${s.model} exchanges=${s.exchanges.length} ` +
        `status=${s.exchanges.map((e) => e.response_status).join(",")} ` +
        `body=${first?.chunks ? `chunks:${first.chunks.length}` : JSON.stringify(String(first?.content ?? "")).slice(0, 40)}`,
    );
  }
  console.log(`finish_reason 分布（基线臂）: ${[...fr.entries()].map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(`provider 拒绝样本（非 2xx，判据②输入）: ${rejected.length}/${all.length}`);
  if (corruptLines) console.log(`坏行剔除: ${corruptLines} 行（JSON 不完整，通常由采集进程被硬切造成）`);
  if (skipped.length) console.log(`丢弃: ${skipped.length} 条\n` + skipped.slice(0, 8).map((s) => `  - ${s}`).join("\n"));
  if (problems.length) {
    console.log(`规格问题: ${problems.length}`);
    for (const p of problems.slice(0, 20)) console.log(`  ! ${p}`);
  } else console.log("规格问题: 0");
}

/** CHECK_ONLY：读取已落盘的 session 文件；读/解析失败带出目录，避免只看到裸 JSON 语法错。 */
function loadExistingSessions(): Session[] {
  if (!existsSync(OUT_DIR)) return [];
  try {
    return readdirSync(OUT_DIR)
      .filter((f) => /^session-\d+\.json$/.test(f))
      .sort()
      .map((f) => {
        const o = JSON.parse(readFileSync(`${OUT_DIR}/${f}`, "utf8")) as { session_id: string } & Omit<Session, "key">;
        return { key: o.session_id, client: o.client, model: o.model, exchanges: o.exchanges };
      });
  } catch (err) {
    throw new Error(`读取 ${OUT_DIR}/session-*.json 失败: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

/** 写盘：目录缺失即建；任一文件写失败抛出带目录上下文的错误（避免半套文件静默留下）。 */
function writeSessions(named: readonly Session[]): void {
  try {
    mkdirSync(OUT_DIR, { recursive: true });
    for (const s of named) {
      const out = {
        session_id: s.key,
        client: s.client,
        model: s.model,
        exchanges: s.exchanges,
      };
      writeFileSync(`${OUT_DIR}/${s.key}.json`, JSON.stringify(out, null, 2) + "\n", "utf8");
    }
  } catch (err) {
    throw new Error(`写入 ${OUT_DIR}/session-*.json 失败: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

async function main(): Promise<void> {
  if (CHECK_ONLY) {
    const sessions = loadExistingSessions();
    console.log(`已有 session 文件: ${sessions.length}（${sessions.map((s) => `${s.key}.json`).join(", ") || "无"}）`);
    const problems = validate(sessions);
    report(sessions, [], problems);
    if (sessions.length < REQUIRE) {
      console.error(`\nG-CANARY #E 未达标：${sessions.length}/${REQUIRE}`);
      process.exit(1);
    }
    return;
  }

  const { sessions: all, skipped } = buildSessions(await loadRaw());
  const chosen = pick(all, REQUIRE);
  const named: Session[] = chosen.map((s, i) => ({ ...s, key: `session-${String(i + 1).padStart(2, "0")}` }));
  const problems = validate(named);

  report(named, skipped, problems);
  if (all.length > chosen.length) {
    console.log(`注：共识别 ${all.length} 个会话，取 exchanges 最多的 ${chosen.length} 个（多余 ${all.length - chosen.length} 个未写盘）`);
  }

  if (DRY_RUN) {
    console.log("\n--dry-run：未写文件");
    return;
  }
  writeSessions(named);
  console.log(`\n已写 ${named.length} 个文件到 ${OUT_DIR}/session-*.json（var/ 已 gitignore，不入 git）`);

  if (named.length < REQUIRE) {
    console.error(`G-CANARY #E 未达标：${named.length}/${REQUIRE} —— 继续经 capture-proxy 聊真实会话`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
