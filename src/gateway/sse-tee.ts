/**
 * @test REQ-VETO-002
 * @intent SSE 帧解析：`data: <json>\n\n` → payload。v1 只支持 chat.completions 常用形态；
 *         无法解析时返回 null（上层置 malformed: true）。
 */

export interface SseFrame {
  readonly raw: string;
  readonly event?: string;
  readonly data?: string;
}

/** 从字节流中拆 SSE 帧；返回剩余未解析缓冲。 */
export function parseSseFrames(buf: string): { frames: SseFrame[]; rest: string } {
  const frames: SseFrame[] = [];
  let rest = buf;
  while (true) {
    const idx = rest.indexOf("\n\n");
    if (idx < 0) break;
    const raw = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    let event: string | undefined;
    let data: string | undefined;
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data = (data ? data + "\n" : "") + line.slice(5).trimStart();
    }
    const ev: SseFrame = { raw, ...(event !== undefined ? { event } : {}), ...(data !== undefined ? { data } : {}) };
    frames.push(ev);
  }
  return { frames, rest };
}

export function tryParseJson(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 生成 veto-mid-stream 终止流事件（AC-VETO-002-03 契约）。 */
export function encodeVetoEvent(deliveredChunks: number): string {
  const payload = JSON.stringify({
    error: { code: "llmveto:veto-mid-stream", delivered_chunks: deliveredChunks },
  });
  return `event: error\ndata: ${payload}\n\n`;
}
