/**
 * @test REQ-V2bA-03 / REQ-V2bA-04 / REQ-V2bA-14
 * @intent 协议线格式（wire format）的类型契约。
 *
 * 立此文件的理由（R2 评审 C2）："该协议的已知载荷字段是否都被投影了"这件事，
 * 不能由投影器自己声明——投影器忘了某个字段时，它照样会说自己"覆盖了"。
 * 因此把权威清单变成**协议声明的数据**（CoverageSpec），由调用方拿清单与投影器
 * 上报的 handled 求差集，得到与文本量无关的覆盖结论。
 *
 * 三个取值域都是封闭的，新增取值必须同步 specification.yaml 与文档。
 */

/** 网关能识别的线格式。新增一种必须同时加 CoverageSpec 与正负样本矩阵。 */
export type WireFormat = "chat" | "anthropic-messages" | "openai-responses";

/** 识别结果：只有两态。覆盖结果不在这个轴上（见 CoverageVerdict）。 */
export type RecognizedFormat = { readonly kind: "known"; readonly format: WireFormat } | { readonly kind: "unknown" };

/** 轴2：覆盖结论。与"有没有文本"无关，只看 present/handled 两个集合。 */
export type CoverageVerdict =
  /** present 非空且全部被处理 —— 正常判定。 */
  | "full"
  /** 有已知载荷字段没被投影器处理 —— 受管路由 fail-closed。 */
  | "partial"
  /** 一个已知载荷字段都没出现 —— 受管路由 fail-closed。 */
  | "vacuous";

/** evidence 顶层 reason 的封闭枚举（与既有 registry_unavailable / inject_skipped 并列）。 */
export type CoverageReason = "shape_unrecognized" | "shape_known_empty" | "shape_partial_coverage";

/**
 * 一个协议"已知载荷字段"的权威清单。
 *
 * 路径语法：点号分隔的键路径；数组中出现的元素记为 `key[]`；元素内部的键继续用点号串接
 * （例如 `messages[].content[].text`）。**只登记会被扫描的载荷**，结构性字段
 * （model / usage / finish_reason）不登记——它们进 meta，不进文本投影。
 */
export interface CoverageSpec {
  readonly requestPayloadPaths: readonly string[];
  readonly responsePayloadPaths: readonly string[];
}

/** 投影结果：文本片段 + 派生标记 + 覆盖上报。 */
export interface Projection {
  /** 交给 checker 的文本片段（调用方用既有分隔符拼接）。 */
  readonly parts: readonly string[];
  /**
   * 片段中**存在规范化产物**（对象转 JSON 等），其 offsets 不指回原文（REQ-05）。
   * 调用方不得把派生片段的 offsets 当成原文位置。
   */
  readonly derived: boolean;
  /** 本次投影实际处理过的载荷路径（来自 CoverageSpec 的同一套路径语法）。 */
  readonly handled: readonly string[];
  /** 原始 body 中**存在**的已知载荷路径（由调用方用 CoverageSpec 求得后回填）。 */
  readonly present: readonly string[];
}

/** 方向：请求侧 / 响应侧。 */
export type Direction = "request" | "response";

export interface WireProtocol {
  readonly format: WireFormat;
  readonly coverage: CoverageSpec;
  /** 非流式请求投影。 */
  projectRequest(parsed: Record<string, unknown>): Projection;
  /** 非流式响应投影。 */
  projectResponse(parsed: Record<string, unknown>, requestedModel: string | null): Projection;
  /**
   * 流式一帧投影。没有可扫载荷的帧（心跳、`ping`、只带元数据的帧）返回空 parts——
   * 这是合法常态，**不**计入 present（设计 D-02 响应侧空洞修正）。
   */
  projectFrame(parsed: Record<string, unknown>): Projection;
  /** 该格式是否支持 canary 注入（DR-031 / D4：仅 chat）。 */
  readonly canaryInjection: boolean;
}

/** 空投影（无载荷）的便捷构造。 */
export const EMPTY_PROJECTION: Projection = Object.freeze({
  parts: Object.freeze([]) as readonly string[],
  derived: false,
  handled: Object.freeze([]) as readonly string[],
  present: Object.freeze([]) as readonly string[],
});

/** 由 parts/handled 构造投影；derived 由调用方显式给出。 */
export function projection(parts: readonly string[], handled: readonly string[], derived = false): Projection {
  return { parts, handled, present: [], derived };
}
