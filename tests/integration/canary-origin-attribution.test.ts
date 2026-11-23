import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { EvidenceRecord } from "../../src/evidence/schema.ts";
import { EvidenceWriter } from "../../src/evidence/writer.ts";
import { startGateway } from "../../src/gateway/server.ts";

// @test REQ-V2a-05
// @intent P1-2 canary 串入归因：真实网关 + 真实 canary 注册表，验证跨会话泄漏的 evidence
//         finding 携带来源会话键（origin），回答"谁串进了谁"而不只是"检测到串流"。
// @covers AC-V2a-06 AC-V2a-17
//
// 为什么必须是集成测试：本改动经过两处「逐字段/逐键构造」的透传点
//   ① gateway/core.ts  toEvidenceFinding  —— 不显式传递则 finding 丢 origin
//   ② gateway/core.ts  responseMetaFor     —— 不并入则 checker 根本读不到归因快照
// 两处都是静默丢弃（类型检查与既有单测都不会报错），只有走真实请求链路才能暴露。
// 实测记录：实现完成但只改 ① 时，端到端断言 origin=undefined —— 正是漏了 ②。

let dir: string;
let gw: Awaited<ReturnType<typeof startGateway>> | null = null;
let mock: Server | null = null;
let evPath: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "llmveto-canary-origin-"));
});
afterEach(async () => {
  if (gw) {
    await gw.close();
    gw = null;
  }
  if (mock) {
    await new Promise<void>((r) => mock!.close(() => r()));
    mock = null;
  }
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 读证据文件全部记录。 */
function readEvidence(): EvidenceRecord[] {
  let raw = "";
  try {
    raw = readFileSync(evPath, "utf8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as EvidenceRecord);
}

/**
 * 启动一个会「泄漏」的 mock upstream：第一个请求记下收到的 canary 并正常回复；
 * 之后的请求把该 canary 塞进响应体（模拟上游把别的会话的 canary 回传给当前会话）。
 */
async function bootLeakyUpstream(): Promise<string> {
  let victimCanary: string | null = null;
  mock = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => {
      body += c.toString("utf8");
    });
    req.on("end", () => {
      const m = /llmveto-canary-[a-z0-9]+/.exec(body);
      res.writeHead(200, { "content-type": "application/json" });
      if (victimCanary === null && m !== null) {
        victimCanary = m[0];
        res.end(
          JSON.stringify({
            model: "gpt-4o",
            choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
          }),
        );
        return;
      }
      res.end(
        JSON.stringify({
          model: "gpt-4o",
          choices: [
            {
              message: { role: "assistant", content: `leaked ${victimCanary ?? "none"}` },
              finish_reason: "stop",
            },
          ],
        }),
      );
    });
  });
  await new Promise<void>((r) => mock!.listen(0, "127.0.0.1", () => r()));
  const addr = mock.address();
  if (addr === null || typeof addr === "string") throw new Error("mock upstream failed to bind");
  return `http://127.0.0.1:${addr.port}`;
}

async function callWithSession(baseUrl: string, sessionKey: string): Promise<Response> {
  return fetch(baseUrl + "/opencode/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-llmveto-session-id": sessionKey },
    body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
  });
}

describe("P1-2 canary 串入归因（真实网关 + 串流上游）", () => {
  it("跨会话泄漏命中 → evidence finding 的 origin = 来源会话键", async () => {
    const upstreamUrl = await bootLeakyUpstream();
    evPath = join(dir, `ev-${Math.random().toString(36).slice(2)}.jsonl`);
    const writer = new EvidenceWriter(evPath);
    gw = await startGateway({
      config: {
        upstreamBaseUrl: upstreamUrl,
        evidenceWriter: writer,
        canaryRegistryPath: join(dir, `reg-${Math.random().toString(36).slice(2)}.json`),
      },
    });

    // 会话 A 先拿到 canary
    await (await callWithSession(gw.url, "session-alpha")).text();
    // 会话 B 的响应里出现 A 的 canary
    const rB = await callWithSession(gw.url, "session-beta");
    await rB.text();

    const recs = readEvidence();
    const blocked = recs.find((r) => r.action_taken === "blocked_before_deliver");
    expect(blocked).toBeDefined();

    const hit = blocked!.findings.find((f) => f.checker === "canary-return-scan");
    expect(hit).toBeDefined();
    expect(hit!.rule_id).toBe("canary-detected-in-response");
    // 核心断言：归因到会话 A（不是 undefined，也不是 B 自己）
    expect(hit!.origin).toBe("session-alpha");
  });

  it("无跨会话泄漏 → 不产生 canary finding，也不出现 origin 字段", async () => {
    const cleanMock = createServer((req, res) => {
      req.on("data", () => undefined);
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            model: "gpt-4o",
            choices: [{ message: { role: "assistant", content: "完全正常" }, finish_reason: "stop" }],
          }),
        );
      });
    });
    mock = cleanMock;
    await new Promise<void>((r) => cleanMock.listen(0, "127.0.0.1", () => r()));
    const addr = cleanMock.address();
    if (addr === null || typeof addr === "string") throw new Error("bind failed");

    evPath = join(dir, `ev2-${Math.random().toString(36).slice(2)}.jsonl`);
    const writer = new EvidenceWriter(evPath);
    gw = await startGateway({
      config: {
        upstreamBaseUrl: `http://127.0.0.1:${addr.port}`,
        evidenceWriter: writer,
        canaryRegistryPath: join(dir, `reg2-${Math.random().toString(36).slice(2)}.json`),
      },
    });

    await (await callWithSession(gw.url, "session-a")).text();
    await (await callWithSession(gw.url, "session-b")).text();

    const recs = readEvidence();
    expect(recs.length).toBeGreaterThan(0);
    for (const r of recs) {
      expect(r.findings.some((f) => f.checker === "canary-return-scan")).toBe(false);
      for (const f of r.findings) expect(f.origin).toBeUndefined();
    }
  });

  it("证据链仍可校验（origin 不破坏 v1 链完整性）", async () => {
    const { verifyEvidenceFile } = await import("../../src/evidence/verify.ts");
    const recs = readEvidence();
    expect(recs.length).toBeGreaterThan(0);
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i]!.prev_hash).toBe(recs[i - 1]!.record_hash);
      expect(recs[i]!.seq).toBe(recs[i - 1]!.seq + 1);
    }
    // 带 origin 的记录必须仍通过官方校验器（schema + 链），否则等于破坏了 v1 契约。
    const result = verifyEvidenceFile(evPath);
    expect(result.ok).toBe(true);
  });
});
