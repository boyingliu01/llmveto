// @no-test-required: 测试在 tests/unit/adapters/claude-code.test.ts（本项目测试布局为 tests/ 目录；Gate 5a 仅识别同目录/根 tests/ 六种路径）
import { homedir } from "node:os";
import { join } from "node:path";
import type { Adapter, ConfigId, Env } from "./index.ts";
import { applyManagedPatch, readManagedConfig } from "./config-io.ts";

/**
 * @test REQ-V2bA-06 / AC-V2bA-06a~c
 * @intent Claude Code 适配器：`~/.claude/settings.json` 的 `env.ANTHROPIC_BASE_URL`。
 *
 * 依据（官方 settings 参考原文示例）：
 *   { "env": { "ANTHROPIC_BASE_URL": "https://proxy.example.com" } }
 * settings 里的 `env` 会覆盖 shell 里的同名变量，因此这是"只改一个文件就生效"的形态。
 *
 * **凭据变量刻意不纳管**：`ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` 由用户自己配。
 * 本项目的定位是通道安全网关，不是凭据托管——代填会把密钥搬进第二个地方（对 T1b 是扩大暴露面）。
 * 代价：用户未自备凭据时 Claude Code 会报 401 或沿用 claude.ai 登录态；doctor 会提示这一点，
 * 但适配器**不会**臆造凭据。
 *
 * 路径约定：`<gw>/claude/anthropic`。前缀 `claude` 既是识别权威（设计 §2.4），
 * 也是 fail-closed 的作用域来源；provider 段取 `anthropic` 与既有 `<client>/<provider>` 结构一致。
 */

export const MANAGED_CONFIG_IDS: readonly ConfigId[] = Object.freeze([
  {
    id: "claude.settings.env.ANTHROPIC_BASE_URL",
    description: "Claude Code settings.json 的 env.ANTHROPIC_BASE_URL（网关 base URL）",
  },
]);

/** 期望的 base URL：`<gw>/claude/anthropic`。 */
function expectedBaseUrl(gatewayBaseUrl: string): string {
  return joinBase(joinBase(gatewayBaseUrl, "claude"), "anthropic");
}

function joinBase(base: string, segment: string): string {
  return base.replace(/\/+$/, "") + "/" + segment;
}

/** 取 settings.env.ANTHROPIC_BASE_URL（缺失/非字符串 → undefined）。 */
function readBaseUrl(current: Record<string, unknown>): string | undefined {
  const env = current.env;
  if (!env || typeof env !== "object") return undefined;
  const value = (env as Record<string, unknown>).ANTHROPIC_BASE_URL;
  return typeof value === "string" ? value : undefined;
}

export const claudeCodeAdapter: Adapter = {
  name: "claude-code",
  MANAGED_CONFIG_IDS,
  buildPatch(gatewayBaseUrl: string): Record<string, unknown> {
    return { env: { ANTHROPIC_BASE_URL: expectedBaseUrl(gatewayBaseUrl) } };
  },
  detectDrift(current: Record<string, unknown>, gatewayBaseUrl: string): readonly ConfigId[] {
    return readBaseUrl(current) === expectedBaseUrl(gatewayBaseUrl) ? [] : MANAGED_CONFIG_IDS;
  },
  defaultConfigPath(env: Env): string {
    return env.LLMVETO_CLAUDE_SETTINGS ?? join(homedir(), ".claude", "settings.json");
  },
  readCurrentConfig(env: Env): Record<string, unknown> {
    return readManagedConfig(this, env);
  },
  applyManagedConfig(env: Env, gatewayBaseUrl: string): string {
    // 复用既有 JSON 写盘原语（REQ-V2bA-08a）：与 OpenCode/Delphi 同一条路径，不复制第二份实现。
    return applyManagedPatch(this, env, gatewayBaseUrl);
  },
};
