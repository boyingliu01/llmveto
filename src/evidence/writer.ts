import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, openSync, readSync, closeSync, statSync } from "node:fs";
import { GENESIS_HASH, sealRecord } from "./chain.ts";
import { EVIDENCE_VERSION, validateEvidence, type EvidenceRecord } from "./schema.ts";

/**
 * @test REQ-VETO-007
 * @intent evidence 单写者 append-only JSONL + fsync best-effort + 崩溃残留半行丢弃。
 */

// AppendInput = EvidenceRecord 去掉链封存字段 + ts 可选；字段表以 schema.ts 为单一事实源，
// 防止 schema 与 writer 两处手工清单漂移（jscpd 曾报 19 行克隆）。
// reason（D-10 可选位，SL-03）经 Omit 保留其可选性：未传时落盘记录键整体缺席。
export type AppendInput = Omit<
  EvidenceRecord,
  "evidence_version" | "event_id" | "seq" | "ts" | "prev_hash" | "record_hash" | "canary" | "reason"
> & {
  readonly ts?: string;
  /** D-10 可选位：显式 undefined 视同缺席（writer 侧键不落盘），故类型允许 undefined。 */
  readonly reason?: string | undefined;
};

export class EvidenceWriter {
  private seq = 0;
  private lastHash: string = GENESIS_HASH;
  private initialized = false;

  constructor(readonly path: string) {}

  /** 启动时读取已有 JSONL 尾部 → 恢复 seq + last_hash；末行残半 → 丢弃。 */
  init(): void {
    if (this.initialized) return;
    if (!existsSync(this.path)) {
      this.initialized = true;
      return;
    }
    const content = readFileSyncUtf8(this.path);
    const lines = content.split("\n").filter((l) => l.length > 0);
    // 半行检测：文件不以 \n 结尾且最后一行 JSON.parse 失败
    const lastLineEnded = content.endsWith("\n");
    const valid: EvidenceRecord[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const isLast = i === lines.length - 1;
      try {
        const parsed = JSON.parse(line) as EvidenceRecord;
        const v = validateEvidence(parsed);
        if (!v.ok) throw new Error("schema invalid");
        valid.push(parsed);
      } catch {
        if (isLast && !lastLineEnded) {
          // AC-VETO-007-04：崩溃残留末行丢弃
          continue;
        }
        throw new Error(`evidence file corrupt at line ${i + 1}: ${line.slice(0, 80)}`);
      }
    }
    if (valid.length > 0) {
      this.seq = valid[valid.length - 1]!.seq + 1;
      this.lastHash = valid[valid.length - 1]!.record_hash;
    }
    this.initialized = true;
  }

  append(input: AppendInput): EvidenceRecord {
    this.init();
    const record = sealRecord({
      prev_hash: this.lastHash,
      record: {
        evidence_version: EVIDENCE_VERSION,
        event_id: randomUUID(),
        seq: this.seq,
        ts: input.ts ?? new Date().toISOString(),
        session_id: input.session_id,
        turn_id: input.turn_id,
        request_id: input.request_id,
        client: input.client,
        provider_id: input.provider_id,
        endpoint_host: input.endpoint_host,
        model_requested: input.model_requested,
        model_responded: input.model_responded,
        transport: input.transport,
        request_bytes: input.request_bytes,
        response_bytes: input.response_bytes,
        chunk_count: input.chunk_count,
        latency: input.latency,
        findings: input.findings,
        action_taken: input.action_taken,
        // D-10：reason 可选位 —— 未传时键整体缺席（§14.4-4），v1 记录形状零扰动。
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        response_delivered: input.response_delivered,
        request_body_sha256: input.request_body_sha256,
        response_body_sha256: input.response_body_sha256,
        canary: null,
        body_capture: input.body_capture,
      },
    });
    const v = validateEvidence(record);
    if (!v.ok) throw new Error(`evidence schema invalid: ${v.errors.join("; ")}`);
    appendFileSync(this.path, JSON.stringify(record) + "\n", "utf8");
    this.seq += 1;
    this.lastHash = record.record_hash;
    return record;
  }
}

function readFileSyncUtf8(path: string): string {
  const size = statSync(path).size;
  const buf = new Uint8Array(size);
  const fd = openSync(path, "r");
  try {
    let off = 0;
    while (off < size) {
      const n = readSync(fd, buf, off, size - off, off);
      if (n <= 0) break;
      off += n;
    }
  } finally {
    closeSync(fd);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}
