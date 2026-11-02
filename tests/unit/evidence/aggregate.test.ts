import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { aggregateEvidence } from "../../../src/evidence/aggregate.ts";

// @test REQ-V2a-06
// @intent SL-12: durable 计数从链聚合 + 遮蔽语义（D-14）
// @covers AC-V2a-08

describe("SL-12 evidence aggregate (AC-V2a-08)", () => {
  it("文件不存在 → degraded/no_file", () => {
    const r = aggregateEvidence(join(tmpdir(), "nonexistent-sl12.jsonl"));
    expect(r.status).toBe("degraded");
    if (r.status === "degraded") expect(r.reason).toBe("no_file");
  });

  it("空文件 → ok 全零计数", () => {
    const dir = mkdtempSync(join(tmpdir(), "llmveto-agg-empty-"));
    const p = join(dir, "empty.jsonl");
    writeFileSync(p, "", "utf8");
    const r = aggregateEvidence(p);
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.counts.total).toBe(0);
      expect(r.counts.allowed).toBe(0);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("合法链 → 正确聚合计数", () => {
    const dir = mkdtempSync(join(tmpdir(), "llmveto-agg-ok-"));
    const p = join(dir, "chain.jsonl");
    // 模拟两条记录（简化：只需 action_taken 字段供聚合消费）
    const rec1 = { action_taken: "allowed", seq: 0 };
    const rec2 = { action_taken: "blocked_before_forward", seq: 1 };
    const rec3 = { action_taken: "terminated_after_delivery", seq: 2 };
    writeFileSync(p, [JSON.stringify(rec1), JSON.stringify(rec2), JSON.stringify(rec3)].join("\n") + "\n", "utf8");
    const r = aggregateEvidence(p);
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.counts.total).toBe(3);
      expect(r.counts.allowed).toBe(1);
      expect(r.counts.blocked).toBe(1);
      expect(r.counts.terminated).toBe(1);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("损坏行 → degraded/parse_error", () => {
    const dir = mkdtempSync(join(tmpdir(), "llmveto-agg-bad-"));
    const p = join(dir, "broken.jsonl");
    writeFileSync(p, "{ not valid json\n", "utf8");
    const r = aggregateEvidence(p);
    expect(r.status).toBe("degraded");
    if (r.status === "degraded") expect(r.reason).toBe("parse_error");
    rmSync(dir, { recursive: true, force: true });
  });
});
