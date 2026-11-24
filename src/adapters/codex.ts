// @no-test-required: 测试在 tests/unit/adapters/codex.test.ts（本项目测试布局为 tests/ 目录；Gate 5a 仅识别同目录/根 tests/ 六种路径）
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import type { Adapter, ConfigId, Env } from "./index.ts";
import { readCodexToml, writeCodexToml } from "./codex-io.ts";

/**
 * @test REQ-V2bA-07 / AC-V2bA-07a~c / REQ-V2bA-08a
 * @intent Codex 适配器：`~/.codex/config.toml` 的 `model_providers.llmveto.{base_url,wire_api}`。
 *
 * 依据（官方 config-reference 原文）：`model_providers.<id>.wire_api` 的取值
 * "`responses` is the only supported value"，即 Codex 只说 Responses 协议。
 * 因为这是唯一支持值，把 `wire_api` 一并钉成受管项是为了**发现用户把它改成别的**
 * （改了那台 Codex 就不在网关能理解的线格式上了）。
 *
 * 写回策略（DR-031 / 设计 D-05）：**定点编辑**。
 * 解析只用于定位与校验，替换按行精确匹配；除目标键外逐字节相同（含注释、键序、CRLF）。
 * 全量 parse→stringify 会丢掉用户所有注释——可测但不可接受。
 */

/** Codex 侧的 provider id：固定保留值，不与用户的其它 provider 混。 */
const PROVIDER_ID = "llmveto";

export const MANAGED_CONFIG_IDS: readonly ConfigId[] = Object.freeze([
  { id: `codex.model_providers.${PROVIDER_ID}.base_url`, description: "Codex model_providers.llmveto.base_url（网关地址）" },
  { id: `codex.model_providers.${PROVIDER_ID}.wire_api`, description: "Codex model_providers.llmveto.wire_api（必须为 responses）" },
]);

/** 期望的 base URL：`<gw>/codex/openai/v1`（Codex 的 base_url 按 Responses 语义已含 /v1）。 */
function expectedBaseUrl(gatewayBaseUrl: string): string {
  return `${gatewayBaseUrl.replace(/\/+$/, "")}/codex/openai/v1`;
}

/** 从已解析 TOML 中取 `model_providers.llmveto` 表（缺失/非对象 → undefined）。 */
function providerTable(current: Record<string, unknown>): Record<string, unknown> | undefined {
  const providers = current.model_providers;
  if (!providers || typeof providers !== "object") return undefined;
  const table = (providers as Record<string, unknown>)[PROVIDER_ID];
  return table && typeof table === "object" ? (table as Record<string, unknown>) : undefined;
}

/** 检测单条受管键的漂移。 */
function isDrifted(id: ConfigId, table: Record<string, unknown> | undefined, gatewayBaseUrl: string): boolean {
  if (table === undefined) return true;
  if (id.id.endsWith(".base_url")) return table.base_url !== expectedBaseUrl(gatewayBaseUrl);
  return table.wire_api !== "responses";
}

export const codexAdapter: Adapter = {
  name: "codex",
  MANAGED_CONFIG_IDS,
  buildPatch(gatewayBaseUrl: string): Record<string, unknown> {
    return { model_providers: { [PROVIDER_ID]: { base_url: expectedBaseUrl(gatewayBaseUrl), wire_api: "responses" } } };
  },
  detectDrift(current: Record<string, unknown>, gatewayBaseUrl: string): readonly ConfigId[] {
    const table = providerTable(current);
    return MANAGED_CONFIG_IDS.filter((id) => isDrifted(id, table, gatewayBaseUrl));
  },
  defaultConfigPath(env: Env): string {
    return env.LLMVETO_CODEX_CONFIG ?? join(homedir(), ".codex", "config.toml");
  },
  readCurrentConfig(env: Env): Record<string, unknown> {
    // 读失败/不可解析 → {}（全漂移），与 JSON 适配器同语义：绝不把"读不到"当成"配好了"
    try {
      return parseToml(readCodexToml(this.defaultConfigPath(env))) as Record<string, unknown>;
    } catch {
      return {};
    }
  },
  applyManagedConfig(env: Env, gatewayBaseUrl: string): string {
    const path = this.defaultConfigPath(env);
    writeCodexToml(path, {
      table: `model_providers.${PROVIDER_ID}`,
      keys: {
        base_url: expectedBaseUrl(gatewayBaseUrl),
        wire_api: "responses",
      },
    });
    return path;
  },
};
