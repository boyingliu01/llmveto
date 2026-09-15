import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { egressSecretScan } from "../../src/checkers/egress-secret-scan.ts";
import { invisibleUnicodeScanNonStream, invisibleUnicodeScanStream } from "../../src/checkers/invisible-unicode-scan.ts";
import { modelLabelConsistency } from "../../src/checkers/model-label-consistency.ts";
import type { ScanUnit, ScanWindow } from "../../src/shared/types.ts";
import { parseYamlSubset, type YamlValue } from "../utils/yaml-subset.ts";

// @test REQ-VETO-012
// @intent 检出矩阵：v1 门槛 fixture 集内检出率 = 100%（AC-VETO-012-01）
// @covers AC-VETO-012-01 AC-VETO-012-03

const FIXTURES = new URL("../fixtures/threats/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function loadAll(dir: string): YamlValue[] {
  const cases: YamlValue[] = [];
  for (const file of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, file.name);
    if (file.isDirectory()) cases.push(...loadAll(abs) as YamlValue[]);
    else if (file.name.endsWith(".yaml")) {
      const doc = parseYamlSubset(readFileSync(abs, "utf8"));
      const cs = doc.cases;
      if (Array.isArray(cs)) cases.push(...cs);
    }
  }
  return cases;
}

function unit(text: string, dir: "request" | "response" = "request", meta: Record<string, unknown> = {}): ScanUnit {
  return { direction: dir, transport: "non-stream", text, meta };
}

describe("SL-12 detection matrix (REQ-VETO-012 AC-01)", () => {
  // ── T1b：egress-secret-scan 检出率 = 100% ──
  const t1bCases = loadAll(join(FIXTURES, "T1b"));
  it(`T1b 正样本 ≥ 3：${t1bCases.length} cases`, () => {
    expect(t1bCases.length).toBeGreaterThanOrEqual(3);
  });
  for (let i = 0; i < t1bCases.length; i++) {
    const c = t1bCases[i] as Record<string, YamlValue>;
    it(`T1b[${String(c.id ?? i)}] 检出`, () => {
      const r = egressSecretScan(unit(String(c.body ?? "")));
      expect(r.verdict).toBe("finding");
      if (c.expected_rule_id) expect(r.evidence[0]?.rule_id).toBe(String(c.expected_rule_id));
    });
  }

  // ── T2c：invisible-unicode-scan 检出率 = 100%，含跨 chunk ──
  const t2cCases = loadAll(join(FIXTURES, "T2c"));
  it(`T2c 正样本 ≥ 3：${t2cCases.length} cases`, () => {
    expect(t2cCases.length).toBeGreaterThanOrEqual(3);
  });
  for (let i = 0; i < t2cCases.length; i++) {
    const c = t2cCases[i] as Record<string, YamlValue>;
    const chunks = (c.chunks as unknown as string[]) ?? [];
    it(`T2c[${String(c.id ?? i)}] 检出（chunks=${chunks.length}）`, () => {
      if (chunks.length === 1) {
        const r = invisibleUnicodeScanNonStream(unit(chunks[0]!, "response"));
        expect(r.verdict).toBe("finding");
      } else {
        let w: ScanWindow = { pendingBytes: new Uint8Array(0), cursor: 0 };
        let hit = false;
        for (const ch of chunks) {
          const [r, next] = invisibleUnicodeScanStream(w, unit(ch, "response"));
          if (r.verdict === "finding") hit = true;
          w = next;
        }
        expect(hit).toBe(true);
      }
    });
  }

  // ── T3a：model-label-consistency ──
  const t3aCases = loadAll(join(FIXTURES, "T3a"));
  it(`T3a 正样本 ≥ 3：${t3aCases.length} cases`, () => {
    expect(t3aCases.length).toBeGreaterThanOrEqual(3);
  });
  for (let i = 0; i < t3aCases.length; i++) {
    const c = t3aCases[i] as Record<string, YamlValue>;
    it(`T3a[${String(c.id ?? i)}] 期望 ${String(c.expected)}`, () => {
      const meta: Record<string, unknown> = {};
      if (c.request_model !== null && c.request_model !== undefined) meta.model_requested = c.request_model;
      if (c.response_model !== null && c.response_model !== undefined) meta.model_responded = c.response_model;
      const r = modelLabelConsistency(unit("", "response", meta));
      expect(r.verdict).toBe(String(c.expected));
    });
  }
});
