// @no-test-required: var/ 一次性本地采集工具（sprint gate 工具，非 src/ 运行时代码），链路已人工烟测
// var/capture-proxy.ts — G-CANARY #E 录制采集代理（sprint-2026-09-27-01）
//
// 链路：opencode/delphi → 本代理(默认 127.0.0.1:8790) → v1 网关(默认 127.0.0.1:8787) → provider
// 每次请求-响应对写一行 JSONL 到 var/canary-sessions/raw-exchanges.jsonl（var/ 已 gitignore，不入仓库）。
// 凭据类头仅在"写入的记录"里打码为 [STRIPPED]，转发给上游时不做任何改动。
// 真实性优先：请求/响应原文原样落盘，SSE 流按收到的字节累积，解析与分session由后续脚本做。
//
// 用法：
//   node var/capture-proxy.ts [--port 8790] [--upstream http://127.0.0.1:8787] \
//        [--out var/canary-sessions/raw-exchanges.jsonl]
// 停止：Ctrl-C。10 条真实会话聊完后，由 orchestrator 分割成 session-NN.json（规格见
// .sprint-state/g-canary-recording-spec.md）。

import { createServer, request as httpRequest } from "node:http";
import type { IncomingMessage } from "node:http";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const args = process.argv.slice(2);
function argOf(flag: string, def: string): string {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const PORT = Number(argOf("--port", "8790"));
const UPSTREAM = argOf("--upstream", "http://127.0.0.1:8787");
const OUT = argOf("--out", "var/canary-sessions/raw-exchanges.jsonl");
mkdirSync(dirname(OUT), { recursive: true });

const AUTH_HEADERS = new Set([
  "authorization",
  "x-api-key",
  "api-key",
  "x-goog-api-key",
  "proxy-authorization",
  "cookie",
]);

const upstream = new URL(UPSTREAM);

function filterHeaders(h: IncomingMessage["headers"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    out[k] = AUTH_HEADERS.has(k.toLowerCase())
      ? "[STRIPPED]"
      : Array.isArray(v)
        ? v.join(", ")
        : String(v);
  }
  return out;
}

let seq = 0;

createServer((req, res) => {
  const reqChunks: Buffer[] = [];
  req.on("data", (c: Buffer) => reqChunks.push(c));
  req.on("end", () => {
    const reqBody = Buffer.concat(reqChunks);
    const fwdHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (k === "host" || k === "content-length") continue;
      fwdHeaders[k] = Array.isArray(v) ? v.join(", ") : String(v);
    }
    if (reqBody.length > 0) fwdHeaders["content-length"] = String(reqBody.length);

    const upReq = httpRequest(
      {
        protocol: upstream.protocol,
        hostname: upstream.hostname,
        port: upstream.port,
        method: req.method,
        path: req.url,
        headers: fwdHeaders,
      },
      (upRes) => {
        const respChunks: Buffer[] = [];
        upRes.on("data", (c: Buffer) => {
          respChunks.push(c);
          res.write(c);
        });
        upRes.on("end", () => {
          res.end();
          const respBody = Buffer.concat(respChunks);
          const record = {
            capture_seq: ++seq,
            ts: new Date().toISOString(),
            method: req.method,
            path: req.url,
            request_headers: filterHeaders(req.headers),
            request_body: reqBody.toString("utf8"),
            response_status: upRes.statusCode ?? 0,
            content_type: upRes.headers["content-type"] ?? null,
            response_body: respBody.toString("utf8"),
          };
          try {
            appendFileSync(OUT, JSON.stringify(record) + "\n", "utf8");
          } catch (err) {
            console.error("[capture] 落盘失败（不影响转发）:", err);
          }
          console.log(
            `[capture #${record.capture_seq}] ${record.ts} ${req.method} ${req.url} -> ${record.response_status} (${reqBody.length}B / ${respBody.length}B)`,
          );
        });
        res.writeHead(upRes.statusCode ?? 502, upRes.headers);
      },
    );
    upReq.on("error", (err) => {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: { code: "capture_proxy_upstream_error", message: String(err) },
        }),
      );
      console.error(`[capture] upstream error: ${err}`);
    });
    upReq.end(reqBody);
  });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`capture-proxy listening on http://127.0.0.1:${PORT} -> ${UPSTREAM}`);
  console.log(`recording to ${OUT}`);
  console.log("(只进 var/ 不入 git；凭据头在记录中打码；正文保持原样供重放验证)");
});
