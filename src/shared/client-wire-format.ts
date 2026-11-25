// @no-test-required: 测试在 tests/unit/shared/client-wire-format.test.ts（本项目测试布局为 tests/ 目录；Gate 5a 仅识别同目录/根 tests/ 六种路径）
/**
 * @test REQ-V2bA-10 / AC-V2bA-10a
 * @intent 每个受管客户端"用哪种线格式说话"的声明表。
 *
 * 为什么放在 shared 而不是 adapters 或 gateway（R2 评审 M5）：
 *   - `adapters` 层只允许 import `shared`，不得 import `src/gateway/**`；
 *   - `gateway` 同样不 import adapters；
 *   - 而 doctor 需要把"客户端"与"它用的线格式有没有投影覆盖"join 起来——
 *     这个 join 只能落在组合根（cli），前提是**两边的数据类型都来自 shared**。
 * 所以这里只放**纯数据**：不 import 任何实现。
 */

/** 网关能识别的线格式（与 src/gateway/protocols/types.ts 的 WireFormat 同值域）。 */
export type ClientWireFormat = "chat" | "anthropic-messages" | "openai-responses";

/** 一个受管客户端的线格式声明。 */
export interface ClientWireFormatSpec {
  /** 适配器 id（与 Adapter.name 一致）。 */
  readonly client: string;
  /**
   * 该客户端**默认**使用的线格式。
   * `null` 表示"取决于用户配置，无法确定"——doctor 必须据此报 coverage_unknown，
   * 而不是猜一个（R2 CRITICAL-3：输出确定性错误结论比说"不知道"更危险）。
   */
  readonly format: ClientWireFormat | null;
  /** 判定依据（人类可读，写明为什么是这个格式）。 */
  readonly basis: string;
}

/** 受管客户端的线格式声明表。新增客户端必须同时在这里登记。 */
export const CLIENT_WIRE_FORMATS: readonly ClientWireFormatSpec[] = Object.freeze([
  Object.freeze({
    client: "opencode",
    format: "chat",
    basis: "OpenAI 兼容 provider，走 Chat Completions（本机 1496 条 evidence 实测）",
  }),
  Object.freeze({
    client: "delphi",
    format: "chat",
    basis: "endpoint 覆写为 OpenAI 兼容的 /v1/chat/completions",
  }),
  Object.freeze({
    client: "claude-code",
    format: "anthropic-messages",
    basis: "官方 settings 参考：env.ANTHROPIC_BASE_URL 指向网关，推理请求为 POST /v1/messages",
  }),
  Object.freeze({
    client: "codex",
    format: "openai-responses",
    basis: "官方 config-reference：model_providers.<id>.wire_api 唯一支持值 responses（Responses 协议）",
  }),
  Object.freeze({
    client: "promptfoo",
    format: null,
    // promptfoo 的 providers[].config 可指定 openai:chat:* 或 openai:responses:*，
    // 取决于用户写了什么——适配器能读配置，但"读不到"和"读到了但没写死"都要报 unknown。
    basis: "provider 的 config.api 决定 chat 或 responses；配置里没写死时无法确定",
  }),
]);

/** 取某客户端的声明；未登记返回 undefined（= 不受管，不参与覆盖判定）。 */
export function wireFormatOf(client: string): ClientWireFormatSpec | undefined {
  return CLIENT_WIRE_FORMATS.find((c) => c.client === client);
}
