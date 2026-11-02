import { describe, expect, it } from "vitest";
import {
  createWindowStore,
  exceedsWindowOverflowLimit,
  initialWindow,
  isWindowStore,
  recombineWindow,
} from "../../../src/gateway/window-store.ts";
import { STREAM_WINDOW_OVERFLOW_LIMIT } from "../../../src/shared/types.ts";
import { GatewayCore } from "../../../src/gateway/core.ts";
import { EvidenceWriter } from "../../../src/evidence/writer.ts";
import type { CheckerSpec, ScanUnit, ScanWindow } from "../../../src/shared/types.ts";

/**
 * @test REQ-V2a-15（D-07/D-08）
 * @intent window-store 纯函数与账本语义 + core×store 编排契约（R2 A-M1 推进次序）：
 *   1. checker 收到的是**推进前** cursor（AC-VETO-004-02 冻结语义：本片之前已消费 code units）
 *   2. 网关单点推进（旧值 + unit.text.length），checker 回传 cursor 一律忽略、extra 保留
 *   3. per-checker 窗口/字节账本互不可见（AC-V2a-26③：不含 pendingBytes、不含他者状态）
 *   4. LIMIT=262144 严格大于触发（AC-V2a-14 metering 语义单一真相源）
 */

function mkUnit(text: string): ScanUnit {
  return { direction: "response", transport: "stream", text, meta: {} };
}

// @mock-justified: 探针 checker 用闭包数组记录观测（收到 cursor/重投影标记），
// 回传 cursor=9999 专为验证"回传值被网关忽略"——被测对象是 window-store/core，非探针。
function probeChecker(id: string): CheckerSpec & { cursors: number[]; reprojected: boolean[] } {
  const cursors: number[] = [];
  const reprojected: boolean[] = [];
  const spec: CheckerSpec = {
    id,
    side: "response",
    synchronous: true,
    safetyClass: true,
    threat: "T0",
    runStream: (window: ScanWindow, chunk: ScanUnit) => {
      cursors.push(window.cursor);
      reprojected.push(chunk.meta.llmveto_reprojected === true);
      const prevExtra = typeof window.extra?.probeExtra === "number" ? window.extra.probeExtra : 0;
      const next: ScanWindow = {
        pendingBytes: window.pendingBytes,
        cursor: 9999, // 故意回传错误 cursor：网关必须忽略
        extra: { ...window.extra, probeExtra: prevExtra + 1 },
      };
      return [{ verdict: "clean", evidence: [] }, next] as const;
    },
  };
  return { ...spec, cursors, reprojected };
}

function mkCore(...extra: readonly CheckerSpec[]): GatewayCore {
  return new GatewayCore({
    upstreamBaseUrl: "http://127.0.0.1:9",
    evidenceWriter: new EvidenceWriter("unused-window-store-evidence.jsonl"),
    ...(extra.length > 0 ? { extraCheckers: extra } : {}),
  });
}

describe("window-store: 窗口初始化与 Map 生命周期", () => {
  it("initialWindow: cursor=0 / 空 pendingBytes / 无 extra", () => {
    const w = initialWindow();
    expect(w.cursor).toBe(0);
    expect(w.pendingBytes).toBeInstanceOf(Uint8Array);
    expect(w.pendingBytes.length).toBe(0);
    expect(w.extra).toBeUndefined();
  });

  it("windowOf 首取即初始化且幂等；不同 checker 窗口互为独立对象", () => {
    const store = createWindowStore();
    const w1 = store.windowOf("c");
    expect(w1.cursor).toBe(0);
    expect(store.windowOf("c")).toBe(w1);
    const other = store.windowOf("d");
    expect(other).not.toBe(w1);
  });

  it("ReadonlyMap 表面完整：get/has/size/keys/values/entries/forEach/迭代", () => {
    const store = createWindowStore();
    expect(store.size).toBe(0);
    expect(store.has("a")).toBe(false);
    expect(store.get("a")).toBeUndefined();
    store.windowOf("a");
    expect(store.has("a")).toBe(true);
    expect(store.size).toBe(1);
    expect(store.get("a")?.cursor).toBe(0);
    expect([...store.keys()]).toEqual(["a"]);
    expect([...store.entries()][0]?.[0]).toBe("a");
    expect([...store.values()][0]?.cursor).toBe(0);
    expect([...store][0]?.[0]).toBe("a");
    let counted = 0;
    store.forEach(() => {
      counted += 1;
    });
    expect(counted).toBe(1);
  });

  it("isWindowStore 判别：store 为真、普通 Map 为假", () => {
    expect(isWindowStore(createWindowStore())).toBe(true);
    expect(isWindowStore(new Map<string, ScanWindow>())).toBe(false);
  });
});

describe("window-store: 单点推进契约（R2 A-M1 / D-07）", () => {
  it("checker 回传 cursor 被忽略：cursor = 旧值 + unit.text.length（9999/-1 均无效）", () => {
    const store = createWindowStore();
    store.recordChunk("p", { pendingBytes: new Uint8Array(0), cursor: 9999 }, "abcde");
    expect(store.get("p")?.cursor).toBe(5);
    store.recordChunk("p", { pendingBytes: new Uint8Array(0), cursor: -1 }, "xy");
    expect(store.get("p")?.cursor).toBe(7); // 5+2：两次各恰好一次推进
  });

  it("recombineWindow 纯函数：previous/returned 均不被改写；pendingBytes/extra 以回传为准", () => {
    const previous: ScanWindow = { pendingBytes: new Uint8Array([9]), cursor: 2, extra: { a: 1 } };
    const returned: ScanWindow = { pendingBytes: new Uint8Array([8]), cursor: 100, extra: { b: 2 } };
    const next = recombineWindow(previous, returned, 3);
    expect(next.cursor).toBe(5); // 2+3
    expect(next.pendingBytes).toBe(returned.pendingBytes);
    expect(next.extra).toEqual({ b: 2 });
    expect(previous.cursor).toBe(2);
    expect(returned.cursor).toBe(100);
  });
});

describe("window-store: per-checker 字节账本（AC-V2a-26③）", () => {
  it("consumedBytes 按 checker 分账、按 UTF-8 计字节；pendingBytes 与他者状态不计入", () => {
    const store = createWindowStore();
    // "😀x" = 4 + 1 = 5 UTF-8 字节（cursor 口径为 3 个 UTF-16 code unit）
    const returned: ScanWindow = { pendingBytes: new Uint8Array([1, 2, 3]), cursor: 3, extra: { k: 1 } };
    store.recordChunk("probe", returned, "😀x");
    expect(store.consumedBytes("probe")).toBe(5);
    expect(store.consumedBytes("other")).toBe(0); // 未记录者为 0，绝不串账
    expect(store.get("probe")?.cursor).toBe(3);
    expect(store.get("probe")?.pendingBytes).toBe(returned.pendingBytes); // 透传但永不入账
  });

  it("extra 跨片存活且回传值被保留（AC-V2a-26①）", () => {
    const store = createWindowStore();
    store.recordChunk("p", { pendingBytes: new Uint8Array(0), cursor: 0, extra: { n: 1 } }, "abc");
    const merged: ScanWindow = {
      pendingBytes: new Uint8Array(0),
      cursor: 42, // 回传 cursor 仍被忽略
      extra: { n: 2, k: "kept" },
    };
    store.recordChunk("p", merged, "de");
    expect(store.get("p")?.cursor).toBe(5);
    expect(store.get("p")?.extra).toEqual({ n: 2, k: "kept" });
  });
});

describe("window-store: LIMIT 严格大于（AC-V2a-14 metering 单一真相源）", () => {
  it("常量 = 262144（256KiB）；等于不触发、大于即触发", () => {
    expect(STREAM_WINDOW_OVERFLOW_LIMIT).toBe(262144);
    expect(exceedsWindowOverflowLimit(262016, 128)).toBe(false); // 262144 恰好等于 → 放行
    expect(exceedsWindowOverflowLimit(262016, 129)).toBe(true); // 262145 > LIMIT
    expect(exceedsWindowOverflowLimit(0, STREAM_WINDOW_OVERFLOW_LIMIT)).toBe(false);
    expect(exceedsWindowOverflowLimit(0, STREAM_WINDOW_OVERFLOW_LIMIT + 1)).toBe(true);
  });
});

describe("core×store 编排：注入探针验证推进次序与隔离", () => {
  it("checker 收推进前 cursor（0→5），store 落 5→10；回传 9999 被忽略、extra 跨片存活", () => {
    const probe = probeChecker("probe");
    const store = createWindowStore();
    const core = mkCore(probe);
    core.scanResponseStreamUnit(store, mkUnit("aaaaa"));
    core.scanResponseStreamUnit(store, mkUnit("bbbbb"));
    expect(probe.cursors).toEqual([0, 5]); // 推进前 cursor：首片 0，次片为首片长度
    expect(store.get("probe")?.cursor).toBe(10); // 5+5：网关单点推进，9999 被忽略
    expect(store.get("probe")?.extra?.probeExtra).toBe(2); // extra 累积跨片存活
    expect(store.consumedBytes("probe")).toBe(10);
  });

  it("advance:false（归并重投影）：meta 打 llmveto_reprojected、窗口/账本零推进", () => {
    const probe = probeChecker("probe");
    const store = createWindowStore();
    const core = mkCore(probe);
    const { inputs, nextWindows } = core.scanResponseStreamUnit(store, mkUnit("abcdef"), { advance: false });
    expect(inputs.find((i) => i.checkerId === "probe")?.result.verdict).toBe("clean");
    expect(probe.reprojected[0]).toBe(true);
    expect(probe.cursors[0]).toBe(0);
    expect(store.has("probe")).toBe(false); // store 未被创建/推进
    expect(store.consumedBytes("probe")).toBe(0);
    expect(nextWindows.get("probe")?.cursor).toBe(0); // 回退值仍是初始窗口
  });

  it("两个注入 checker 的窗口/extra 互不污染（AC-V2a-26②）", () => {
    const p1 = probeChecker("p1");
    const p2 = probeChecker("p2");
    const store = createWindowStore();
    const core = mkCore(p1, p2);
    core.scanResponseStreamUnit(store, mkUnit("abc"));
    core.scanResponseStreamUnit(store, mkUnit("de"));
    expect(p1.cursors).toEqual([0, 3]);
    expect(p2.cursors).toEqual([0, 3]);
    expect(store.get("p1")?.extra?.probeExtra).toBe(2);
    expect(store.get("p2")?.extra?.probeExtra).toBe(2);
    expect(store.consumedBytes("p1")).toBe(5);
    expect(store.consumedBytes("p2")).toBe(5);
  });

  it("普通 Map 亦可用（无账本回退）：重组点仍单点推进、回传 cursor 忽略、extra 承接", () => {
    const probe = probeChecker("probe");
    const core = mkCore(probe);
    const windows = new Map<string, ScanWindow>();
    const r1 = core.scanResponseStreamUnit(windows, mkUnit("abc"));
    expect(probe.cursors).toEqual([0]);
    expect(r1.nextWindows.get("probe")?.cursor).toBe(3); // 回传 9999 被忽略，recombineWindow 兜底
    expect(r1.nextWindows.get("probe")?.extra?.probeExtra).toBe(1);
    // 普通 Map 不自记账本（这正是 WindowStore 存在的理由）：跨片由调用方显式回填窗口。
    const r2 = core.scanResponseStreamUnit(new Map(r1.nextWindows), mkUnit("de"));
    expect(probe.cursors).toEqual([0, 3]);
    expect(r2.nextWindows.get("probe")?.cursor).toBe(5); // 3+2：推进仍恰好一次
  });

  it("extraCheckers 注入通道与 REGISTRY checker 并存、同样按 store 记账", () => {
    const probe = probeChecker("probe");
    const store = createWindowStore();
    const core = mkCore(probe);
    const { nextWindows } = core.scanResponseStreamUnit(store, mkUnit("a\u200Bb"));
    expect(nextWindows.has("probe")).toBe(true);
    expect(nextWindows.has("invisible-unicode-scan")).toBe(true); // 内置流式 checker 同场
    expect(store.has("invisible-unicode-scan")).toBe(true);
    expect(store.get("invisible-unicode-scan")?.cursor).toBe(3);
  });
});
