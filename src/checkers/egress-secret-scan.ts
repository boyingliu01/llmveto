import type {
  CheckerResult,
  Finding,
  NonStreamChecker,
  ScanUnit,
} from "../shared/types.ts";

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
  { id: "anthropic-sk-ant",    re: /sk-ant-[A-Za-z0-9_\-]{20,}/g },
  { id: "github-ghp",          re: /ghp_[A-Za-z0-9]{36}/g },
  { id: "aws-akia",            re: /AKIA[0-9A-Z]{16}/g },
  { id: "pem-private-key",     re: /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/g },
];

export const egressSecretScan: NonStreamChecker = (unit: ScanUnit): CheckerResult => {
  const findings: Finding[] = [];
  const text = unit.text;

  for (const rule of RULES) {
    rule.re.lastIndex = 0; // 保证纯函数性（regex 是模块级共享对象）
    let m: RegExpExecArray | null;
    const offsets: number[] = [];
    while ((m = rule.re.exec(text)) !== null) {
      // 防御 zero-length 死循环（当前 pattern 不会 zero-length，仍显式保护）
      if (m.index === rule.re.lastIndex) rule.re.lastIndex++;
      offsets.push(m.index);
    }
    if (offsets.length > 0) {
      findings.push({
        checker: "egress-secret-scan",
        threat: "T1b",
        verdict: "finding",
        severity: "high",
        offsets,
        rule_id: rule.id,
      });
    }
  }

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
  runNonStream: egressSecretScan,
} as const;
