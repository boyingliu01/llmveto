// @no-test-required: 测试在 tests/unit/fingerprint/features.test.ts（Gate 5a 仅识别同目录/根 tests/ 六种路径）
import type { ProbeDimension } from "./probe.ts";

/**
 * 从探针响应里提取单个维度的特征。
 *
 * 设计评审 C1 指出："行为退化"必须有可操作的标准，否则实现者卡在 baseline 之前。
 * 这里把四条规则写成代码，每条对应设计 D-03a 的一行。
 *
 * 返回值是**判别联合**而不是裸值：`missing` 与"值为 false"是两回事——
 * 前者是"没测到"，后者是"测到了且退化"。把它们混成一个 falsy 值，
 * baseline 会把采样失败当成退化，信任分随即被噪声淹没。
 */
export type FeatureResult =
  | { readonly kind: "numeric"; readonly value: number }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "missing" };

const MISSING: FeatureResult = Object.freeze({ kind: "missing" });

/** 从 chat 响应里取第一条 message 的 content 文本。 */
function contentOf(parsed: Record<string, unknown>): string | undefined {
  const choices = parsed.choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const first = choices[0];
  if (first === null || typeof first !== "object") return undefined;
  const message = (first as Record<string, unknown>).message;
  if (message === null || typeof message !== "object") return undefined;
  const content = (message as Record<string, unknown>).content;
  return typeof content === "string" ? content : undefined;
}

/** D0：`usage.prompt_tokens` 的值。不同 tokenizer 对同一固定输入给出不同计数。 */
function tokenizerFeature(parsed: Record<string, unknown>): FeatureResult {
  const usage = parsed.usage;
  if (usage === null || typeof usage !== "object") return MISSING;
  const n = (usage as Record<string, unknown>).prompt_tokens;
  return typeof n === "number" ? { kind: "numeric", value: n } : MISSING;
}

/**
 * D1：剥掉 markdown 围栏后能否严格解析出 `{ok: true}`。
 *
 * 剥围栏的理由：弱模型倾向把 JSON 包进 ```json 块。那是**格式习惯**不是**能力退化**，
 * 不剥会把"礼貌"误判成"降级"——这正是 FP 的来源。
 * 但剥完之后仍要求**顶层只有 JSON**：带解释文字的仍然算退化。
 */
function formatFeature(parsed: Record<string, unknown>): FeatureResult {
  const raw = contentOf(parsed);
  if (raw === undefined) return MISSING;
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    const value: unknown = JSON.parse(stripped);
    if (value === null || typeof value !== "object") return { kind: "boolean", value: false };
    const obj = value as Record<string, unknown>;
    return { kind: "boolean", value: Object.keys(obj).length === 1 && obj.ok === true };
  } catch {
    return { kind: "boolean", value: false };
  }
}

/** D2：可接受的答案集（同一城市的不同写法）。冷门到弱模型会答错，但答案唯一。 */
const KNOWLEDGE_ANSWERS: ReadonlySet<string> = new Set([
  "雷克雅未克",
  "雷克雅维克",
  "reykjavik",
  "reykjavík",
]);

/** D2：答案是否在期望集内（去空白、大小写不敏感）。 */
function knowledgeFeature(parsed: Record<string, unknown>): FeatureResult {
  const raw = contentOf(parsed);
  if (raw === undefined) return MISSING;
  const normalized = raw.trim().toLowerCase().replace(/[。.!！?？\s]/g, "");
  return { kind: "boolean", value: KNOWLEDGE_ANSWERS.has(normalized) };
}

/** D3：拒绝文本本身（相似度由 baseline 用 Jaccard 判，此处只取样本）。 */
function refusalFeature(parsed: Record<string, unknown>): FeatureResult {
  const raw = contentOf(parsed);
  if (raw === undefined || raw.trim() === "") return MISSING;
  return { kind: "text", value: raw.trim() };
}

const EXTRACTORS: Readonly<Record<ProbeDimension, (p: Record<string, unknown>) => FeatureResult>> = Object.freeze({
  D0: tokenizerFeature,
  D1: formatFeature,
  D2: knowledgeFeature,
  D3: refusalFeature,
});

/** 提取指定维度的特征。未知维度返回 missing（探针不该因枚举外值崩溃）。 */
export function extractFeature(dim: ProbeDimension, parsed: Record<string, unknown>): FeatureResult {
  const fn = EXTRACTORS[dim];
  return fn === undefined ? MISSING : fn(parsed);
}
