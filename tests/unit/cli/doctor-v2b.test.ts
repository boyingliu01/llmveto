import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../../../src/cli/index.ts";
import { clientCoverageChecks } from "../../../src/cli/client-coverage.ts";

// @test REQ-V2bA-09 / REQ-V2bA-10 / AC-V2bA-09a~b / AC-V2bA-10a~b
// @intent doctor 对每个受管客户端给**封闭六态**之一：
//         not_installed / not_configured / drift / coverage_missing / coverage_unknown / write_failed
//
// 五态不够用是因为"线格式无法确定"必须有独立出口（R2 CRITICAL-3）：
// 把它折算成"有覆盖"或"无覆盖"都是在给确定性错误结论；折算成 not_configured 又会让人以为没配。
// 退出码：not_installed / not_configured → 0；其余四态 → 1。

const dir = mkdtempSync(join(tmpdir(), "llmveto-doctor-v2b-"));

function claudeEnv(path: string | null): Record<string, string> {
  return path === null ? {} : { LLMVETO_CLAUDE_SETTINGS: path };
}

describe("SL-11 doctor 六态（REQ-V2bA-09）", () => {
  it("not_installed：配置文件与父目录都不存在 → 不影响退出码", () => {
    const checks = clientCoverageChecks({ LLMVETO_CLAUDE_SETTINGS: join(dir, "absent", "settings.json") }, "http://127.0.0.1:8787");
    const claude = checks.find((c) => c.client === "claude-code")!;
    expect(claude.state).toBe("not_installed");
    expect(claude.failsDoctor).toBe(false);
  });

  it("not_configured：文件存在但没有受管键", () => {
    const p = join(dir, "settings-nokeys.json");
    writeFileSync(p, JSON.stringify({ permissions: {} }), "utf8");
    const checks = clientCoverageChecks(claudeEnv(p), "http://127.0.0.1:8787");
    const claude = checks.find((c) => c.client === "claude-code")!;
    expect(claude.state).toBe("not_configured");
    expect(claude.failsDoctor).toBe(false);
  });

  it("drift：受管键存在但值不符 → 失败", () => {
    const p = join(dir, "settings-drift.json");
    writeFileSync(p, JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://api.anthropic.com" } }), "utf8");
    const checks = clientCoverageChecks(claudeEnv(p), "http://127.0.0.1:8787");
    const claude = checks.find((c) => c.client === "claude-code")!;
    expect(claude.state).toBe("drift");
    expect(claude.failsDoctor).toBe(true);
  });

  it("已配置且线格式有覆盖 → 不是失败态", () => {
    mkdirSync(join(dir, "ok"), { recursive: true });
    const p = join(dir, "ok", "settings.json");
    writeFileSync(p, JSON.stringify({ env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:8787/claude/anthropic" } }), "utf8");
    const checks = clientCoverageChecks(claudeEnv(p), "http://127.0.0.1:8787");
    const claude = checks.find((c) => c.client === "claude-code")!;
    expect(claude.failsDoctor).toBe(false);
    expect(claude.state).not.toBe("coverage_missing");
  });

  it("coverage_unknown：线格式无法确定 → 失败但不折算成 missing/ok（AC-V2bA-10a）", () => {
    // 造一个"已配置且无漂移"的 promptfoo 项目配置，让判定走到覆盖这一步
    const pfDir = join(dir, "pf");
    mkdirSync(pfDir, { recursive: true });
    const pfPath = join(pfDir, "promptfooconfig.yaml");
    writeFileSync(pfPath, "providers:\n  - id: openai:chat:gpt-5\n    config:\n      apiHost: gw.example.com\n", "utf8");
    const checks = clientCoverageChecks({ LLMVETO_PROMPTFOO_CONFIG: pfPath }, "http://127.0.0.1:8787");
    const pf = checks.find((c) => c.client === "promptfoo")!;
    expect(pf.state).toBe("coverage_unknown");
    expect(pf.failsDoctor).toBe(true); // 报 unknown 要失败，不能算通过
    expect(pf.message).toMatch(/无法确定/);
  });

  it("每个受管客户端都有一条检查项，且状态取自封闭六态", () => {
    const checks = clientCoverageChecks({}, "http://127.0.0.1:8787");
    const states = new Set([
      "not_installed",
      "not_configured",
      "drift",
      "coverage_missing",
      "coverage_unknown",
      "write_failed",
      "coverage_ok",
    ]);
    for (const c of checks) expect(states.has(c.state), `${c.client} 的状态 ${c.state} 不在封闭枚举内`).toBe(true);
    expect(checks.map((c) => c.client)).toEqual(["opencode", "delphi", "claude-code", "codex", "promptfoo"]);
  });

  it("doctor 输出包含每条客户端检查项（接线断言）", async () => {
    const r = await runCli("doctor", {
      stateDir: dir,
      args: [],
      env: { LLMVETO_GATEWAY_URL: "http://127.0.0.1:1", LLMVETO_CLAUDE_SETTINGS: join(dir, "absent2", "s.json") },
    });
    expect(r.stdout).toContain("doctor.client-coverage");
    expect(r.stdout).toContain("claude-code");
  });
});
