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
  /**
   * 常数级预筛：这些字面量一个都不在文本里时，`re` 必然无命中，直接跳过。
   *
   * 为什么需要（G2 回归实测）：4 条新规则 × 多份投影在 512KB 文本上合计 1.2ms，
   * 而 G2 的增量预算只有 0.36ms —— 512KB 档 p50 因此从 5.13ms 涨到 10.58ms。
   * 预筛用 `includes`（5µs 级），绝大多数正常文本直接短路。
   * 漏写的后果只是回落到正则（慢，不会更松），所以每个字面量必须覆盖该规则能命中的**全部**路径。
   */
  readonly prefilter?: readonly string[];
  readonly severity: "medium" | "high";
  /** 命中串的宿主名需再过一道「非内网」判定（裸 IP 规则用）。 */
  readonly publicHostOnly?: boolean;
  /**
   * 该规则命中允许升级为 block（0.6.0 按规则分级）。
   * 只有「读凭据文件」这类**语义封闭**的规则可以标 true：命中即意味着凭据正要离开本机，
   * 不存在「安装教程里也这么写」的正例面。其余规则保持观测类（warn）——
   * 文本规则无法保证零误报，给它们阻断权会把正常开发会话整条 502 掉（2026-11-24 实测）。
   */
  readonly blocking?: boolean;
}

/**
 * 首批规则集：高置信「下载即执行」原语。所有量词有界，避免灾难性回溯。
 * `curl https://example.com` 单独出现（不接管道）不命中；裸 IP 规则仅告警级。
 */
const RULES: readonly Rule[] = [
  {
    id: "remote-pipe-exec",
    prefilter: ["curl", "wget"],
    re: /\b(?:curl|wget)\b[^|\n]{0,300}\|\s*(?:sudo\s+)?(?:ba|z|k|da)?sh\b/g,
    severity: "high",
  },
  {
    id: "process-substitution-exec",
    prefilter: ["curl", "wget"],
    re: /\b(?:ba|z|k)?sh\s+(?:-\S+\s+)*<\(\s*(?:curl|wget)\b|\beval\s+["']?\$\(\s*(?:curl|wget)\b/g,
    severity: "high",
  },
  {
    id: "base64-pipe-exec",
    prefilter: ["base64"],
    re: /\bbase64\s+(?:-d|--decode|-D)\b[^|\n]{0,200}\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/g,
    severity: "high",
  },
  {
    id: "powershell-download-exec",
    prefilter: ["IEX", "iex", "Invoke-Expression", "DownloadString", "powershell", "PowerShell", "pwsh"],
    re: /\b(?:IEX|Invoke-Expression)\s*\(|\bDownloadString\s*\(|\bpowershell(?:\.exe)?\s+-(?:enc|encodedcommand)\b/gi,
    severity: "high",
  },
  {
    id: "reverse-shell",
    prefilter: ["/dev/tcp", "/dev/udp", "nc "],
    re: /\/dev\/(?:tcp|udp)\/[^\s'"]+\/|\bnc\s+[^\n]{0,80}\s-e\s+\/(?:bin|usr\/bin)\/(?:ba)?sh\b/g,
    severity: "high",
  },
  {
    id: "raw-ip-download",
    prefilter: ["http://", "https://"],
    re: /\bhttps?:\/\/(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\/\S*/g,
    severity: "medium",
    publicHostOnly: true,
  },
  {
    // 2026-11-24：`/dev/tcp` 与 `nc -e` 之外的另一半反弹 shell 形态——`nc -c` / `ncat -e`
    // 及 `bash -i >& /dev/tcp/...` 早已由 `reverse-shell` 覆盖，此处补「本机管道到远端」：
    // `cat x | nc host port`、（bash|sh|python…) 管道到远端。裸 `nc` 用法（端口探测、手工会话）
    // 不含远端输入管道，不命中——这是把规则限定在「反向外带」语义上，而不是见到 nc 就报。
    id: "reverse-shell-pipe",
    prefilter: ["nc ", "ncat", "netcat"],
    re: /\b(?:cat|tar|base64)\b[^|\n]{0,200}\|\s*(?:nc|ncat|netcat)\s+\S+\s+\d{1,5}\b|\b(?:ba|z)?sh\b[^|\n]{0,80}\|\s*(?:nc|ncat|netcat)\s+\S+\s+\d{1,5}\b/g,
    severity: "high",
  },
  {
    // 上游对 agent 的工具调用里索要内容型凭据文件：`cat ~/.ssh/id_rsa`、`cat .env`、
    // `cat ~/.aws/credentials`、`.npmrc` 等。「上游叫 agent 读出凭据 → agent 回传」
    // 这条路不经过模型参数读取界面，是凭据出境的实际形态之一。
    // 只认「文件读取工具/命令 + 凭据文件路径」，不认路径单独出现（文档、配置示例常见）。
    id: "credential-file-read",
    prefilter: [".ssh/", ".aws/", ".npmrc", ".pypirc", ".netrc", ".git-credentials", ".gnupg", ".env", "secret"],
    // 语义封闭 → 唯一允许阻断的规则（见 Rule.blocking）。
    blocking: true,
    // 命中集合全部以字面 "." 起头：前缀字符类展开后必然以非空白收尾，不存在空匹配。
    // （2026-11-24 实测：前缀若可匹配空串，`\s*` 会在**每次**匹配失败时枚举每个起点上的
    //  全部空白长度 = O(n²) 分配，一个普通句子就 OOM。）
    re: /(?:\bcat\b|\bhead\b|\btail\b|\bless\b|\bmore\b|\btype\b|["']path["']\s*:|["']file_path["']\s*:)\s*["']?(?:[^\s"'.]{1,40}\/)?(?:\.ssh\/id_[a-z0-9]+|\.aws\/credentials|\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.gnupg\/|\.env(?:\.[a-z0-9]+)?(?![\w.-])|secrets?\.(?:json|ya?ml|toml)(?![\w]))/gi,
    severity: "high",
  },
];

/**
 * 投毒底座的「拉取并落盘 + 随后执行」：单条正则同时匹配「下载到的本地文件名」与
 * 「之后对同一路径执行」必然要反向引用 + 长距离回溯，实测会灾难性回溯（OOM），
 * 故拆成两段有界扫描：先定位落盘（`curl -o x` / `wget -O x` / `-OutFile x`），
 * 再在命中位置之后的定长窗口里找执行原语（chmod 后执行 / ./x / sh x / source x）。
 * 只认「下载到本地文件名再执行」——`curl -o out.html <URL>` 这类正常下载不命中。
 */
const DOWNLOAD_RULE: Rule = {
  id: "download-then-execute",
  re: /\b(?:curl|wget|Invoke-WebRequest|iwr)\b[^|\n]{0,200}?(?:-O\w*|-o\s+|--output\s+|-OutFile\s+)\s*["']?([^\s"';&|]{1,64})/g,
  severity: "high",
};
const EXEC_AFTER_DOWNLOAD_WINDOW = 400;
const EXEC_AFTER_DOWNLOAD = /chmod\b[^\n]{0,40}|\bsource\b|\.\/|\b(?:ba|z)?sh\s+\S+/;

/** 落盘目标是否可判定（排除空串、stdout `-` 与 URL）。 */
function isLocalDownloadTarget(local: string): boolean {
  return local !== "" && local !== "-" && !/^[a-z][a-z0-9+.-]*:\/\//i.test(local);
}

/** 落盘后是否在同一窗口里出现执行原语。 */
function executesAfter(text: string, endOfMatch: number): boolean {
  const tail = text.slice(endOfMatch, endOfMatch + EXEC_AFTER_DOWNLOAD_WINDOW);
  return EXEC_AFTER_DOWNLOAD.test(tail);
}

/** 下载动作的命令名。有一条在上游识别，`download-then-execute` 整条规则就不可能命中。 */
const DOWNLOAD_COMMANDS: readonly string[] = Object.freeze(["curl", "wget", "iwr", "Invoke-WebRequest"]);

/** 常数级预筛（同 Rule.prefilter 的理由）：命令名是下载动作的必要条件。 */
function mayDownload(text: string): boolean {
  return DOWNLOAD_COMMANDS.some((cmd) => text.includes(cmd));
}

function scanDownloadThenExecute(text: string): readonly { readonly offset: number; readonly text: string }[] {
  if (!mayDownload(text)) return [];
  const out: { offset: number; text: string }[] = [];
  for (const m of text.matchAll(DOWNLOAD_RULE.re)) {
    // 落盘目标可以是绝对路径（/tmp/p.sh）：只要不是 URL、也不是 `-`（stdout）。
    if (!isLocalDownloadTarget(m[1] ?? "")) continue;
    if (!executesAfter(text, m.index + m[0].length)) continue;
    out.push({ offset: m.index, text: m[0] });
  }
  return out;
}

/**
 * 可阻断规则白名单（0.6.0）：由 Rule.blocking 派生，是 policy 层判定 finding 能否升级为
 * block 的**唯一来源**。新增阻断规则必须在此登记，且必须有「命中即危险」的语义论证。
 */
export const BLOCKING_RULE_IDS: ReadonlySet<string> = Object.freeze(
  new Set(RULES.filter((r) => r.blocking === true).map((r) => r.id)),
);

/**
 * 内网/回环/链路本地地址不算可疑下载源（本地开发与内网示例是常态）。
 *
 * 写成「网段表 + 一次区间查找」而不是条件链：条件链每个 `||` / `.some()` 短路都计一个
 * 分支（CCN 一路涨到 11），而这里要表达的只是"该 /16 落在哪几个枚举区间里"。
 * 表本身就是这份豁免的完整清单，新增网段只需加一行。
 */
interface PrivateRange {
  /** 第一段（闭区间）。 */
  readonly first: number;
  /** 第二段区间（闭区间）；`lo === hi` 即 /16 固定段。 */
  readonly lo: number;
  readonly hi: number;
}

const PRIVATE_IPV4_RANGES: readonly PrivateRange[] = Object.freeze([
  { first: 0, lo: 0, hi: 255 }, // 0.0.0.0/8 本网络
  { first: 10, lo: 0, hi: 255 }, // 10.0.0.0/8
  { first: 127, lo: 0, hi: 255 }, // 127.0.0.0/8 回环
  { first: 169, lo: 254, hi: 254 }, // 169.254.0.0/16 链路本地
  { first: 172, lo: 16, hi: 31 }, // 172.16.0.0/12
  { first: 192, lo: 168, hi: 168 }, // 192.168.0.0/16
]);

function isPrivateIpv4(hostPort: string): boolean {
  const host = hostPort.replace(/^https?:\/\//, "").split(":")[0] ?? "";
  const [a, b] = host.split(".").map(Number);
  // 非点分十进制（缺第二段）不属本函数判定域：它不是 IPv4 字面量，交给调用方。
  if (a === undefined || b === undefined) return false;
  return PRIVATE_IPV4_RANGES.some((r) => r.first === a && b >= r.lo && b <= r.hi);
}

interface RuleHit {
  readonly rule: Rule;
  readonly offsets: readonly number[];
  /** 命中原文（去重键的一半）；双投影命中时取还原后文本的那一份。 */
  readonly text: string;
}

/** 扫一份投影文本；返回每个规则的全部命中偏移与命中原文（finding 由调用方按规则聚合）。 */
function scanOne(text: string, rule: Rule): readonly { readonly offset: number; readonly text: string }[] {
  // 用 matchAll 而非 `while (re.exec(text))`：`matchAll` 内部管理副本的 lastIndex，
  // 不受调用方状态影响，也没有「零宽命中 → 原地重来」这一档（实测：一个 22 字符的
  // 命中就能让 exec 循环永远停在同一位、把 2 GB 堆吃光，见 docs/KNOWN-ISSUES.md）。
  const out: { offset: number; readonly text: string }[] = [];
  for (const m of text.matchAll(rule.re)) {
    if (rule.publicHostOnly === true && isPrivateIpv4(m[0])) continue;
    out.push({ offset: m.index ?? 0, text: m[0] });
  }
  return out;
}

/**
 * 双投影扫描：去掉 offsets 只在「首个投影（原文）」命中时保留——
 * 转义还原后的文本长度口径不同，偏移不可回指原文（与 egress-secret-scan 同纪律）。
 * 每个规则对每份投影的所有命中都返回（同一规则的不同命令各算一条），
 * 再由 applyDedup 按「规则 + 命中原文」去掉同一请求内的重复。
 */
/** 一份投影的偏移仅在原文投影（index 0）可回指原文，其余投影不报 offsets。 */
function offsetsFor(projectionIndex: number, withOffsets: boolean, offset: number): readonly number[] {
  return withOffsets && projectionIndex === 0 ? [offset] : [];
}

/**
 * 命中是否只是"在讨论这条规则"，而不是真的在调用（2026-11-25）。
 *
 * 立节理由（实测，与本仓库 0.6.1 修 PEM 误报同源）：`powershell-download-exec`
 * 原本只要求出现 `powershell -enc`。于是任何**讨论**这条规则的文本都被判危险并
 * 阻断整条请求——实测一次 1MB 的会话历史里，只因其中提到了 `powershell -enc`
 * 这个字符串，就被 `blocked_before_forward` 拦下 6 次，开发本项目的会话被自己的
 * 网关打死。同一段话里既有规则文档、又有测试断言，全部命中。
 *
 * 判据：真实调用 `-enc` / `-encodedcommand` 后面必须跟一段**base64 载荷**。
 * PowerShell 的 base64 参数是 UTF-16LE 命令编码后的结果，一条最短的可用命令
 * （如 `iex(...)`）也在几十个字符以上。所以要求：
 *   - 紧跟 `-enc` 之后是 base64 字符集，且**连续长度 ≥ MIN_ENC_PAYLOAD**；
 *   - 讨论文本里出现的 `-enc SQBFAFgA` 只有 8 个字符，不达阈值。
 *
 * 阈值取 12：文档/测试里最常见的示例值是 `SQBFAFgA`（8 字符，解出来是 `IEX`），
 * 必须排除；而实测 `SQBFAFgAIAAoAE4`（15 字符）是可信的最短真实形态，必须保留。
 * 12 落在两者之间——再高会漏掉 15 字符的真实调用，再低就会放行文档示例。
 */
const MIN_ENC_PAYLOAD = 12;

/**
 * `-enc` / `-encodedcommand` 后是否真有一份够长的 base64 载荷。
 *
 * 起点取**匹配串内部** `-enc` 之后的位置，而不是整段匹配的末尾：
 * `\b` 在 `-enc` 与空格之间不收尾，整段匹配可能吃掉一个后续字符，
 * 用 `offset + text.length` 会切错位（实测：切片落在 `c` 上，载荷被判成 1 字符）。
 */
function hasEncodedPayload(text: string, match: { readonly offset: number; readonly text: string }): boolean {
  const inMatch = /-(?:enc|encodedcommand)\b/i.exec(match.text);
  if (inMatch === null) return false;
  const from = match.offset + inMatch.index + inMatch[0].length;
  const m = /^[\s"']*([A-Za-z0-9+/=_-]+)/.exec(text.slice(from));
  return m !== null && (m[1] ?? "").length >= MIN_ENC_PAYLOAD;
}

/**
 * 该命中是否可上报（"讨论"不算）。
 *
 * 只有 powershell-download-exec 需要这层判断：它的 `-enc` 分支是唯一"字符串出现
 * ≠ 行为发生"的规则。`IEX(` 与 `DownloadString(` 是完整调用形态，照旧直报。
 */
function isReportableHit(rule: Rule, text: string, match: { offset: number; text: string }): boolean {
  if (rule.id === "powershell-download-exec") return isRealEncodedCall(text, match);
  if (rule.id === "credential-file-read") return isQuotedOrInlineCode(text, match);
  return true;
}

/** `-enc` 之后是否真跟着足够长的 base64 载荷（vs 文档里的短示例）。 */
function isRealEncodedCall(text: string, match: { offset: number; text: string }): boolean {
  if (!/-enc(?:odedcommand)?\b/i.test(match.text)) return true;
  return hasEncodedPayload(text, match);
}

/**
 * `credential-file-read` 的误报过滤：这次读凭据到底是**要执行**，还是**在谈论**。
 *
 * 实测背景（2026-11-26T12:00:47，本仓库自己的开发会话被拦 5 次）：
 * 当时正在讨论这条规则本身，请求体里带着 `cat ~/.ssh/id_rsa` 之类**示例文本**，
 * 请求体约 1MB（完整会话上下文）。规则按"读取命令 + 凭据路径"正确命中，
 * 但被谈论的命令不等于被执行的命令——网关没有执行任何东西。
 *
 * 判据：命中的文本若落在**反引号行内代码**或**双引号包裹**里，视为引用而非执行。
 *
 * 为什么这两种形态够用：
 *   - 真实 tool-call 的 `command` 字段是 JSON 字符串，`cat ~/.ssh/id_rsa` 两侧
 *     是 `"` 且**紧邻**（`"command":"cat ~/.ssh/id_rsa"`）。这里判的是匹配文本
 *     **自身**是否被引号包住，而不是它在 JSON 字符串里——后者恒为真，等于不判。
 *   - markdown 讨论几乎总用反引号。
 *
 * **承认的边界**：若 agent 直接在 prose 里写裸的 `cat ~/.ssh/id_rsa`（无反引号、
 * 无引号），仍会命中。这是刻意的——宁可漏判"谈论"也不放过"执行"，
 * 而反引号/引号是谈论方最自然的写法，执行方反而不加。
 */
function isQuotedOrInlineCode(text: string, match: { offset: number; text: string }): boolean {
  // ① JSON 工具调用：引号**紧邻字段名**（`"command":"cat ..."`、`"path":"~/.ssh/..."`）。
  //    这是执行形态，必须命中——判据看引号之外是不是字段名，而不是"有没有引号"。
  if (/"[a-z_]+"\s*:\s*"$/i.test(text.slice(Math.max(0, match.offset - 40), match.offset))) return true;
  // ② 两侧成对的引号 + 前面是空白/词（不是 `:`）= 句子引用，放行。
  //    对照：`"command":"cat ~/.ssh/id_rsa"` 的引号前是 `:` → 走 ① 命中。
  const before = text[match.offset - 1];
  const after = text[match.offset + match.text.length];
  if ((before === '"' && after === '"') || (before === "'" && after === "'")) {
    const beforeQuote = text.slice(Math.max(0, match.offset - 2), match.offset - 1);
    if (/[\s,;:!?]/.test(beforeQuote) || match.offset === 1) return false;
  }
  // ② 反引号行内代码：向前数未配对的反引号，奇数个说明在代码段内
  const lineStart = text.lastIndexOf("\n", match.offset) + 1;
  const ticks = (text.slice(lineStart, match.offset).match(/`/g) ?? []).length;
  return ticks % 2 === 0;
}

/**
 * 整体预筛：这段文本里**有没有任何一个**危险命令规则可能命中。
 *
 * 为什么不是逐规则 `includes`（实测教训）：单次 `includes` 在 512KB 上要 0.057ms，
 * 8 条规则 × 平均 3 个关键字 = 24 次 → **2.14ms**，比它想省的 1.9ms 还贵。
 * 而单字符 `includes` 只要 0.004ms（memchr），几个单字符就把绝大多数文本排除了。
 *
 * 覆盖性论证（每条规则命中时必然含下列至少一个字符）：
 *   - remote-pipe-exec / base64-pipe-exec / reverse-shell-pipe：必有 `|`
 *   - process-substitution-exec：`<(` 或 `$(`
 *   - powershell-download-exec：`IEX(` / `DownloadString(` 的 `(`，或 `-enc` / `-encodedcommand` 的 `-`
 *   - reverse-shell：`/dev/tcp/` 的 `/`
 *   - raw-ip-download：`://` 的 `/`
 *   - credential-file-read：`.ssh/` 之类必有 `.` 或 `/`
 *   - download-then-execute：`-O` 之类的 `-`，或路径里的 `/`
 * 因此必须包含 `-`（`powershell.exe -enc` 形态不含其它任何一个）。
 * 不放 `.`：它在任何含域名的文本里都有，排除力为零。
 *
 * **这条论证写错过一次**（实测：`powershell.exe -enc SQBFAFgA` 不含前五个字符，被误杀），
 * 所以这里是按"每条规则 × 每个分支"逐个核对的，不是凭直觉。
 */
function mayHitAnyRule(text: string): boolean {
  return (
    text.includes("|") ||
    text.includes("$") ||
    text.includes("<") ||
    text.includes("(") ||
    text.includes("/") ||
    text.includes("-")
  );
}

/** 文本是否可能命中该规则（常数级预筛；无 prefilter 时恒真）。 */
function mayMatch(text: string, rule: Rule): boolean {
  const keys = rule.prefilter;
  if (keys === undefined) return true;
  for (const key of keys) if (text.includes(key)) return true;
  return false;
}

/** 单条规则跨全部投影的命中。 */
function hitsForRule(texts: readonly string[], rule: Rule, withOffsets: boolean): readonly RuleHit[] {
  return texts.flatMap((text, i) => (mayHitAnyRule(text) && mayMatch(text, rule) ?
    scanOne(text, rule)
      // "讨论规则"不算命中：只有 powershell-download-exec 的 `-enc` 分支需要这层判断。
      .filter((m) => isReportableHit(rule, text, m))
      .map((m) => ({ rule, offsets: offsetsFor(i, withOffsets, m.offset), text: m.text }))
      : []),
  );
}

function scanTextsWithText(texts: readonly string[], withOffsets: boolean): readonly RuleHit[] {
  const ruleHits = RULES.flatMap((rule) => hitsForRule(texts, rule, withOffsets));
  const downloadHits = texts.flatMap((text, i) =>
    mayHitAnyRule(text)
      ? scanDownloadThenExecute(text).map((m) => ({ rule: DOWNLOAD_RULE, offsets: offsetsFor(i, withOffsets, m.offset), text: m.text }))
      : [],
  );
  return [...ruleHits, ...downloadHits];
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

/**
 * 同一请求内跨扫描单元的命中抑制（2026-11-24）：请求体里 `roles[*].content` 这类整组消息
 * （本机 DSH 会话实测：一次请求带全部历史 tool-result，同一条命令可重复出现数十次）会让
 * 每条命中都各自产出一条 finding，同一条交互的 tips（真危险命令）被噪声淹没。
 * 不变量：仍是纯函数——状态只活在一次判定内（调用方构造），不进模块级全局；
 * 去重键取规则 + 命中文本（同一规则同一文本只报一次，设计上不丢规则维度）。
 */
export interface DangerousCommandDedup {
  readonly seen: Set<string>;
  /**
   * 单个规则一次判定最多保留几条命中（0.6.0）。长 DSL 会话会把全部历史 tool-result 一起
   * 发上来，同一条规则可能命中几十处互不相同的文本；evidence 里堆 40 条同规则 finding
   * 会把真有价值的那条淹没。上限只截断**条数**，不改变判定（有命中仍是有命中）。
   */
  readonly perRuleCount: Map<string, number>;
}

/** 单规则 findings 上限（观测类噪声控制，非检测阈值）。 */
export const MAX_FINDINGS_PER_RULE = 5 as const;

export function createDangerousCommandDedup(): DangerousCommandDedup {
  return { seen: new Set<string>(), perRuleCount: new Map<string, number>() };
}

function applyDedup(hits: readonly (RuleHit & { readonly text: string })[], dedup?: DangerousCommandDedup): readonly RuleHit[] {
  if (dedup === undefined) return hits;
  // 既有命中（另一次调用产生）在新调用里仍作为既有事实出现一次：不清空、只记新键。
  const fresh = hits.filter((hit) => {
    const key = `${hit.rule.id}\u0000${hit.text}`;
    if (dedup.seen.has(key)) return false;
    dedup.seen.add(key);
    const n = (dedup.perRuleCount.get(hit.rule.id) ?? 0) + 1;
    dedup.perRuleCount.set(hit.rule.id, n);
    return n <= MAX_FINDINGS_PER_RULE;
  });
  return fresh;
}

/** 流式/非流式共用的纯文本判定（无 offsets 语义时传 false）。 */
function checkTexts(texts: readonly string[], withOffsets: boolean, dedup?: DangerousCommandDedup): CheckerResult {
  const findings = toFindings(applyDedup(scanTextsWithText(texts, withOffsets), dedup));
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

/**
 * 修复卡（0.6.0）：同一请求的请求侧与响应侧共用一份去重状态时，响应里复述请求中的同一命令
 * 不再二次告警。可选参数——不传时行为与 0.5.2 完全相同（纯函数契约不变）。
 */
export function checkDangerousCommandWithDedup(unit: ScanUnit, dedup: DangerousCommandDedup): CheckerResult {
  return checkTexts(scanTexts(unit), true, dedup);
}

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
  // 0.6.0：请求侧也要扫——凭据出境与投毒口令都从「请求里的 file_path / command」落地，
  // 只挂响应侧时这些内容从不进入判定面（见 docs/KNOWN-ISSUES.md 的 2026-11-24 条目）。
  sides: ["request", "response"],
  synchronous: true,
  safetyClass: false, // 文本规则有正例教程误报面 → finding=warn（policy mapBySpec 兜底）
  threat: THREAT,
  runNonStream: checkDangerousCommandNonStream,
  runStream: checkDangerousCommandStream,
} as const;
