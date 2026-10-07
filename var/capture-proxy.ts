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

import { createServer } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
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

process.on("uncaughtException", (err) => {
  // 录制代理是多小时采集的单点：一次未捕获异常会让后续所有会话静默不再落盘，
  // 故记录后继续服务，不退出。
  console.error("[capture] 未捕获异常（已忽略，继续服务）:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("[capture] 未处理 rejection（已忽略，继续服务）:", err);
});

createServer((req, res) => {
  res.on("error", (err) => console.error("[capture] 客户端写出错:", err.message));

  const reqChunks: Buffer[] = [];
  req.on("data", (c: Buffer) => reqChunks.push(c));
  req.on("error", (err) => console.error("[capture] 请求流错误:", err.message));
  req.on("end", () => {
    const reqBody = Buffer.concat(reqChunks);
    const fwdHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (k === "host" || k === "content-length") continue;
      fwdHeaders[k] = Array.isArray(v) ? v.join(", ") : String(v);
    }
    if (reqBody.length > 0) fwdHeaders["content-length"] = String(reqBody.length);

    const transport = upstream.protocol === "https:" ? httpsRequest : httpRequest;
    const upReq = transport(
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
        let recorded = false;

        // 客户端中途断开（opencode Esc/超时/整终端被硬切）时 res.write 会抛错，
        // 未处理即拖垮整个代理；故这里只向已断开的连接丢弃写失败，落盘照常。
        const forward = (c: Buffer) => {
          respChunks.push(c);
          if (!res.writableEnded && !res.destroyed) {
            try {
              res.write(c);
            } catch {
              /* 连接已断，记录继续 */
            }
          }
        };

        const finalize = (truncated: boolean) => {
          if (recorded) return;
          recorded = true;
          if (!res.writableEnded && !res.destroyed) {
            try {
              res.end();
            } catch {
              /* ignore */
            }
          }
          const respBody = Buffer.concat(respChunks);
          const record: Record<string, unknown> = {
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
          if (truncated) record.truncated = true;
          try {
            appendFileSync(OUT, JSON.stringify(record) + "\n", "utf8");
          } catch (err) {
            console.error("[capture] 落盘失败（不影响转发）:", err);
          }
          console.log(
            `[capture #${record.capture_seq}] ${record.ts} ${req.method} ${req.url} -> ${record.response_status} (${reqBody.length}B / ${respBody.length}B)${truncated ? " [TRUNCATED]" : ""}`,
          );
        };

        upRes.on("data", forward);
        upRes.on("end", () => finalize(false));
        upRes.on("error", (err) => {
          console.error("[capture] 上游响应流中断:", err.message);
          finalize(true);
        });
        res.on("close", () => {
          // 客户端断开：仍把已收到的部分落盘并标 truncated，供切分脚本剔除
          if (!recorded) {
            upRes.destroy();
            finalize(true);
          }
        });
        res.writeHead(upRes.statusCode ?? 502, upRes.headers);
      },
    );
    upReq.on("error", (err) => {
      console.error(`[capture] upstream error: ${err}`);
      if (res.writableEnded || res.destroyed) return;
      try {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: { code: "capture_proxy_upstream_error", message: String(err) },
          }),
        );
      } catch (writeErr) {
        console.error("[capture] 错误响应写出失败（客户端已断）:", writeErr);
      }
    });
    upReq.end(reqBody);
  });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`capture-proxy listening on http://127.0.0.1:${PORT} -> ${UPSTREAM}`);
  console.log(`recording to ${OUT}`);
  console.log("(只进 var/ 不入 git；凭据头在记录中打码；正文保持原样供重放验证)");
});
