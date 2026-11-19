// @test REQ-POST-01
// @no-test-required: 测试在 tests/unit/checkers/dangerous-command-scan.test.ts（本仓库测试统一放 tests/，不做同目录 co-locate）
import type {
  CheckerResult,
  Finding,
  NonStreamChecker,
  ScanUnit,
  StreamChecker,
} from "../shared/types.ts";
import { scanTexts } from "../shared/types.ts";

/**
 * @intent 供应链投毒响应面：检出「从网络取内容并直接执行」的命令形态（T2a 内容侧，观测类）。
 *
 * 定位：`tool-call-shape` 只判结构合法性（未声明工具/缺参/坏 JSON），不看命令内容；
 *       本 checker 补内容侧，覆盖中转站/供应商在响应正文或 tool-call 参数里夹带
 *       `curl … | bash`、PowerShell 下载执行、base64 管道执行、反弹 shell、公网裸 IP 下载。
 *
 * 为什么是观测类（finding=warn）：同一段文本既是投毒载荷、也是正常安装教程
 * （`curl -fsSL https://bun.sh/install | bash`）。阻断类要求 FP=0，文本规则做不到，
 * 故只告警并落 evidence（rule_id + offsets），由使用者判断；后续可按 rule 粒度升级。
 *
 * 不变量：
 *   1. 纯函数：只依赖 ScanUnit / scanTexts；无配置、时钟、网络。
 *   2. 只经 scanTexts 取文本（原始 + 转义还原双投影），转义写法无法绕过。
 *   3. 无跨请求状态；流式用窗口 extra 内的有界尾部累积（≤4KiB），命令跨 chunk 仍可命中。
 */

export const CHECKER_ID = "dangerous-command-scan";
export const THREAT = "T2a";

/** 流式滚动尾部上限：命令文本远短于此，4KiB 足够跨 chunk 拼接且限制单帧扫描成本。 */
const STREAM_TAIL_CHARS = 4096;
const ACC_KEY = "accText";

interface Rule {
  readonly id: string;
  readonly re: RegExp;
  readonly severity: "medium" | "high";
  /** 命中串的宿主名需再过一道「非内网」判定（裸 IP 规则用）。 */
  readonly publicHostOnly?: boolean;
}

/**
 * 首批规则集：高置信「下载即执行」原语。所有量词有界，避免灾难性回溯。
 * `curl https://example.com` 单独出现（不接管道）不命中；裸 IP 规则仅告警级。
 */
const RULES: readonly Rule[] = [
  {
    id: "remote-pipe-exec",
    re: /\b(?:curl|wget)\b[^|\n]{0,300}\|\s*(?:sudo\s+)?(?:ba|z|k|da)?sh\b/g,
    severity: "high",
  },
  {
    id: "process-substitution-exec",
    re: /\b(?:ba|z|k)?sh\s+(?:-\S+\s+)*<\(\s*(?:curl|wget)\b|\beval\s+["']?\$\(\s*(?:curl|wget)\b/g,
    severity: "high",
  },
  {
    id: "base64-pipe-exec",
    re: /\bbase64\s+(?:-d|--decode|-D)\b[^|\n]{0,200}\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/g,
    severity: "high",
  },
  {
    id: "powershell-download-exec",
    re: /\b(?:IEX|Invoke-Expression)\s*\(|\bDownloadString\s*\(|\bpowershell(?:\.exe)?\s+-(?:enc|encodedcommand)\b/gi,
    severity: "high",
  },
  {
    id: "reverse-shell",
    re: /\/dev\/(?:tcp|udp)\/[^\s'"]+\/|\bnc\s+[^\n]{0,80}\s-e\s+\/(?:bin|usr\/bin)\/(?:ba)?sh\b/g,
    severity: "high",
  },
  {
    id: "raw-ip-download",
    re: /\bhttps?:\/\/(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\//g,
    severity: "medium",
    publicHostOnly: true,
  },
];

/** 内网/回环/链路本地地址不算可疑下载源（本地开发与内网示例是常态）。 */
function isPrivateIpv4(hostPort: string): boolean {
  const host = hostPort.replace(/^https?:\/\//, "").split(":")[0]!;
  const [a, b] = host.split(".").map(Number) as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

interface RuleHit {
  readonly rule: Rule;
  readonly offsets: readonly number[];
}

/** 扫一份投影文本；返回每个规则的首批命中偏移（同一规则只报一条 finding）。 */
function scanOne(text: string, rule: Rule): readonly number[] {
  const re = new RegExp(rule.re.source, rule.re.flags);
  const offsets: number[] = [];
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index === re.lastIndex) re.lastIndex++;
    if (rule.publicHostOnly === true && isPrivateIpv4(m[0])) continue;
    offsets.push(m.index);
  }
  return offsets;
}

/**
 * 双投影扫描：去掉 offsets 只在「首个投影（原文）」命中时保留——
 * 转义还原后的文本长度口径不同，偏移不可回指原文（与 egress-secret-scan 同纪律）。
 */
function scanTextsForRules(texts: readonly string[], withOffsets: boolean): readonly RuleHit[] {
  const hits: RuleHit[] = [];
  for (const rule of RULES) {
    for (let i = 0; i < texts.length; i++) {
      const offsets = scanOne(texts[i]!, rule);
      if (offsets.length === 0) continue;
      hits.push({ rule, offsets: withOffsets && i === 0 ? offsets : [] });
      break;
    }
  }
  return hits;
}

function toFindings(hits: readonly RuleHit[]): readonly Finding[] {
  return hits.map(({ rule, offsets }) => ({
    checker: CHECKER_ID,
    threat: THREAT,
    verdict: "finding",
    severity: rule.severity,
    rule_id: rule.id,
    ...(offsets.length > 0 ? { offsets } : {}),
  }));
}

/** 流式/非流式共用的纯文本判定（无 offsets 语义时传 false）。 */
function checkTexts(texts: readonly string[], withOffsets: boolean): CheckerResult {
  const findings = toFindings(scanTextsForRules(texts, withOffsets));
  return findings.length === 0
    ? { verdict: "clean", evidence: [] }
    : { verdict: "finding", evidence: findings };
}

/** 流式累积用的单一投影：有转义还原投影时用它（还原后的字符即真实字符）。 */
function primaryProjection(unit: ScanUnit): string {
  const texts = scanTexts(unit);
  return texts[texts.length - 1]!;
}

export const checkDangerousCommandNonStream: NonStreamChecker = (unit) =>
  checkTexts(scanTexts(unit), true);

export const checkDangerousCommandStream: StreamChecker = (window, chunk) => {
  const prev = typeof window.extra?.[ACC_KEY] === "string" ? (window.extra[ACC_KEY] as string) : "";
  const fresh = primaryProjection(chunk);
  // 有界尾部：只保留最后 STREAM_TAIL_CHARS 个码元，单帧扫描成本与响应总长无关。
  const acc = (prev + fresh).slice(-STREAM_TAIL_CHARS);
  const next = {
    pendingBytes: window.pendingBytes,
    cursor: window.cursor + fresh.length,
    extra: { ...window.extra, [ACC_KEY]: acc },
  } as const;
  // 流式窗口的偏移以累积尾部为基准、不代表整段响应，故不报 offsets。
  return [checkTexts([acc], false), next] as const;
};

export const DANGEROUS_COMMAND_SCAN_SPEC = {
  id: CHECKER_ID,
  side: "response",
  synchronous: true,
  safetyClass: false, // 文本规则有正例教程误报面 → finding=warn（policy mapBySpec 兜底）
  threat: THREAT,
  runNonStream: checkDangerousCommandNonStream,
  runStream: checkDangerousCommandStream,
} as const;
