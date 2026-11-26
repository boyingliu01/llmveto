import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../../../src/cli/index.ts";
import { FingerprintStore } from "../../../src/fingerprint/store.ts";

// @test REQ-V2bC-14 / AC-14a~b
// @intent CLI 是用户唯一能看见指纹结论的地方。两条：
//           AC-14a 命令可用（不是桩）
//           AC-14b 输出信任分与样本计数
//
//         另一条隐含约束：`fingerprint` **默认不触发探针**——只读展示。
//         想探必须显式 `--probe`，因为探针会向中转站发请求（最小暴露）。

let dirs: string[] = [];
function stateDir(): string {
  const d = mkdtempSync(join(tmpdir(), "fp-cli-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe("SL-14 CLI fingerprint（AC-14a/14b）", () => {
  it("AC-14a：命令已注册（不是 unknown command）", async () => {
    const r = await runCli("fingerprint", { stateDir: stateDir() });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toContain("unknown command");
  });

  it("无数据时给出可操作提示，而不是空输出", async () => {
    const r = await runCli("fingerprint", { stateDir: stateDir() });
    expect(r.stdout).toContain("no fingerprint data yet");
    expect(r.stdout).toContain("--probe");
  });

  it("AC-14b：有数据时输出 trust 与 samples", async () => {
    const dir = stateDir();
    const store = new FingerprintStore(join(dir, "fingerprint.jsonl"));
    for (let i = 0; i < 3; i += 1) {
      store.append({
        kind: "probe_feature",
        provider_id: "p/a",
        dimension: "D0",
        value: 10,
        verdict: "clean",
        deviation: 0,
        ts: "t",
      });
    }
    const r = await runCli("fingerprint", { stateDir: dir });
    expect(r.stdout).toContain("p/a");
    expect(r.stdout).toContain("trust=");
    expect(r.stdout).toContain("samples=3");
  });

  it("样本不足时标 provisional（分数仅供参考）", async () => {
    const dir = stateDir();
    new FingerprintStore(join(dir, "fingerprint.jsonl")).append({
      kind: "probe_feature",
      provider_id: "p",
      dimension: "D0",
      value: 10,
      verdict: "clean",
      deviation: 0,
      ts: "t",
    });
    expect((await runCli("fingerprint", { stateDir: dir })).stdout).toContain("provisional");
  });

  it("默认不触发探针（只读展示）", async () => {
    const r = await runCli("fingerprint", { stateDir: stateDir() });
    // 输出里不该出现"probe requested"
    expect(r.stdout).not.toContain("probe requested");
  });

  it("--probe 缺 provider 参数 → exit 2 + 用法", async () => {
    const r = await runCli("fingerprint", { stateDir: stateDir(), args: ["--probe"] });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("--probe <provider_id>");
  });

  it("--probe 带 provider → 受理并说明配额约束", async () => {
    const r = await runCli("fingerprint", { stateDir: stateDir(), args: ["--probe", "p/x"] });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("p/x");
    expect(r.stdout).toContain("quota");
  });
});
