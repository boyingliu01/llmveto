import { describe, expect, it } from "vitest";
import { EMPTY_PROJECTION, projection } from "../../../../src/gateway/protocols/types.ts";

// @test REQ-V2bA-14
// @intent 投影值对象的契约：`derived` 标记与 `present` 的来源必须明确，
//         否则下游无法区分"原文可见"与"规范化产物"（REQ-05 offsets 口径）。

describe("protocols/types 投影值对象", () => {
  it("projection() 产出 parts/handled/derived，present 恒为空（由调用方回填）", () => {
    const p = projection(["a"], ["x"], true);
    expect(p).toEqual({ parts: ["a"], derived: true, handled: ["x"], present: [] });
  });

  it("默认 derived=false", () => {
    expect(projection([], []).derived).toBe(false);
  });

  it("EMPTY_PROJECTION 是冻结的空值（心跳帧用）", () => {
    expect(EMPTY_PROJECTION.parts).toEqual([]);
    expect(EMPTY_PROJECTION.handled).toEqual([]);
    expect(EMPTY_PROJECTION.present).toEqual([]);
    expect(EMPTY_PROJECTION.derived).toBe(false);
    expect(Object.isFrozen(EMPTY_PROJECTION)).toBe(true);
  });
});
