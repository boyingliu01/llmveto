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

/** 上游行为：接受连接后立即销毁 socket（模拟中途 reset）。 */
async function startResettingUpstream(): Promise<{ server: Server; url: string }> {
  const server = createServer((req) => {
    req.socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${addr.port}` };
}

function chatBody(): string {
  return JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hello" }] });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "llmveto-upstream-fail-"));
  const bad = await startResettingUpstream();
  badUpstream = bad.server;
  badUpstreamUrl = bad.url;
});

afterEach(async () => {
  if (gw) { await gw.close(); gw = null; }
});

afterAll(() => {
  badUpstream?.close();
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
});
