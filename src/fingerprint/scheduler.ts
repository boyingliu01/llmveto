// @no-test-required: 测试在 tests/unit/fingerprint/scheduler.test.ts（Gate 5a 仅识别同目录/根 tests/ 六种路径）
import { extractFeature } from "./features.ts";
import { sendProbe } from "./http.ts";
import { type Patrol, PROBE_INTERVAL_MS } from "./patrol.ts";
import { buildProbeBody, dimensionFor } from "./probe.ts";
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
}

export class ProbeScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly opts: SchedulerOptions;
  private readonly log: (msg: string) => void;

  constructor(opts: SchedulerOptions) {
    this.opts = opts;
    this.log = opts.log ?? ((m) => process.stderr.write(`${m}\n`));
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
    const seq = this.opts.store.recentFeatures(providerId, "D0", 1).length;
    const dim = dimensionFor(seq);
    this.opts.patrol.recordAttempt(providerId);

    const send = this.opts.probe ?? sendProbe;
    const res = await send(baseUrl, buildProbeBody(dim, this.modelFor(providerId)));
    if (!res.ok || res.body === undefined) {
      this.opts.patrol.recordFailure(providerId, dim, res.errorClass ?? "decode_error");
      return true;
    }
    const feature = extractFeature(dim, res.body);
    this.recordFeature(providerId, dim, feature);
    this.opts.patrol.recordSuccess(providerId);
    return true;
  }

  /** 把一次特征提取落链。`missing` 不写 feature（没测到不是测到了）。 */
  private recordFeature(providerId: string, dim: ReturnType<typeof dimensionFor>, feature: ReturnType<typeof extractFeature>): void {
    if (feature.kind === "missing") return;
    this.opts.store.append({
      kind: "probe_feature",
      provider_id: providerId,
      dimension: dim,
      value: feature.value,
      // 判定由 baseline 层做；调度器只负责采集，不在这里下结论
      verdict: "baseline_pending",
      deviation: 0,
      ts: new Date().toISOString(),
    });
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
