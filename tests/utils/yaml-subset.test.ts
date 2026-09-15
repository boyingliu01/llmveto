import { describe, expect, it } from "vitest";
import { parseYamlSubset } from "./yaml-subset.ts";

// @test REQ-VETO-012
// @intent yaml-subset 解析器：仅覆盖本项目 fixture 使用的最小子集
//         （scalar / list-of-maps / nested map / quoted string / boolean / null / number）

describe("yaml-subset parser (test-only helper)", () => {
  it("parses flat scalars with correct types", () => {
    const r = parseYamlSubset(
      [
        "name: alice",
        "age: 30",
        "active: true",
        "score: 4.5",
        "note: null",
        "quoted: 'hello world'",
      ].join("\n"),
    );
    expect(r).toEqual({
      name: "alice",
      age: 30,
      active: true,
      score: 4.5,
      note: null,
      quoted: "hello world",
    });
  });

  it("parses indented list of maps (fixture convention)", () => {
    const src = [
      "items:",
      "  - id: t1",
      "    body: hello",
      "    expected: 1",
      "  - id: t2",
      "    body: world",
      "    expected: 2",
    ].join("\n");
    const r = parseYamlSubset(src);
    expect(r.items).toEqual([
      { id: "t1", body: "hello", expected: 1 },
      { id: "t2", body: "world", expected: 2 },
    ]);
  });

  it("parses nested list of scalars", () => {
    const r = parseYamlSubset(["codes:", "  - FEFF", "  - 200B"].join("\n"));
    expect(r.codes).toEqual(["FEFF", "200B"]);
  });

  it("skips comment lines and blank lines", () => {
    const r = parseYamlSubset(["# comment", "a: 1", "", "# another", "b: 2"].join("\n"));
    expect(r).toEqual({ a: 1, b: 2 });
  });

  it("handles quoted string containing colon", () => {
    const r = parseYamlSubset(`url: "http://example.com:8080"`);
    expect(r.url).toBe("http://example.com:8080");
  });
});
