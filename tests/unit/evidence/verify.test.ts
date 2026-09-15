import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EvidenceWriter } from "../../../src/evidence/writer.ts";
import { verifyEvidenceFile } from "../../../src/evidence/verify.ts";

// @test REQ-VETO-010
// @intent llmveto verify：链完整性 + schema 断言（三种失败模式）
// @covers AC-VETO-010-01 AC-VETO-010-02 AC-VETO-010-03 AC-VETO-010-04

function sample() {
  return {
    session_id: "s", turn_id: "t", request_id: "r",
    client: "opencode", provider_id: "openai", endpoint_host: "api.openai.com",
    model_requested: "gpt-4o", model_responded: "gpt-4o",
    transport: "non-stream" as const,
    request_bytes: 10, response_bytes: 20, chunk_count: 1, latency: 5,
    findings: [],
    action_taken: "allowed" as const,
    response_delivered: { partial: false, delivered_chunks: 1 },
    request_body_sha256: "a".repeat(64),
    response_body_sha256: "b".repeat(64),
    body_capture: "metadata_only" as const,
  };
}

describe("SL-07 llmveto verify (REQ-VETO-010)", () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "llmveto-verify-")); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it("AC-01 正常链 → ok", () => {
    const p = join(dir, "ok.jsonl");
    const w = new EvidenceWriter(p);
    w.append(sample());
    w.append(sample());
    w.append(sample());
    const r = verifyEvidenceFile(p);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.records).toBe(3);
  });

  it("AC-02 中间一条被改写 → first_bad_seq", () => {
    const p = join(dir, "tampered.jsonl");
    const w = new EvidenceWriter(p);
    w.append(sample());
    w.append(sample());
    w.append(sample());
    // 篡改第 2 条：改 client
    const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
    const r2 = JSON.parse(lines[1]!);
    r2.client = "evil";
    lines[1] = JSON.stringify(r2);
    writeFileSync(p, lines.join("\n") + "\n", "utf8");
    const res = verifyEvidenceFile(p);
    expect(res.ok).toBe(false);
    if (!res.ok && res.kind === "chain_broken") {
      expect(res.first_bad_seq).toBe(1);
    } else {
      throw new Error("expected chain_broken, got " + JSON.stringify(res));
    }
  });

  it("AC-02 prev_hash 断裂 → first_bad_seq", () => {
    const p = join(dir, "broken-prev.jsonl");
    const w = new EvidenceWriter(p);
    w.append(sample());
    w.append(sample());
    const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
    const r2 = JSON.parse(lines[1]!);
    r2.prev_hash = "f".repeat(64);
    // 重新计算 record_hash 让 schema 通过 → 但 prev 与上一条 record_hash 不匹配
    lines[1] = JSON.stringify(r2);
    writeFileSync(p, lines.join("\n") + "\n", "utf8");
    const res = verifyEvidenceFile(p);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe("chain_broken");
  });

  it("AC-03 schema 违约：缺 seq → schema_violation", () => {
    const p = join(dir, "schema.jsonl");
    writeFileSync(p, JSON.stringify({ evidence_version: 1, event_id: "x" }) + "\n", "utf8");
    const res = verifyEvidenceFile(p);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe("schema_violation");
  });

  it("AC-04 evidence_version != 1 → unsupported_version", () => {
    const p = join(dir, "v2.jsonl");
    writeFileSync(p, JSON.stringify({ evidence_version: 2 }) + "\n", "utf8");
    const res = verifyEvidenceFile(p);
    expect(res.ok).toBe(false);
    if (!res.ok && res.kind === "unsupported_version") {
      expect(res.evidence_version).toBe(2);
    } else {
      throw new Error("expected unsupported_version, got " + JSON.stringify(res));
    }
  });

  it("edge: 无文件 → no_file", () => {
    const res = verifyEvidenceFile(join(dir, "does-not-exist.jsonl"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe("no_file");
  });
});
