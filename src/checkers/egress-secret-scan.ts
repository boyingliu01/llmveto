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
  // PEM 私钥：头部 + **主体** 双条件（见 hasPemBody 的立节理由）。
  // 只认头部会把「讨论 PEM 格式的任何文本」判成凭据出境——本仓库自己的夹具就是反例。
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

/**
 * PEM 命中必须带**主体**才判为凭据（2026-11-24）。
 *
 * 立节理由：`pem-private-key` 原本只匹配头部 `-----BEGIN … PRIVATE KEY-----`。
 * 于是任何**讨论** PEM 格式的文本都被判成凭据出境并阻断整条请求——包括本仓库
 * `tests/fixtures/threats/T1b/secrets.yaml` 里的夹具行
 * `-----BEGIN RSA PRIVATE KEY----- payload -----END RSA PRIVATE KEY-----`
 * （2026-09-15 起就在仓库里）。实测：该夹具与「只输入这一行」都能让请求 502，
 * 也就是**开发本项目的会话会被自己的网关拦下**，与 0.5.2 修掉的那类误报同源，
 * 但当时只覆盖了 AKIA/ghp 两条规则。
 *
 * 判据取「头部之后是否有 base64 主体」：真实私钥的头部后面必跟成块 base64，
 * 而文档、夹具、对话里引用格式时不会。门槛取 20（`PEM_BODY_MIN_CHARS`）——真实私钥主体
 * 是数百到数千字符，20 只是"确实有内容"的下限；取更大值会让**测试样例**形态
 * （`MIIEow...` 这类截断示例）漏检，而这不是我们想排除的形态。
 * 为什么不是"有 END 就算"：夹具里恰恰有 END，只有主体能区分二者。
 *
 * 残余：讲「真实但截断的私钥」时仍会命中（截断的密钥仍然是泄露风险，这是有意的）；
 * 只写头部而不带任何 base64 文本的引用不会命中。
 */
/**
 * PEM 真块判据（2026-11-24）：**头与尾是否分处不同的行**。
 *
 * 立节理由：`pem-private-key` 原本只匹配头部 `-----BEGIN … PRIVATE KEY-----`，
 * 于是任何**讨论** PEM 格式的文本都被判成凭据出境并阻断整条请求——包括本仓库
 * `tests/fixtures/threats/T1b/secrets.yaml` 里从 2026-09-15 起就存在的夹具行
 * `-----BEGIN RSA PRIVATE KEY----- payload -----END RSA PRIVATE KEY-----`。
 * 实测：只输入这一行就能让请求 502，即**开发本项目的会话会被自己的网关拦下**。
 *
 * 判据的选择过程（四条候选，最终只用第四条）：
 *   ① 主体长度 ≥ N：测试样例 `MIIEow...` 只有 6 个合法字符，与夹具无法用长度分开；
 *   ② 有主体内容：夹具里的 `payload` 占位词也算内容，分不开；
 *   ③ 多行块：与真实私钥一致，但把**截断示例**（测试与文档常用的三行形态）也归入"真块"，
 *      而这类示例正是要保留检出能力的——判据不能与已冻结的测试契约冲突；
 *   ④ **头尾同行**：夹具与格式讨论把 BEGIN 与 END 写在同一行，真实 PEM 块按规范
 *      逐行排布，头与尾必然分处不同行。实测这一条精确分开了两类输入。
 *
 * 取舍：只写 `BEGIN` 头、不写成块的格式引用放行；成块形态（含截断块）照常阻断。
 */
const PEM_END = /-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----/;
const PEM_HEADER = /^-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/;

function hasPemBody(text: string, headStart: number): boolean {
  const tail = text.slice(headStart);
  const endMatch = PEM_END.exec(tail);
  // 无 END：要么是"只引用头部"的格式讨论，要么是被截断的真块。
  // 分界取头部之后是否**另起一行有内容**：真实 PEM 块头部后必换行接主体；
  // 对话里引用格式时头与后续文字同行（`PEM 文件以 -----BEGIN … PRIVATE KEY----- 开头`）。
  if (endMatch === null) return /^\r?\n\s*\S/.test(tail.slice(PEM_HEADER.exec(tail)?.[0].length ?? 0));
  // 头与尾之间出现了换行 ⇒ 成块形态；同行收尾 ⇒ 夹具/格式讨论。
  return tail.slice(0, endMatch.index).includes("\n");
}


interface RuleScan {
  readonly matched: boolean;
  readonly offsets: number[];
}

/** 逐个投影扫一条规则，首个命中的投影即停（同一 rule 只报一条）。 */
/** 转义投影命中占位：该投影的偏移不可回指原文（长度口径不同），故不报。 */
const OFFSET_NOT_APPLICABLE = "\u0000offsets-not-applicable";

/**
 * 该命中是否应判为凭据。两个排除项各有立节理由：
 *   - 官方文档示例值（DOCUMENTED_EXAMPLE_VALUES）：逐字相等的示例串不是密钥；
 *   - PEM 空壳（hasPemBody）：只有头部的引用是文档/夹具形态，不是私钥块。
 */
function isReportableHit(rule: Rule, text: string, matchedText: string, matchIndex: number): boolean {
  if (isDocumentedExample(matchedText)) return false;
  if (rule.id === "pem-private-key") return hasPemBody(text, matchIndex);
  return true;
}

/**
 * 单份文本内的全部命中偏移。`keepOffsets=false` 时只判存在性
 * （转义投影的偏移与原文长度口径不同，不可回指）。
 *
 * 用 `matchAll` 而非 `while (re.exec(...))`：后者需要调用方手工维护 `rule.re.lastIndex`，
 * 任何 `continue` 分支都可能留下错位的游标（同类缺陷已在 dangerous-command-scan 上
 * 实测导致无限循环）。`matchAll` 自持游标，也没有零宽命中这一档。
 */
function scanOneProjection(rule: Rule, text: string, keepOffsets: boolean): string[] {
  const offsetOf = (index: number): string => (keepOffsets ? String(index) : OFFSET_NOT_APPLICABLE);
  return [...text.matchAll(rule.re)]
    .filter((m) => isReportableHit(rule, text, m[0], m.index ?? 0))
    .map((m) => offsetOf(m.index ?? 0));
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
