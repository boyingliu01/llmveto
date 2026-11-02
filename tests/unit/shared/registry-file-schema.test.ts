import { describe, expect, it } from "vitest";
import { validateRegistryFile } from "../../../src/shared/registry-file-schema.ts";

// @test REQ-V2a-07
// @intent canary-registry.json 结构契约的只读校验（D-02）：运行期 store 与 doctor 共用。
//         损坏三类（版本 / 结构）必须逐项可判，合法文件返回规整化数据；
//         校验无 I/O，故可直接表驱动断言。
// @covers AC-V2a-19①

const valid = {
  version: 1,
  rotation_count: 2,
  last_rotated_at: "2026-11-02T00:00:00.000Z",
  entries: { s1: { canary: "llmveto-canary-0123456789ab", last_seen: 1_760_000_000_000 } },
};

describe("registry-file-schema: validateRegistryFile", () => {
  it("合法文件 → 返回规整化 RegistryFile（version 恒为当前版本）", () => {
    const checked = validateRegistryFile(valid);
    expect(typeof checked).not.toBe("string");
    if (typeof checked === "string") return;
    expect(checked.version).toBe(1);
    expect(checked.rotation_count).toBe(2);
    expect(checked.last_rotated_at).toBe(valid.last_rotated_at);
    expect(checked.entries.s1?.canary).toBe(valid.entries.s1.canary);
  });

  it("last_rotated_at=null（从未轮换）合法", () => {
    const checked = validateRegistryFile({ ...valid, last_rotated_at: null });
    expect(typeof checked).not.toBe("string");
  });

  it("非对象 / 数组 / null → malformed_structure", () => {
    for (const v of [null, 42, "x", [], [valid]]) {
      expect(validateRegistryFile(v), JSON.stringify(v)).toBe("malformed_structure");
    }
  });

  it("version 不识别 → unknown_version（不是 malformed）", () => {
    expect(validateRegistryFile({ ...valid, version: 2 })).toBe("unknown_version");
    expect(validateRegistryFile({ ...valid, version: "1" })).toBe("unknown_version");
  });

  it("rotation_count 非法（负数 / 非有限 / 非数字）→ malformed_structure", () => {
    for (const rotation of [-1, Number.NaN, Number.POSITIVE_INFINITY, "2", null]) {
      expect(validateRegistryFile({ ...valid, rotation_count: rotation })).toBe("malformed_structure");
    }
  });

  it("last_rotated_at 非法（非 null 且不可解析）→ malformed_structure", () => {
    for (const at of ["not-a-date", 123, {}]) {
      expect(validateRegistryFile({ ...valid, last_rotated_at: at })).toBe("malformed_structure");
    }
  });

  it("entries 非普通对象（null / 数组 / 字符串）→ malformed_structure", () => {
    for (const entries of [null, [], "x", 7]) {
      expect(validateRegistryFile({ ...valid, entries })).toBe("malformed_structure");
    }
  });

  it("单条 entry 结构非法（canary 非串 / last_seen 非有限数）→ malformed_structure", () => {
    const cases = [
      { s: null },
      { s: [] },
      { s: { canary: 1, last_seen: 1 } },
      { s: { canary: "c", last_seen: "1" } },
      { s: { canary: "c", last_seen: Number.NaN } },
      { s: { canary: "c" } },
    ];
    for (const entries of cases) {
      expect(validateRegistryFile({ ...valid, entries }), JSON.stringify(entries)).toBe("malformed_structure");
    }
  });
});
