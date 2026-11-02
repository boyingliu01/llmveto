import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * @test REQ-V2a-09
 * @intent 双矩阵 CI 落地守卫（AC-V2a-10）：PR 档跑检出/误报矩阵，nightly 档跑
 *         13 对手 4-way 矩阵并在端口争用时可回退串行。CI 工作流是验收证据面，
 *         不能让路径/安装面/超时档位在无人察觉的情况下漂移。
 * @covers AC-V2a-10
 */

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string): string => readFileSync(`${REPO_ROOT}${rel}`, "utf8");

const TEST_WF = ".github/workflows/test.yml";
const NIGHTLY_WF = ".github/workflows/relay-nightly.yml";

/** testkit/evil-relay.ts 的 13 个 opponent id（§8.3 判定域）。 */
const OPPONENTS = [
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
] as const;

describe("CI workflows（REQ-V2a-09 / AC-V2a-10）", () => {
  it("test.yml：全量覆盖率门 + 双向 typecheck + lint 都在执行面上（不得再被静默移除）", () => {
    const wf = read(TEST_WF);
    expect(wf).toContain("COVERAGE_ALL=1");
    expect(wf).toContain("npx vitest run --coverage");
    expect(wf).toContain("bun run typecheck && bun run typecheck:dist");
    expect(wf).toContain("npx oxlint bench tests src");
  });

  it("test.yml：检出与误报矩阵指向真实套件，且没有任何 `|| true` 掩码", () => {
    const wf = read(TEST_WF);
    expect(wf).toContain("tests/integration/detection-matrix.test.ts");
    expect(wf).toContain("tests/integration/false-positive-matrix.test.ts");
    // 13 对手 relay 只在 nightly 跑，PR 档不得重复消费（§8.4 档位）
    expect(wf).not.toContain("tests/integration/relay-detection.test.ts");
    expect(wf).not.toContain("RELAY_MATRIX");
    expect(wf).not.toContain("|| true");
  });

  it("relay 套件默认跳过（PR 全量步），仅 nightly 置 RELAY_MATRIX=1 执行", () => {
    const relay = read("tests/integration/relay-detection.test.ts");
    expect(relay).toContain('process.env.RELAY_MATRIX === "1"');
    expect(relay).toContain("describe.skipIf(!RELAY_MATRIX)");
    expect(read(NIGHTLY_WF).match(/RELAY_MATRIX: "1"/g) ?? []).toHaveLength(2);
  });

  it("relay-nightly.yml：安装面为 bun.lock，运行面为真实 relay 套件", () => {
    const wf = read(NIGHTLY_WF);
    expect(wf).toContain("bun install --frozen-lockfile");
    expect(wf).toContain("tests/integration/relay-detection.test.ts");
    expect(wf).not.toContain("npm ci");
    // 未开 --coverage 时 coverage/ 不存在，上传步只会制造误导性空产物
    expect(wf).not.toContain("path: coverage/");
  });

  it("relay-nightly.yml：4-way 矩阵覆盖全部 13 对手，且矩阵 pattern 使用下划线 opponent id", () => {
    const wf = read(NIGHTLY_WF);
    expect(wf.match(/shard:\s*\d/g) ?? []).toHaveLength(4);
    for (const opponent of OPPONENTS) {
      expect(wf, `nightly matrix 未覆盖对手 ${opponent}`).toContain(opponent);
    }
    expect(wf).not.toContain("prompt-injection");
    expect(wf).not.toContain("data-exfiltration");
  });

  it("relay-nightly.yml：端口争用回退 = 串行单 fork，且 job 上限覆盖并行 30 + 回退余量（§8.4）", () => {
    const wf = read(NIGHTLY_WF);
    expect(wf).toContain("--poolOptions.forks.singleFork=true");
    expect(wf).toContain("timeout-minutes: 45");
    expect(wf).toContain("timeout-minutes: 30");
  });
});
