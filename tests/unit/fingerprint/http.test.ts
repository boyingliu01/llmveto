import { afterEach, describe, expect, it } from "vitest";
import { PROBE_PATH, PROBE_TIMEOUT_MS, SDK_USER_AGENTS, sendProbe } from "../../../src/fingerprint/http.ts";
import { startMockUpstream, type MockUpstream } from "../../utils/mock-upstream.ts";

// @test REQ-V2bC-12 / REQ-V2bC-13 / AC-12a~b / AC-13a~b
// @intent 探针的网络层形态。三条约束各有用意：
//           C8a UA 不报自己是谁 —— 中转站正是被怀疑的一方
//           C8c 路径与主流量同形 —— 特殊路径本身就是标记
//           C7a 5s 超时 —— 探针不能拖住任何东西
//
//         **诚实边界**：这些都只降低可识别性。探针的时序和载荷结构仍可被识别，
//         测试不假装能验证"不可识别"。

let mock: MockUpstream | null = null;
afterEach(async () => {
  if (mock) await mock.close();
  mock = null;
});

async function boot(body: string, status = 200): Promise<string> {
  mock = await startMockUpstream({ transport: "non-stream", body, status });
  return mock.url;
}

describe("SL-11 网络层形态（AC-12a/12b）", () => {
  it("AC-12b：请求打到 /v1/chat/completions（与主流量同形）", async () => {
    const url = await boot(JSON.stringify({ ok: true }));
    await sendProbe(url, { model: "m", messages: [] });
    expect(mock!.requests[0]!.url).toContain(PROBE_PATH);
    expect(mock!.requests[0]!.url).not.toMatch(/fingerprint|probe|patrol/i);
  });

  it("AC-12a：UA 来自 SDK 列表，不含 llmveto", async () => {
    const url = await boot(JSON.stringify({ ok: true }));
    await sendProbe(url, { model: "m", messages: [] });
    const ua = String(mock!.requests[0]!.headers["user-agent"] ?? "");
    expect(SDK_USER_AGENTS).toContain(ua);
    expect(ua.toLowerCase()).not.toContain("llmveto");
  });

  it("UA 由注入函数决定（测试可确定）", async () => {
    const url = await boot(JSON.stringify({ ok: true }));
    await sendProbe(url, { model: "m" }, { pickUa: () => SDK_USER_AGENTS[2]! });
    expect(mock!.requests[0]!.headers["user-agent"]).toBe(SDK_USER_AGENTS[2]);
  });
});

describe("SL-11 错误分类（C7f 的输入）", () => {
  it("429 → http_429（限流与 5xx 对运维含义不同）", async () => {
    const url = await boot("{}", 429);
    const r = await sendProbe(url, { model: "m" });
    expect(r).toMatchObject({ ok: false, errorClass: "http_429", status: 429 });
  });

  it("503 → http_5xx", async () => {
    const url = await boot("{}", 503);
    expect((await sendProbe(url, { model: "m" })).errorClass).toBe("http_5xx");
  });

  it("非 JSON 响应 → decode_error", async () => {
    const url = await boot("not json at all");
    expect((await sendProbe(url, { model: "m" })).errorClass).toBe("decode_error");
  });

  it("连接不上 → rst（不是抛错）", async () => {
    const r = await sendProbe("http://127.0.0.1:1", { model: "m" });
    expect(r.ok).toBe(false);
    expect(r.errorClass).toBe("rst");
  });

  it("成功时返回解析后的 body", async () => {
    const url = await boot(JSON.stringify({ choices: [{ message: { content: "hi" } }] }));
    const r = await sendProbe(url, { model: "m" });
    expect(r.ok).toBe(true);
    expect(r.body).toHaveProperty("choices");
  });
});

describe("SL-12 超时（AC-13b）", () => {
  it("超时常数为 5s（C7a）", () => {
    expect(PROBE_TIMEOUT_MS).toBe(5_000);
  });
});
