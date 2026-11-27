// @no-test-required: 测试在 tests/unit/fingerprint/scheduler.test.ts（Gate 5a 仅识别同目录/根 tests/ 六种路径）
import { BASELINE_WINDOW, median, type Sample, verdictFor } from "./baseline.ts";
import { CATCHUP_SERIES_GAP_MS, CatchUpPlanner } from "./catchup.ts";
import { extractFeature } from "./features.ts";
import { sendProbe } from "./http.ts";
import { type Patrol, PROBE_INTERVAL_MS } from "./patrol.ts";
import { buildProbeBody, dimensionFor, PAYLOAD_GENERATION } from "./probe.ts";
import type { FingerprintStore } from "./store.ts";

/**
 * 周期探针调度器。
 *
 * 这是把 `Patrol` + `sendProbe` + `extractFeature` 真正接起来的地方——
 * 在此之前它们各自有测试，却**从未被任何生产代码调用**。
 * 有测试不等于有功能：那一课在 v2b-A 的走查里学过一遍，这里是同一个坑。
 *
 * 设计约束（逐条对应需求）：
 *   - 每 provider 每 6h 至多一次，手动与周期共享配额（走 `Patrol.shouldProbe`）
 *   - 退避中的 provider 一律跳过（`isBackingOff`，AC-20）
 *   - 单次探针失败不影响其它 provider（每个 provider 独立 try）
 *   - 调度器本身永不抛出（周期任务把 daemon 拖挂是不可接受的）
 */

export interface SchedulerOptions {
  readonly store: FingerprintStore;
  readonly patrol: Patrol;
  /** 受管 provider → 上游 base URL。 */
  readonly providers: Readonly<Record<string, string>>;
  /** 发起探针；默认走 `sendProbe`，测试注入桩。 */
  readonly probe?: typeof sendProbe;
  /** 记录日志；默认写 stderr。 */
  readonly log?: (msg: string) => void;
  /** 补齐探针之间的间隔；默认 4s（R5 CAVEAT-2），测试注入 0 以消除等待。 */
  readonly catchUpGapMs?: number;
}

export class ProbeScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  /** 每个 provider 上次观测到的 model 字段（判定"字段是否变化"用）。 */
  private readonly lastModel = new Map<string, string>();
  private readonly planner: CatchUpPlanner;
  private readonly opts: SchedulerOptions;
  private readonly log: (msg: string) => void;

  constructor(opts: SchedulerOptions) {
    this.opts = opts;
    this.log = opts.log ?? ((m) => process.stderr.write(`${m}\n`));
    // **必须传同一个时钟**：CatchUpPlanner 默认用真实 Date.now()，而测试注入的是假时钟。
    // 两者混用会让"补齐配额是否已用"的判定随测试执行速度漂移——实测在并发下
    // 偶发失败（同一测试单独跑 3 次全绿、全量跑时红）。时钟不一致是隐形的非确定性源。
    this.planner = new CatchUpPlanner({ store: opts.store, now: opts.patrol.clock });
  }

  /**
   * 跑一轮：对每个 provider 检查配额与退避，够条件才发。
   *
   * 返回本轮实际发出的探针数（测试据此断言"退避期间为 0"）。
   */
  async runOnce(): Promise<number> {
    let sent = 0;
    for (const [providerId, baseUrl] of Object.entries(this.opts.providers)) {
      if (!this.opts.patrol.shouldProbe(providerId)) continue;
      // 每个 provider 独立 try：一个挂了不该影响其它
      try {
        if (await this.probeOne(providerId, baseUrl)) sent += 1;
      } catch (err) {
        this.log(`[fingerprint] probe ${providerId} threw: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return sent;
  }

  /** 探一个 provider；返回是否真的发出了请求。 */
  private async probeOne(providerId: string, baseUrl: string): Promise<boolean> {
    // 轮转序号 = 该 provider 的**总采样次数**，不是"某一维的记录数"。
    // 第一版用 D0 的记录数当序号，而每轮只采一维，D0 计数几乎不动 →
    // 永远轮不到 D2/D3，四个维度的轮转等于没有发生。
    const dim = dimensionFor(this.sampleCount(providerId));
    this.opts.patrol.recordAttempt(providerId);

    const send = this.opts.probe ?? sendProbe;
    const res = await send(baseUrl, buildProbeBody(dim, this.modelFor(providerId)));
    if (!res.ok || res.body === undefined) {
      this.opts.patrol.recordFailure(providerId, dim, res.errorClass ?? "decode_error");
      return true;
    }
    const feature = extractFeature(dim, res.body);
    const verdict = this.recordFeature(providerId, dim, feature, this.modelChanged(providerId, res.body));
    this.opts.patrol.recordSuccess(providerId);
    // 退化 → 触发补齐（设计 D-04a）：确认是稳定降级还是时间分片
    if (verdict === "finding") await this.catchUp(providerId, baseUrl, dim);
    return true;
  }

  /**
   * 把一次特征提取落链——**并在这里真正调用判定**。
   *
   * 第一版只写 `verdict: "baseline_pending"`，注释说"判定由 baseline 层做"，
   * 但调度器从不调用它：`verdictFor` 在生产代码里一次都没被执行。
   * 结果是整条判定链断开——信任分永远算不出 finding，doctor 永远不会报 FAIL，
   * 整套判据（方向判定/归因/severity）只活在测试里。
   *
   * `missing` 仍然不写 feature：没测到不是测到了。
   */
  private recordFeature(
    providerId: string,
    dim: ReturnType<typeof dimensionFor>,
    feature: ReturnType<typeof extractFeature>,
    modelChanged: boolean,
  ): "clean" | "finding" | "baseline_pending" | "missing" {
    if (feature.kind === "missing") return "missing";
    const base = this.baselineFor(providerId, dim);
    const result = verdictFor({
      kind: feature.kind,
      baseValue: base,
      observed: feature.value,
      modelChanged,
    });
    this.opts.store.append({
      kind: "probe_feature",
      provider_id: providerId,
      dimension: dim,
      value: feature.value,
      generation: PAYLOAD_GENERATION,
      verdict: result.verdict,
      deviation: result.deviation,
      ...(result.hit_by === undefined ? {} : { hit_by: result.hit_by }),
      ...(result.severity === undefined ? {} : { severity: result.severity }),
      ts: new Date().toISOString(),
    });
    return result.verdict;
  }

  /**
   * 退化后的补齐（设计 D-04a / REQ-V2bC-07/15）。
   *
   * 第一版里 `CatchUpPlanner` 只存在于测试——补齐与分片识别（整个 REQ-07/15）
   * 从未被调用。这里把它接上：发现退化后串行补测 2 个维度，
   * 若都正常则记 `inconsistent_degradation`（时间分片的强信号）。
   *
   * 补齐受与常规探针**相同的退避约束**（D-04a）：退避中就完全不补。
   */
  private async catchUp(providerId: string, baseUrl: string, degraded: ReturnType<typeof dimensionFor>): Promise<void> {
    const planner = this.planner;
    if (!planner.shouldCatchUp(providerId, this.opts.patrol)) return;
    planner.recordCatchUp(providerId);

    const samples: { dimension: ReturnType<typeof dimensionFor>; degraded: boolean }[] = [];
    const send = this.opts.probe ?? sendProbe;
    for (const dim of planner.planFor(degraded)) {
      // 串行、带间隔（R5 CAVEAT-2：三连发本身就是突发指纹）
      await new Promise((r) => setTimeout(r, this.opts.catchUpGapMs ?? CATCHUP_SERIES_GAP_MS));
      const res = await send(baseUrl, buildProbeBody(dim, this.modelFor(providerId)));
      if (!res.ok || res.body === undefined) continue;
      const f = extractFeature(dim, res.body);
      if (f.kind === "missing") continue;
      const base = this.baselineFor(providerId, dim);
      const v = verdictFor({ kind: f.kind, baseValue: base, observed: f.value, modelChanged: false });
      samples.push({ dimension: dim, degraded: v.verdict === "finding" });
    }
    if (samples.length === 0) return;

    const verdict = planner.interpret(degraded, samples);
    if (verdict.kind !== "inconsistent_degradation") return;
    this.opts.store.append({
      kind: "inconsistent_degradation",
      provider_id: providerId,
      degraded_dimension: verdict.degraded_dimension,
      healthy_dimensions: verdict.healthy_dimensions,
      ts: new Date().toISOString(),
    });
  }

  /**
   * 该 provider 该维度的基线：最近 K 次的中位数。
   *
   * 没有历史样本时返回 null → `verdictFor` 给 `baseline_pending`，
   * 这是宽限期而不是失败（"还没测"不等于"测出问题"）。
   */
  private baselineFor(providerId: string, dim: ReturnType<typeof dimensionFor>): number | boolean | string | null {
    // 按代过滤：换代后旧代样本与新载荷不可比（`baselineKey` 的语义在此落地）
    const samples = this.opts.store.recentFeatures(providerId, dim, BASELINE_WINDOW, PAYLOAD_GENERATION);
    return median(samples.map((e) => sampleOf(e.value)));
  }

  /** 该 provider 已完成的采样总数（所有维度合计），用作轮转序号。 */
  private sampleCount(providerId: string): number {
    return this.opts.store.forProvider(providerId).filter((e) => e.kind === "probe_feature").length;
  }

  /**
   * 本次响应的 `model` 字段是否与该 provider 上次不同。
   *
   * 判定需要这个信息（设计 D-03：字段变+行为退化 = 版本回退；
   * 字段不变+行为退化 = 字段撒谎，更严重）。没有历史值时视为"未变"，
   * 因为第一次采样本来就没有可比的基准。
   */
  private modelChanged(providerId: string, body: Record<string, unknown>): boolean {
    const now = typeof body.model === "string" ? body.model : undefined;
    if (now === undefined) return false;
    const prev = this.lastModel.get(providerId);
    if (prev === undefined) {
      this.lastModel.set(providerId, now);
      return false;
    }
    return prev !== now;
  }

  /**
   * 探针请求里用的模型名。
   *
   * 取自 provider 的 id 尾段（`opencode/whalecloud` → `whalecloud`）——
   * 这是一个无奈的选择：受管枚举里没有"该 provider 用哪个模型"。真实取值
   * 需要用户配置，而这不在 v2b-C 范围内，登记为已知限制。
   */
  private modelFor(providerId: string): string {
    return providerId.split("/").pop() ?? providerId;
  }

  /** 启动周期调度。间隔取基准周期（各 provider 的实际节流由 Patrol 负责）。 */
  start(): void {
    if (this.timer !== null) return;
    // 启动时先跑一轮："刚开启却要等 6 小时才有第一个数据点"不是好体验
    void this.runOnce().catch(() => undefined);
    this.timer = setInterval(() => void this.runOnce().catch(() => undefined), PROBE_INTERVAL_MS);
    // 不因这个定时器让进程无法退出
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}

/**
 * 存储里的 `value` → 基线样本。
 *
 * 存储是 JSON，布尔和字符串都能原样存；这里按运行时类型还原成判别联合，
 * 让 `median` 能区分"数值基线"与"布尔基线"（它们的中位数算法不同）。
 */
function sampleOf(value: number | boolean | string): Sample {
  if (typeof value === "number") return { kind: "numeric", value };
  if (typeof value === "boolean") return { kind: "boolean", value };
  return { kind: "text", value };
}
