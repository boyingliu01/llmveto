// @no-test-required: bench HTTP 端到端测量骨架（被 runner 编排调用）；核心决策逻辑 percentile/isRegression 由 bench/regression-formula.test.ts 覆盖，本文件只做真实 loopback 采样与传输层去伪影。
import { performance } from "node:perf_hooks";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as net from "node:net";
import * as http from "node:http";
import { EvidenceWriter } from "../src/evidence/writer.ts";
import { startGateway } from "../src/gateway/server.ts";
import { startMockUpstream, type MockUpstreamSpec } from "../tests/utils/mock-upstream.ts";
import { percentile } from "./regression-formula.ts";

/**
 * @test REQ-VETO-013
 * @intent M2.5 bench HTTP 端到端测量骨架。
 *
 * 背景：v0.1 的 G1/G2 是进程内 microbench（直接调用 checker 函数），
 *       不含反代 HTTP 路径与逐跳开销，无法反映"启用网关"对客户端真实可观测延迟的贡献。
 *       本骨架改为：客户端 →（网关 → mock 上游 → 网关）→ 客户端，
 *       delta = t(经网关) − t(直连 mock)，即"过闸带来的端到端增量"。
 *
 * 采样协议（AC-VETO-013-01）：预热 WARMUP + n=N；报告 p50/p95/p99。
 */

const WARMUP = 50;
const N = 200;

// 经网关的路由路径（client=bench / provider=default）；直连用 mock 原始路径。
export const GW_PATH = "/bench/default/v1/chat/completions";
export const BYPASS_PATH = "/v1/chat/completions";

export interface BenchStack {
  readonly gatewayUrl: string;
  readonly upstreamUrl: string;
  close(): Promise<void>;
}

export async function bootStack(spec: MockUpstreamSpec): Promise<BenchStack> {
  const mock = await startMockUpstream(spec);
  const dir = mkdtempSync(join(tmpdir(), "llmveto-bench-"));
  const writer = new EvidenceWriter(join(dir, "bench.jsonl"));
  // 走真实路由：catch-all upstreamBaseUrl → mock；bench/default 未命中表 → 回落 catch-all。
  const gw = await startGateway({ config: { upstreamBaseUrl: mock.url, evidenceWriter: writer } });
  return {
    gatewayUrl: gw.url,
    upstreamUrl: mock.url,
    close: async () => { await gw.close(); await mock.close(); },
  };
}

// 真实长连接客户端形态：keep-alive 复用 socket + TCP_NODELAY 抑制 Nagle/delayed-ACK
// （否则 64KB 恰撞 socket 缓冲边界时会引入 ~10-25ms 传输层拖慢，不是网关成本）。
const keepAliveAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 1,
  scheduling: "lifo",
  createConnection: (options, onCreate) => {
    const sock = net.createConnection(options as net.TcpNetConnectOpts, () => {
      sock.setNoDelay(true);
      sock.setKeepAlive(true);
      if (onCreate) onCreate(null, sock);
    });
    return sock;
  },
});

function postOnce(url: string, body: string, firstByte: boolean): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const u = new URL(url);
    const t0 = performance.now();
    const payload = Buffer.from(body, "utf8");
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: "POST",
        agent: keepAliveAgent,
        headers: { "content-type": "application/json", "content-length": String(payload.byteLength) },
      },
      (res) => {
        if (firstByte) {
          let done = false;
          res.once("data", () => { if (done) return; done = true; resolve(performance.now() - t0); res.destroy(); });
          res.on("end", () => { if (!done) { done = true; resolve(performance.now() - t0); } });
        } else {
          res.on("data", () => {});
          res.on("end", () => resolve(performance.now() - t0));
        }
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

/** 首帧到达时间：从发出请求到收到第一个响应数据块（流式）。 */
export function ttftMs(url: string, body: string): Promise<number> {
  return postOnce(url, body, true);
}

/** 完整请求往返：从发出到读尽响应体（非流式）。 */
export function roundTripMs(url: string, body: string): Promise<number> {
  return postOnce(url, body, false);
}

export interface Delta {
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

/**
 * 端到端延迟增量 = 逐请求配对的 (经网关 − 直连) 的分位数。
 * 每个 i 先测经网关再测直连，相减得单次过闸增量样本，再对增量分布取 p50/p95/p99：
 *   - 增量分布天然单调（p50 ≤ p95 ≤ p99），无需跨分布做分位数差（那会因两条分布在
 *     不同时刻独立采样而把慢漂移耦合进尾部，制造非单调肥尾）。
 *   - 固定 gw-first 顺序：若有热场偏置只会保守地计入网关侧，不会低估过闸成本。
 * 传输层已用 TCP_NODELAY + keep-alive 消除 64KB socket 缓冲边界的 Nagle/delayed-ACK 停顿，
 * 故配对相减不再出现历史上的 64KB 档假性回退。
 */
export async function sampleDelta(
  measure: (url: string, body: string) => Promise<number>,
  gatewayUrl: string,
  upstreamUrl: string,
  body: string,
  path: string,
  warmup = WARMUP,
  n = N,
): Promise<Delta> {
  const gwUrl = gatewayUrl + path;
  const dirUrl = upstreamUrl + BYPASS_PATH;
  for (let i = 0; i < warmup; i++) {
    await measure(gwUrl, body);
    await measure(dirUrl, body);
  }
  const deltas: number[] = [];
  for (let i = 0; i < n; i++) {
    const g = await measure(gwUrl, body);
    const d = await measure(dirUrl, body);
    deltas.push(Math.max(0, g - d));
  }
  return { p50: percentile(deltas, 0.5), p95: percentile(deltas, 0.95), p99: percentile(deltas, 0.99) };
}

/** 构造 sizeKb KB 的合法 JSON 请求体（把填充塞进 message.content，保证网关可解析 model）。 */
export function makeRequestBody(sizeKb: number, stream: boolean): string {
  const target = Math.max(0, sizeKb * 1024 - 64);
  const filler = "The quick brown fox jumps over the lazy dog. ";
  let content = "";
  while (content.length < target) content += filler;
  content = content.slice(0, target);
  return JSON.stringify({
    model: "gpt-4o",
    stream,
    messages: [{ role: "user", content }],
  });
}
