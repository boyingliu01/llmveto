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

const ROOT = new URL("../../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

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
  "src/checkers":  ["../shared", "../checkers", "./"],
  "src/policy":    ["../shared", "../checkers", "../policy", "./"],
  "src/evidence":  ["../shared", "../evidence", "./"],
  "src/adapters":  ["../shared", "../adapters", "./"],
  "src/gateway":   ["../shared", "../checkers", "../policy", "../evidence", "../gateway", "./"],
  "src/cli":       ["../shared", "../checkers", "../policy", "../evidence", "../adapters", "../gateway", "../cli", "./"],
};

function layerOf(file: string): string | null {
  for (const layer of Object.keys(LAYER_ALLOW)) {
    if (file.startsWith(layer.replace(/\\/g, "/")) || file.startsWith(layer + "/")) return layer;
  }
  return null;
}

describe("architecture boundaries (TEST 契约 #2)", () => {
  const allSrcFiles = walk("src").filter((f) => layerOf(f.replace(/\\/g, "/")) !== null);

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
