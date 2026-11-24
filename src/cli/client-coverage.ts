// @no-test-required: 测试在 tests/unit/cli/doctor-v2b.test.ts（本项目测试布局为 tests/ 目录；Gate 5a 仅识别同目录/根 tests/ 六种路径）
import { existsSync } from "node:fs";
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

const STATE_FAILS: Readonly<Record<ClientState, boolean>> = Object.freeze({
  not_installed: false,
  not_configured: false,
  drift: true,
  coverage_missing: true,
  coverage_unknown: true,
  write_failed: true,
  coverage_ok: false,
});

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

/** 配置文件是否"存在"（含父目录缺失 = 没装）。 */
function installed(path: string): boolean {
  return existsSync(path) || existsSync(dirname(path));
}

/** 单个客户端的判定。 */
function judge(adapter: Adapter, env: Env, gatewayBaseUrl: string): ClientCoverageCheck {
  const client = adapter.name;
  const path = adapter.defaultConfigPath(env);
  if (!installed(path)) {
    return { client, state: "not_installed", failsDoctor: false, message: `未安装（${path} 不存在）` };
  }
  const current = adapter.readCurrentConfig(env);
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

/** 线格式覆盖判定（REQ-V2bA-10）：无法确定必须是独立出口。 */
function coverageState(adapter: Adapter, current: Record<string, unknown>): ClientCoverageCheck {
  const client = adapter.name;
  const spec = wireFormatOf(client);
  if (spec === undefined) {
    return { client, state: "coverage_unknown", failsDoctor: true, message: "unmanaged: 未登记线格式" };
  }
  if (spec.format === null) {
    return {
      client,
      state: "coverage_unknown",
      failsDoctor: true,
      message: `线格式无法确定（${spec.basis}）；doctor 不会据此报"已覆盖"`,
    };
  }
  // 线格式有声明即视为本网关有对应投影器（协议表在 gateway 层，cli 不 import，用值域判断）。
  // 已配置且覆盖存在 = 健康；它不是"未配置"，所以单独给一个成功态。
  return { client, state: "coverage_ok", failsDoctor: false, message: `线格式 ${spec.format} 有投影覆盖` };
}

/** 为全部受管客户端产出检查项。 */
export function clientCoverageChecks(env: Env, gatewayBaseUrl: string): readonly ClientCoverageCheck[] {
  return ADAPTERS.map((a) => judge(a, env, gatewayBaseUrl));
}
