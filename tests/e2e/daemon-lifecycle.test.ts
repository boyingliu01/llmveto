import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startMockUpstream, type MockUpstream } from "../utils/mock-upstream.ts";

// @test REQ-VETO-008
// @intent M3 守护化生命周期：spawn 真实 CLI 入口跑 `start`（父进程派生 detached 后台 daemon 后返回）→
//         `status` 真实探活 → 向 daemon（独立进程）经路由发起一次真实转发（跨进程 HTTP）→
//         `stop` 终止（断言进程真的消失，非仅删文件）。守护"可安装部署试用"的核心可用性。
//         使用 LLMVETO_PORT=0 抢占 ephemeral 端口，规避并行测试端口冲突。
//
// 驱动选择：dist 存在且不比 src 旧时优先 `node dist/cli/index.js`——即 ADR-0001 的真实分发物
//（bin.llmveto 指向它），实测比 bun 跑 .ts 源码快 10–25×（start 5.9s→0.5s / status 4.8s→0.2s）；
// dist 缺失或滞后（源码改动后未重建）则回落 `bun run src/cli/index.ts`，保证任何环境都有覆盖、
// 且绝不测试过期产物。两 runtime 皆不可用时 skip（当前环境必有一者）。
//
// spawn 预算：每条生命周期恰好 3 次 CLI 调用（start/status/stop）。重复 stop、僵尸 pid、stop 后
// status 等分支由单元测试覆盖（tests/unit/cli/cli.test.ts 用假 pid 文件断言），不在 E2E 重复付费。
// @covers AC-VETO-008-01

const ROOT = process.cwd();
const SRC_ENTRY = join(ROOT, "src", "cli", "index.ts");
const DIST_ENTRY = join(ROOT, "dist", "cli", "index.js");

function spawnable(runtime: string): boolean {
  try {
    return spawnSync(runtime, ["--version"], { encoding: "utf8" }).status === 0;
  } catch {
    return false;
  }
}

function newestSrcMtime(dir: string): number {
  let newest = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) newest = Math.max(newest, newestSrcMtime(p));
    else if (e.name.endsWith(".ts")) newest = Math.max(newest, statSync(p).mtimeMs);
  }
  return newest;
}

const distFresh =
  existsSync(DIST_ENTRY) && statSync(DIST_ENTRY).mtimeMs >= newestSrcMtime(join(ROOT, "src"));

const driver =
  distFresh && spawnable("node")
    ? { runtime: "node", argv: (args: string[]): string[] => [DIST_ENTRY, ...args] }
    : spawnable("bun")
      ? { runtime: "bun", argv: (args: string[]): string[] => ["run", SRC_ENTRY, ...args] }
      : null;

const suite = driver ? describe : describe.skip;

function cli(args: string[], env: Record<string, string>) {
  return spawnSync(driver!.runtime, driver!.argv(args), {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return predicate();
}

suite("M3 daemon lifecycle (spawn real CLI)", () => {
  let dir: string | null = null;
  let mock: MockUpstream | null = null;

  afterEach(async () => {
    if (dir) {
      // 仅失败路径（daemon 未正常收尾、pid 文件残留）才补一次 stop，避免恒付 spawn 成本
      if (existsSync(join(dir, "gateway.pid"))) {
        try {
          cli(["stop"], { LLMVETO_STATE_DIR: dir });
        } catch {
          /* best-effort */
        }
      }
      rmSync(dir, { recursive: true, force: true });
      dir = null;
    }
    if (mock) {
      await mock.close();
      mock = null;
    }
  });

  it("start(后台常驻) → status(探活) → 跨进程转发+evidence → stop(进程终止+状态清理)", async () => {
    dir = mkdtempSync(join(tmpdir(), "llmveto-daemon-"));
    mock = await startMockUpstream({
      transport: "non-stream",
      body: '{"model":"gpt-4o","choices":[{"message":{"content":"ok"}}]}',
    });

    // 1) start：父进程派生后台 daemon 后立即返回（不阻塞终端）
    const s = cli(["start"], {
      LLMVETO_STATE_DIR: dir,
      LLMVETO_PORT: "0",
      LLMVETO_UPSTREAM_BASE_URL: mock.url,
    });
    expect(s.status).toBe(0);
    expect(s.stdout).toContain("started in background");

    const pidFile = join(dir, "gateway.pid");
    expect(existsSync(pidFile)).toBe(true);
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    expect(Number.isInteger(pid) && pid > 0).toBe(true);
    expect(pidAlive(pid)).toBe(true); // daemon 是真实存活的后台进程

    const url = readFileSync(join(dir, "gateway.url"), "utf8").trim();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    // 1b) D-02 接线：daemon 必须持有 stateDir/canary-registry.json；否则 rotate 恒 503、注入永不生效。
    const rotate = await fetch(`${url}/_llmveto/canary/rotate`, { method: "POST" });
    expect(rotate.status).toBe(200);
    expect(await rotate.json()).toMatchObject({ rotation_count: 1 });
    expect(existsSync(join(dir, "canary-registry.json"))).toBe(true);

    // 2) status：真实探活（pid 存活 → running，并回显 url）
    const running = cli(["status"], { LLMVETO_STATE_DIR: dir });
    expect(running.status).toBe(0);
    expect(running.stdout).toContain(`running pid=${pid}`);
    expect(running.stdout).toContain(`url=${url}`);

    // 3) 跨进程：从测试进程真实请求后台 daemon，经 catch-all 路由转发到 mock 上游 → 200 + evidence 落盘
    const res = await fetch(`${url}/opencode/mock/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "daemon probe" }] }),
    });
    expect(res.status).toBe(200);
    await res.text();
    expect(mock.requests.length).toBe(1); // 请求真的到达了上游（经独立 daemon 进程转发）
    // D-02 + §4.3：受管路径在 fetch 前注入会话 canary（rotate 后 registry 已建，首请求分配并落盘）。
    expect(mock.requests[0]!.body).toContain("llmveto-canary-");
    // evidence 落盘在响应之后（server.ts 先 res.end 后 writeEvidence）→ 轮询等待"最终一致"，不断言写序
    const evidenceFile = join(dir, "evidence.jsonl");
    expect(await waitUntil(() => existsSync(evidenceFile))).toBe(true);

    // 4) stop：终止真实进程 + 清理状态文件；直接断言进程真的消失（强于再 spawn 一次 status）
    const stop = cli(["stop"], { LLMVETO_STATE_DIR: dir });
    expect(stop.status).toBe(0);
    expect(await waitUntil(() => !pidAlive(pid), 3000)).toBe(true);
    expect(existsSync(pidFile)).toBe(false);
    expect(existsSync(join(dir, "gateway.url"))).toBe(false);
  });
});
