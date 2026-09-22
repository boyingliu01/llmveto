import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deepMerge, readJsonConfig, readJsonConfigStrict, writeJsonConfig } from "../src/adapters/config-io.ts";
import { opencodeAdapter } from "../src/adapters/opencode.ts";
import { delphiAdapter } from "../src/adapters/delphi.ts";
import type { Env } from "../src/adapters/index.ts";

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

  it("readJsonConfigStrict 写路径语义：缺失/空白 → {}；存在但不可解析 → throw；顶层非对象 → throw", () => {
    expect(readJsonConfigStrict(join(dir, "strict-absent.json"))).toEqual({});
    const blank = join(dir, "strict-blank.json");
    writeFileSync(blank, " \n ", "utf8");
    expect(readJsonConfigStrict(blank)).toEqual({});
    const broken = join(dir, "strict-broken.json");
    writeFileSync(broken, "{ not json", "utf8");
    expect(() => readJsonConfigStrict(broken)).toThrow();
    const arr = join(dir, "strict-arr.json");
    writeFileSync(arr, "[1,2,3]", "utf8");
    expect(() => readJsonConfigStrict(arr)).toThrow(/not a JSON object/);
    // 与检测侧（readJsonConfig）的语义分叉是本修复的核心：读失败在写路径不得退化为空对象。
    expect(readJsonConfig(broken)).toEqual({});
  });
});

describe("adapters applyManagedConfig 写路径守卫 (REQ-VETO-009)", () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "llmveto-cfg-write-")); });
  afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } });

  const cases = [
    { name: "opencode", adapter: opencodeAdapter, envKey: "LLMVETO_OPENCODE_CONFIG" },
    { name: "delphi", adapter: delphiAdapter, envKey: "LLMVETO_DELPHI_CONFIG" },
  ] as const;

  for (const c of cases) {
    it(`${c.name}：既有配置不可解析 → 抛错且文件原样未动（禁止以空基覆写用户配置）`, () => {
      const p = join(dir, `${c.name}-broken.json`);
      writeFileSync(p, "{ broken", "utf8");
      const env: Env = { [c.envKey]: p };
      expect(() => c.adapter.applyManagedConfig(env, "http://127.0.0.1:8787")).toThrow();
      expect(readFileSync(p, "utf8")).toBe("{ broken");
    });

    it(`${c.name}：合法配置 → 深合并写入，非受管字段保留`, () => {
      const p = join(dir, `${c.name}-ok.json`);
      writeFileSync(p, JSON.stringify({ keep: { me: true }, ...(c.name === "opencode" ? { provider: { custom: { options: { baseURL: "http://x" } } } } : {}) }), "utf8");
      const env: Env = { [c.envKey]: p };
      c.adapter.applyManagedConfig(env, "http://127.0.0.1:8787");
      const written = readJsonConfig(p) as Record<string, unknown>;
      expect(written.keep).toEqual({ me: true }); // 非受管内容未被覆写
      expect(c.adapter.detectDrift(written, "http://127.0.0.1:8787")).toEqual([]); // 写后漂移自洽
    });
  }
});
