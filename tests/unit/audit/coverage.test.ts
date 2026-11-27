import { describe, expect, it } from "vitest";
import { type EvidenceSample, computeCoverage } from "../../../src/audit/coverage.ts";

// @test REQ-V3-02
// @intent 对比"用户声明的 agent"与"evidence 里的实际流量"，产出三态。
//
//         **关键区分**（设计 D-03）：
//           active  窗口内有流量
//           stale   窗口内无，但历史上有  ← 可能停用了
//           missing 从未有过             ← 最可疑：可能拼错 id，或压根没接
//
//         混成一个会让用户无法判断该看哪条。空 evidence 时全部是 missing 而非 stale
//         ——"历史上有过"在空数据下不成立。

const DAY = 24 * 3600 * 1000;
const NOW = Date.parse("2026-11-28T00:00:00Z");

function sample(client: string, msAgo: number): EvidenceSample {
  return { client, ts: new Date(NOW - msAgo).toISOString() };
}

describe("三态判定（设计 D-03）", () => {
  it("窗口内有流量 → active", () => {
    const r = computeCoverage(["a"], [sample("a", 1 * DAY)], { now: NOW, windowDays: 7 });
    expect(r.entries[0]?.state).toBe("active");
    expect(r.entries[0]?.count).toBe(1);
  });

  it("窗口内无但有历史 → stale", () => {
    const r = computeCoverage(["a"], [sample("a", 30 * DAY)], { now: NOW, windowDays: 7 });
    expect(r.entries[0]?.state).toBe("stale");
  });

  it("从未有过 → missing", () => {
    const r = computeCoverage(["a"], [], { now: NOW, windowDays: 7 });
    expect(r.entries[0]?.state).toBe("missing");
  });

  it("空 evidence：所有声明都是 missing 而非 stale（设计：边界情况）", () => {
    const r = computeCoverage(["a", "b"], [], { now: NOW, windowDays: 7 });
    expect(r.entries.map((e) => e.state)).toEqual(["missing", "missing"]);
  });

  it("stale 带 lastSeen，missing 不带", () => {
    const r = computeCoverage(["old", "never"], [sample("old", 30 * DAY)], { now: NOW, windowDays: 7 });
    expect(r.entries[0]?.lastSeen).toBeDefined();
    expect(r.entries[1]?.lastSeen).toBeUndefined();
  });
});

describe("时间窗边界（设计 D-05：左闭右开）", () => {
  it("恰好落在窗口左边界 → 计入（左闭）", () => {
    const r = computeCoverage(["a"], [sample("a", 7 * DAY)], { now: NOW, windowDays: 7 });
    expect(r.entries[0]?.state).toBe("active");
    expect(r.entries[0]?.count).toBe(1);
  });

  it("早于左边界 1ms → 不计入窗口", () => {
    const r = computeCoverage(["a"], [sample("a", 7 * DAY + 1)], { now: NOW, windowDays: 7 });
    expect(r.entries[0]?.state).toBe("stale");
    expect(r.entries[0]?.count).toBe(0);
  });

  it("晚于 now 的记录不计入（未来时间戳）", () => {
    const r = computeCoverage(["a"], [sample("a", -1 * DAY)], { now: NOW, windowDays: 7 });
    expect(r.entries[0]?.count).toBe(0);
  });
});

describe("精确匹配，不做归一化（设计 D-02）", () => {
  it("Codex 声明不会匹配到 codex 流量", () => {
    const r = computeCoverage(["Codex"], [sample("codex", 1 * DAY)], { now: NOW, windowDays: 7 });
    expect(r.entries[0]?.state).toBe("missing");
  });

  it("大小写完全一致才匹配", () => {
    const r = computeCoverage(["codex"], [sample("codex", 1 * DAY)], { now: NOW, windowDays: 7 });
    expect(r.entries[0]?.state).toBe("active");
  });
});

describe("已知 client 提示（设计：边界情况）", () => {
  it("knownClients 列出 evidence 里实际出现的所有 client（含非客户端值）", () => {
    const r = computeCoverage(
      ["a"],
      [sample("a", 1 * DAY), sample("dsh", 2 * DAY), sample("healthz", 3 * DAY), sample("unknown", 4 * DAY)],
      { now: NOW, windowDays: 7 },
    );
    expect(r.knownClients).toEqual(["a", "dsh", "healthz", "unknown"]);
  });

  it("knownClients 含窗口外的历史 client（拼错对照需要看全量）", () => {
    const r = computeCoverage(["a"], [sample("very-old", 300 * DAY)], { now: NOW, windowDays: 7 });
    expect(r.knownClients).toEqual(["very-old"]);
  });

  it("knownClients 排序稳定（便于对照阅读）", () => {
    const r = computeCoverage(["a"], [sample("z", 1 * DAY), sample("a", 1 * DAY)], { now: NOW, windowDays: 7 });
    expect(r.knownClients).toEqual(["a", "z"]);
  });
});

describe("汇总", () => {
  it("hasMissing 反映是否存在 missing", () => {
    expect(computeCoverage(["a"], [], { now: NOW, windowDays: 7 }).hasMissing).toBe(true);
    expect(computeCoverage(["a"], [sample("a", 1 * DAY)], { now: NOW, windowDays: 7 }).hasMissing).toBe(false);
  });

  it("只有 stale 时 hasMissing 为 false（stale 是信息性的）", () => {
    const r = computeCoverage(["a"], [sample("a", 30 * DAY)], { now: NOW, windowDays: 7 });
    expect(r.hasMissing).toBe(false);
  });
});
