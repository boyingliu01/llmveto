// @no-test-required: bench runner（可执行脚本），其核心决策逻辑 percentile/isRegression 已由 bench/regression-formula.test.ts 全量覆盖；测量骨架 http-harness.ts；本文件仅负责编排采样 + 控制台输出。
import { bootStack, ttftMs, sampleDelta, makeRequestBody, GW_PATH, type Delta } from "./http-harness.ts";
import { G1_TTFT_P95_MAX_MS, G1_TTFT_P99_MAX_MS } from "./regression-formula.ts";

/**
 * @test REQ-VETO-013
 * @intent G1 TTFT delta（HTTP 端到端，M2.5 重写）：
 *   t(经网关)  = 客户端 POST → 网关（请求扫描）→ 上游 → 网关首帧扫描+tee → 客户端读到第一个 chunk
 *   t(旁路)    = 客户端 POST → 上游 → 客户端读到第一个 chunk（无网关）
 *   ttft_delta = t(经网关) − t(旁路)。
 *
 * 采样：预热 50 + n=200；报告 p50/p95/p99（AC-VETO-013-01）。
 * 阈值：p95 < 5ms 且 p99 < 12ms（AC-VETO-013-01 v1 冻结）。
 * 输出格式受 bench/check-regression.ts 解析约束（匹配 /p95=([\d.]+)ms/）。
 */

const CHUNKS = Array.from({ length: 24 }, (_, i) =>
  JSON.stringify({ choices: [{ index: 0, delta: { content: `tok${i} ` } }] }),
);

export async function sampleG1(): Promise<Delta> {
  const stack = await bootStack({ transport: "stream", chunks: CHUNKS });
  try {
    const body = makeRequestBody(1, true); // 小请求体，聚焦首帧（TTFT）
    return await sampleDelta(ttftMs, stack.gatewayUrl, stack.upstreamUrl, body, GW_PATH);
  } finally {
    await stack.close();
  }
}

if (process.argv[1]?.includes("g1-ttft")) {
  const r = await sampleG1();
  const pass = r.p95 < G1_TTFT_P95_MAX_MS && r.p99 < G1_TTFT_P99_MAX_MS;
  console.log(`G1 TTFT delta → p50=${r.p50.toFixed(3)}ms p95=${r.p95.toFixed(3)}ms p99=${r.p99.toFixed(3)}ms ${pass ? "PASS" : `FAIL (limit p95<${G1_TTFT_P95_MAX_MS}ms & p99<${G1_TTFT_P99_MAX_MS}ms)`}`);
}
