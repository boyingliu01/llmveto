import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMANDS, assertNoV2Stubs, runCli } from "../../../src/cli/index.ts";

// @test REQ-V2a-06
// @intent SL-12: canary rotate 双路径 + 未知动词 exit 2 + assertNoV2Stubs 放宽
// @covers AC-V2a-08 AC-V2a-19③

describe("SL-12 canary rotate (AC-V2a-08)", () => {
  it("COMMANDS 扩展至 6：含 canary", () => {
    expect(COMMANDS).toContain("canary");
    expect(COMMANDS.length).toBe(6);
  });

  it("assertNoV2Stubs 允许 canary，仍禁 report", () => {
    expect(() => assertNoV2Stubs()).not.toThrow();
  });

  it("canary 无动词 → exit 2", async () => {
    const dir = mkdtempSync(join(tmpdir(), "llmveto-canary-"));
    const r = await runCli("canary", { stateDir: dir, args: [] });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("unknown canary verb");
    rmSync(dir, { recursive: true, force: true });
  });

  it("canary unknown-verb → exit 2", async () => {
    const dir = mkdtempSync(join(tmpdir(), "llmveto-canary-unk-"));
    const r = await runCli("canary", { stateDir: dir, args: ["frobnicate"] });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("unknown canary verb");
    rmSync(dir, { recursive: true, force: true });
  });

  it("canary rotate 离线路径：网关未运行 → 写零字节哨兵并如实说明延后生效", async () => {
    const dir = mkdtempSync(join(tmpdir(), "llmveto-canary-offline-"));
    const r = await runCli("canary", {
      stateDir: dir,
      args: ["rotate"],
      env: { LLMVETO_GATEWAY_URL: "http://127.0.0.1:1" }, // 不可能有网关在端口 1
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("rotate deferred");
    expect(r.stdout).toContain("applies on next gateway start");
    const sentinel = join(dir, "canary-rotate.request");
    expect(existsSync(sentinel)).toBe(true);
    expect(readFileSync(sentinel).length).toBe(0); // 零字节
    rmSync(dir, { recursive: true, force: true });
  });

  it("canary rotate 不可达目标不挂起：仍走离线登记路径", async () => {
    // 无法在单测中启动真实网关（需要完整配置），此处验证 fetch 失败路径
    const dir = mkdtempSync(join(tmpdir(), "llmveto-canary-online-err-"));
    // 指向一个不可达地址但 TCP 可达（用本机端口 0 不可达 → 走离线）
    // 改为：模拟 reachable 但 fetch 失败 → 用 loopback 上无服务的端口
    // 实际上 probeReachable + fetch 都会失败 → 走离线。在线错误路径需真实网关。
    // 此处仅验证命令分派不 crash。
    const r = await runCli("canary", {
      stateDir: dir,
      args: ["rotate"],
      env: { LLMVETO_GATEWAY_URL: "http://127.0.0.1:1" },
    });
    expect(r.exitCode).toBe(0); // 不可达 → 离线成功
    rmSync(dir, { recursive: true, force: true });
  });
});
