import { existsSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { isDirectRun } from "../../src/cli/index.ts";

// @test REQ-VETO-008
// @intent M1.1 CLI 黑盒冒烟：spawn 真实入口（非 import runCli），断言命令确实执行——
//         守护 v0.1 的 P0 回归"入口静默 no-op"（测试全绿但产品装不起来）。
//         同时覆盖 ADR-0001 的可移植入口判定 isDirectRun 与 Node dist 分发物。
//
// 沙箱自适应：某些受限环境（嵌套 spawn 被命名管道策略拒绝）无法 fork 子进程，
// 此时相应 it 自动 skip；isDirectRun 纯函数断言始终运行。真 CI（无该限制）全跑。

const ROOT = process.cwd();
const SRC_ENTRY = join(ROOT, "src", "cli", "index.ts");
const DIST_ENTRY = join(ROOT, "dist", "cli", "index.js");

function canSpawn(runtime: string): boolean {
  try {
    const r = spawnSync(runtime, ["--version"], { encoding: "utf8" });
    return r.status === 0 && !r.error;
  } catch {
    return false;
  }
}

const CAN_BUN = canSpawn("bun");
const CAN_NODE = canSpawn("node");
const DIST_READY = existsSync(DIST_ENTRY) && CAN_NODE;

let stateDir: string;
beforeAll(() => { stateDir = mkdtempSync(join(tmpdir(), "llmveto-smoke-")); });

function spawnCli(runtime: string, entry: string, args: string[], env: Record<string, string> = {}) {
  const prefix = runtime === "bun" ? ["run", entry] : [entry];
  const r = spawnSync(runtime, [...prefix, ...args], {
    cwd: ROOT, encoding: "utf8",
    env: { ...process.env, LLMVETO_STATE_DIR: stateDir, ...env },
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("M1.1 isDirectRun 可移植入口判定 (纯函数，恒运行)", () => {
  const selfUrl = new URL("../../src/cli/index.ts", import.meta.url).href;
  it("本模块路径与 argv[1] 一致 → true（直接执行）", () => {
    expect(isDirectRun(selfUrl, SRC_ENTRY)).toBe(true);
    expect(isDirectRun(selfUrl, join(ROOT, "src", "cli", "index.ts"))).toBe(true);
  });
  it("argv[1] 是别的脚本 / 缺失 → false（作为模块被 import 时不执行入口）", () => {
    expect(isDirectRun(selfUrl, join(ROOT, "node_modules", "vitest", "worker.js"))).toBe(false);
    expect(isDirectRun(selfUrl, undefined)).toBe(false);
    expect(isDirectRun(selfUrl, "")).toBe(false);
  });
});

const bunSuite = CAN_BUN ? describe : describe.skip;
bunSuite("M1.1 CLI black-box smoke (spawn source entry via bun)", () => {
  it("无参数 → exit 2 且列出合法命令（证明入口执行，非 no-op）", () => {
    const r = spawnCli("bun", SRC_ENTRY, []);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("unknown command");
    expect(r.stderr).toContain("start, stop, status, doctor, verify");
  });

  it("未知命令 → exit 2", () => {
    const r = spawnCli("bun", SRC_ENTRY, ["bogus"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("unknown command: bogus");
  });

  it("status（未运行，空状态目录）→ exit 1 + 'not running'", () => {
    const r = spawnCli("bun", SRC_ENTRY, ["status"], { LLMVETO_STATE_DIR: join(stateDir, "bun-empty-" + Date.now()) });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("not running");
  });

  it("verify（文件不存在）→ exit 1 + 'no file'", () => {
    const r = spawnCli("bun", SRC_ENTRY, ["verify", "-f", join(stateDir, "does-not-exist.jsonl")]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("no file");
  });

  it("doctor（无受管配置 + 端口不可达）→ exit 1 + FAIL 行（真实读盘非门面）", () => {
    const r = spawnCli("bun", SRC_ENTRY, ["doctor"], {
      LLMVETO_OPENCODE_CONFIG: join(stateDir, "none-oc.json"),
      LLMVETO_DELPHI_CONFIG: join(stateDir, "none-dp.json"),
      LLMVETO_GATEWAY_URL: "http://127.0.0.1:1",
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("[FAIL] doctor.config-drift");
    expect(r.stdout).toContain("opencode.provider.openai.options.baseURL");
  });
});

const distSuite = DIST_READY ? describe : describe.skip;
distSuite("M1.1 Node dist entry (ADR-0001 distribution promise)", () => {
  it("node dist/cli/index.js bogus → exit 2（Node 可运行分发物）", () => {
    const r = spawnCli("node", DIST_ENTRY, ["bogus"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("unknown command: bogus");
  });

  it("node dist/cli/index.js status → exit 1（可移植入口 isDirectRun 在 Node 下生效）", () => {
    const r = spawnCli("node", DIST_ENTRY, ["status"], { LLMVETO_STATE_DIR: join(stateDir, "node-empty-" + Date.now()) });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("not running");
  });
});
