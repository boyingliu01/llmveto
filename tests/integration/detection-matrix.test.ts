import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { egressSecretScan } from "../../src/checkers/egress-secret-scan.ts";
import { invisibleUnicodeScanNonStream, invisibleUnicodeScanStream } from "../../src/checkers/invisible-unicode-scan.ts";
import { modelLabelConsistency } from "../../src/checkers/model-label-consistency.ts";
import { checkThinkingSignaturePresence } from "../../src/checkers/thinking-signature-presence.ts";
import { buildMergedToolCallScanUnit, buildResponseScanUnit, createToolCallArgsMerger } from "../../src/gateway/scan-unit.ts";
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

  // ── T2c：invisible-unicode-scan 检出率 = 100%，含跨 chunk 与 tool-call arguments 归并路径 ──
  const t2cCases = loadAll(join(FIXTURES, "T2c"));
  it(`T2c 正样本 ≥ 3：${t2cCases.length} cases`, () => {
    expect(t2cCases.length).toBeGreaterThanOrEqual(3);
  });
  for (let i = 0; i < t2cCases.length; i++) {
    const c = t2cCases[i] as Record<string, YamlValue>;
    const chunks = (c.chunks as unknown as string[]) ?? [];
    if (c.merge === "tool-call-arguments") {
      // SL-01/AC-V2a-01：fragments 为 arguments 内容切片，runner 构造完整 delta 帧喂归并器。
      // 前置事实（v1 漏检面）：任一单帧独立扫描均 clean —— 归并是唯一检出路径。
      const frags = (c.fragments as unknown as string[]) ?? [];
      it(`T2c[${String(c.id ?? i)}] tool-call arguments 归并后检出（跨帧 ${frags.length} 片）`, () => {
        expect(frags.length).toBeGreaterThanOrEqual(2);
        const frameOf = (frag: string) =>
          JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "m", arguments: frag } }] } }] });
        for (const frag of frags) {
          const fu = buildResponseScanUnit(frameOf(frag), JSON.parse(frameOf(frag)), null, "stream");
          expect(invisibleUnicodeScanNonStream(fu).verdict).toBe("clean");
        }
        const merger = createToolCallArgsMerger();
        for (const frag of frags) merger.feed(JSON.parse(frameOf(frag)));
        const r = invisibleUnicodeScanNonStream(buildMergedToolCallScanUnit(merger.mergedText()));
        expect(r.verdict).toBe("finding");
      });
      continue;
    }
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
  const allT3aCases = loadAll(join(FIXTURES, "T3a"));
  const t3aCases = allT3aCases.filter((c) => {
    const r = c as Record<string, YamlValue>;
    return r.checker === undefined || r.checker === "model-label-consistency";
  });
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

  // ── T3a：thinking-signature-presence（SL-10/REQ-V2a-03） ──
  const t3aThinkingCases = allT3aCases.filter((c) => {
    const r = c as Record<string, YamlValue>;
    return r.checker === "thinking-signature-presence";
  });
  for (let i = 0; i < t3aThinkingCases.length; i++) {
    const c = t3aThinkingCases[i] as Record<string, YamlValue>;
    it(`T3a-thinking[${String(c.id ?? i)}] 期望 ${String(c.expected)}`, () => {
      const meta: Record<string, unknown> = {};
      if (c.thinking_enabled !== null && c.thinking_enabled !== undefined) meta.thinking_enabled = c.thinking_enabled;
      const r = checkThinkingSignaturePresence(unit(String(c.response_text ?? ""), "response", meta));
      expect(r.verdict).toBe(String(c.expected));
    });
  }
});
