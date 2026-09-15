import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/index.ts";
import { MANAGED_CONFIG_IDS as OPENCODE_IDS } from "../../src/adapters/opencode.ts";
import { MANAGED_CONFIG_IDS as DELPHI_IDS } from "../../src/adapters/delphi.ts";

// @test REQ-VETO-014
// @intent AC-VETO-014-06 doctor 漂移：受管配置未指向本地网关 → exit=1 且 FAIL 行包含漂移条目 id。
// @covers AC-VETO-014-06

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "llmveto-e2e-doctor-")); });

describe("SL-14 e2e: doctor drift detection (REQ-VETO-014)", () => {
  it("AC-06 空 current config → doctor FAIL + 输出列出 MANAGED_CONFIG_IDS 条目 id", async () => {
    // detectDrift({}) 会把所有 MANAGED_CONFIG_IDS 判为漂移；因此 stdout 应包含每条 id
    const res = await runCli("doctor", { stateDir: dir, args: [] });
    expect(res.exitCode).toBe(1);
    const failLines = res.stdout.split("\n").filter((l) => l.startsWith("[FAIL]"));
    expect(failLines.length).toBeGreaterThan(0);
    const driftLine = failLines.find((l) => l.includes("doctor.config-drift"));
    expect(driftLine).toBeDefined();
    // 至少断言 3 个 opencode + 2 个 delphi 条目 id 全部出现
    for (const id of OPENCODE_IDS) expect(driftLine!).toContain(id.id);
    for (const id of DELPHI_IDS) expect(driftLine!).toContain(id.id);
  });
});
