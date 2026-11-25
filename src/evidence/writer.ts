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

/**
 * 解析一行 evidence 并校验；损坏且**非**崩溃残留时抛出。
 *
 * @param halfWritten 该行是否可能是崩溃残留（文件末尾无换行）
 */
function parseRecordLine(line: string, lineNo: number, halfWritten: boolean): EvidenceRecord | null {
  try {
    const parsed = JSON.parse(line) as EvidenceRecord;
    if (!validateEvidence(parsed).ok) throw new Error("schema invalid");
    return parsed;
  } catch (e) {
    // AC-VETO-007-04：崩溃残留末行丢弃，不让半条记录卡住整个网关启动。
    // 返回 null 而不是占位记录——占位记录会被当成"最后一条"写进 seq，从而差一。
    if (halfWritten) return null;
    throw new Error(`evidence file corrupt at line ${lineNo}: ${line.slice(0, 80)}`, { cause: e });
  }
}

export class EvidenceWriter {
  private seq = 0;
  private lastHash: string = GENESIS_HASH;
  private initialized = false;

  constructor(readonly path: string) {}

  /** 启动时读取已有 JSONL 尾部 → 恢复 seq + last_hash；末行残半 → 丢弃。 */
  init(): void {
    if (this.initialized) return;
    const content = existsSync(this.path) ? readFileSyncUtf8(this.path) : null;
    if (content !== null) this.resumeFrom(content);
    this.initialized = true;
  }

  /** 从既有文件内容接续 seq 与 lastHash（重放全部记录以校验链）。 */
  private resumeFrom(content: string): void {
    const lines = content.split("\n").filter((l) => l.length > 0);
    // 半行检测：文件不以 \n 结尾且最后一行 JSON.parse 失败 → 崩溃残留，丢弃末行
    const lastLineEnded = content.endsWith("\n");
    const parsed = lines.map((line, i) => parseRecordLine(line, i + 1, i === lines.length - 1 && !lastLineEnded));
    const valid = parsed.filter((r): r is EvidenceRecord => r !== null);
    const last = valid.at(-1);
    if (last === undefined) return;
    this.seq = last.seq + 1;
    this.lastHash = last.record_hash;
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
    try {
      appendFileSync(this.path, JSON.stringify(record) + "\n", "utf8");
    } catch (err) {
      // 写失败必须在此止住：下面的 seq/lastHash 只有在落盘成功后才能前移，否则内存链会与磁盘分叉。
      throw new Error(`evidence append failed: ${this.path} (${err instanceof Error ? err.message : String(err)})`);
    }
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
