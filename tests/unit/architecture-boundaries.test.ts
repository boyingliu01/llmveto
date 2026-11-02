import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// @test REQ-VETO-003
// @intent 架构边界断言 —— 落实 TEST 可测试性契约 #2：checker 不得 import gateway/evidence/policy
//         与 architecture.yaml 双重锁。违反者使表驱动单测失效，且无法事后补。
// @covers AC-VETO-003-04
// 边界：src/checkers/** 只允许 import 自身目录 + src/shared/**；
//       src/policy/** 允许 shared + checkers；
//       src/gateway/** 允许 shared + checkers + policy + evidence。
// 参见 architecture.yaml。

// 本文件位于 tests/unit/ → 上两级 = 仓库根。（历史教训：曾用 "../../.."，文件移入
// tests/unit/ 后 ROOT 指向仓库上一级，walk 静默返回空集 → 旧断言在 Windows 上空转；
// v2a canary 断言真实读文件才暴露。）
const ROOT = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function walk(dir: string): string[] {
  const abs = join(ROOT, dir);
  try {
    if (!statSync(abs).isDirectory()) return [];
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of readdirSync(abs)) {
    const p = join(abs, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(relative(ROOT, p)));
    else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) out.push(relative(ROOT, p));
  }
  return out;
}

const LAYER_ALLOW: Record<string, string[]> = {
  "src/shared":    ["../shared", "./"],
  "src/canary":    ["../shared", "./"],
  "src/checkers":  ["../shared", "../checkers", "./"],
  "src/policy":    ["../shared", "../checkers", "../policy", "./"],
  "src/evidence":  ["../shared", "../evidence", "./"],
  "src/adapters":  ["../shared", "../adapters", "./"],
  "src/gateway":   ["../shared", "../checkers", "../policy", "../evidence", "../canary", "../gateway", "./"],
  "src/cli":       ["../shared", "../checkers", "../policy", "../evidence", "../adapters", "../gateway", "../cli", "./"],
};

function layerOf(file: string): string | null {
  for (const layer of Object.keys(LAYER_ALLOW)) {
    if (file.startsWith(layer.replace(/\\/g, "/")) || file.startsWith(layer + "/")) return layer;
  }
  return null;
}

const allSrcFiles = walk("src").filter((f) => layerOf(f.replace(/\\/g, "/")) !== null);

describe("architecture boundaries (TEST 契约 #2)", () => {
  it("src/checkers/** 不 import gateway/evidence/policy/adapters/cli", () => {
    const forbidden = /from\s+["'][^"']*(?:gateway|evidence|policy|adapters|cli)[^"']*["']/;
    const offenders: string[] = [];
    for (const f of allSrcFiles) {
      const fposix = f.replace(/\\/g, "/");
      if (!fposix.startsWith("src/checkers/")) continue;
      const src = readFileSync(join(ROOT, fposix), "utf8");
      for (const line of src.split("\n")) {
        if (line.trimStart().startsWith("//")) continue;
        if (forbidden.test(line)) offenders.push(`${fposix}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("所有 src 层 import 路径落在 LAYER_ALLOW 白名单内", () => {
    const importRe = /from\s+["'](\.\.?\/[^"']+)["']/g;
    const violations: string[] = [];
    for (const f of allSrcFiles) {
      const fposix = f.replace(/\\/g, "/");
      const layer = layerOf(fposix);
      if (!layer) continue;
      const allow = LAYER_ALLOW[layer]!;
      const src = readFileSync(join(ROOT, fposix), "utf8");
      for (const m of src.matchAll(importRe)) {
        const spec = m[1]!;
        // 归一化：src/checkers/x.ts 中 import "../shared/types" → 目标层为 src/shared
        const targetDir = fposix.replace(/\/[^/]+$/, "");
        const resolved = join(targetDir, spec).replace(/\\/g, "/").replace(/^(\.\.\/)+/, "");
        const targetLayer = "src/" + resolved.split("/").find((seg) => !seg.startsWith("."));
        // 简化：只要目标不是本层且不在允许前缀 → 违规。实际判定见下方 ok（allow 数组参与）。
        const isLocal = spec.startsWith("./");
        const crossLayer = targetLayer !== layer;
        if (crossLayer && !isLocal) {
          const ok = Object.keys(LAYER_ALLOW).some((l) => resolved.startsWith(l + "/") && allow.includes("../" + l.split("/").pop()!));
          if (!ok) violations.push(`${fposix}: import ${spec} → ${resolved} (layer ${targetLayer} not allowed)`);
        }
      }
    }
    // 当前 SL-02 只引入 checkers→shared，其他跨层留待后续 slice；先断言"已知安全"
    expect(violations).toEqual([]);
  });
});

// ── v2a 扩展（REQ-V2a-07 / AC-V2a-19③，设计决策 D-01）────────────────────────

// @test REQ-V2a-07
// @intent canary 新域分层断言：canary=[shared]、gateway 扩列 +canary、checkers 不变且不 import
//         canary、cli 无 canary 写侧 import —— architecture.yaml 与源码扫描双重锁。
// @covers AC-V2a-19③（静态侧）

function parseLayers(): Record<string, string[]> {
  const text = readFileSync(join(ROOT, "architecture.yaml"), "utf8");
  const layers: Record<string, string[]> = {};
  let current: string | null = null;
  for (const line of text.split("\n")) {
    const nameMatch = /^\s*-\s*name:\s*(\S+)\s*$/.exec(line);
    if (nameMatch) {
      current = nameMatch[1]!;
      layers[current] = [];
      continue;
    }
    const importMatch = /^\s*allowed_imports:\s*\[([^\]]*)\]/.exec(line);
    if (importMatch && current !== null) {
      layers[current] = importMatch[1]!
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
  }
  return layers;
}

describe("architecture boundaries v2a (REQ-V2a-07 / AC-V2a-19③, D-01)", () => {
  const layers = parseLayers();

  it("architecture.yaml：canary 层存在且 allowed_imports = [shared]", () => {
    expect(layers["canary"]).toEqual(["shared"]);
  });

  it("architecture.yaml：gateway 层扩列含 canary；checkers 层不变且不含 canary", () => {
    expect(layers["gateway"]).toContain("canary");
    expect(layers["checkers"]).toEqual(["shared", "checkers"]);
  });

  it("src/canary/** 源码只 import shared 层与自身", () => {
    const files = walk("src/canary");
    expect(files.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const f of files) {
      const fposix = f.replace(/\\/g, "/");
      const src = readFileSync(join(ROOT, fposix), "utf8");
      for (const m of src.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)) {
        const targetDir = fposix.replace(/\/[^/]+$/, "");
        const resolved = join(targetDir, m[1]!).replace(/\\/g, "/").replace(/^(\.\.\/)+/, "");
        if (!resolved.startsWith("src/shared/") && !resolved.startsWith("src/canary/")) {
          violations.push(`${fposix}: import ${m[1]} → ${resolved}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("src/checkers/** 源码不 import canary（AC-V2a-26④ 不放宽）", () => {
    const forbidden = /from\s+["'][^"']*canary[^"']*["']/;
    const offenders: string[] = [];
    for (const f of allSrcFiles) {
      const fposix = f.replace(/\\/g, "/");
      if (!fposix.startsWith("src/checkers/")) continue;
      const src = readFileSync(join(ROOT, fposix), "utf8");
      for (const line of src.split("\n")) {
        if (line.trimStart().startsWith("//")) continue;
        if (forbidden.test(line)) offenders.push(`${fposix}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("src/cli/** 不 import canary 写侧（AC-V2a-19③ 静态断言，防未来回归）", () => {
    const offenders: string[] = [];
    const targets = [...walk("src/cli"), "src/index.ts"];
    expect(targets.length).toBeGreaterThan(0);
    for (const f of targets) {
      const fposix = f.replace(/\\/g, "/");
      const src = readFileSync(join(ROOT, fposix), "utf8");
      if (/from\s+["'][^"']*canary/.test(src)) offenders.push(fposix);
    }
    expect(offenders).toEqual([]);
  });
});
