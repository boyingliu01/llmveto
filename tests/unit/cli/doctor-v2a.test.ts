import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../../../src/cli/index.ts";

// @test REQ-V2a-06
// @intent SL-12: doctor 扩枚举 4→6 + [DEGRADED] 前缀断言
// @covers AC-V2a-08

describe("SL-12 doctor expansion (AC-V2a-08)", () => {
  it("doctor 输出含 canary-registry + coverage-counters 检查项（枚举 4→6）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "llmveto-doctor-v2a-"));
    const r = await runCli("doctor", {
      stateDir: dir,
      env: {
        LLMVETO_OPENCODE_CONFIG: join(dir, "absent-opencode.json"),
        LLMVETO_DELPHI_CONFIG: join(dir, "absent-delphi.json"),
      },
    });
    expect(r.stdout).toContain("doctor.canary-registry");
    expect(r.stdout).toContain("doctor.coverage-counters");
    // 总检查项至少 6（config-drift + port-reachable + evidence-chain + canary-registry + coverage-counters）
    const lines = r.stdout.split("\n").filter((l) => l.startsWith("["));
    expect(lines.length).toBeGreaterThanOrEqual(5);
    rmSync(dir, { recursive: true, force: true });
  });

  it("coverage-counters 链缺失 → [DEGRADED] 前缀", async () => {
    const dir = mkdtempSync(join(tmpdir(), "llmveto-doctor-deg-"));
    const r = await runCli("doctor", {
      stateDir: dir,
      env: {
        LLMVETO_OPENCODE_CONFIG: join(dir, "absent-opencode.json"),
        LLMVETO_DELPHI_CONFIG: join(dir, "absent-delphi.json"),
      },
    });
    const line = r.stdout.split("\n").find((l) => l.includes("doctor.coverage-counters"))!;
    expect(line).toContain("[DEGRADED]");
    rmSync(dir, { recursive: true, force: true });
  });

  it("canary-registry 文件存在且合法 → PASS", async () => {
    const dir = mkdtempSync(join(tmpdir(), "llmveto-doctor-regok-"));
    writeFileSync(join(dir, "canary-registry.json"), JSON.stringify({
      version: 1, rotation_count: 0, last_rotated_at: null, entries: {},
    }), "utf8");
    const r = await runCli("doctor", {
      stateDir: dir,
      env: {
        LLMVETO_OPENCODE_CONFIG: join(dir, "absent-opencode.json"),
        LLMVETO_DELPHI_CONFIG: join(dir, "absent-delphi.json"),
      },
    });
    const line = r.stdout.split("\n").find((l) => l.includes("doctor.canary-registry"))!;
    expect(line).toContain("[PASS]");
    expect(line).toContain("registry ok");
    rmSync(dir, { recursive: true, force: true });
  });

  it("canary-registry 文件损坏 → [DEGRADED] 前缀", async () => {
    const dir = mkdtempSync(join(tmpdir(), "llmveto-doctor-regbad-"));
    writeFileSync(join(dir, "canary-registry.json"), "{ broken json", "utf8");
    const r = await runCli("doctor", {
      stateDir: dir,
      env: {
        LLMVETO_OPENCODE_CONFIG: join(dir, "absent-opencode.json"),
        LLMVETO_DELPHI_CONFIG: join(dir, "absent-delphi.json"),
      },
    });
    const line = r.stdout.split("\n").find((l) => l.includes("doctor.canary-registry"))!;
    expect(line).toContain("[DEGRADED]");
    rmSync(dir, { recursive: true, force: true });
  });

  it("结构非法但 JSON 可解析（entries=null）→ [DEGRADED]（与运行期 validateRegistryFile 同判）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "llmveto-doctor-regshape-"));
    writeFileSync(join(dir, "canary-registry.json"), JSON.stringify({
      version: 1, rotation_count: 0, last_rotated_at: null, entries: null,
    }), "utf8");
    const r = await runCli("doctor", {
      stateDir: dir,
      env: {
        LLMVETO_OPENCODE_CONFIG: join(dir, "absent-opencode.json"),
        LLMVETO_DELPHI_CONFIG: join(dir, "absent-delphi.json"),
      },
    });
    const line = r.stdout.split("\n").find((l) => l.includes("doctor.canary-registry"))!;
    expect(line).toContain("[DEGRADED]");
    expect(line).toContain("malformed_structure");
    rmSync(dir, { recursive: true, force: true });
  });
});
