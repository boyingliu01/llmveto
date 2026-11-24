// @no-test-required: 测试在 tests/unit/adapters/promptfoo.test.ts（本项目测试布局为 tests/ 目录；Gate 5a 仅识别同目录/根 tests/ 六种路径）
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Adapter, ConfigId, Env } from "./index.ts";
import { writePromptfooScalar } from "./promptfoo-io.ts";

/**
 * @test REQ-V2bA-08 / AC-V2bA-08a~c
 * @intent promptfoo 适配器：项目级 `promptfooconfig.yaml` 的 `providers[].config.apiBaseUrl`。
 *
 * 这个适配器与另两个**语义不同**，原因都在官方文档里：
 *   - 配置是**项目级**的（"promptfoo eval reads promptfooconfig.yaml in your current directory"），
 *     通常进版本库、与团队共享，所以默认只报告、写入需显式 opt-in；
 *   - baseURL 必须用 `config.apiBaseUrl`（含协议/端口/自定义路径）：`apiHost` 只会拼成
 *     `https://<host>/v1`，在本地网关上直接失效。
 *
 * 受管 provider 用**稳定标识**（`id`，缺省退 `config.label`），不用数组下标——
 * 用户增删 provider 不该被读成漂移。
 */

/**
 * 受管 provider 的判定：**所有** openai 兼容 provider 都受管。
 *
 * 为什么不是"只第一个"：同一份配置里可以有多个 provider，只把第一个指向网关，
 * 其余的照旧直连官方——那正是本需求要消灭的覆盖缺口（配了网关 ≠ 被保护）。
 * 受管项以**稳定标识**（provider id）一一定名，不用数组下标。
 */
function isManagedProvider(entry: { id: string }): boolean {
  return entry.id.startsWith("openai:");
}

/** 某个 provider 的受管项 id。 */
function managedIdOf(providerId: string): string {
  return `promptfoo.provider.${providerId}.config.apiBaseUrl`;
}

/** 受管项清单（每个 openai 兼容 provider 一条）。 */
export const MANAGED_CONFIG_IDS: readonly ConfigId[] = Object.freeze([
  { id: managedIdOf("openai:chat:<model>"), description: "promptfoo providers[<openai 兼容 id>].config.apiBaseUrl（网关地址）" },
]);

/** 期望的 base URL：`<gw>/promptfoo/openai/v1`（apiBaseUrl 含 API 前缀）。 */
function expectedBaseUrl(gatewayBaseUrl: string): string {
  return `${gatewayBaseUrl.replace(/\/+$/, "")}/promptfoo/openai/v1`;
}

/**
 * 配置文件定位：env 覆写 → cwd 的 `promptfooconfig.yaml` → `promptfooconfig.yml`。
 * @param cwd 调用方的工作目录（CLI 里就是 process.cwd()；测试注入临时目录）
 */
export function promptfooConfigPath(env: Env, cwd: string = process.cwd()): string {
  if (env.LLMVETO_PROMPTFOO_CONFIG) return env.LLMVETO_PROMPTFOO_CONFIG;
  const yaml = join(cwd, "promptfooconfig.yaml");
  if (existsSync(yaml)) return yaml;
  const yml = join(cwd, "promptfooconfig.yml");
  return existsSync(yml) ? yml : yaml;
}

/** 一个 provider 条目在 YAML 里的关键信息（极简解析：只认本适配器关心的形状）。 */
interface ProviderEntry {
  readonly id: string;
  readonly apiBaseUrl?: string;
  readonly apiHost?: string;
  readonly line: number;
}

/**
 * 极简 YAML 扫描：只提取 `providers:` 列表里的条目与它们的 `config.apiBaseUrl` / `config.apiHost`。
 *
 * 刻意不引入 YAML 库：受管面只有"一个标量值"，而引入库就要承担它的解析/序列化行为
 * （注释与排版全部重写，和 Codex 的 TOML 是同一个问题）。定位用行扫描，替换用行级编辑。
 */
function scanProviders(text: string): ProviderEntry[] {
  const lines = text.split(/\r?\n/);
  const out: ProviderEntry[] = [];
  let inProviders = false;
  let current: { id: string; apiBaseUrl?: string; apiHost?: string; line: number } | null = null;
  const flush = () => {
    if (current !== null) out.push(current);
    current = null;
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (/^[A-Za-z_]+:/.test(line)) {
      flush();
      inProviders = line.startsWith("providers:");
      continue;
    }
    if (!inProviders) continue;
    const idMatch = /^\s*-\s+(?:id:\s*)?(\S+)\s*$/.exec(line);
    if (idMatch !== null) {
      flush();
      current = { id: idMatch[1]!.replace(/^["']|["']$/g, ""), line: i };
      continue;
    }
    if (current === null) continue;
    const kv = /^\s+(apiBaseUrl|apiHost):\s*(.+?)\s*$/.exec(line);
    if (kv !== null) {
      const value = kv[2]!.replace(/^["']|["']$/g, "");
      if (kv[1] === "apiBaseUrl") current.apiBaseUrl = value;
      else current.apiHost = value;
    }
  }
  flush();
  return out;
}

/** 读到的配置对象视图（供 detectDrift / unmanagedReason 使用）。 */
interface PromptfooConfig {
  readonly providers: readonly ProviderEntry[];
}

function asConfig(current: Record<string, unknown>): readonly ProviderEntry[] {
  const providers = current.providers;
  return Array.isArray(providers) ? (providers as ProviderEntry[]) : [];
}

export interface PromptfooAdapter extends Adapter {
  /** 默认是否写项目文件（恒为 false：写入必须显式 opt-in）。 */
  readonly writesProjectConfigByDefault: boolean;
  /** 若配置用了替代手段（apiHost 等）覆盖 baseURL，返回人类可读原因；否则 undefined。 */
  unmanagedReason(current: Record<string, unknown>): string | undefined;
}

export const promptfooAdapter: PromptfooAdapter = {
  name: "promptfoo",
  MANAGED_CONFIG_IDS,
  writesProjectConfigByDefault: false,
  defaultConfigPath(env: Env): string {
    return promptfooConfigPath(env);
  },
  buildPatch(gatewayBaseUrl: string): Record<string, unknown> {
    return { providers: [{ id: "openai:chat:<model>", config: { apiBaseUrl: expectedBaseUrl(gatewayBaseUrl) } }] };
  },
  readCurrentConfig(env: Env): Record<string, unknown> {
    const path = this.defaultConfigPath(env);
    if (!existsSync(path)) return { providers: [] };
    let text = "";
    try {
      text = readFileSync(path, "utf8");
    } catch {
      return { providers: [], __unreadable: true };
    }
    // 有内容却扫不出一条 provider：可能是"空项目"，也可能是"格式不认识"。
    // 把"一个 provider 都没有但文件非空"标出来，由 doctor 报 drift 而不是绿灯
    // （code-walkthrough R2：坏配置此前落 coverage_unknown，状态不对）。
    const providers = scanProviders(text);
    const hasProviderKey = /^providers:\s*$/m.test(text);
    if (providers.length === 0 && hasProviderKey) return { providers: [], __unreadable: true };
    return { providers };
  },
  detectDrift(current: Record<string, unknown>, gatewayBaseUrl: string): readonly ConfigId[] {
    // 没有任何 provider = 这个项目还没用 promptfoo（或没配 provider），属"未配置"而不是"漂移"。
    // 会在每个项目里都报漂移的适配器，等于把告警变成噪音。
    if (asConfig(current).length === 0) return [];
    const wanted = expectedBaseUrl(gatewayBaseUrl);
    const drifted: ConfigId[] = [];
    for (const p of asConfig(current)) {
      if (!isManagedProvider(p)) continue;
      // 用替代手段指定端点（apiHost）：由 unmanagedReason 报，不计漂移
      if (p.apiHost !== undefined) continue;
      if (p.apiBaseUrl !== wanted) drifted.push({ id: managedIdOf(p.id), description: `promptfoo provider ${p.id} 的 apiBaseUrl` });
    }
    // 一个 openai 兼容 provider 都没有 → 该客户端根本没在使用本网关
    if (drifted.length === 0 && !asConfig(current).some(isManagedProvider)) return MANAGED_CONFIG_IDS;
    return drifted;
  },
  unmanagedReason(current: Record<string, unknown>): string | undefined {
    const withHost = asConfig(current).filter((p) => p.apiHost !== undefined);
    if (withHost.length === 0) return undefined;
    return `unmanaged: ${withHost.map((p) => p.id).join(", ")} 用 apiHost 指定端点（apiHost 只拼 https://<host>/v1，无法指向本地网关）`;
  },
  applyManagedConfig(env: Env, gatewayBaseUrl: string): string {
    const path = this.defaultConfigPath(env);
    // 项目级文件默认只报告；写入必须显式 opt-in（AC-V2bA-08a）。
    if (env.LLMVETO_INCLUDE_PROJECT_CONFIG !== "1") return path;
    // 项目级配置不存在时**显式失败**：本适配器不创建项目文件（那等于替用户开一个新项目），
    // 而"没写却报告成功"会让 doctor 的写盘项说谎。
    if (!existsSync(path)) throw new Error(`promptfoo 配置不存在：${path}（本适配器不创建项目文件；请先用 promptfoo eval 生成）`);
    for (const p of asConfig(this.readCurrentConfig(env))) {
      if (isManagedProvider(p)) writePromptfooScalar(path, p.id, "apiBaseUrl", expectedBaseUrl(gatewayBaseUrl));
    }
    return path;
  },
};
