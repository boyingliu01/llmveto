import { homedir } from "node:os";
import { join } from "node:path";
import type { Adapter, ConfigId, Env } from "./index.ts";
import { deepMerge, readJsonConfig, readJsonConfigStrict, writeJsonConfig } from "./config-io.ts";

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
    const providerUrl = (key: string) => joinBase(joinBase(gatewayBaseUrl, "opencode"), key);
    const drift: ConfigId[] = [];
    const provider = (current.provider ?? {}) as Record<string, { options?: { baseURL?: string } }>;
    for (const id of MANAGED_CONFIG_IDS) {
      if (id.id === "opencode.env.OPENCODE_MODELS_URL") {
        const env = (current.env ?? {}) as Record<string, string>;
        if (env.OPENCODE_MODELS_URL !== joinBase(gatewayBaseUrl, "opencode") + "/models") drift.push(id);
        continue;
      }
      const key = id.id.split(".")[2]; // "opencode.provider.<KEY>.options.baseURL"
      if (!key) continue;
      const url = provider[key]?.options?.baseURL;
      if (url !== providerUrl(key)) drift.push(id);
    }
    return drift;
  },
  defaultConfigPath(env: Env): string {
    return env.LLMVETO_OPENCODE_CONFIG ?? join(homedir(), ".config", "opencode", "opencode.json");
  },
  readCurrentConfig(env: Env): Record<string, unknown> {
    return readJsonConfig(this.defaultConfigPath(env));
  },
  applyManagedConfig(env: Env, gatewayBaseUrl: string): string {
    const path = this.defaultConfigPath(env);
    const merged = deepMerge(readJsonConfigStrict(path), this.buildPatch(gatewayBaseUrl));
    writeJsonConfig(path, merged);
    return path;
  },
};

function joinBase(base: string, seg: string): string {
  return base.replace(/\/$/, "") + "/" + seg;
}
