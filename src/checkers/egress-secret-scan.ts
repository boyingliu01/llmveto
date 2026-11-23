import type {
  CheckerResult,
  Finding,
  NonStreamChecker,
  ScanUnit,
} from "../shared/types.ts";
import { scanTexts } from "../shared/types.ts";

/**
 * @test REQ-VETO-003
 * @intent 出站凭据扫描器（**G-LIC 决议后**：v1 采自建 top-5 高置信凭据模式；
 *         gitleaks BUSL 许可不通过 → 覆盖面缩小至 5 类，见 docs/licenses.md）
 *
 * 关键不变量：
 *   1. 纯函数（AC-VETO-003-04）：不 import gateway/evidence/policy；不读配置/时钟/网络/env。
 *   2. 阻断类 FP=0（TEST §3）：模式高置信，宁漏不误；`sk-` 后须紧跟 ≥20 个字母数字。
 *   3. 认证类头不进扫描单元 —— 由网关（SL-09）保证，见 AC-VETO-002-06 / AC-VETO-003-02。
 *      checker 本身**只看** ScanUnit.text，不感知 header 概念。
 *   4. verdict ∈ {clean, finding}；error 仅由超时/异常路径产生（本文件不主动产生 error）。
 */

interface Rule {
  readonly id: string;
  readonly re: RegExp;
}

/**
 * v1 冻结规则集（top-5 高置信凭据模式）。
 * 每条 regex 都必须带 `g` 标志以支持多处命中；实现内会 `.lastIndex = 0` 保证纯函数性。
 */
const RULES: readonly Rule[] = [
  { id: "openai-sk",           re: /sk-[A-Za-z0-9]{20,}/g },
  { id: "anthropic-sk-ant",    re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { id: "github-ghp",          re: /ghp_[A-Za-z0-9]{36}/g },
  { id: "aws-akia",            re: /AKIA[0-9A-Z]{16}/g },
  { id: "pem-private-key",     re: /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/g },
];

/**
 * 厂商官方文档里的**示例值**白名单（精确匹配，不做模式推断）。
 *
 * 为什么需要：这些串出现在真实请求里时，扫描器判 finding → 策略层 block，
 * 整条请求零出境。但它们不是密钥——
 *   ① `tests/fixtures/threats/T1b/secrets.yaml` 用它做"必须被检出"的夹具，
 *      于是**开发/讨论本项目的会话本身会被自己的网关拦下**（实测 1.9MB 请求里
 *      命中 7×openai-sk + 6×github-ghp + 15×aws-akia，全部来自夹具与文档）；
 *   ② 任何在 AI 对话里讨论凭据格式的人都会撞上同一堵墙。
 *
 * 为什么这样不削弱防护：白名单是**逐字相等**的定长串，不参与正则。
 * `AKIAIOSFODNN7EXAMPLE` 的尾 8 位 `EXAMPLE` 若出现在真实密钥里，概率约 1/36^7 ≈ 1e-11，
 * 且必须**整串 20 字符完全相同**才豁免——真密钥不会与官方示例逐字相同。
 *
 * 为什么只收"官方文档值"：`sk-ant-api03-AbCdEf…` 这类夹具自造的占位串不在白名单内，
 * 它们仍应被检出（测试正是用它验证规则有效）。加白名单前必须先确认该串在厂商公开文档中
 * 以示例身份出现，否则会变成"为通过测试而放宽检测"。
 */
const DOCUMENTED_EXAMPLE_VALUES: ReadonlySet<string> = Object.freeze(
  new Set([
    "AKIAIOSFODNN7EXAMPLE", // AWS 文档示例 access key id
    "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij", // GitHub 文档示例 token
  ]),
);

/** 该命中是否只是官方文档示例值（逐字相等才判 true）。 */
function isDocumentedExample(matchedText: string): boolean {
  return DOCUMENTED_EXAMPLE_VALUES.has(matchedText);
}

interface RuleScan {
  readonly matched: boolean;
  readonly offsets: number[];
}

/** 逐个投影扫一条规则，首个命中的投影即停（同一 rule 只报一条）。 */
/** 转义投影命中占位：该投影的偏移不可回指原文（长度口径不同），故不报。 */
const OFFSET_NOT_APPLICABLE = "\u0000offsets-not-applicable";

/**
 * 单份文本内的全部命中偏移。跳过官方文档示例值；`keepOffsets=false` 时只判存在性
 * （转义投影的偏移与原文长度口径不同，不可回指）。
 */
function scanOneProjection(rule: Rule, text: string, keepOffsets: boolean): string[] {
  rule.re.lastIndex = 0;
  const hits: string[] = [];
  for (let m = rule.re.exec(text); m !== null; m = rule.re.exec(text)) {
    // 防御 zero-length 死循环（当前 pattern 不会 zero-length，仍显式保护）
    if (m.index === rule.re.lastIndex) rule.re.lastIndex++;
    // 官方文档示例值不算凭据（见 DOCUMENTED_EXAMPLE_VALUES 的立节理由）
    if (isDocumentedExample(m[0])) continue;
    hits.push(keepOffsets ? String(m.index) : OFFSET_NOT_APPLICABLE);
  }
  return hits;
}

/** 逐个投影扫一条规则，首个命中的投影即停（同一 rule 只报一条）。 */
function scanProjections(rule: Rule, texts: readonly string[]): RuleScan {
  rule.re.lastIndex = 0; // 保证纯函数性（regex 是模块级共享对象）
  for (let i = 0; i < texts.length; i++) {
    const hits = scanOneProjection(rule, texts[i]!, i === 0);
    if (hits.length === 0) continue;
    // 转义投影的偏移与原文长度口径不同，不可回指 → 不报 offsets（只有首个投影才报）
    const offsets = hits.includes(OFFSET_NOT_APPLICABLE) ? [] : hits.map(Number);
    return { matched: true, offsets };
  }
  return { matched: false, offsets: [] };
}

function findingFor(rule: Rule, scan: RuleScan): Finding | null {
  if (!scan.matched) return null;
  return {
    checker: "egress-secret-scan",
    threat: "T1b",
    verdict: "finding",
    severity: "high",
    // 转义投影命中时无可靠位置（长度口径不同），只报规则命中这一事实
    ...(scan.offsets.length > 0 ? { offsets: scan.offsets } : {}),
    rule_id: rule.id,
  };
}

export const egressSecretScan: NonStreamChecker = (unit: ScanUnit): CheckerResult => {
  // 多投影：原始文本 + 转义还原文本（编码层对抗）。凭据可被 `sk-\u0061…` 这类
  // 转义写法拆散以规避朴素匹配，故两份都扫；同一 rule 只报一条（取先命中的投影）。
  const texts = scanTexts(unit);
  const findings = RULES
    .map((rule) => findingFor(rule, scanProjections(rule, texts)))
    .filter((f): f is Finding => f !== null);

  return findings.length === 0
    ? { verdict: "clean", evidence: [] }
    : { verdict: "finding", evidence: findings };
};

/**
 * Checker 元数据声明（供注册表使用）。
 */
export const EGRESS_SECRET_SCAN_SPEC = {
  id: "egress-secret-scan",
  side: "request",
  synchronous: true,
  safetyClass: true, // → policy 层 finding=block；error=block（DESIGN §降级规则）
  threat: "T1b",
  runNonStream: egressSecretScan,
} as const;
