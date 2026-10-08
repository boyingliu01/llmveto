import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { EvidenceWriter } from "../../src/evidence/writer.ts";
import { startGateway } from "../../src/gateway/server.ts";

// @test REQ-VETO-002
// @intent 回归：上游连接层失败（ECONNRESET / 超时 / DNS 失败）时网关必须 fail-closed 而非进程崩溃。
//
// 缺陷形态（本文件所守护者）：`dispatch` 由 server 以 `void dispatch(...)` 发后不管，且自身无
// try/catch。上游 reset 时 `core.ts` 的 `await fetch(...)` 抛出，异常沿 async 边界冒泡成
// unhandledRejection → 在 bun/node 下杀死**整个 daemon 进程**。后果：
//   ① 客户端收不到任何响应（挂起或 socket 错误），没有 502；
//   ② 该次交互**不落任何 evidence**（审计缺口）；
//   ③ 网关进程消失 → 之后所有流量完全无保护（fail-open 的最坏形态）。
// 正确行为：单次请求失败 → 502 + evidence 落盘（action_taken = blocked_before_forward），
// 且**进程存活**、后续请求仍能被正常处理。

let dir: string;
let gw: Awaited<ReturnType<typeof startGateway>> | null = null;
let badUpstream: Server | null = null;
let badUpstreamUrl = "";
let midStreamUpstream: Server | null = null;
let midStreamUrl = "";

/** 上游行为：接受连接后立即销毁 socket（模拟 reset，headers 都还没回）。 */
async function startResettingUpstream(): Promise<{ server: Server; url: string }> {
  const server = createServer((req) => {
    req.socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${addr.port}` };
}

/** 上游行为：先吐 SSE 头 + 2 个 chunk，再销毁 socket（模拟**流中途** reset）。
 *  这是 PWR1-B-M3 的场景：失败抵达兜底路径时 headers 已出、部分字节已交付客户端。
 *
 *  PWR2-C-M1 / PWR2-B-m2 / PWR2-A-m1（三家同指）：销毁时机不得用固定 `setTimeout(30)`——
 *  慢速 CI 上网关可能一帧未转发即被 destroy，落入 blocked_before_forward 分支使断言随机红。
 *  改为**事件驱动**：监听本端 socket 的 `data`（网关 fetch 在内核缓冲被对端读取时触发），
 *  累计被消费的响应字节达到两帧长度（允许网关一次 read 全吃下）即证明两帧已进入网关进程
 *  （其 `res.write` 转发在 for-await 消费链上先行发生），然后销毁。
 *  600ms 仅作防死等的兜底上界，不参与时序正确性。 */
async function startMidStreamResettingUpstream(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    const f1 = 'data: {"choices":[{"delta":{"content":"par"}}]}\n\n';
    const f2 = 'data: {"choices":[{"delta":{"content":"tial"}}]}\n\n';
    res.write(f1);
    res.write(f2);
    const bothFramesBytes = Buffer.byteLength(f1) + Buffer.byteLength(f2);
    let consumedBytes = 0;
    let destroyed = false;
    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      res.destroy();
    };
    res.socket?.on("data", (chunk: Buffer) => {
      consumedBytes += chunk.length;
      if (consumedBytes >= bothFramesBytes) destroy();
    });
    setTimeout(destroy, 600); // 防死等兜底；正常路径由 data 事件先触发
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${addr.port}` };
}

function chatBody(stream = false): string {
  return JSON.stringify({ model: "gpt-4o", ...(stream ? { stream: true } : {}), messages: [{ role: "user", content: "hello" }] });
}

// PWR1-A-m4：对"无未处理拒绝"做**显式**断言，而不是只靠"进程还活着"间接推断。
// （间接推断在未来引入 log-only 容错时仍会绿，而缺陷语义已变。）
const observedRejections: unknown[] = [];
function onRejection(reason: unknown): void { observedRejections.push(reason); }
beforeAll(async () => {
  process.on("unhandledRejection", onRejection);
  dir = mkdtempSync(join(tmpdir(), "llmveto-upstream-fail-"));
  const bad = await startResettingUpstream();
  badUpstream = bad.server;
  badUpstreamUrl = bad.url;
  const mid = await startMidStreamResettingUpstream();
  midStreamUpstream = mid.server;
  midStreamUrl = mid.url;
});

afterEach(async () => {
  if (gw) { await gw.close(); gw = null; }
  expect(observedRejections, `unhandledRejection: ${observedRejections.map(String).join("; ")}`).toHaveLength(0);
  observedRejections.length = 0;
});

afterAll(() => {
  process.off("unhandledRejection", onRejection);
  badUpstream?.close();
  midStreamUpstream?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("e2e: 上游失败时的 fail-closed 与进程存活 (REQ-VETO-002)", () => {
  it("上游 socket reset → 502（不是挂起、不是崩溃），且进程存活可继续服务", async () => {
    const evPath = join(dir, "reset.jsonl");
    const writer = new EvidenceWriter(evPath);
    gw = await startGateway({ config: { upstreamBaseUrl: badUpstreamUrl, evidenceWriter: writer } });

    const r = await fetch(gw.url + "/opencode/prov/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: chatBody(),
    });

    // 关键断言 1：必须有确定的 HTTP 失败响应，而不是连接挂起/被重置后无响应
    expect(r.status).toBe(502);
    const text = await r.text();
    expect(text).toContain("llmveto:");

    // 关键断言 2：这次失败必须留痕（审计链条不得因上游故障而断）
    const lines = readFileSync(evPath, "utf8").split("\n").filter(Boolean);
    expect(lines.length).toBe(1);
    const rec = JSON.parse(lines[0]!);
    expect(rec.action_taken).toBe("blocked_before_forward");
    expect(Array.isArray(rec.findings)).toBe(true);
    expect(rec.findings.length).toBeGreaterThan(0);
  });

  it("上游失败后网关仍存活：进程可达、后续 benign 请求可被正常处理", async () => {
    const evPath = join(dir, "survive.jsonl");
    const writer = new EvidenceWriter(evPath);
    gw = await startGateway({ config: { upstreamBaseUrl: badUpstreamUrl, evidenceWriter: writer } });

    // 第一次：触发上游失败路径
    const first = await fetch(gw.url + "/opencode/prov/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: chatBody(),
    });
    expect(first.status).toBe(502);
    await first.text();

    // 第二次：若进程已崩溃，这次 fetch 会抛 socket 错误（或永久挂起被 vitest 超时打断）
    const second = await fetch(gw.url + "/opencode/prov/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: chatBody(),
    });
    // 仍是 502（同一坏上游），但**重点是拿到了 HTTP 状态码** = 进程活着、事件循环未死
    expect(second.status).toBe(502);
    await second.text();

    // 两次交互各留一条 evidence：证明故障路径没有吞掉审计
    const lines = readFileSync(evPath, "utf8").split("\n").filter(Boolean);
    expect(lines.length).toBe(2);
  });

  it("流式请求遇上游失败 → 同样 fail-closed 且留痕", async () => {
    const evPath = join(dir, "reset-stream.jsonl");
    const writer = new EvidenceWriter(evPath);
    gw = await startGateway({ config: { upstreamBaseUrl: badUpstreamUrl, evidenceWriter: writer } });

    const r = await fetch(gw.url + "/opencode/prov/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", stream: true, messages: [{ role: "user", content: "hello" }] }),
    });
    expect(r.status).toBe(502);
    await r.text();

    const lines = readFileSync(evPath, "utf8").split("\n").filter(Boolean);
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]!).action_taken).toBe("blocked_before_forward");
  });

  // PWR1-B-M3 判别用例：失败发生在**部分 SSE 已交付之后**（headersSent=true）。
  // 缺陷形态（修复前）：兜底路径往 event-stream 里追加 JSON body（污染客户端解析），
  // 且 evidence 硬编码 delivered_chunks=0 / partial 缺失——客户端明明拿到了内容，审计却说"什么都没发"。
  it("流中途 reset（已交付部分 chunk）→ 只断流不追加 JSON；evidence 如实记 partial 与真实计数", async () => {
    const evPath = join(dir, "midstream.jsonl");
    const writer = new EvidenceWriter(evPath);
    gw = await startGateway({ config: { upstreamBaseUrl: midStreamUrl, evidenceWriter: writer } });

    const r = await fetch(gw.url + "/opencode/prov/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: chatBody(true),
    });
    // headers 已出 → 客户端拿到的是 200 + SSE 头（失败信号是流终止，不是状态码改写）
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toContain("data:");
    // 关键：交付面**不得**混入 JSON 错误体（SSE 流里塞裸 JSON 是二次破坏）
    expect(text).not.toContain("upstream-error");

    const lines = readFileSync(evPath, "utf8").split("\n").filter(Boolean);
    expect(lines.length).toBe(1);
    const rec = JSON.parse(lines[0]!);
    expect(rec.action_taken).toBe("terminated_after_delivery");
    expect(rec.transport).toBe("stream");
    expect(rec.chunk_count).toBeGreaterThan(0);
    expect(rec.response_delivered.partial).toBe(true);
    expect(rec.response_delivered.delivered_chunks).toBeGreaterThan(0);
    expect(rec.findings[0].checker).toBe("gateway");
  });
});
