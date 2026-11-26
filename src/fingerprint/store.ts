// @no-test-required: 测试在 tests/unit/fingerprint/store.test.ts（Gate 5a 仅识别同目录/根 tests/ 六种路径）
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ProbeDimension } from "./probe.ts";

/**
 * 探针证据存储。
 *
 * 设计 D-07：三类事件**同一张表**，用 `kind` 区分。不另立存储的理由是
 * 信任分要按 provider 跨事件聚合——分散在三个文件里，聚合就成了三次读盘加一次归并。
 *
 * append-only JSONL，与 evidence 同形态。末行半写（崩溃残留）丢弃而不是抛错：
 * 探针是后台行为，不该因为上一次崩溃让整条链路起不来。
 */

export type ProbeErrorClass = "timeout" | "rst" | "http_5xx" | "http_429" | "decode_error";

/** 正常探针：计入 K=10 特征窗口。 */
export interface ProbeFeatureEvent {
  readonly kind: "probe_feature";
  readonly provider_id: string;
  readonly dimension: ProbeDimension;
  /**
   * 载荷代号。换代后旧代的事件与新代的观测**不可比**，所以基线按代过滤。
   * 缺失视为**当前代**（兼容 v0.10.1 之前写入、没有该字段的历史数据）。
   */
  readonly generation?: number;
  readonly value: number | boolean | string;
  readonly verdict: "clean" | "finding" | "baseline_pending";
  readonly deviation: number;
  readonly ts: string;
}

/** 探针失败：独立事件，**不进**特征窗口，单独驱动退避。 */
export interface ProbeFailureEvent {
  readonly kind: "probe_failure";
  readonly provider_id: string;
  /** 语义是「本轮**计划**探测的维度」，恒非空（网络层失败时响应没到，无从得知实际维度）。 */
  readonly target_dimension: ProbeDimension;
  readonly error_class: ProbeErrorClass;
  readonly ts: string;
}

/** 分片对抗信号：单维退化而其余维正常。 */
export interface InconsistentDegradationEvent {
  readonly kind: "inconsistent_degradation";
  readonly provider_id: string;
  readonly degraded_dimension: ProbeDimension;
  readonly healthy_dimensions: readonly ProbeDimension[];
  readonly ts: string;
}

export type ProbeEvent =
  | ProbeFeatureEvent
  | ProbeFailureEvent
  | InconsistentDegradationEvent
  | PatrolStateEvent
  | CatchUpQuotaEvent;

/** patrol 的持久化状态（C7e：退避必须跨重启保留）。与三类证据事件同表，便于一致的时间序。 */
export interface PatrolStateEvent {
  readonly kind: "patrol_state";
  readonly provider_id: string;
  readonly last_attempt_ts: number;
  readonly consecutive_failures: number;
  readonly backoff_rounds: number;
  readonly backoff_until_ts: number;
}

/** 补齐配额（跨重启保留，评审 C1）。 */
export interface CatchUpQuotaEvent {
  readonly kind: "catchup_quota";
  readonly provider_id: string;
  readonly ts_ms: number;
}

/** 封闭枚举：新增事件类型必须改这里（而不是让写入端自由发挥）。 */
export const PROBE_EVENT_KINDS = Object.freeze([
  "probe_feature",
  "probe_failure",
  "inconsistent_degradation",
  "patrol_state",
  "catchup_quota",
] as const);

function assertValid(event: ProbeEvent): void {
  if (!PROBE_EVENT_KINDS.includes(event.kind)) {
    throw new Error(`fingerprint store: unknown kind ${String(event.kind)}`);
  }
  if (event.kind !== "probe_failure") return;
  // AC-11b：target_dimension 恒非空。
  // 类型系统保证它是枚举值，但**运行时的数据来自 JSON 反序列化**——那里没有类型。
  // 空串是最容易从"缺失字段"退化成的形态，所以这条校验必须在运行时做。
  const dim: unknown = event.target_dimension;
  if (typeof dim !== "string" || dim.length === 0) {
    throw new Error("fingerprint store: probe_failure.target_dimension must be non-empty");
  }
}

export class FingerprintStore {
  constructor(private readonly path: string) {}

  /**
   * 追加一条事件。
   *
   * 写入失败**抛出**而不是吞掉：调用方（patrol）据此计入失败并进退避。
   * 静默忽略会让"探针一直没落盘"看起来像"一切正常"，那正是本功能要消灭的形态。
   */
  append(event: ProbeEvent): void {
    assertValid(event);
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      appendFileSync(this.path, `${JSON.stringify(event)}\n`, "utf8");
    } catch (err) {
      throw new Error(`fingerprint store: cannot append to ${this.path}: ${err instanceof Error ? err.message : String(err)}`, {
        cause: err,
      });
    }
  }

  /** 读全部事件；损坏行丢弃（崩溃残留不该阻断读取）。 */
  readAll(): ProbeEvent[] {
    if (!existsSync(this.path)) return [];
    const out: ProbeEvent[] = [];
    for (const line of readFileSync(this.path, "utf8").split("\n")) {
      if (line.trim() === "") continue;
      try {
        out.push(JSON.parse(line) as ProbeEvent);
      } catch {
        // 崩溃残留：丢弃这一行，保留其余
      }
    }
    return out;
  }

  /** 某 provider 的全部事件。 */
  forProvider(providerId: string): ProbeEvent[] {
    return this.readAll().filter((e) => e.provider_id === providerId);
  }

  /**
   * 某 provider 某维度的最近 `limit` 条特征（K 窗口用）。
   *
   * 取的是**最近**的而不是最早的：基线要反映当前状态，早期数据在
   * provider 升级后就是噪声。
   */
  recentFeatures(providerId: string, dimension: ProbeDimension, limit: number, generation?: number): ProbeFeatureEvent[] {
    const hits = this.readAll().filter(
      (e): e is ProbeFeatureEvent =>
        e.kind === "probe_feature" &&
        e.provider_id === providerId &&
        e.dimension === dimension &&
        // 指定代时只取该代：换载荷后 token 数/措辞全变，混算会让换代本身
        // 表现为一次大规模退化（正是 baselineKey 要防的）
        // 缺失 generation 视为**当前代**而不是代 0：v0.10.1 之前写入的事件没有该字段，
        // 把它们一律当作"上一代"会让升级后所有历史基线突然作废，凭空制造一次重建窗口。
        (generation === undefined || (e.generation ?? generation) === generation),
    );
    return hits.slice(-limit);
  }

  /** 某 provider 的连续失败次数（驱动退避）。 */
  consecutiveFailures(providerId: string): number {
    const events = this.forProvider(providerId);
    let count = 0;
    // 从尾部往前数：遇到第一条非失败事件即停止
    for (let i = events.length - 1; i >= 0; i -= 1) {
      if (events[i]!.kind !== "probe_failure") break;
      count += 1;
    }
    return count;
  }
}
