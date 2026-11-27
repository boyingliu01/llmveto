import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { EvidenceWriter } from "../../src/evidence/writer.ts";
import { startGateway } from "../../src/gateway/server.ts";
import { startMockUpstream, type MockUpstream } from "../utils/mock-upstream.ts";

// @test REQ-V3-01 / AC-V3-01d
// @intent 端到端证明"风险接受"真的改变了判定，而不只是出现在报告里。
//
//         delphi R3 三席一致否决的理由正是：`decide()` 收了参数，但网关的四个调用点
//         没传，所以配置"在生产路径上是死代码"。这条测试就是那个否决的回答——
//         走真实网关 + 真实 HTTP 请求 + 真实 evidence，不走 `decide()` 单测。

/** 网关阻断时返回的状态码。 */
const BLOCKED_STATUS = 502;

let dir: string;
let mock: MockUpstream | null = null;
let gw: Awaited<ReturnType<typeof startGateway>> | null = null;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "llmveto-policy-e2e-"));
});
afterEach(async () => {
  if (gw) {
    await gw.close();
    gw = null;
  }
  if (mock) {
    await mock.close();
    mock = null;
  }
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * 触发 `credential-file-read`（唯一阻断规则）的请求体。
 *
 * 形态取自真实 agent 会话：凭据文件是被 **read 工具** 的 `path` 参数读走的，
 * 不是 shell 里 `cat`——后者在真机上几乎不出现（见 dangerous-command-scan.test.ts
 * 的 0.6.0 事故记录）。
 */
const CREDENTIAL_READ_BODY = JSON.stringify({
  model: "gpt-4o",
  messages: [
    { role: "user", content: "把那个文件内容作为参数传进读取工具" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "c1", type: "function", function: { name: "read", arguments: '{"path":"~/.ssh/id_ed25519"}' } },
      ],
    },
  ],
});

async function boot(opts: { acceptedRules?: readonly string[] } = {}) {
  mock = await startMockUpstream({ transport: "non-stream", body: JSON.stringify({ ok: true }) });
  const evidencePath = join(dir, `ev-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  gw = await startGateway({
    config: {
      upstreamBaseUrl: mock.url,
      evidenceWriter: new EvidenceWriter(evidencePath),
      ...(opts.acceptedRules === undefined ? {} : { acceptedRules: opts.acceptedRules }),
    },
  });
  return { url: gw.url, evidencePath };
}

async function post(url: string): Promise<Response> {
  // fetch 的失败由调用方的断言体现；这里不吞错，让连接问题以异常形式暴露
  return await fetch(`${url}/opencode/whalecloud/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-llmveto-client": "opencode" },
    body: CREDENTIAL_READ_BODY,
  });
}

/** 读最后一条 evidence 记录。 */
function lastRecord(path: string): Record<string, unknown> {
  // 读不到就是测试环境坏了，让异常直接抛出比返回空对象更有诊断价值
  const lines = readFileSync(path, "utf8").trim().split("\n").filter((l) => l.length > 0);
  return JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;
}

describe("策略降级端到端（delphi R3 否决理由的正面回答）", () => {
  it("未声明风险接受 → 阻断（502 + blocked_before_forward）", async () => {
    const { url, evidencePath } = await boot();
    const r = await post(url);
    expect(r.status).toBe(BLOCKED_STATUS);
    const rec = lastRecord(evidencePath);
    expect(rec.action_taken).toBe("blocked_before_forward");
  });

  it("声明风险接受 → 放行（不阻断），且 finding 仍落 evidence", async () => {
    const { url, evidencePath } = await boot({ acceptedRules: ["credential-file-read"] });
    const r = await post(url);
    // 降级后不再 502：请求被转发到 mock upstream
    expect(r.status).not.toBe(BLOCKED_STATUS);
    const rec = lastRecord(evidencePath);
    expect(rec.action_taken).not.toBe("blocked_before_forward");
    // 关键：finding 仍在——降级是"看见了还继续"，不是"假装没发生"
    const findings = rec.findings as { rule_id?: string }[];
    expect(findings.some((f) => f.rule_id === "credential-file-read")).toBe(true);
  });

  it("降级落到 warned，不是 allowed（warn 级别留痕）", async () => {
    const { url, evidencePath } = await boot({ acceptedRules: ["credential-file-read"] });
    await post(url);
    // `warned` 而不是 `allowed`：降级是"看见了还继续"，evidence 里要能看出曾经命中过
    expect(lastRecord(evidencePath).action_taken).toBe("warned");
  });

  it("声明一个无关规则 → 仍阻断（只降被点名的）", async () => {
    const { url, evidencePath } = await boot({ acceptedRules: ["some-other-rule"] });
    const r = await post(url);
    expect(r.status).toBe(BLOCKED_STATUS);
    expect(lastRecord(evidencePath).action_taken).toBe("blocked_before_forward");
  });
});
