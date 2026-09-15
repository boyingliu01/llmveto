import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { EvidenceWriter } from "../../src/evidence/writer.ts";
import { verifyEvidenceFile } from "../../src/evidence/verify.ts";
import { runCli } from "../../src/cli/index.ts";
import type { AppendInput } from "../../src/evidence/writer.ts";
import type { EvidenceRecord } from "../../src/evidence/schema.ts";

// @test REQ-VETO-014
// @intent AC-VETO-014-07 verify 链：正常链 → ok；篡改中间记录字段 → chain_broken + first_bad_seq。
// @covers AC-VETO-014-07

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "llmveto-e2e-verify-")); });

function makeInput(seq: number): AppendInput {
  return {
    session_id: `s-${seq}`,
    turn_id: `t-${seq}`,
    request_id: `r-${seq}`,
    client: "opencode",
    provider_id: "openai",
    endpoint_host: "127.0.0.1",
    model_requested: "gpt-4o",
    model_responded: "gpt-4o",
    transport: "non-stream",
    request_bytes: 100,
    response_bytes: 200,
    chunk_count: 1,
    latency: 5,
    findings: [],
    action_taken: "allowed",
    response_delivered: { partial: false, delivered_chunks: 1 },
    request_body_sha256: "a".repeat(64),
    response_body_sha256: "b".repeat(64),
    body_capture: "metadata_only",
  };
}

describe("SL-14 e2e: evidence chain verify (REQ-VETO-014)", () => {
  it("AC-07 未篡改 → verifyEvidenceFile ok=true, records=5；CLI verify exit=0", async () => {
    const path = join(dir, "clean.jsonl");
    const w = new EvidenceWriter(path);
    for (let i = 0; i < 5; i++) w.append(makeInput(i));
    const r = verifyEvidenceFile(path);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.records).toBe(5);

    const cli = await runCli("verify", { stateDir: dir, args: ["-f", path] });
    expect(cli.exitCode).toBe(0);
    expect(cli.stdout).toContain("ok: 5 records");
  });

  it("AC-07 篡改第 2 条 latency → chain_broken + first_bad_seq=2", async () => {
    const path = join(dir, "tampered.jsonl");
    const w = new EvidenceWriter(path);
    for (let i = 0; i < 5; i++) w.append(makeInput(i));
    // 篡改 seq=2 的 latency：5 → 999（record_hash 会因此不匹配）
    const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.length > 0);
    const rec = JSON.parse(lines[2]!) as EvidenceRecord & { latency: number };
    rec.latency = 999;
    lines[2] = JSON.stringify(rec);
    writeFileSync(path, lines.join("\n") + "\n", "utf8");

    const r = verifyEvidenceFile(path);
    expect(r.ok).toBe(false);
    if (!r.ok && r.kind === "chain_broken") {
      expect(r.first_bad_seq).toBe(2);
    } else {
      throw new Error(`expected chain_broken, got kind=${(r as { kind?: string }).kind}`);
    }

    const cli = await runCli("verify", { stateDir: dir, args: ["-f", path] });
    expect(cli.exitCode).toBe(1);
    expect(cli.stderr).toContain("first_bad_seq=2");
  });
});
