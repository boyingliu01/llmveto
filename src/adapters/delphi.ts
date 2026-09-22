import { homedir } from "node:os";
import { join } from "node:path";
import type { Adapter, ConfigId, Env } from "./index.ts";
import { deepMerge, readJsonConfig, writeJsonConfig } from "./config-io.ts";

/**
 * @test REQ-VETO-009
 * @intent Delphi 适配器：.delphi-config.json endpoint 覆写；v1 覆盖 2 个受管项。
 */

export const MANAGED_CONFIG_IDS: readonly ConfigId[] = Object.freeze([
  { id: "delphi.endpoint.chat",   description: "Delphi chat completions endpoint" },
  { id: "delphi.endpoint.stream", description: "Delphi stream completions endpoint" },
]);

export const delphiAdapter: Adapter = {
  name: "delphi",
  MANAGED_CONFIG_IDS,
  buildPatch(gatewayBaseUrl: string): Record<string, unknown> {
    // 路径路由约定：<gw>/delphi/<provider>/v1/chat/completions；v1 单 endpoint 用 "default" 占位
    const base = delphiBase(gatewayBaseUrl);
    return {
      endpoint: {
        chat:   base + "/v1/chat/completions",
        stream: base + "/v1/chat/completions?stream=1",
      },
    };
  },
  detectDrift(current: Record<string, unknown>, gatewayBaseUrl: string): readonly ConfigId[] {
    const base = delphiBase(gatewayBaseUrl);
    const expected: Record<string, string> = {
      "delphi.endpoint.chat":   base + "/v1/chat/completions",
      "delphi.endpoint.stream": base + "/v1/chat/completions?stream=1",
    };
    const ep = (current.endpoint ?? {}) as Record<string, string>;
    const drift: ConfigId[] = [];
    for (const id of MANAGED_CONFIG_IDS) {
      if (ep[id.id.split(".")[2]!] !== expected[id.id]) drift.push(id);
    }
    return drift;
  },
  defaultConfigPath(env: Env): string {
    return env.LLMVETO_DELPHI_CONFIG ?? join(homedir(), ".delphi-config.json");
  },
  readCurrentConfig(env: Env): Record<string, unknown> {
    return readJsonConfig(this.defaultConfigPath(env));
  },
  applyManagedConfig(env: Env, gatewayBaseUrl: string): string {
    const path = this.defaultConfigPath(env);
    const merged = deepMerge(readJsonConfig(path), this.buildPatch(gatewayBaseUrl));
    writeJsonConfig(path, merged);
    return path;
  },
};

function delphiBase(gatewayBaseUrl: string): string {
  return gatewayBaseUrl.replace(/\/$/, "") + "/delphi/default";
}
