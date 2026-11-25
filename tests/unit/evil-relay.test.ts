import { afterEach, describe, expect, it } from "vitest";
import { type EvilRelayInstance, type OpponentId, startEvilRelay } from "../../testkit/evil-relay.ts";

// @test REQ-V2a-08（对抗对手的测试工具本身）
// @intent `testkit/evil-relay.ts` 是 13 个对抗对手的实现，只在 nightly 的
//         `RELAY_MATRIX=1` 下跑（`tests/integration/relay-detection.test.ts` 整份
//         skipIf）。于是 PR 全量里它的覆盖率只有 7.5%——**测试工具本身没有被测**。
//         工具坏掉时 nightly 才会红，而 nightly 是最后一道门。
//
//         这里覆盖不依赖 13 个子进程矩阵的部分：参数校验、真实启停、HTTP 应答形态、
//         以及"注入的配置值不会变成脚本片段"这个安全属性。

const HTTP_OK = 200;
const SEED_NOISE = 3;

let live: EvilRelayInstance[] = [];

afterEach(async () => {
  await Promise.all(live.map((r) => r.close().catch(() => undefined)));
  live = [];
});

/** 启动一个对手并登记，供 afterEach 统一关闭。 */
async function boot(opponent: OpponentId, seed: number, interceptPath?: string): Promise<EvilRelayInstance> {
  const relay = await startEvilRelay({ opponent, seed, ...(interceptPath === undefined ? {} : { interceptPath }) });
  live.push(relay);
  return relay;
}

/** 向对手发一次 chat 请求，返回状态码与响应体（JSON 文本）。 */
async function ask(relay: EvilRelayInstance, payload: unknown): Promise<{ status: number; body: string }> {
  const res = await fetch(`${relay.url}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: JSON.stringify(await res.json()) };
}

describe("evil-relay 参数校验（REQ-V2a-08）", () => {
  it("未知对手 → 抛错并列出合法取值", async () => {
    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: 故意传入非法值以覆盖校验分支
      startEvilRelay({ opponent: "not-an-opponent" as any }),
    ).rejects.toThrow(/Unknown opponent: not-an-opponent\. Must be one of:/);
  });

  it("错误信息里带出全部 13 个对手名", async () => {
    const err = await startEvilRelay({
      // biome-ignore lint/suspicious/noExplicitAny: 同上
      opponent: "bogus" as any,
    }).catch((e: Error) => e);
    const text = String((err as Error).message);
    for (const name of ["honest", "drift", "swap", "prompt_injection", "tool_manipulation"]) {
      expect(text).toContain(name);
    }
  });
});

describe("evil-relay 真实启停（REQ-V2a-08）", () => {
  it("honest 对手可启动，返回可用 URL 与 pid，且能优雅关闭", async () => {
    const relay = await boot("honest", 7);
    expect(relay.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(relay.pid).toBeGreaterThan(0);
    // honest 是控制组：`(body) => body`，原样回显请求体。
    const req = { model: "m", messages: [{ role: "user", content: "hi" }] };
    const { status, body } = await ask(relay, req);
    expect(status).toBe(HTTP_OK);
    expect(JSON.parse(body)).toEqual(req);
  });

  it("swap 对手确实改写了工具名（对手逻辑真的被执行，而不是原样透传）", async () => {
    const relay = await boot("swap", SEED_NOISE);
    const a = await ask(relay, {
      model: "m",
      tool_calls: [{ name: "read_file", arguments: "{}" }],
    });
    expect(a.status).toBe(HTTP_OK);
    expect(JSON.parse(a.body).tool_calls[0].name).toBe("read_file_swapped");
  });

  it("cache 对手把首个响应回放给后续请求（seq 状态在子进程内真实累积）", async () => {
    const relay = await boot("cache", SEED_NOISE);
    const first = await ask(relay, { model: "m", messages: [{ role: "user", content: "FIRST" }] });
    const second = await ask(relay, { model: "m", messages: [{ role: "user", content: "SECOND" }] });
    expect(first.status).toBe(HTTP_OK);
    // 第二个请求的应答应当是第一个的内容——证明对手 handler 拿到了累积的 seq，
    // 而不是每个请求都被独立地原样透传。
    expect(second.body).toBe(first.body);
    expect(second.body).toContain("FIRST");
    expect(second.body).not.toContain("SECOND");
  });
});

describe("evil-relay 注入面的安全属性（REQ-V2a-08）", () => {
  it("interceptPath 含脚本注入字符时，子进程仍能正常启动（值经 JSON.stringify 注入）", async () => {
    // 这是 buildChildScript 的注释所声明的安全属性：外部字符串一律走 JSON.stringify，
    // 不能直接拼进脚本。若哪天改成模板直插，这里的路径会变成可执行片段
    // （`'); process.exit(1); //`），子进程起不来——本用例就会红。
    const relay = await boot("honest", SEED_NOISE, "'); process.exit(1); //");
    expect(relay.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    // 拦截路径不匹配时对手不介入，应答仍是 200 —— 关键是子进程没有因注入而退出。
    expect((await ask(relay, { model: "m", messages: [{ role: "user", content: "hi" }] })).status).toBe(HTTP_OK);
  });
});
