import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { computeRecordHash, GENESIS_HASH, sealRecord, verifyRecord } from "../../../src/evidence/chain.ts";
import { redactSink } from "../../../src/evidence/redact-sink.ts";
import { REQUIRED_FIELDS, validateEvidence } from "../../../src/evidence/schema.ts";
import { EvidenceWriter } from "../../../src/evidence/writer.ts";

// @test REQ-VETO-007
// @intent evidence store：契约 #4 必填字段 + SHA-256 链 + append-only + 崩溃残留半行丢弃
// @covers AC-VETO-007-01 AC-VETO-007-02 AC-VETO-007-03 AC-VETO-007-04 AC-VETO-007-05

function sampleInput(overrides: Partial<Parameters<EvidenceWriter["append"]>[0]> = {}) {
  return {
    session_id: "s1", turn_id: "t1", request_id: "r1",
    client: "opencode", provider_id: "openai", endpoint_host: "api.openai.com",
    model_requested: "gpt-4o", model_responded: "gpt-4o",
    transport: "non-stream" as const,
    request_bytes: 100, response_bytes: 200, chunk_count: 1, latency: 12,
    findings: [],
    action_taken: "allowed" as const,
    response_delivered: { partial: false, delivered_chunks: 1 },
    request_body_sha256: "a".repeat(64),
    response_body_sha256: "b".repeat(64),
    body_capture: "metadata_only" as const,
    ...overrides,
  };
}

describe("SL-06 evidence store (REQ-VETO-007)", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "llmveto-ev-")); });
  afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } });

  // AC-VETO-007-01 契约 #4 必填字段
  it("AC-01 必填字段清单 = 契约 #4", () => {
    const expected = [
      "evidence_version","event_id","seq","ts","session_id","turn_id","request_id",
      "client","provider_id","endpoint_host","model_requested","model_responded","transport",
      "request_bytes","response_bytes","chunk_count","latency","findings","action_taken",
      "response_delivered","request_body_sha256","response_body_sha256","prev_hash","record_hash","canary",
    ];
    for (const f of expected) expect(REQUIRED_FIELDS).toContain(f as typeof REQUIRED_FIELDS[number]);
  });

  it("AC-01 落盘 JSONL 含全部必填字段", () => {
    const path = join(dir, "ev.jsonl");
    const w = new EvidenceWriter(path);
    const rec = w.append(sampleInput());
    for (const f of REQUIRED_FIELDS) {
      expect(rec, `field ${f}`).toHaveProperty(f);
    }
    const v = validateEvidence(rec);
    expect(v.ok).toBe(true);
  });

  // AC-VETO-007-02 链式哈希
  it("AC-02 首条 prev_hash = GENESIS；第二条 prev_hash = 首条 record_hash", () => {
    const path = join(dir, "ev2.jsonl");
    const w = new EvidenceWriter(path);
    const r1 = w.append(sampleInput());
    const r2 = w.append(sampleInput({ request_id: "r2" }));
    expect(r1.prev_hash).toBe(GENESIS_HASH);
    expect(r2.prev_hash).toBe(r1.record_hash);
    // 重算一致
    const { record_hash: _drop, ...minus } = r2;
    expect(computeRecordHash(minus as typeof r2 & { prev_hash: string })).toBe(r2.record_hash);
    expect(verifyRecord(r1, null).ok).toBe(true);
    expect(verifyRecord(r2, r1).ok).toBe(true);
  });

  // AC-VETO-007-03 body_capture 默认
  it("AC-03 redactSink metadata_only：text 空 + sha256 保留", () => {
    const r = redactSink("metadata_only", "hello sk-abcdefghijklmnopqrstuvwx");
    expect(r.text).toBe("");
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("AC-03 redactSink redacted：凭据模式命中替换", () => {
    const r = redactSink("redacted", "hello sk-abcdefghijklmnopqrstuvwx \u200Bdone");
    expect(r.text).toContain("[REDACTED]");
    expect(r.text).not.toContain("sk-abcdefghijklmnopqrstuvwx");
    expect(r.text).not.toContain("\u200B");
  });

  it("AC-03 redactSink full：原文透传", () => {
    const r = redactSink("full", "raw content");
    expect(r.text).toBe("raw content");
  });

  // AC-VETO-007-04 崩溃残留半行
  it("AC-04 末行半行丢弃 → writer 重启后 seq/last_hash 正常", () => {
    const path = join(dir, "ev4.jsonl");
    const w = new EvidenceWriter(path);
    w.append(sampleInput());
    w.append(sampleInput({ request_id: "r2" }));
    // 追加半行
    const existing = readFileSync(path, "utf8");
    writeFileSync(path, existing + '{"seq":2,"partial":tr', "utf8");

    const w2 = new EvidenceWriter(path);
    w2.init();
    const r3 = w2.append(sampleInput({ request_id: "r3" }));
    expect(r3.seq).toBe(2); // 覆盖被丢弃的 seq=2 半行位置
  });

  // AC-VETO-007-05 canary null
  it("AC-05 canary 恒 null", () => {
    const path = join(dir, "ev5.jsonl");
    const w = new EvidenceWriter(path);
    const r = w.append(sampleInput());
    expect(r.canary).toBeNull();
  });

  // sealRecord 独立测试
  it("sealRecord 纯函数：同输入两次 record_hash 相同", () => {
    const a = sealRecord({ prev_hash: GENESIS_HASH, record: sampleInput({ ts: "2026-09-15T00:00:00.000Z" }) as never });
    const b = sealRecord({ prev_hash: GENESIS_HASH, record: sampleInput({ ts: "2026-09-15T00:00:00.000Z" }) as never });
    // sealRecord 为纯函数：不注入 event_id，同入参两次调用 record_hash 必相等（确定性）：
    expect(a.record_hash).toBe(b.record_hash);
    const base = {
      evidence_version: 1 as const, event_id: "fixed-uuid", seq: 0, ts: "2026-09-15T00:00:00.000Z",
      ...sampleInput(),
    };
    const r1 = sealRecord({ prev_hash: GENESIS_HASH, record: base as never });
    const r2 = sealRecord({ prev_hash: GENESIS_HASH, record: base as never });
    expect(r1.record_hash).toBe(r2.record_hash);
    expect(a.record_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
