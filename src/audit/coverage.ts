// @no-test-required: 测试在 tests/unit/audit/coverage.test.ts（Gate 5a 仅识别同目录/根 tests/ 六种路径）

/**
 * 对比"用户声明的 agent"与"evidence 里的实际流量"，产出三态覆盖结果。
 *
 * ## 这不是绕过检测
 *
 * 它只回答"你声明在用的 agent 中，哪些在窗口内没有网关流量"。
 * 不判断那是不是被有意绕过——那需要可信遥测源，本机没有（见 issue #3）。
 * 典型用例是"忘了接入"或"升级后配置漂移"。
 *
 * ## 三态为什么不能合并
 *
 *   active  窗口内有流量
 *   stale   窗口内无，但历史上有 —— 可能停用了，也可能是最近绕过了
 *   missing 从未有过 —— 最可疑：多半是 id 拼错或压根没接
 *
 * 合并成一个"没流量"会让用户无法判断该先查哪条。
 */

export type CoverageState = "active" | "stale" | "missing";

/** evidence 记录的最小投影：这里只需要 client 与 ts。 */
export interface EvidenceSample {
  readonly client: string;
  readonly ts: string;
}

export interface CoverageEntry {
  readonly agent: string;
  readonly state: CoverageState;
  /** 窗口内的请求数。 */
  readonly count: number;
  /** 最后一次出现时刻（含窗口外）；从未出现则 undefined。 */
  readonly lastSeen?: string;
}

export interface CoverageResult {
  readonly entries: readonly CoverageEntry[];
  /** evidence 里**实际出现过**的 client（含窗口外、含非客户端值）。供拼错对照。 */
  readonly knownClients: readonly string[];
  /** 是否存在 `missing`（决定退出码）。 */
  readonly hasMissing: boolean;
}

export interface CoverageOptions {
  readonly now: number;
  readonly windowDays: number;
}

const DAY_MS = 24 * 3600 * 1000;

/** 单条记录的时间戳是否落在 `[now - window, now]`（左闭右开）。 */
function inWindow(sample: EvidenceSample, nowMs: number, windowMs: number): boolean {
  const t = Date.parse(sample.ts);
  if (Number.isNaN(t)) return false;
  const age = nowMs - t;
  // 左闭 [0, window)：age === windowMs 视为窗口内，age > windowMs 不算；
  // 未来时间戳（age < 0）不算，避免时钟偏差把未发生的算成已发生
  return age >= 0 && age <= windowMs;
}

/** 某 agent 的全部样本（精确匹配，不做大小写归一——归一化会制造假匹配）。 */
function samplesOf(agent: string, samples: readonly EvidenceSample[]): EvidenceSample[] {
  return samples.filter((s) => s.client === agent);
}

/** 单个 agent 的判定。 */
function entryFor(agent: string, samples: readonly EvidenceSample[], nowMs: number, windowMs: number): CoverageEntry {
  const own = samplesOf(agent, samples);
  if (own.length === 0) return { agent, state: "missing", count: 0 };

  const inWin = own.filter((s) => inWindow(s, nowMs, windowMs));
  const last = own.reduce((acc, s) => (Date.parse(s.ts) > Date.parse(acc.ts) ? s : acc));
  return {
    agent,
    state: inWin.length > 0 ? "active" : "stale",
    count: inWin.length,
    lastSeen: last.ts,
  };
}

/** 计算覆盖结果。 */
export function computeCoverage(
  agents: readonly string[],
  samples: readonly EvidenceSample[],
  opts: CoverageOptions,
): CoverageResult {
  const nowMs = opts.now;
  const windowMs = opts.windowDays * DAY_MS;
  const entries = agents.map((a) => entryFor(a, samples, nowMs, windowMs));
  // 排序是为了输出稳定：用户在终端里肉眼对照时，乱序会增加阅读成本
  const knownClients = [...new Set(samples.map((s) => s.client))].sort();
  return { entries, knownClients, hasMissing: entries.some((e) => e.state === "missing") };
}
