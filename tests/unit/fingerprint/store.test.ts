import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FingerprintStore } from "../../../src/fingerprint/store.ts";

// @test REQ-V2bC-11 / AC-11a~c
// @intent 三类证据事件必须能落盘、能读回、且 kind 是封闭枚举。
//         设计 D-07 要求它们同一张表用 kind 区分——不另立存储，
//         因为"信任分要能聚合"的前提是所有事件在一个地方。

let dirs: string[] = [];
function tempPath(): string {
  const d = mkdtempSync(join(tmpdir(), "fp-store-"));
  dirs.push(d);
  return join(d, "fingerprint.jsonl");
}

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

/** 造一条 probe_feature 事件（多个用例共用，避免重复）。 */
function feature(over: Partial<{ provider_id: string; dimension: "D0"; value: number; ts: string }> = {}) {
  return {
    kind: "probe_feature" as const,
    provider_id: "p",
    dimension: "D0" as const,
    value: 1,
    verdict: "clean" as const,
    deviation: 0,
    ts: "t",
    ...over,
  };
}

describe("SL-06 事件写入与读回（AC-11a~c）", () => {
  it("probe_feature 落盘后能原样读回", () => {
    const path = tempPath();
    const store = new FingerprintStore(path);
    store.append({
      kind: "probe_feature",
      provider_id: "opencode/whalecloud",
      dimension: "D0",
      value: 42,
      verdict: "clean",
      deviation: 0.01,
      ts: "2026-11-26T12:00:00Z",
    });
    const all = store.readAll();
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual({
      kind: "probe_feature",
      provider_id: "opencode/whalecloud",
      dimension: "D0",
      value: 42,
      verdict: "clean",
      deviation: 0.01,
      ts: "2026-11-26T12:00:00Z",
    });
  });

  it("AC-11b：probe_failure 的 target_dimension 恒非空", () => {
    const path = tempPath();
    const store = new FingerprintStore(path);
    store.append({
      kind: "probe_failure",
      provider_id: "p",
      target_dimension: "D2",
      error_class: "timeout",
      ts: "2026-11-26T12:00:00Z",
    });
    const [e] = store.readAll();
    expect(e).toHaveProperty("target_dimension", "D2");
  });

  it("AC-11b：写入 target_dimension 为空串时拒绝（不是静默接受）", () => {
    const path = tempPath();
    const store = new FingerprintStore(path);
    expect(() =>
      store.append({
        kind: "probe_failure",
        provider_id: "p",
        // biome-ignore lint/suspicious/noExplicitAny: 故意传非法值验证拒绝
        target_dimension: "" as any,
        error_class: "timeout",
        ts: "2026-11-26T12:00:00Z",
      }),
    ).toThrow(/target_dimension/);
  });

  it("AC-11c：inconsistent_degradation 字段完整", () => {
    const path = tempPath();
    const store = new FingerprintStore(path);
    store.append({
      kind: "inconsistent_degradation",
      provider_id: "p",
      degraded_dimension: "D2",
      healthy_dimensions: ["D0", "D1", "D3"],
      ts: "2026-11-26T12:00:00Z",
    });
    const [e] = store.readAll();
    expect(e).toMatchObject({ degraded_dimension: "D2", healthy_dimensions: ["D0", "D1", "D3"] });
  });

  it("kind 是封闭枚举：未知 kind 被拒绝", () => {
    const path = tempPath();
    const store = new FingerprintStore(path);
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: 故意传枚举外值
      store.append({ kind: "unknown_kind", provider_id: "p", ts: "2026-11-26T12:00:00Z" } as any),
    ).toThrow(/kind/);
  });
});

describe("SL-06 按 provider / kind 查询", () => {
  it("forProvider 只返回该 provider 的事件", () => {
    const path = tempPath();
    const store = new FingerprintStore(path);
    store.append(feature({ provider_id: "a", ts: "t1" }));
    store.append(feature({ provider_id: "b", ts: "t2" }));
    expect(store.forProvider("a")).toHaveLength(1);
    expect(store.forProvider("b")).toHaveLength(1);
  });

  it("recent 按 provider 取最近 N 条特征（K 窗口用）", () => {
    const path = tempPath();
    const store = new FingerprintStore(path);
    for (let i = 0; i < 15; i += 1) {
      store.append(feature({ provider_id: "a", value: i, ts: `t${i}` }));
    }
    expect(store.recentFeatures("a", "D0", 10)).toHaveLength(10);
    // 取的是**最近**的 10 条（值 5..14），不是最早的
    expect(store.recentFeatures("a", "D0", 10)[0]?.value).toBe(5);
  });
});

describe("SL-06 损坏行处理", () => {
  it("末行半写（崩溃残留）被丢弃，不阻断读取", () => {
    const path = tempPath();
    writeFileSync(path, '{"kind":"probe_feature","provider_id":"a","dimension":"D0","value":1,"verdict":"clean","deviation":0,"ts":"t"}\n{"kind":"probe_feat', "utf8");
    const store = new FingerprintStore(path);
    expect(store.readAll()).toHaveLength(1);
  });

  it("文件不存在 → 空结果（不是抛错）", () => {
    expect(new FingerprintStore(join(tmpdir(), `nope-${Date.now()}.jsonl`)).readAll()).toEqual([]);
  });
});
