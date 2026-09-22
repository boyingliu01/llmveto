import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deepMerge, readJsonConfig, writeJsonConfig } from "../src/adapters/config-io.ts";

// @test REQ-VETO-009
// @intent config-io 受管配置读写原语：缺失/空/坏文件 → {}（doctor 据此判"全漂移"，fail-closed）；
//         写出幂等（深合并 + 标量/数组按 patch 覆盖），供漂移检测与配置修复共用。
// 位置约定：置于 tests/ 根（而非 tests/unit/adapters/ 镜像位）——兼容全局 xp-gate Gate 5A
//           「新源文件须配对测试」的 tests/<name>.test.ts 路径规则；仓库其余测试仍用镜像结构。

describe("adapters config-io (REQ-VETO-009)", () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "llmveto-cfg-")); });
  afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } });

  it("readJsonConfig 文件缺失 → {}", () => {
    expect(readJsonConfig(join(dir, "absent.json"))).toEqual({});
  });

  it("readJsonConfig 合法对象 → 原样返回", () => {
    const p = join(dir, "ok.json");
    writeJsonConfig(p, { a: 1, nested: { b: "x" } });
    expect(readJsonConfig(p)).toEqual({ a: 1, nested: { b: "x" } });
  });

  it("readJsonConfig 空文件 / 纯空白 → {}", () => {
    const p = join(dir, "empty.json");
    writeFileSync(p, "  \n\t ", "utf8");
    expect(readJsonConfig(p)).toEqual({});
  });

  it("readJsonConfig 不可解析 JSON → {}", () => {
    const p = join(dir, "broken.json");
    writeFileSync(p, "{ not json", "utf8");
    expect(readJsonConfig(p)).toEqual({});
  });

  it("readJsonConfig 顶层非对象（数组/字符串）→ {}", () => {
    const arr = join(dir, "arr.json");
    writeFileSync(arr, "[1,2,3]", "utf8");
    expect(readJsonConfig(arr)).toEqual({});
    const str = join(dir, "str.json");
    writeFileSync(str, '"hello"', "utf8");
    expect(readJsonConfig(str)).toEqual({});
  });

  it("writeJsonConfig 递归建父目录 + 2 空格缩进 + 尾换行（round-trip 一致）", () => {
    const p = join(dir, "deep", "nested", "out.json");
    writeJsonConfig(p, { k: { v: [1, 2] } });
    const raw = readFileSync(p, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toContain('  "k"');
    expect(readJsonConfig(p)).toEqual({ k: { v: [1, 2] } });
  });

  it("deepMerge 纯对象深合并；数组/标量按 patch 覆盖（幂等，不改入参）", () => {
    const base = { a: 1, nest: { x: 1, y: 2 }, arr: [1, 2], keep: true };
    const patch = { nest: { y: 9, z: 3 }, arr: [7], b: "new" };
    const merged = deepMerge(base, patch);
    expect(merged).toEqual({ a: 1, nest: { x: 1, y: 9, z: 3 }, arr: [7], keep: true, b: "new" });
    expect(deepMerge(merged, patch)).toEqual(merged);
    expect(base.nest).toEqual({ x: 1, y: 2 });
  });
});
