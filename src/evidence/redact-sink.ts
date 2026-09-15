import type { BodyCapture } from "../shared/types.ts";
import { sha256Hex } from "./chain.ts";

/**
 * @test REQ-VETO-007
 * @intent 单一脱敏咽喉点（DD-VETO-010）：所有 sink（evidence/stdout/report）
 *         写盘前必须经过 redactSink()。
 *
 * v1 默认 body_capture=metadata_only → 不落原文，仅 sha256；
 * redacted → 命中凭据/隐形字符偏移替换为 `[REDACTED]`；
 * full → 原文透传（文档必须标注 T1b 本地聚集风险）。
 */

const REDACTED = "[REDACTED]";
const CRED = /(sk-[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9_\-]{20,}|ghp_[A-Za-z0-9]{36}|AKIA[0-9A-Z]{16}|-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----)/g;
const INVISIBLE = /[\u200B\u200C\u200D\uFEFF\u202E\u2066\u2067\u2068\u2069]/g;

export interface RedactResult {
  readonly mode: BodyCapture;
  readonly text: string;
  readonly sha256: string;
}

export function redactSink(mode: BodyCapture, body: string): RedactResult {
  const text = mode === "redacted"
    ? body.replace(CRED, REDACTED).replace(INVISIBLE, "")
    : mode === "full"
      ? body
      : ""; // metadata_only：不落文本
  const sha = sha256Hex(body);
  return { mode, text, sha256: sha };
}
