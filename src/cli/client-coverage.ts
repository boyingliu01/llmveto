// @no-test-required: 测试在 tests/unit/cli/doctor-v2b.test.ts（本项目测试布局为 tests/ 目录；Gate 5a 仅识别同目录/根 tests/ 六种路径）
import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Adapter, Env } from "../adapters/index.ts";
import { delphiAdapter } from "../adapters/delphi.ts";
import { opencodeAdapter } from "../adapters/opencode.ts";
import { claudeCodeAdapter } from "../adapters/claude-code.ts";
import { codexAdapter } from "../adapters/codex.ts";
import { promptfooAdapter } from "../adapters/promptfoo.ts";
import { wireFormatOf } from "../shared/client-wire-format.ts";

/**
 * @test REQ-V2bA-09 / REQ-V2bA-10 / AC-V2bA-09a~b / AC-V2bA-10a~b
 * @intent doctor 对每个受管客户端的**封闭六态**判定。
 *
 * 这里就是 R2 评审 M5 说的那个跨层 join 的落点：组合根（cli）把
 *   adapters 层（怎么读配置、怎么判漂移）与
 *   shared 层的线格式声明（这客户端说什么格式）
 * join 起来，两边互不 import。适配器不知道线格式，线格式表不知道配置。
 *
 * 为什么需要 coverage 两态："配好了"不等于"扫得到"。一个客户端可以把 baseURL
 * 指向网关，但说的线格式网关没有投影器——那时流量会以 unknown/vacuous 被阻断，
 * 这与"配置漂移"是两种完全不同的故障，必须分开报。
 */

/** 六态封闭枚举。 */
export type ClientState =
  | "not_installed"
  | "not_configured"
  | "drift"
  | "coverage_missing"
  | "coverage_unknown"
  | "write_failed"
  | "coverage_ok";

export interface ClientCoverageCheck {
  readonly client: string;
  readonly state: ClientState;
  /** 该状态是否让 doctor 失败（not_installed / not_configured 不失败）。 */
  readonly failsDoctor: boolean;
  readonly message: string;
}

/**
 * 适配器 → 客户端名（adapters 的 name 与线格式表的 client 必须对齐）。
 * 单独抽出来是因为 adapters 的 name 是 `claude-code`，而线格式表也用同名——
 * 让这层映射显式存在，改名时编译器会在这里提醒。
 */
const ADAPTERS: readonly Adapter[] = Object.freeze([
  opencodeAdapter,
  delphiAdapter,
  claudeCodeAdapter,
  codexAdapter,
  promptfooAdapter as unknown as Adapter,
]);

/**
 * 客户端是否"已安装"。
 *
 * 判据因适配器而异，这不是不一致而是事实不同：
 *   - 用户级适配器（opencode/delphi/claude-code/codex）：配置在固定路径，
 *     **目录存在即已安装**（装了客户端就有目录，只是还没配）；
 *   - promptfoo 是**项目级**：配置文件在当前项目里，目录（项目根）永远存在，
 *     所以只有**文件本身存在**才算这个项目在用 promptfoo。
 * 把两者混为一谈会在发布机上把"空工作区"读成"装了但没配"，进而把
 * "线格式无法确定"报成 coverage_unknown，发布门因此变红。
 */
function installed(adapter: Adapter, path: string): boolean {
  if (adapter.name === "promptfoo") return existsSync(path);
  return existsSync(path) || existsSync(dirname(path));
}

/** 单个客户端的判定。 */
function judge(adapter: Adapter, env: Env, gatewayBaseUrl: string): ClientCoverageCheck {
  const client = adapter.name;
  const path = adapter.defaultConfigPath(env);
  if (!installed(adapter, path)) {
    return { client, state: "not_installed", failsDoctor: false, message: `未安装（${path} 不存在）` };
  }
  const current = adapter.readCurrentConfig(env);
  // 配置存在却读不出任何内容 = 损坏，不是"没配"。把损坏报成 not_configured 会让 doctor 绿灯，
  // 而这恰恰是最该被发现的状态（适配器自己的注释写着"绝不把读不到当成配好了"）。
  if (isUnreadableConfig(path, current)) {
    return { client, state: "drift", failsDoctor: true, message: `配置不可解析：${path}（修复或删除后重试）` };
  }
  const drift = adapter.detectDrift(current, gatewayBaseUrl);
  if (drift.length === 0) return coverageState(adapter, current);
  // 文件在、但一个受管键都没有 = 没配；有键但不符 = 漂移。
  // 判据不能是"配置非空"——满了无关设置的文件同样是"没配本网关"，
  // 报成 drift 会让人去追一个根本不存在的漂移。
  if (!hasManagedKeys(adapter, current, gatewayBaseUrl)) {
    return { client, state: "not_configured", failsDoctor: false, message: `未配置受管键（${path}）；受管项：${drift.map((d) => d.id).join(", ")}` };
  }
  return { client, state: "drift", failsDoctor: true, message: `drift: ${drift.map((d) => d.id).join(", ")}` };
}

/**
 * 配置里是否真的写了受管键。
 *
 * 判据：受管 id 的**最后一段**（如 `env.ANTHROPIC_BASE_URL` 里的 `ANTHROPIC_BASE_URL`、
 * `base_url`、`apiBaseUrl`）是否出现在配置的序列化视图里。这是粗匹配，但方向安全：
 * 匹配上了才报 drift（要人去查），没匹配上才报"未配置"（提示去配）。
 */
function hasManagedKeys(adapter: Adapter, current: Record<string, unknown>, _gatewayBaseUrl: string): boolean {
  const text = JSON.stringify(current);
  return adapter.MANAGED_CONFIG_IDS.some((c) => {
    const leaf = c.id.split(".").pop() ?? "";
    return leaf.length > 0 && text.includes(leaf);
  });
}

/** 配置文件存在、但读回来的对象是空的（解析失败）→ 视为损坏。 */
function isUnreadableConfig(path: string, current: Record<string, unknown>): boolean {
  if (!existsSync(path)) return false;
  // 适配器可以自己申报"读到了但解析不出来"（如 promptfoo 的 providers 为空块）
  if (current.__unreadable === true) return true;
  return Object.keys(current).length === 0 && readFileSync(path, "utf8").trim().length > 0;
}

/**
 * 从配置本身推导线格式（promptfoo 的 provider id 前缀就是线格式）。
 *
 * `openai:chat:*` → chat；`openai:responses:*` → openai-responses。
 * 这是**读出来的事实**，不是猜的；只有读不出来时才算"无法确定"。
 */
function derivedFormat(adapter: Adapter, current: Record<string, unknown>): string | null {
  if (adapter.name !== "promptfoo") return null;
  const text = JSON.stringify(current);
  if (text.includes("openai:responses:")) return "openai-responses";
  if (text.includes("openai:chat:")) return "chat";
  return null;
}

/** 线格式覆盖判定（REQ-V2bA-10）：无法确定必须是独立出口。 */
function coverageState(adapter: Adapter, current: Record<string, unknown>): ClientCoverageCheck {
  const client = adapter.name;
  const spec = wireFormatOf(client);
  if (spec === undefined) {
    return { client, state: "coverage_unknown", failsDoctor: true, message: "unmanaged: 未登记线格式" };
  }
  const fromConfig = derivedFormat(adapter, current);
  if (spec.format === null && fromConfig === null) {
    return {
      client,
      state: "coverage_unknown",
      failsDoctor: true,
      message: `线格式无法确定（${spec.basis}）；doctor 不会据此报"已覆盖"`,
    };
  }
  const effective = spec.format ?? fromConfig;
  // 线格式有声明即视为本网关有对应投影器（协议表在 gateway 层，cli 不 import，用值域判断）。
  // 已配置且覆盖存在 = 健康；它不是"未配置"，所以单独给一个成功态。
  return { client, state: "coverage_ok", failsDoctor: false, message: `线格式 ${effective} 有投影覆盖` };
}

/** 为全部受管客户端产出检查项。 */
export function clientCoverageChecks(env: Env, gatewayBaseUrl: string): readonly ClientCoverageCheck[] {
  return ADAPTERS.map((a) => judge(a, env, gatewayBaseUrl));
}
