// @no-test-required: 测试在 tests/unit/audit/watch-list.test.ts（Gate 5a 仅识别同目录/根 tests/ 六种路径）
import { existsSync, readFileSync } from "node:fs";

/**
 * 读用户声明的 agent 清单（`~/.config/llmveto/watched.json`）。
 *
 * ## 这个模块不做什么
 *
 * 它**不做绕过检测**。判断"某个 agent 流量没经过网关是被人有意绕过了"
 * 需要可信遥测源（内核审计 / eBPF），而本机没有（实测：无 auditd、无 BPF 挂载点）。
 * 任何基于日志或用户自报的"检测"都可被绕过者规避——那是依赖攻击者配合的假安全。
 *
 * delphi 需求评审三席一致否决了那个定位，本功能因而降级为
 * **配置遗漏可见性**：只回答"你声明在用的 agent 中，哪些没有网关流量"。
 * 典型用例是"忘了接入"或"升级后配置漂移"，不是防恶意绕过。
 *
 * 需要更强能力时的路线见 issue #3（auditd/eBPF 评估）。
 *
 * ## 三种失败都不是 PASS
 *
 * `absent` / `invalid` / `empty` 都是独立状态。把"没检查过"报成 PASS，
 * 是本项目反复出现的缺陷形态（`coverageOf`、`persistState`、Gate 8 的 `reason:""`）。
 */

/** `window_days` 上限。太长会让 `stale` 被当成 `active`。 */
export const WATCH_MAX_WINDOW_DAYS = 90 as const;

/** `window_days` 默认值。 */
export const WATCH_DEFAULT_WINDOW_DAYS = 7 as const;

export type WatchListStatus = "ok" | "absent" | "invalid" | "empty";

export interface WatchList {
  readonly status: WatchListStatus;
  /** 声明的 agent id（去重后保序）。非 ok 时为空数组。 */
  readonly agents: readonly string[];
  readonly windowDays: number;
  readonly error?: string;
}

/** 非 ok 的统一形状：agents 为空，窗口用默认值。 */
function notOk(status: WatchListStatus, error?: string): WatchList {
  return error === undefined ? { status, agents: [], windowDays: WATCH_DEFAULT_WINDOW_DAYS } : { status, agents: [], windowDays: WATCH_DEFAULT_WINDOW_DAYS, error };
}

/** 校验并归一 `window_days`；非法返回错误串。 */
function windowDaysOf(raw: unknown): { readonly days: number } | { readonly error: string } {
  if (raw === undefined) return { days: WATCH_DEFAULT_WINDOW_DAYS };
  if (typeof raw !== "number" || !Number.isInteger(raw)) return { error: `window_days 必须是整数，收到 ${String(raw)}` };
  if (raw < 1 || raw > WATCH_MAX_WINDOW_DAYS) {
    return { error: `window_days 必须在 1..${WATCH_MAX_WINDOW_DAYS} 之间，收到 ${raw}` };
  }
  return { days: raw };
}

/** 校验 `agents` 是字符串数组；非法返回错误串。 */
function agentsOf(raw: unknown): { readonly agents: string[] } | { readonly error: string } {
  if (!Array.isArray(raw)) return { error: "agents 必须是字符串数组" };
  if (!raw.every((a) => typeof a === "string")) return { error: "agents 含非字符串元素" };
  // 去重保序：重复声明没有额外信息，但保留首次出现的顺序便于用户对照
  return { agents: [...new Set(raw as string[])] };
}

/** 解析并校验一份配置文本。 */
function parse(text: string): WatchList {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return notOk("invalid", `JSON 无法解析：${err instanceof Error ? err.message : String(err)}`);
  }
  if (parsed === null || typeof parsed !== "object") return notOk("invalid", "配置必须是 JSON 对象");

  const obj = parsed as Record<string, unknown>;
  if (obj.schema_version !== 1) return notOk("invalid", `不支持的 schema_version: ${String(obj.schema_version)}`);

  const agents = agentsOf(obj.agents);
  if ("error" in agents) return notOk("invalid", agents.error);
  if (agents.agents.length === 0) return notOk("empty");

  const days = windowDaysOf(obj.window_days);
  if ("error" in days) return notOk("invalid", days.error);

  return { status: "ok", agents: agents.agents, windowDays: days.days };
}

/**
 * 加载监看清单。
 *
 * @param path 配置文件路径
 */
export function loadWatchList(path: string): WatchList {
  if (!existsSync(path)) return notOk("absent");
  try {
    return parse(readFileSync(path, "utf8"));
  } catch (err) {
    return notOk("invalid", `无法读取：${err instanceof Error ? err.message : String(err)}`);
  }
}
