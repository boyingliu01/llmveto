import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claudeCodeAdapter, MANAGED_CONFIG_IDS } from "../../../src/adapters/claude-code.ts";

// @test REQ-V2bA-06 / AC-V2bA-06a~c
// @intent Claude Code 的受管项是 `~/.claude/settings.json` 的 `env.ANTHROPIC_BASE_URL`
//         （官方 settings 参考原文示例即此写法；settings 的 env 覆盖 shell 同名变量）。
//
// **凭据变量不纳管**（AC-V2bA-06c）：本项目是通道安全网关，不是凭据托管。
// 代填 ANTHROPIC_AUTH_TOKEN 会把密钥搬进第二个地方，与 T1b 的立场冲突。

const dir = mkdtempSync(join(tmpdir(), "llmveto-claude-"));

const SETTINGS = join(dir, "settings.json");

function env(): Record<string, string> {
  return { LLMVETO_CLAUDE_SETTINGS: SETTINGS };
}

describe("SL-08 Claude Code 适配器（REQ-V2bA-06）", () => {
  it("受管项恰好一个：env.ANTHROPIC_BASE_URL", () => {
    expect(MANAGED_CONFIG_IDS.map((c) => c.id)).toEqual(["claude.settings.env.ANTHROPIC_BASE_URL"]);
  });

  it("写入后读回、漂移为空（AC-V2bA-06a）", () => {
    const path = claudeCodeAdapter.applyManagedConfig(env(), "http://127.0.0.1:8787");
    expect(path).toBe(SETTINGS);
    const current = claudeCodeAdapter.readCurrentConfig(env());
    expect((current.env as Record<string, string>).ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:8787/claude/anthropic");
    expect(claudeCodeAdapter.detectDrift(current, "http://127.0.0.1:8787")).toEqual([]);
  });

  it("手工改值后检出漂移条目 id（AC-V2bA-06b）", () => {
    const p = SETTINGS;
    const cfg = JSON.parse(readFileSync(p, "utf8")) as { env: Record<string, string> };
    cfg.env.ANTHROPIC_BASE_URL = "https://api.anthropic.com";
    writeFileSync(p, JSON.stringify(cfg), "utf8");
    const drift = claudeCodeAdapter.detectDrift(claudeCodeAdapter.readCurrentConfig(env()), "http://127.0.0.1:8787");
    expect(drift.map((d) => d.id)).toEqual(["claude.settings.env.ANTHROPIC_BASE_URL"]);
  });

  it("不写、不读、不比较凭据变量（AC-V2bA-06c）", () => {
    claudeCodeAdapter.applyManagedConfig(env(), "http://127.0.0.1:8787");
    const raw = readFileSync(SETTINGS, "utf8");
    expect(raw).not.toContain("ANTHROPIC_AUTH_TOKEN");
    expect(raw).not.toContain("ANTHROPIC_API_KEY");
    // 源码层面同样没有任何写入动作
    const src = readFileSync(new URL("../../../src/adapters/claude-code.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/ANTHROPIC_AUTH_TOKEN"\s*:/);
  });

  it("保留用户已有的其它 settings 键（深合并，不覆盖）", () => {
    const p = join(dir, "keep.json");
    writeFileSync(p, JSON.stringify({ permissions: { allow: ["Bash"] }, env: { FOO: "bar" } }), "utf8");
    claudeCodeAdapter.applyManagedConfig({ LLMVETO_CLAUDE_SETTINGS: p }, "http://127.0.0.1:8787");
    const out = JSON.parse(readFileSync(p, "utf8")) as { permissions: unknown; env: Record<string, string> };
    expect(out.permissions).toEqual({ allow: ["Bash"] });
    expect(out.env.FOO).toBe("bar");
    expect(out.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:8787/claude/anthropic");
  });

  it("配置文件缺失 → 全漂移（fail-closed，不静默通过）", () => {
    const missing = { LLMVETO_CLAUDE_SETTINGS: join(dir, "nope", "settings.json") };
    const drift = claudeCodeAdapter.detectDrift(claudeCodeAdapter.readCurrentConfig(missing), "http://127.0.0.1:8787");
    expect(drift.length).toBe(1);
  });
});
