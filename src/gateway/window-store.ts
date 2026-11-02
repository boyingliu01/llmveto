import type { ScanWindow } from "../shared/types.ts";
import { STREAM_WINDOW_OVERFLOW_LIMIT } from "../shared/types.ts";
export { STREAM_WINDOW_OVERFLOW_LIMIT } from "../shared/types.ts";

/**
 * @test REQ-V2a-15
 * @intent 流式窗口按 checker 分持的存储与账本（D-07/ADR-0005 的实现载体）。
 * @no-test-required: 测试在 tests/unit/gateway/window-store.test.ts（本项目测试布局为
 *                   tests/{unit,integration,e2e}/**，Gate 5a 仅识别同目录/根 tests/ 六种路径，
 *                   故在此登记真实位置而非声称免测）。
 *
 * 关键契约：
 *   - R2 A-M1（最高优先）：checker 收到的是**推进前**窗口（AC-VETO-004-02 冻结语义：
 *     cursor = 本片之前已消费的 UTF-16 code unit 数）；网关在 checker 返回后于重组点
 *     单点推进（旧值 + unit.text.length），checker 回传 cursor 一律忽略、回传 extra 原样
 *     保留——推进恰好一次、绝不提前。"先推进后扫"即 v1 双推进镜像，AC-V2a-25 系统性失败。
 *   - AC-V2a-26③：per-checker 字节账本（consumedBytes）只记本 checker 消费的字节，
 *     不含 pendingBytes、不含其他 checker 的任何状态。
 *   - AC-V2a-14：256KiB 单调用硬顶常量与严格大于谓词在此单一真相源（metering 由
 *     tool-call-shape 自身窗口累积字节承载，checker 侧自判，网关不做全局截断）。
 */

/** §4.2/ADR-0003 定值（单一来源 = shared/types.ts）：单次 tool-call arguments 累积硬顶 = 256 KiB。 */

/** 严格大于语义（AC-V2a-14）：Σ 累积 + 本片长度恰好等于 LIMIT 仍放行，越顶即触发。 */
export function exceedsWindowOverflowLimit(accumulatedBytes: number, nextChunkLength: number): boolean {
  return accumulatedBytes + nextChunkLength > STREAM_WINDOW_OVERFLOW_LIMIT;
}

/** 初始窗口：cursor=0 / 空 pendingBytes / 无 extra（D-07 重组起点）。 */
export function initialWindow(): ScanWindow {
  return { pendingBytes: new Uint8Array(0), cursor: 0 };
}

/**
 * D-07 重组：pendingBytes/extra 以 checker 回传为准（checker 私有 keyspace），
 * cursor 由网关单点推进（旧值 + 消费长度），回传 cursor 无效。纯函数：不改写入参。
 */
export function recombineWindow(previous: ScanWindow, returned: ScanWindow, consumedTextLength: number): ScanWindow {
  return {
    pendingBytes: returned.pendingBytes,
    cursor: previous.cursor + consumedTextLength,
    ...(returned.extra !== undefined ? { extra: returned.extra } : {}),
  };
}

/** per-checker 窗口存储：ReadonlyMap 表面 + 账本操作（core 是唯一写者）。 */
export interface WindowStore extends ReadonlyMap<string, ScanWindow> {
  /** 取窗口，无则惰性初始化（读路径不创建缺失键）。 */
  windowOf(checkerId: string): ScanWindow;
  /** 重组落账：cursor 单点推进 + extra 承接 + UTF-8 字节入账；返回落账后的窗口。 */
  recordChunk(checkerId: string, returned: ScanWindow, consumedText: string): ScanWindow;
  /** AC-V2a-26③：该 checker 已消费的 UTF-8 字节数（不含 pendingBytes，他者不可见）。 */
  consumedBytes(checkerId: string): number;
}

export function createWindowStore(): WindowStore {
  const windows = new Map<string, ScanWindow>();
  const consumed = new Map<string, number>();

  function windowOf(checkerId: string): ScanWindow {
    const existing = windows.get(checkerId);
    if (existing !== undefined) return existing;
    const fresh = initialWindow();
    windows.set(checkerId, fresh);
    return fresh;
  }

  return {
    windowOf,
    recordChunk(checkerId, returned, consumedText) {
      const next = recombineWindow(windowOf(checkerId), returned, consumedText.length);
      windows.set(checkerId, next);
      consumed.set(checkerId, (consumed.get(checkerId) ?? 0) + Buffer.byteLength(consumedText, "utf8"));
      return next;
    },
    consumedBytes: (checkerId) => consumed.get(checkerId) ?? 0,
    get: (checkerId) => windows.get(checkerId),
    has: (checkerId) => windows.has(checkerId),
    get size(): number {
      return windows.size;
    },
    keys: () => windows.keys(),
    values: () => windows.values(),
    entries: () => windows.entries(),
    forEach: (callbackfn, thisArg) => windows.forEach(callbackfn, thisArg),
    [Symbol.iterator]: () => windows[Symbol.iterator](),
  };
}

/** 运行时判别：core 据此决定推进落账走 store 账本还是纯重组（普通 Map 亦可用）。 */
export function isWindowStore(m: ReadonlyMap<string, ScanWindow>): m is WindowStore {
  return "recordChunk" in m;
}
