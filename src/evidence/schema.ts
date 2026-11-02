import type { ActionTaken, BodyCapture } from "../shared/types.ts";

/**
 * @test REQ-VETO-007
 * @intent evidence 记录字段表 —— 与 TEST 可测试性契约 #4 一一对应，v1 冻结。
 *         `evidence_version: 1` 是消费方（llmveto verify）识别入口。
 */

export const EVIDENCE_VERSION = 1 as const;

export interface EvidenceFinding {
  readonly checker: string;
  readonly threat: string;
  readonly verdict: "clean" | "finding" | "error";
  readonly severity?: "low" | "medium" | "high" | "critical";
  readonly offsets?: readonly number[];
  readonly rule_id?: string;
}

export interface ResponseDelivered {
  readonly partial: boolean;
  readonly delivered_chunks: number;
}

/** 契约 #4 全部 ✅ 必填字段。 */
export interface EvidenceRecord {
  readonly evidence_version: 1;
  readonly event_id: string;
  readonly seq: number;
  readonly ts: string; // ISO-8601
  readonly session_id: string;
  readonly turn_id: string;
  readonly request_id: string;
  readonly client: string;
  readonly provider_id: string;
  readonly endpoint_host: string;
  readonly model_requested: string | null;
  readonly model_responded: string | null;
  readonly transport: "stream" | "non-stream";
  readonly request_bytes: number;
  readonly response_bytes: number;
  readonly chunk_count: number;
  readonly latency: number; // ms
  readonly findings: readonly EvidenceFinding[];
  readonly action_taken: ActionTaken;
  readonly response_delivered: ResponseDelivered;
  readonly request_body_sha256: string;
  readonly response_body_sha256: string;
  readonly prev_hash: string; // hex sha256；链首 = "0".repeat(64)
  readonly record_hash: string; // hex sha256
  readonly canary: null;
  readonly body_capture: BodyCapture;
}

/**
 * 必填字段名清单（verify schema 断言用；顺序即 JSON 输出顺序）。
 * TEST 契约 #4 冻结。
 */
export const REQUIRED_FIELDS: readonly (keyof EvidenceRecord)[] = Object.freeze([
  "evidence_version",
  "event_id",
  "seq",
  "ts",
  "session_id",
  "turn_id",
  "request_id",
  "client",
  "provider_id",
  "endpoint_host",
  "model_requested",
  "model_responded",
  "transport",
  "request_bytes",
  "response_bytes",
  "chunk_count",
  "latency",
  "findings",
  "action_taken",
  "response_delivered",
  "request_body_sha256",
  "response_body_sha256",
  "prev_hash",
  "record_hash",
  "canary",
  "body_capture",
]);

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * 单字段校验表：顺序即报错顺序（v1 冻结）；新增受检字段 = 追加一行，不再增长
 * validateEvidence 的圈复杂度（lizard 曾报 CCN 22）。
 */
const FIELD_VALIDATORS: readonly ((
  r: Record<string, unknown>,
  push: (m: string) => void,
) => void)[] = [
  (r, push) => { if (r.evidence_version !== 1) push(`evidence_version must be 1, got ${String(r.evidence_version)}`); },
  (r, push) => { if (typeof r.seq !== "number" || !Number.isInteger(r.seq) || r.seq < 0) push("seq: non-negative integer required"); },
  (r, push) => { if (typeof r.ts !== "string" || Number.isNaN(Date.parse(r.ts))) push("ts: ISO-8601 string required"); },
  ...(["prev_hash", "record_hash", "request_body_sha256", "response_body_sha256"] as const).map((f) =>
    (r: Record<string, unknown>, push: (m: string) => void) => {
      if (typeof r[f] === "string" && !HEX64.test(r[f] as string)) push(`${f}: hex64 required`);
    },
  ),
  (r, push) => { if ("canary" in r && r.canary !== null) push("canary must be null in v1"); },
];

/** 运行时 schema 断言：verify 消费入口 + writer 落盘前调用。 */
export function validateEvidence(rec: unknown): { ok: true } | { ok: false; errors: readonly string[] } {
  const errors: string[] = [];
  if (typeof rec !== "object" || rec === null) {
    return { ok: false, errors: ["root: not an object"] };
  }
  const r = rec as Record<string, unknown>;
  for (const f of REQUIRED_FIELDS) {
    if (!(f in r)) errors.push(`missing: ${f}`);
  }
  for (const check of FIELD_VALIDATORS) check(r, (m) => errors.push(m));
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
