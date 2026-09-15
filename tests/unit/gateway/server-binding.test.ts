import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startGateway } from "../../../src/gateway/server.ts";
import { EvidenceWriter } from "../../../src/evidence/writer.ts";

// @test REQ-VETO-002
// @intent AC-VETO-002-01 硬绑 127.0.0.1：非回环 host 启动即抛错（安全不可协商不变量）。
// @covers AC-VETO-002-01

describe("SL-09 gateway: host binding invariant (AC-VETO-002-01)", () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "llmveto-host-")); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  const cfg = () => ({ config: { upstreamBaseUrl: "http://127.0.0.1:1", evidenceWriter: new EvidenceWriter(join(dir, "e.jsonl")) } });

  it("host='0.0.0.0' → 抛错，含 AC-VETO-002-01 与 loopback-only 提示", async () => {
    await expect(startGateway({ ...cfg(), host: "0.0.0.0" })).rejects.toThrow(/AC-VETO-002-01/);
    await expect(startGateway({ ...cfg(), host: "0.0.0.0" })).rejects.toThrow(/Loopback-only/);
  });

  it("host='192.168.1.10' → 抛错", async () => {
    await expect(startGateway({ ...cfg(), host: "192.168.1.10" })).rejects.toThrow(/AC-VETO-002-01/);
  });

  it("host 未指定 → 默认 127.0.0.1 且 ephemeral port 可启动 → close 干净", async () => {
    const gw = await startGateway(cfg());
    expect(gw.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    await gw.close();
  });

  it("host='localhost' → 允许（回环别名）", async () => {
    const gw = await startGateway({ ...cfg(), host: "localhost" });
    expect(gw.url).toMatch(/^http:\/\/localhost:\d+$/);
    await gw.close();
  });
});
