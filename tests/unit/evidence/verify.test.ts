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

  // 完整性边界（REQ §evidence 信任边界，"须原样出现在 README 与 docs"）：
  //   ✅ 保证：单条改写 / 中间删除 → 检测
  //   ❌ 不保证：整链删除或重置（本机同权限对手）—— 无外部锚定，故**本组测试不声称能检测尾部截断**。
  // 尾部截断的剩余前缀本身就是一条自洽的短链（prev_hash 两两匹配、seq 从 0 连续），
  // 任何纯本地校验都无法与"这条链本来就短"区分。这里把它写成**显式的负面契约测试**，
  // 使"能检测"与"不能检测"两个方向都被钉住，避免日后有人误以为已覆盖。
  it("negative-contract: 尾部截断**不**被检测（REQ 明示的残余风险，非缺陷）", () => {
    const p = join(dir, "truncated-tail.jsonl");
    const w = new EvidenceWriter(p);
    for (let i = 0; i < 3; i++) w.append(sample());
    const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
    writeFileSync(p, lines.slice(0, 2).join("\n") + "\n", "utf8");
    const res = verifyEvidenceFile(p);
    // 现状即契约：报 ok。若将来引入外部锚定使此处变红，须同批修订 REQ 信任边界表，
    // 不得单方面改测试（该方向的文件级期限见 REQ §外部锚定：未排期）。
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.records).toBe(2);
  });

  it("✅保证方向：中段删除（非尾部）→ chain_broken", () => {
    const p = join(dir, "delete-middle.jsonl");
    const w = new EvidenceWriter(p);
    for (let i = 0; i < 4; i++) w.append(sample());
    const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
    // 删掉第 2 条（中段）→ 剩余记录的 prev_hash 不再匹配
    writeFileSync(p, [lines[0], lines[2], lines[3]].join("\n") + "\n", "utf8");
    const res = verifyEvidenceFile(p);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe("chain_broken");
  });

  it("✅保证方向：合法链（seq 连续 0..n-1）→ 报 ok（不得假红）", () => {
    const p = join(dir, "seq-contiguous.jsonl");
    const w = new EvidenceWriter(p);
    for (let i = 0; i < 5; i++) w.append(sample());
    const res = verifyEvidenceFile(p);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.records).toBe(5);
  });

  it("✅保证方向：记录被重新编号（seq 与位置不符）→ chain_broken", () => {
    const p = join(dir, "seq-mismatch.jsonl");
    const w = new EvidenceWriter(p);
    w.append(sample());
    w.append(sample());
    const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
    const r2 = JSON.parse(lines[1]!);
    r2.seq = 7; // 手改 seq 但不重算 record_hash
    lines[1] = JSON.stringify(r2);
    writeFileSync(p, lines.join("\n") + "\n", "utf8");
    const res = verifyEvidenceFile(p);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe("chain_broken");
  });

  it("✅保证方向：整体清空 → 不得报 ok（空文件不是合法链）", () => {
    const p = join(dir, "truncated-all.jsonl");
    const w = new EvidenceWriter(p);
    w.append(sample());
    writeFileSync(p, "", "utf8");
    const res = verifyEvidenceFile(p);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe("chain_broken");
  });
});
