import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COMMANDS, assertNoV2Stubs, runCli } from "../../../src/cli/index.ts";
import { EvidenceWriter } from "../../../src/evidence/writer.ts";

// @test REQ-VETO-008
// @intent CLI 冻结 5 命令集合（无 stub）+ doctor 4 检查项 + verify 三种失败模式
// @covers AC-VETO-008-01 AC-VETO-008-02 AC-VETO-008-03 AC-VETO-008-04

describe("SL-11 CLI (REQ-VETO-008)", () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "llmveto-cli-")); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it("AC-01 命令集合封闭枚举：仅 start/stop/status/doctor/verify", () => {
    expect([...COMMANDS].sort()).toEqual(["doctor", "start", "status", "stop", "verify"]);
    expect(() => assertNoV2Stubs()).not.toThrow();
  });

  it("AC-01 未注册命令 → exit=2", async () => {
    const r = await runCli("report", { stateDir: dir });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("unknown command");
  });

  it("AC-02 doctor 4 检查项：漂移 FAIL（枚举内条目未受管）", async () => {
    const r = await runCli("doctor", { stateDir: dir });
    expect(r.stdout).toContain("doctor.config-drift");
    expect(r.stdout).toContain("doctor.port-reachable");
    expect(r.stdout).toContain("doctor.evidence-chain");
    // 空配置 → 所有受管项都算漂移 → FAIL
    const last = r.stdout.split("\n").filter(Boolean).map((l) => l.split(" ")[0]);
    expect(r.exitCode).toBe(1);
    expect(last.some((s) => s === "[FAIL]")).toBe(true);
  });

  it("AC-03 --write-managed-config 触发第 3 检查项；写入失败仅告警", async () => {
    const r = await runCli("doctor", { stateDir: dir, args: ["--write-managed-config"] });
    expect(r.stdout).toContain("doctor.write-managed-config");
    // 该项永远 PASS（best-effort）
    const line = r.stdout.split("\n").find((l) => l.includes("doctor.write-managed-config"))!;
    expect(line).toContain("[PASS]");
  });

  it("AC-04 v1 doctor 检查项集合不含 TLS/CA", async () => {
    const r = await runCli("doctor", { stateDir: dir });
    expect(r.stdout.toLowerCase()).not.toContain("tls");
    expect(r.stdout.toLowerCase()).not.toContain("ca-bundle");
  });

  it("verify：无文件 → no_file", async () => {
    const r = await runCli("verify", { stateDir: dir, args: ["-f", join(dir, "nonexistent.jsonl")] });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("no file");
  });

  it("verify：正常链 → ok", async () => {
    const p = join(dir, "ok.jsonl");
    const w = new EvidenceWriter(p);
    w.append({
      session_id: "s", turn_id: "t", request_id: "r",
      client: "opencode", provider_id: "openai", endpoint_host: "x",
      model_requested: "a", model_responded: "a",
      transport: "non-stream", request_bytes: 1, response_bytes: 1, chunk_count: 1, latency: 1,
      findings: [], action_taken: "allowed",
      response_delivered: { partial: false, delivered_chunks: 1 },
      request_body_sha256: "a".repeat(64), response_body_sha256: "b".repeat(64),
      body_capture: "metadata_only",
    });
    const r = await runCli("verify", { stateDir: dir, args: ["-f", p] });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("ok: 1 records");
  });

  it("verify：篡改 → first_bad_seq", async () => {
    const p = join(dir, "tampered.jsonl");
    const w = new EvidenceWriter(p);
    const sample = {
      session_id: "s", turn_id: "t",
      client: "opencode", provider_id: "openai", endpoint_host: "x",
      model_requested: "a", model_responded: "a",
      transport: "non-stream" as const, request_bytes: 1, response_bytes: 1, chunk_count: 1, latency: 1,
      findings: [], action_taken: "allowed" as const,
      response_delivered: { partial: false, delivered_chunks: 1 },
      request_body_sha256: "a".repeat(64), response_body_sha256: "b".repeat(64),
      body_capture: "metadata_only" as const,
    };
    w.append({ ...sample, request_id: "r1" });
    w.append({ ...sample, request_id: "r2" });
    const { readFileSync } = await import("node:fs");
    const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
    const r1 = JSON.parse(lines[1]!); r1.client = "evil";
    lines[1] = JSON.stringify(r1);
    writeFileSync(p, lines.join("\n") + "\n", "utf8");
    const r = await runCli("verify", { stateDir: dir, args: ["-f", p] });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("first_bad_seq=1");
  });

  it("verify：evidence_version ≠ 1 → unsupported_version 分支", async () => {
    const p = join(dir, "badver.jsonl");
    writeFileSync(p, JSON.stringify({ evidence_version: 2 }) + "\n", "utf8");
    const r = await runCli("verify", { stateDir: dir, args: ["-f", p] });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("unsupported evidence_version");
  });

  it("verify：schema 违约 → schema_violation 分支（缺必填 client）", async () => {
    const p = join(dir, "badschema.jsonl");
    // evidence_version=1 但缺必填字段 → validateEvidence 报 schema_violation
    writeFileSync(p, JSON.stringify({ evidence_version: 1, seq: 0 }) + "\n", "utf8");
    const r = await runCli("verify", { stateDir: dir, args: ["-f", p] });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/schema violation at seq=\d+/);
  });

  it("status：未运行（pid 文件缺失）→ exit=1 'not running'", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "llmveto-status-idle-"));
    const r = await runCli("status", { stateDir: emptyDir });
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("not running\n");
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it("status：运行中（存活 pid + url）→ exit=0 'running pid=... url=...'", async () => {
    const d = mkdtempSync(join(tmpdir(), "llmveto-status-run-"));
    writeFileSync(join(d, "gateway.pid"), String(process.pid), "utf8"); // 本 worker 进程必然存活
    writeFileSync(join(d, "gateway.url"), "http://127.0.0.1:9999", "utf8");
    const r = await runCli("status", { stateDir: d });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`running pid=${process.pid}`);
    expect(r.stdout).toContain("url=http://127.0.0.1:9999");
    rmSync(d, { recursive: true, force: true });
  });

  it("status：pid 存在但 url 缺失 → url=unknown 分支", async () => {
    const d = mkdtempSync(join(tmpdir(), "llmveto-status-nourl-"));
    writeFileSync(join(d, "gateway.pid"), String(process.pid), "utf8");
    const r = await runCli("status", { stateDir: d });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("url=unknown");
    rmSync(d, { recursive: true, force: true });
  });

  it("status：pid 文件存在但进程已死（僵尸文件）→ 如实报 stale + exit=1", async () => {
    const d = mkdtempSync(join(tmpdir(), "llmveto-status-stale-"));
    writeFileSync(join(d, "gateway.pid"), "999999", "utf8"); // 基本不可能存活的 pid
    writeFileSync(join(d, "gateway.url"), "http://127.0.0.1:8787", "utf8");
    const r = await runCli("status", { stateDir: d });
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("stale pid file");
    rmSync(d, { recursive: true, force: true });
  });

  it("start：存活 pid + url → 幂等返回 already running（不派生第二个 daemon）", async () => {
    const d = mkdtempSync(join(tmpdir(), "llmveto-start-idem-"));
    writeFileSync(join(d, "gateway.pid"), String(process.pid), "utf8"); // 本 worker 进程必然存活
    writeFileSync(join(d, "gateway.url"), "http://127.0.0.1:8787", "utf8");
    const r = await runCli("start", { stateDir: d });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`already running (pid=${process.pid})`);
    expect(r.stdout).toContain("http://127.0.0.1:8787");
    rmSync(d, { recursive: true, force: true });
  });

  it("stop：无 pid 文件 → exit=1 如实报告未运行（禁止 stub 式假成功）", async () => {
    const r = await runCli("stop", { stateDir: dir });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("not running");
  });

  it("stop：stale pid 文件 → kill 失败但清理文件，exit=1 如实报告", async () => {
    const d = mkdtempSync(join(tmpdir(), "llmveto-stop-"));
    writeFileSync(join(d, "gateway.pid"), "999999", "utf8");
    writeFileSync(join(d, "gateway.url"), "http://127.0.0.1:1", "utf8");
    const r = await runCli("stop", { stateDir: d });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("stale pid");
    expect(existsSync(join(d, "gateway.pid"))).toBe(false);
    rmSync(d, { recursive: true, force: true });
  });
});
