import { homedir } from "node:os";
import { join } from "node:path";
import type { Adapter, ConfigId, Env } from "./index.ts";
import { applyManagedPatch, readManagedConfig } from "./config-io.ts";

/**
 * @test REQ-VETO-009
 * @intent OpenCode 适配器：provider.<id>.options.baseURL + OPENCODE_MODELS_URL
 *         v1 覆盖 3 个受管 provider（openai / anthropic / mock）。
 */

export const MANAGED_CONFIG_IDS: readonly ConfigId[] = Object.freeze([
  { id: "opencode.provider.openai.options.baseURL",     description: "OpenAI provider baseURL" },
  { id: "opencode.provider.anthropic.options.baseURL",  description: "Anthropic provider baseURL" },
  { id: "opencode.provider.mock.options.baseURL",       description: "Mock provider baseURL (test harness)" },
  { id: "opencode.env.OPENCODE_MODELS_URL",             description: "本地模型目录镜像 URL 锁定" },
]);

export const opencodeAdapter: Adapter = {
  name: "opencode",
  MANAGED_CONFIG_IDS,
  buildPatch(gatewayBaseUrl: string): Record<string, unknown> {
    // 路径路由约定：<gw>/opencode/<provider>，网关从路径推导 client+provider 身份
    const providerUrl = (key: string) => joinBase(joinBase(gatewayBaseUrl, "opencode"), key);
    return {
      provider: {
        openai:    { options: { baseURL: providerUrl("openai") } },
        anthropic: { options: { baseURL: providerUrl("anthropic") } },
        mock:      { options: { baseURL: providerUrl("mock") } },
      },
      env: { OPENCODE_MODELS_URL: joinBase(gatewayBaseUrl, "opencode") + "/models" },
    };
  },
  detectDrift(current: Record<string, unknown>, gatewayBaseUrl: string): readonly ConfigId[] {
    const provider = (current.provider ?? {}) as Record<string, { options?: { baseURL?: string } }>;
    const env = (current.env ?? {}) as Record<string, string>;
    return MANAGED_CONFIG_IDS.filter((id) => isDrifted(id, provider, env, gatewayBaseUrl));
  },
  defaultConfigPath(env: Env): string {
    return env.LLMVETO_OPENCODE_CONFIG ?? join(homedir(), ".config", "opencode", "opencode.json");
  },
  readCurrentConfig(env: Env): Record<string, unknown> {
    return readManagedConfig(this, env);
  },
  applyManagedConfig(env: Env, gatewayBaseUrl: string): string {
    return applyManagedPatch(this, env, gatewayBaseUrl);
  },
};

/**
 * 单条受管配置是否漂移：MODELS_URL 与 env 比对，其余条目与 provider.<KEY>.options.baseURL 比对。
 * 拆出来是为了让 detectDrift 本体只剩一次 filter（原实现循环内两层分支，CCN 8）。
 */
function isDrifted(
  id: ConfigId,
  provider: Record<string, { options?: { baseURL?: string } }>,
  env: Record<string, string>,
  gatewayBaseUrl: string,
): boolean {
  if (id.id === "opencode.env.OPENCODE_MODELS_URL") {
    return env.OPENCODE_MODELS_URL !== joinBase(gatewayBaseUrl, "opencode") + "/models";
  }
  const key = id.id.split(".")[2]; // "opencode.provider.<KEY>.options.baseURL"
  if (!key) return false;
  return provider[key]?.options?.baseURL !== joinBase(joinBase(gatewayBaseUrl, "opencode"), key);
}

function joinBase(base: string, seg: string): string {
  return base.replace(/\/$/, "") + "/" + seg;
}
