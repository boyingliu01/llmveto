import type { Adapter, ConfigId } from "./index.ts";

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
    const url = gatewayBaseUrl.replace(/\/$/, "") + "/delphi";
    return {
      endpoint: {
        chat:   url + "/v1/chat/completions",
        stream: url + "/v1/chat/completions?stream=1",
      },
    };
  },
  detectDrift(current: Record<string, unknown>, gatewayBaseUrl: string): readonly ConfigId[] {
    const base = gatewayBaseUrl.replace(/\/$/, "") + "/delphi";
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
};
