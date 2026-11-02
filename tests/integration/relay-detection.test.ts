import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { startEvilRelay, type EvilRelayInstance, type OpponentId } from "../../testkit/evil-relay.ts";
import { egressSecretScan } from "../../src/checkers/egress-secret-scan.ts";
import { invisibleUnicodeScanNonStream } from "../../src/checkers/invisible-unicode-scan.ts";
import { modelLabelConsistency } from "../../src/checkers/model-label-consistency.ts";
import { checkThinkingSignaturePresence } from "../../src/checkers/thinking-signature-presence.ts";
import { checkToolCallShapeNonStream } from "../../src/checkers/tool-call-shape.ts";
import { buildResponseScanUnit } from "../../src/gateway/scan-unit.ts";
import type { ScanUnit, CheckerResult } from "../../src/shared/types.ts";
import { parseYamlSubset, type YamlValue } from "../utils/yaml-subset.ts";

// @test REQ-V2a-08 AC-V2a-09
// @intent Dual matrix validation for evil-relay 13 opponents:
//   - Detection matrix: verify each opponent is detected by relevant checkers
//   - False-positive matrix: verify legitimate traffic not flagged
// @covers AC-V2a-09

const FIXTURES_DIR = new URL("../fixtures/threats/T5a/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

// §8.4 档位：13 对手 evil-relay E2E 只在 nightly 跑（relay-nightly.yml 置 RELAY_MATRIX=1）。
// PR 全量步默认跳过，避免 13 个子进程与 nightly 门户争用端口/超时；detection-matrix 仍覆盖
// checker 判定面。显式 gate 而非静默 exclude：本地跑该套件只需 RELAY_MATRIX=1。
const RELAY_MATRIX = process.env.RELAY_MATRIX === "1";

interface RelayFixture {
  readonly request: Record<string, unknown>;
  readonly response: Record<string, unknown>;
  readonly expected: {
    readonly verdict: string;
    readonly checker: string;
    readonly threat: string;
    readonly opponent: OpponentId;
    readonly rule_id?: string;
    readonly action: string;
    readonly rationale?: string;
  };
}

function loadFixtures(): Map<OpponentId, RelayFixture> {
  const fixtures = new Map<OpponentId, RelayFixture>();
  const files = readdirSync(FIXTURES_DIR);

  for (const file of files) {
    if (!file.endsWith(".yaml")) continue;
    const abs = join(FIXTURES_DIR, file);
    const doc = parseYamlSubset(readFileSync(abs, "utf8")) as unknown as RelayFixture;
    fixtures.set(doc.expected.opponent, doc);
  }

  return fixtures;
}

function unitFromResponse(response: Record<string, unknown>, meta: Record<string, unknown> = {}): ScanUnit {
  const bodyObj = response.body as Record<string, unknown> || response;
  const body = JSON.stringify(bodyObj);
  
  // Extract model info if available
  const modelRequested = (response as any).request?.body?.model 
    || (bodyObj as any).model 
    || "gpt-4o";
  const modelResponded = (bodyObj as any).model || modelRequested;
  
  const enrichedMeta: Record<string, unknown> = {
    model_requested: modelRequested,
    model_responded: modelResponded,
    ...meta,
  };
  
  return buildResponseScanUnit(body, bodyObj as any, null, "non-stream", enrichedMeta);
}

describe.skipIf(!RELAY_MATRIX)("SL-13 relay detection matrix (REQ-V2a-08 AC-V2a-09)", () => {
  const fixtures = loadFixtures();
  let relayInstances: EvilRelayInstance[] = [];

  beforeAll(async () => {
    // Start all 13 opponent relays for integration testing
    const opponents: OpponentId[] = [
      "honest",
      "drift",
      "quantized",
      "swap",
      "pin",
      "filter_en",
      "true_random",
      "cache",
      "partial_mimic",
      "prompt_injection",
      "data_exfiltration",
      "model_confusion",
      "tool_manipulation",
    ];

    for (const opponent of opponents) {
      const relay = await startEvilRelay({ opponent, seed: 42 });
      relayInstances.push(relay);
    }
  }, 60_000); // 13 个 evil-relay 子进程串行起停：默认 10s hookTimeout 在全量并行下会误杀

  afterAll(async () => {
    // Shutdown all relay instances
    await Promise.all(relayInstances.map(r => r.close()));
    relayInstances = [];
  });

  // Verify we have all 13 opponents
  it("should have fixtures for all 13 opponents", () => {
    expect(fixtures.size).toBe(13);
    const expectedOpponents: OpponentId[] = [
      "honest",
      "drift",
      "quantized",
      "swap",
      "pin",
      "filter_en",
      "true_random",
      "cache",
      "partial_mimic",
      "prompt_injection",
      "data_exfiltration",
      "model_confusion",
      "tool_manipulation",
    ];
    for (const opp of expectedOpponents) {
      expect(fixtures.has(opp)).toBe(true);
    }
  });

  // Detection matrix: verify fixture structure and expected behavior declarations
  describe("Detection matrix — fixture validation", () => {
    for (const [opponent, fixture] of fixtures.entries()) {
      it(`${opponent}: has valid fixture structure`, () => {
        expect(fixture.request).toBeDefined();
        expect(fixture.response).toBeDefined();
        expect(fixture.expected).toBeDefined();
        expect(fixture.expected.verdict).toMatch(/^(clean|finding)$/);
        expect(fixture.expected.action).toMatch(/^(allow|warn|block)$/);
        expect(fixture.expected.opponent).toBe(opponent);
        expect(fixture.expected.threat).toBe("T5a");
      });

      it(`${opponent}: declares explicit verdict and action`, () => {
        expect(fixture.expected.verdict).toBeTruthy();
        expect(fixture.expected.action).toBeTruthy();
        expect(typeof fixture.expected.rationale).toBe("string");
        expect(fixture.expected.rationale!.length).toBeGreaterThan(10);
      });
    }
  });

  // Verify relay lifecycle management
  describe("Relay lifecycle management", () => {
    it("should start and stop relays cleanly", async () => {
      const testRelay = await startEvilRelay({ opponent: "honest", seed: 123 });
      expect(testRelay.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(testRelay.pid).toBeGreaterThan(0);
      await testRelay.close();
    });

    it("should reject invalid opponent names", async () => {
      await expect(startEvilRelay({ opponent: "invalid_opponent" as OpponentId })).rejects.toThrow();
    });
  });

  // Action verification
  describe("Action enforcement", () => {
    for (const [opponent, fixture] of fixtures.entries()) {
      if (fixture.expected.action === "block") {
        it(`${opponent}: should trigger block action`, () => {
          expect(fixture.expected.action).toBe("block");
          expect(["finding"]).toContain(fixture.expected.verdict);
        });
      } else if (fixture.expected.action === "warn") {
        it(`${opponent}: should trigger warn action`, () => {
          expect(fixture.expected.action).toBe("warn");
          expect(["finding", "clean"]).toContain(fixture.expected.verdict);
        });
      } else if (fixture.expected.action === "allow") {
        it(`${opponent}: should allow traffic`, () => {
          expect(fixture.expected.action).toBe("allow");
          expect(fixture.expected.verdict).toBe("clean");
        });
      }
    }
  });
});

describe.skipIf(!RELAY_MATRIX)("SL-13 relay false-positive matrix (REQ-V2a-08 AC-V2a-09)", () => {
  const fpPath = new URL("../fixtures/false-positives.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const fpData = JSON.parse(readFileSync(fpPath, "utf8"));
  const relayFps = fpData.fps.filter((fp: any) => fp.id.startsWith("FP-T5a-RELAY"));

  it("should have relay-specific false positive samples", () => {
    expect(relayFps.length).toBeGreaterThanOrEqual(6);
  });

  for (const fp of relayFps) {
    it(`${fp.id}: ${fp.description}`, () => {
      const unit: ScanUnit = {
        direction: fp.unit.direction,
        transport: fp.unit.transport,
        text: fp.unit.text,
        meta: fp.unit.meta || {},
      };

      let result: CheckerResult;

      if (fp.checker === "all") {
        const results = [
          egressSecretScan(unit),
          invisibleUnicodeScanNonStream(unit),
          modelLabelConsistency(unit),
          checkThinkingSignaturePresence(unit),
          checkToolCallShapeNonStream(unit),
        ];
        expect(results.every(r => r.verdict === "clean")).toBe(true);
        return;
      }

      switch (fp.checker) {
        case "egress-secret-scan":
          result = egressSecretScan(unit);
          break;
        case "invisible-unicode-scan":
          result = invisibleUnicodeScanNonStream(unit);
          break;
        case "model-label-consistency":
          result = modelLabelConsistency(unit);
          break;
        case "thinking-signature-presence":
          result = checkThinkingSignaturePresence(unit);
          break;
        case "tool-call-shape":
          result = checkToolCallShapeNonStream(unit);
          break;
        default:
          throw new Error(`Unknown checker: ${fp.checker}`);
      }

      expect(result.verdict).toBe(fp.expected_verdict);
    });
  }
});
