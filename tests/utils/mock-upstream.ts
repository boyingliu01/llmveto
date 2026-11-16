import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";

/**
 * @test REQ-VETO-011
 * @intent 纯 TS 声明式脚本回放（v1 全部集成/E2E 恶意上游载体）。
 *         支持自定义 chunk 边界（AC-VETO-011-02：把 U+200B 三字节拆两片）。
 *         requests 记录 method/url（含查询串）/body/headers，供断言转发保真度。
 *
 * Fixture schema：
 *   { transport: "stream"|"non-stream",
 *     chunks?: string[]  // stream 模式：每个字符串作为一个 SSE 帧 data 值
 *     boundaryChunks?: number[][]  // 若提供，则按字节切片替代 chunks（对每个 chunk utf8 编码后按给定索引分片）
 *     body?: string      // non-stream：直接返回体
 *     status?: number    // 默认 200
 *     headers?: Record<string,string> }
 */

export interface MockUpstreamSpec {
  readonly transport: "stream" | "non-stream";
  readonly chunks?: readonly string[];
  readonly boundaryChunks?: readonly (readonly number[])[];
  readonly body?: string;
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface MockUpstream {
  readonly url: string;
  readonly requests: readonly { method: string; url: string; body: string; headers: Record<string, string> }[];
  close(): Promise<void>;
}

export async function startMockUpstream(spec: MockUpstreamSpec): Promise<MockUpstream> {
  const requests: MockUpstream["requests"] = [];
  const server = createServer((req, res) => { void handle(req, res, spec, requests); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${addr.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve())),
  };
}

/** 读请求体 + 归一化头（多值取首）：handle 只保留响应形态编排。 */
async function readRequest(req: IncomingMessage): Promise<{ body: string; headers: Record<string, string> }> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return { body: Buffer.concat(chunks).toString("utf8"), headers: headersOf(req.headers) };
}

function headersOf(raw: IncomingMessage["headers"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") out[k] = v;
    else if (Array.isArray(v)) out[k] = v[0] ?? "";
  }
  return out;
}

async function handle(req: IncomingMessage, res: ServerResponse, spec: MockUpstreamSpec, sink: MockUpstream["requests"]): Promise<void> {
  const { body, headers } = await readRequest(req);
  (sink as { method: string; url: string; body: string; headers: Record<string, string> }[]).push({ method: req.method ?? "GET", url: req.url ?? "", body, headers });

  for (const [k, v] of Object.entries(spec.headers ?? {})) res.setHeader(k, v);
  res.statusCode = spec.status ?? 200;

  if (spec.transport === "non-stream") {
    res.setHeader("content-type", "application/json");
    res.end(spec.body ?? "");
    return;
  }
  res.setHeader("content-type", "text/event-stream");
  const frames = spec.chunks ?? [];
  const boundaries = spec.boundaryChunks;
  if (boundaries && boundaries.length === frames.length) {
    await writeAtBoundaries(res, frames, boundaries);
  } else {
    await writeWholeFrames(res, frames);
  }
  res.write("data: [DONE]\n\n");
  res.end();
}

/** 自定义 chunk 边界：每个 SSE 帧再按给定字节索引切片写出，供测试观察分片。 */
async function writeAtBoundaries(
  res: ServerResponse,
  frames: readonly string[],
  boundaries: readonly (readonly number[])[],
): Promise<void> {
  for (let i = 0; i < frames.length; i++) {
    const bytes = Buffer.from(`data: ${frames[i]}\n\n`, "utf8");
    let prev = 0;
    for (const cut of [...boundaries[i]!, bytes.byteLength]) {
      res.write(bytes.subarray(prev, cut));
      prev = cut;
      // 允许测试观察到 chunk 边界的分离
      await new Promise((r) => setImmediate(r));
    }
  }
}

async function writeWholeFrames(res: ServerResponse, frames: readonly string[]): Promise<void> {
  for (const f of frames) {
    res.write(`data: ${f}\n\n`);
    await new Promise((r) => setImmediate(r));
  }
}

/** 便捷：把一段文本按 utf-8 字节切成 N 片，返回每片字节起始索引（模拟 chunk 边界）。 */
export function byteCutsFor(text: string, splitAtBytes: readonly number[]): readonly number[] {
  const total = Buffer.byteLength(text, "utf8");
  return splitAtBytes.filter((n) => n > 0 && n < total);
}

export const mockUpstreamId = (): string => "mock-" + randomUUID().slice(0, 8);
