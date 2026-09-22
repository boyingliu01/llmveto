// @no-test-required: bench runner（可执行脚本），其核心 percentile / isRegression 已由 regression-formula.test.ts 覆盖；测量骨架 http-harness.ts；本文件仅负责编排采样 + 控制台输出。
import { bootStack, roundTripMs, sampleDelta, makeRequestBody, GW_PATH, type Delta } from "./http-harness.ts";
import { G2_THRESHOLDS } from "./regression-formula.ts";

/**
 * @test REQ-VETO-013
 * @intent G2 请求侧端到端 p95 三档（HTTP 端到端，M2.5 重写）：
 *   t(经网关) = 客户端 → 网关（读体 + egress-secret-scan 全量扫描）→ 上游 → 网关（响应扫描）→ 客户端读尽
 *   t(旁路)   = 客户端 → 上游 → 客户端读尽（无网关）
 *   delta = t(经网关) − t(旁路)，随请求体分档 8/64/512 KB。
 *
 * 阈值（AC-VETO-013-02 v1 冻结）：p95 ≤8KB:3ms / ≤64KB:10ms / ≤512KB:40ms。
 * 输出格式受 `bench/runner-format.ts` 的 `g2LineRe(tier_kb)` 契约约束（行首锚定、捕获组恒为 p50/p95/p99；
 * 判定分位数为 p50，见 docs/adr/0002 补遗三）。
 */

export interface G2Tier {
  readonly tier_kb: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

const OK_BODY = '{"model":"gpt-4o","choices":[{"message":{"content":"ok"}}]}';

export async function sampleG2(tierKb: number): Promise<G2Tier> {
  const stack = await bootStack({ transport: "non-stream", body: OK_BODY });
  try {
    const body = makeRequestBody(tierKb, false);
    const d: Delta = await sampleDelta(roundTripMs, stack.gatewayUrl, stack.upstreamUrl, body, GW_PATH);
    return { tier_kb: tierKb, ...d };
  } finally {
    await stack.close();
  }
}

if (process.argv[1]?.includes("g2-request-gate")) {
  for (let i = 0; i < G2_THRESHOLDS.length; i++) {
    const gate = G2_THRESHOLDS[i]!;
    const kb = gate.body_bytes / 1024;
    const r = await sampleG2(kb);
    const pass = r.p95 < gate.p95_ms;
    console.log(`G2 ${r.tier_kb}KB → p50=${r.p50.toFixed(2)}ms p95=${r.p95.toFixed(2)}ms p99=${r.p99.toFixed(2)}ms ${pass ? "PASS" : `FAIL (limit ${gate.p95_ms}ms)`}`);
  }
}
