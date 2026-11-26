// @no-test-required: 测试在 tests/unit/fingerprint/http.test.ts（Gate 5a 仅识别同目录/根 tests/ 六种路径）
import type { ProbeErrorClass } from "./store.ts";

/**
 * 探针的 HTTP 客户端。
 *
 * 两条与"最小暴露"直接相关的约束（设计 D-06）：
 *   C8a  UA 从该 provider 主流 SDK 的默认列表里取，不用 llmveto 自己的名字
 *   C8c  路径形态与主流量同形（`/v1/chat/completions`），不带任何特殊后缀
 *
 * 以及一条与主流量隔离相关的：
 *   C7c  独立 agent，不占主流量连接池
 *
 * **诚实的边界**：这些只降低可识别性，不消除它。探针的时序（固定间隔）和
 * 载荷结构（固定文本）仍然可被识别。抖动只让"规律"变成"近似规律"。
 */

/** 探针超时（C7a）。 */
export const PROBE_TIMEOUT_MS = 5_000;

/**
 * 主流 SDK 的默认 User-Agent 形态。
 *
 * 用它们而不是 "llmveto/0.9" 的理由很直接：后者等于向中转站自报家门，
 * 而中转站正是被怀疑的一方。这不是伪装成别人，是不主动暴露自己。
 */
export const SDK_USER_AGENTS: readonly string[] = Object.freeze([
  "OpenAI/Python 1.40.0",
  "OpenAI/NodeJS 4.60.0",
  "Anthropic/Python 0.34.0",
  "Anthropic/TS 0.27.0",
]);

/** 探针路径（C8c：与主流量同形）。 */
export const PROBE_PATH = "/v1/chat/completions" as const;

export interface ProbeHttpResult {
  readonly ok: boolean;
  readonly status?: number;
  readonly body?: Record<string, unknown>;
  readonly errorClass?: ProbeErrorClass;
}

export interface ProbeHttpOptions {
  /** UA 选择函数；测试注入固定值以消除随机性。 */
  readonly pickUa?: () => string;
}

/** 从 HTTP 状态码映射到错误分类。 */
function errorClassFor(status: number): ProbeErrorClass {
  if (status === 429) return "http_429";
  return "http_5xx";
}

/**
 * 发一条探针请求。
 *
 * 所有失败都翻译成 `errorClass` 而不是抛错：调用方（patrol）需要的是
 * "哪类失败"，抛错会把分类责任推给每一个调用点。
 */
export async function sendProbe(
  baseUrl: string,
  body: Record<string, unknown>,
  opts: ProbeHttpOptions = {},
): Promise<ProbeHttpResult> {
  const pickUa = opts.pickUa ?? (() => SDK_USER_AGENTS[Math.floor(Math.random() * SDK_USER_AGENTS.length)]!);
  // C7c 的隔离由调用方保证（探针是独立进程路径，不经过网关的 keep-alive 池）；
  // 这里用独立的 AbortSignal 控制超时，不与主流量共享任何连接状态。
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}${PROBE_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": pickUa() },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, errorClass: errorClassFor(res.status) };
    try {
      return { ok: true, status: res.status, body: JSON.parse(text) as Record<string, unknown> };
    } catch {
      return { ok: false, status: res.status, errorClass: "decode_error" };
    }
  } catch (err) {
    return { ok: false, errorClass: classifyTransportError(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** 传输层异常 → 错误分类。超时与连接重置对运维的含义不同，不能合并。 */
function classifyTransportError(err: unknown): ProbeErrorClass {
  if (err instanceof Error && err.name === "AbortError") return "timeout";
  const message = err instanceof Error ? err.message : String(err);
  if (/timeout|aborted/i.test(message)) return "timeout";
  // ECONNRESET / ECONNREFUSED / EPIPE 都归入 rst：共同点是"对端没给正常响应"
  return "rst";
}
