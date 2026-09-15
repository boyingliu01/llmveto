import type {
  CheckerResult,
  Finding,
  NonStreamChecker,
  ScanUnit,
  ScanWindow,
  StreamChecker,
} from "../shared/types.ts";

/**
 * @test REQ-VETO-004
 * @intent 隐形 Unicode 字符扫描（T2c）：U+200B/200C/200D/FEFF/202E/2066-2069；
 *         跨 chunk 滚动窗口 —— window.cursor 承载**全局码点偏移**，findings.offsets 为全局位置。
 *
 * 能力边界（REQ 登记表 T2c 行）：v1 不覆盖 NFKC 归一化后同形变体、自定义 PUA 编码。
 * 关键不变量：纯函数，无配置/时钟/网络/env；ScanWindow.pendingBytes 由网关侧
 * 增量 UTF-8 解码承载（DESIGN §扫描单元定义），checker 只见解码后的文本。
 */

// v1 冻结码点集（9 个），全部落 BMP，无代理对。
const INVISIBLE = /[\u200B\u200C\u200D\uFEFF\u202E\u2066\u2067\u2068\u2069]/g;

export const CHECKER_ID = "invisible-unicode-scan";

function scanText(text: string, baseCursor: number): Finding[] {
  INVISIBLE.lastIndex = 0; // 纯函数保证
  const offsets: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = INVISIBLE.exec(text)) !== null) {
    // 全局码点偏移：由于本 pattern 命中项均为 BMP 单元（非代理对），
    // m.index 是 UTF-16 code unit index；对 BMP 而言 = 码点 index。
    offsets.push(baseCursor + m.index);
    if (m.index === INVISIBLE.lastIndex) INVISIBLE.lastIndex++;
  }
  if (offsets.length === 0) return [];
  return [{
    checker: CHECKER_ID,
    threat: "T2c",
    verdict: "finding",
    severity: "medium",
    offsets,
    rule_id: "invisible-unicode",
  }];
}

export const invisibleUnicodeScanNonStream: NonStreamChecker = (unit: ScanUnit): CheckerResult => {
  const findings = scanText(unit.text, 0);
  return findings.length === 0
    ? { verdict: "clean", evidence: [] }
    : { verdict: "finding", evidence: findings };
};

/**
 * 流式：window.cursor 记录已消费的 UTF-16 code unit 数（对 BMP 等价码点数）。
 * 每 chunk 增量扫描 → 累积 finding → 返回新 cursor。
 */
export const invisibleUnicodeScanStream: StreamChecker = (
  window: ScanWindow,
  chunk: ScanUnit,
): readonly [CheckerResult, ScanWindow] => {
  const findings = scanText(chunk.text, window.cursor);
  const nextCursor = window.cursor + chunk.text.length;
  const next: ScanWindow = {
    pendingBytes: window.pendingBytes, // 由网关侧维护；checker 透传
    cursor: nextCursor,
  };
  const result: CheckerResult = findings.length === 0
    ? { verdict: "clean", evidence: [] }
    : { verdict: "finding", evidence: findings };
  return [result, next] as const;
};

export const INVISIBLE_UNICODE_SCAN_SPEC = {
  id: CHECKER_ID,
  side: "response",
  synchronous: true,
  safetyClass: true,
  runNonStream: invisibleUnicodeScanNonStream,
  runStream: invisibleUnicodeScanStream,
} as const;
