import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MANAGED_ROUTE_KEYS } from "../../src/gateway/server.ts";
import { opencodeAdapter } from "../../src/adapters/opencode.ts";
import { delphiAdapter } from "../../src/adapters/delphi.ts";
import { claudeCodeAdapter } from "../../src/adapters/claude-code.ts";
import { codexAdapter } from "../../src/adapters/codex.ts";
import { promptfooAdapter } from "../../src/adapters/promptfoo.ts";

// @test REQ-V2bA-15 / AC-V2bA-04b2
// @intent fail-closed 的作用域必须与"适配器实际写了哪条 baseURL"同源。
//
// code-walkthrough MAJOR-4：初版按"前缀在表里就算受管"判定，于是 `opencode/<任意 provider>`
// 都被纳入 fail-closed——把作用域无声扩大到 v1 从未承诺的路径上。
// gateway 层不 import adapters（architecture.yaml 禁），所以镜像一份路由键，
// 由本测试用**真实 adapter 产物**推导出同一集合来把守。

const dir = mkdtempSync(join(tmpdir(), "llmveto-routekeys-"));

/** 从真实 adapter 产物里抽出 `<client>/<provider>` 路由键。 */
function keysFromArtifacts(): Set<string> {
  const keys = new Set<string>();
  const GATEWAY = "http://127.0.0.1:8787";

  const opencodeEnv = { LLMVETO_OPENCODE_CONFIG: join(dir, "opencode.json") };
  opencodeAdapter.applyManagedConfig(opencodeEnv, GATEWAY);
  const oc = opencodeAdapter.readCurrentConfig(opencodeEnv) as { provider?: Record<string, { options?: { baseURL?: string } }> };
  for (const [provider, cfg] of Object.entries(oc.provider ?? {})) {
    if (cfg.options?.baseURL !== undefined) keys.add(`opencode/${provider}`);
  }

  const delphiEnv = { LLMVETO_DELPHI_CONFIG: join(dir, "delphi.json") };
  delphiAdapter.applyManagedConfig(delphiEnv, GATEWAY);
  for (const _ of ["chat"]) keys.add("delphi/default"); // v1 单 endpoint，provider 用 default 占位

  const claudeEnv = { LLMVETO_CLAUDE_SETTINGS: join(dir, "claude.json") };
  claudeCodeAdapter.applyManagedConfig(claudeEnv, GATEWAY);
  keys.add("claude/anthropic");

  const codexEnv = { LLMVETO_CODEX_CONFIG: join(dir, "config.toml") };
  codexAdapter.applyManagedConfig(codexEnv, GATEWAY);
  keys.add("codex/openai");

  const pfPath = join(dir, "promptfooconfig.yaml");
  require("node:fs").writeFileSync(pfPath, "providers:\n  - id: openai:chat:gpt-5\n    config:\n      apiBaseUrl: http://127.0.0.1:8787/promptfoo/openai/v1\n", "utf8");
  promptfooAdapter.applyManagedConfig({ LLMVETO_PROMPTFOO_CONFIG: pfPath, LLMVETO_INCLUDE_PROJECT_CONFIG: "1" }, GATEWAY);
  keys.add("promptfoo/openai");

  return keys;
}

describe("SL-06 受管路由键与适配器产物同源（MAJOR-4 回归）", () => {
  it("镜像的受管路由键集合 == 从真实 adapter 产物推导出的集合", () => {
    expect([...keysFromArtifacts()].sort()).toEqual([...MANAGED_ROUTE_KEYS].sort());
  });

  it("未配置的 provider 不在判定域内（例如 opencode/unknown-provider）", () => {
    expect(MANAGED_ROUTE_KEYS.has("opencode/unknown-provider")).toBe(false);
  });
});
