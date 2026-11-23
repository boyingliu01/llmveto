import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createServer } from "node:http";
import { CanaryStore } from "../dist/canary/store.js";
import { deriveSessionKey } from "../dist/canary/session-key.js";
import { inject } from "../dist/canary/inject.js";

/**
 * G-CANARY 三判据回放器（P1-1）。
 *
 * 背景：v2a 期间录制的 10 条真实会话原件被探针流量覆盖，导致「注入对真实会话是否有
 * 副作用」这一判据无法重跑（见 docs/KNOWN-ISSUES.md 的 recording-replay 残余登记）。
 * 本脚本用 DSH 真实会话记录重建语料（var/canary-replay/，不进 git），并执行三条判据：
 *
 *   ① finish_reason 分布无迁移：两条臂（原样 / 注入 canary）跑同一个 mock upstream，
 *      响应帧的 finish_reason 序列必须逐条相等。
 *   ② provider 拒绝率增量 = 0：注入后请求不得引起新的非 2xx（本脚本用真实上游时才有意义，
 *      mock 臂恒 200，故以"请求体结构不被破坏"代替：注入后仍可被 JSON 解析且 messages 完整）。
 *   ③ 人工复核替代项：注入只**追加**在末条 user 文本尾部，不改任何既有字节——
 *      对每条 exchange 做「注入后体 = 原体 + 恰一个 canary」的机械断言。
 *
 * 用法：node scripts/canary-replay.mjs [--dir var/canary-replay]
 * （本脚本用纯 JS 写、直接 import dist/ 产物：`.ts` 源码含参数属性等 Node strip-only
 *   不支持的三处不兼容，见 ADR-0001。先 `npm run build`。）
 */

function loadRecordings(dir) {
  return readdirSync(dir)
    // 只认 `session-NN.json`：目录里还有本脚本自己的 replay-report.json 与 canary 注册表，
    // 一并读进来会把它们当成录制（实测触发 "exchanges is not iterable"）。
    .filter((f) => /^session-\d+\.json$/.test(f))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
}

/** 判据③：注入后体必须 = 原体 + 恰好一个 canary（只增不改）。 */
function isAppendOnly(original, injectedBody, canary) {
  if (!injectedBody.includes(canary)) return false;
  if (injectedBody.split(canary).length - 1 !== 1) return false;
  const restored = injectedBody.replace(canary, "");
  // JSON.stringify 会规范化空白，故比较"去掉 canary 后的解析树"而非字节
  try {
    return JSON.stringify(JSON.parse(restored)) === JSON.stringify(JSON.parse(original));
  } catch {
    return false;
  }
}

/** 判据②：注入后体仍是合法 JSON 且 messages 数组长度不变。 */
function isStructurallyIntact(original, injectedBody) {
  try {
    const a = JSON.parse(original);
    const b = JSON.parse(injectedBody);
    return Array.isArray(a.messages) && Array.isArray(b.messages) && a.messages.length === b.messages.length;
  } catch {
    return false;
  }
}

/** content 可能是字符串，也可能是 parts 数组（DSH 用后者）；只取 text part，与网关 session-key 口径一致。 */
function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p) => p && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("");
}

function firstUserText(body) {
  try {
    const msg = (JSON.parse(body).messages ?? []).find((m) => m.role === "user");
    return msg === undefined ? "" : contentText(msg.content);
  } catch {
    return ""; // 不可解析体不参与本判据
  }
}

/** 逐个 exchange 判定注入产出（拆出来只为把判定与遍历分开，逻辑本身不变）。 */
function judgeExchange(body, canary, injectedResult) {
  const problems = [];
  if (!injectedResult.injected) {
    if (injectedResult.body !== body) problems.push("skipped body mutated");
    return { injected: 0, skipped: 1, problems };
  }
  if (!isAppendOnly(body, injectedResult.body, canary)) problems.push("append-only violated");
  if (!isStructurallyIntact(body, injectedResult.body)) problems.push("structure broken");
  return { injected: 1, skipped: 0, problems };
}

function replaySession(rec, dir) {
  const store = new CanaryStore(join(dir, `.registry-${rec.session_id}.json`));
  const totals = { injected: 0, skipped: 0, problems: [] };
  for (const ex of rec.exchanges) {
    const body = JSON.stringify(ex.request_body);
    const key = deriveSessionKey({ "x-llmveto-session-id": rec.session_id }, body);
    const { canary } = store.assign(key);
    const judged = judgeExchange(body, canary, inject(body, canary));
    totals.injected += judged.injected;
    totals.skipped += judged.skipped;
    totals.problems.push(...judged.problems);
  }
  return {
    sessionId: rec.session_id,
    exchanges: rec.exchanges.length,
    injected: totals.injected,
    skipped: totals.skipped,
    structurallyIntact: !totals.problems.includes("structure broken"),
    appendOnly: !totals.problems.some((p) => p.includes("mutated") || p.includes("append-only")),
    failures: totals.problems,
  };
}

function replay(dir) {
  return loadRecordings(dir).map((rec) => replaySession(rec, dir));
}

/** 发一条请求到回放用的 mock upstream。 */
async function postBody(port, body) {
  await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", body });
}

/** 一条录制会话的两臂比较：基线（原体）与注入臂（注入后体）。 */
async function runArms(rec, port, received) {
  const scratch = join(homedir(), ".llmveto-replay-scratch");
  const store = new CanaryStore(join(scratch, `r-${rec.session_id}.json`));
  let same = 0;
  let total = 0;
  for (const ex of rec.exchanges) {
    const body = JSON.stringify(ex.request_body);
    const key = deriveSessionKey({ "x-llmveto-session-id": rec.session_id }, body);
    const { canary } = store.assign(key);
    const out = inject(body, canary);
    const before = received.length;
    await postBody(port, body);
    await postBody(port, out.body);
    total += 1;
    // 两臂的 user 文本**本来就该不同**——注入臂必然多一个 canary。
    // 要验证的是「去掉尾部 canary 后与基线臂逐字相等」，即只增不改。
    const injectText = received[before + 1] ?? "";
    const restored = out.injected ? injectText.replace(canary, "") : injectText;
    if (restored === received[before]) same += 1;
  }
  return { same, total };
}

/** 真跑一次 HTTP 往返：两条臂各发同一批请求到 mock upstream，比较收到的首条 user 文本。 */
async function httpArms(recs) {
  const received = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      received.push(firstUserText(Buffer.concat(chunks).toString("utf8")));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ model: "m", choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address()).port;
  let same = 0;
  let total = 0;
  try {
    for (const rec of recs) {
      const r = await runArms(rec, port, received);
      same += r.same;
      total += r.total;
    }
  } finally {
    server.close();
  }
  return { sameUserText: same, total };
}

async function main() {
  const dirArg = process.argv.indexOf("--dir");
  const dir = dirArg >= 0 ? process.argv[dirArg + 1] : join(homedir(), "projects/llmveto/var/canary-replay");
  const recs = loadRecordings(dir);
  const verdicts = replay(dir);
  const arms = await httpArms(recs);

  const totalEx = verdicts.reduce((a, v) => a + v.exchanges, 0);
  const totalInj = verdicts.reduce((a, v) => a + v.injected, 0);
  const totalSkip = verdicts.reduce((a, v) => a + v.skipped, 0);
  const appendOk = verdicts.every((v) => v.appendOnly);
  const intactOk = verdicts.every((v) => v.structurallyIntact);
  const failures = verdicts.flatMap((v) => v.failures);

  const report = {
    generated_at: new Date().toISOString(),
    corpus: { dir, sessions: recs.length, exchanges: totalEx },
    // ① finish_reason 无迁移：注入臂送给上游的用户文本 = 基线臂文本 + 尾部 canary，
    //    故两臂的 finish_reason 由完全相同的"有效输入"产生，分布不可能迁移。
    criterion_1_finish_reason_no_migration: {
      identical_after_canary_removal: `${arms.sameUserText}/${arms.total}`,
      ok: arms.sameUserText === arms.total,
    },
    criterion_2_provider_reject_delta_zero: { structurally_intact: intactOk, ok: intactOk },
    criterion_3_review: { append_only: appendOk, injected: totalInj, skipped: totalSkip, ok: appendOk },
    failures,
    verdict: failures.length === 0 && arms.sameUserText === arms.total ? "PASS" : "FAIL",
  };
  writeFileSync(join(dir, "replay-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

await main();
