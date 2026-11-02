/**
 * @test REQ-V2a-15 / AC-V2a-14
 * @intent 2049×128B 工具调用参数流的 fixture 生成器（G-WINDOW 关门夹具）。
 * @no-test-required: 本文件是被测 fixture，由 tests/integration/stream-windows.test.ts 全量行使
 *                   （i=2048 送达 / i=2049 越顶两边界断言）；Gate 5a 仅识别同目录/根 tests/ 六种
 *                   配对路径，故在此登记而非另建配对文件。
 *
 * 权衡：预生成 JSON 约 520KB，但 2049 帧逐帧内联会让测试文件自身超 loc 预算；
 * 生成器函数（本文件）即"生成脚本"形态，运行时展开为帧数组，无静态文件体积成本，
 * 且每帧内容可由 overflowFragment(i) 确定性重建——断言 "#2048# 送达 / #2049# 未送达"
 * 直接依赖该确定性。
 *
 * 帧内不含 tool_calls[].function.name / id：buildResponseScanUnit 经
 * collectToolCallParts 会把 name 拼进扫描文本，会破坏
 * "unit.text == 参数片段（128B）"的计长前提（AC-V2a-14 的 metering 语义）。
 */
export const OVERFLOW_CHUNKS = 2049 as const;
export const OVERFLOW_CHUNK_BYTES = 128 as const;

/** 第 i 帧的参数片段：`#i#` 标记 + 填充，恒为 128 个 UTF-16 code unit。 */
export function overflowFragment(i: number): string {
  const marker = `#${i}#`;
  return marker + "a".repeat(OVERFLOW_CHUNK_BYTES - marker.length);
}

export function overflowFrame(i: number): string {
  return JSON.stringify({
    model: "m",
    choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: overflowFragment(i) } }] } }],
  });
}

export function buildOverflowFrames(): readonly string[] {
  return Array.from({ length: OVERFLOW_CHUNKS }, (_v, idx) => overflowFrame(idx + 1));
}
