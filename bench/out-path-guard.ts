// 基线写入路径守卫（从 record-baseline.ts 抽出为可测模块，R10R4-C-m4）。
//
// 为什么要抽：这条判据自 R8 起连续五轮被走查出**路径形态类**缺陷（大小写变体、8.3 短名、符号链接、
// UNC/admin-share、硬链接、NTFS 备用数据流、宿主折叠、尾冒号空流名…），而**每一轮的证据都只有人工
// 探针**——`record-baseline.ts` 是可执行脚本、不在 vitest 的 include 面（`tests/**`、`bench/**.test.ts`），
// 重构守卫段极易静默丢掉某条判据而不被守卫面捕获。抽成模块 + 配单测后，形态矩阵进 CI 阻断步。
//
// 信任边界（docs/adr/0002 补遗一·写入路径守卫）：放行判据是 `isCi`（= `process.env.CI === "true"`），
// 即信任 CI 平台注入该变量。本模块防**误操作**，不是防篡改的安全控制。
import { accessSync, constants, existsSync, realpathSync, statSync } from "node:fs";
import { platform } from "node:os";
import { dirname, resolve } from "node:path";

/** 权威基线在 repo 内的 tracked 路径——保真锚点（docs/adr/0002 补遗三）。 */
export const TRACKED_BASELINE = "bench/baseline.json";

/**
 * 折叠**宿主**（R10R2-C-M1）：win32 上 `:` 只可能来自 NTFS 备用数据流引用（文件名本身禁用该字符）。
 * realpath 与 statSync 对**尚不存在**的流一律 ENOENT → 名字与身份双判据同时为假，
 * `bench/baseline.json:<任意新流名>` 即可穿透守卫、把整份基线写进受保护文件的备用流（此前"ADS 已收口"
 * 仅对**已存在**的流名成立）。故折叠前把末段首个 `:` 及其后的全部流后缀剥掉（多级流
 * `baseline.json:a:b` 一并剥净），把判定对象折回宿主文件。合法路径的末段不含 `:`，此步恒等 —— 只增拒绝，
 * 不放宽任何既有判定。posix 上 `:` 是普通文件名字符，且 realpath 本就能区分该文件与 tracked，故不剥离。
 *
 * `plat` 形参为测试注入点（默认取真实平台）：CI 跑在 linux，若判据只读 `platform()`，win32 分支在
 * CI 上永远不可达 → 流形态这条最脆的判据依然只剩人工探针。
 */
export function hostPath(p: string, plat: string = platform()): string {
  if (plat !== "win32") return p;
  const sep = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  // 末段之外的冒号属于盘符（`C:`）或 UNC 共享根（`\\srv\share`），不是流分隔符。
  const start = sep === -1 && /^[A-Za-z]:/.test(p) ? 2 : sep + 1;
  const colon = p.indexOf(":", start);
  return colon === -1 ? p : p.slice(0, colon);
}

/**
 * 把同一文件的多种**名字**写法折叠为同一字符串：优先文件系统解析（realpath 解引用 symlink、按平台原生
 * 规则取回真实大小写与长名，含 8.3 短名 → 长名），目标尚不存在或不可解析时退化为词法 resolve；两条分支
 * 之后一律在大小写不敏感平台（win32/darwin 默认 FS）折叠大小写。
 */
export function canonicalPath(p: string, plat: string = platform()): string {
  let canonical: string;
  try {
    canonical = realpathSync.native(p);
  } catch {
    canonical = resolve(p);
  }
  return plat === "win32" || plat === "darwin" ? canonical.toLowerCase() : canonical;
}

/**
 * `stat` → 身份串。**单独成函数**是为了让 `ino === 0` 这条退让进入受测面（R10R4-C-m4 的同一动机）：
 * 真实文件系统要报出 0 需要 9p / 部分网络盘，CI（ubuntu-latest）造不出来，没有这个注入点，
 * "两个不同文件在哨兵文件系统上假等" 这条判据就只剩人工探针。
 * `win32` 上 `\\.\NUL` 是一个**真实存在且报 ino=0** 的路径（实测 `dev=0 ino=0`），故端到端一侧
 * 由 `out-path-guard.test.ts` 的 `it.runIf(win32)` 用例锚定；本函数负责平台无关的那一半。
 */
export function identityOf(st: { readonly dev: number; readonly ino: number }): string | null {
  return st.ino === 0 ? null : `${st.dev}:${st.ino}`;
}

/**
 * 折叠**身份**（R10R1-B-1：路径归一只折叠名字，同一字节另有名字时折叠不掉）。`dev:ino` 由 libuv 在
 * 三平台统一暴露——win32 下即卷序列号 + FileId（非"win32 无 inode"）。实测 win32/NTFS 上硬链接、
 * NTFS 备用数据流、UNC/admin-share（`\\localhost\d$\…`）三类别名形态的 dev/ino 与 tracked 文件全等，
 * `\\?\` 设备命名空间与 `subst` 盘则本就被 realpath 折叠。任一路径 stat 失败（尚不存在，或 ACL 令读取被拒）、
 * 或文件系统不报文件 ID（`ino === 0` 哨兵，见 `identityOf`）→ null，该条判据退让给路径折叠。
 * 退让**不是**同一回事（R10R3-A-m4/B-m3/C-m2）：out 侧 stat 失败是合法高频场景（首次录制目标尚不存在），
 * 告警会刷屏，故保持静默；tracked 侧 stat 失败即异常事件且使全部别名形态失效，另加定向告警。
 */
export function fileIdentity(p: string): string | null {
  try {
    return identityOf(statSync(p));
  } catch {
    return null;
  }
}

/**
 * 区分 `fileIdentity` 返回 null 的两种成因：stat 抛错（异常，值得告警）vs 文件系统不报文件 ID
 * （`ino === 0` 哨兵，正常降级，不该告警）。
 */
export function statThrows(p: string): boolean {
  try {
    statSync(p);
    return false;
  } catch {
    return true;
  }
}

/** 命中受保护 tracked 基线时的三种理由形态（拒绝文案按此分支措辞）。 */
export type RefusalVia = "stream" | "alias" | "tracked";

/**
 * argv 层面的形态校验（与"是不是受保护文件"无关，纯粹是"这根本不是一个 out 路径参数"）。
 * 放在模块里而不是脚本里，是为了让它和守卫的其余判据进同一个受测面（R10R4-C-m4）——此前这两条
 * throw 只存在于不可被 vitest 触及的可执行脚本中。
 */
export function assertOutPathArg(outPath: string): void {
  if (outPath.trim() === "") {
    // `bun run` 会剥掉空 argv（落到"无参"分支），故空串一支只在直接以 node 调用时可达——两入口差异见
    // docs/adr/0002 验证节，避免读者以 `bun run bench:record ""` 观测不到而误判守卫未生效。
    throw new Error(
      `empty out path: bench:record takes an optional non-empty out path only ` +
        `(e.g. \`bun run bench:record bench/baseline.local.json\`)`,
    );
  }
  if (outPath.startsWith("-")) {
    throw new Error(
      `unknown flag ${outPath}: bench:record takes an optional out path only ` +
        `(e.g. \`bun run bench:record bench/baseline.local.json\`)`,
    );
  }
}

export interface OutPathFate {
  readonly outPath: string;
  readonly outHost: string;
  readonly sameName: boolean;
  readonly sameInode: boolean;
  /** 身份判据是否**整体缺席**（tracked 侧 stat 抛错，而非 `ino === 0` 的正常降级）——仅此情形告警。 */
  readonly identityAbsent: boolean;
  /** 非 null = 该 out 路径落在受保护基线上（宿主/名字/身份任一折叠后同判）。 */
  readonly refusal: RefusalVia | null;
}

/**
 * 判定 out 路径是否落在 tracked 基线上（**不**看 CI；调用方按 `isCi` 决定是否据此拒绝）。
 * 宿主折叠**先于**名字与身份两条判据生效。
 */
export function inspectOutPath(
  outPath: string,
  opts: { readonly tracked?: string; readonly plat?: string } = {},
): OutPathFate {
  const tracked = opts.tracked ?? TRACKED_BASELINE;
  const plat = opts.plat ?? platform();
  const outHost = hostPath(outPath, plat);
  const sameName = canonicalPath(outHost, plat) === canonicalPath(tracked, plat);
  const outIdentity = fileIdentity(outHost);
  const trackedIdentity = fileIdentity(tracked);
  const sameInode = outIdentity !== null && outIdentity === trackedIdentity;
  const refusal: RefusalVia | null = !(sameName || sameInode)
    ? null
    : outHost !== outPath
      ? "stream"
      : sameInode && !sameName
        ? "alias"
        : "tracked";
  return {
    outPath,
    outHost,
    sameName,
    sameInode,
    identityAbsent: trackedIdentity === null && statThrows(tracked),
    refusal,
  };
}

/** 拒绝文案。三种理由措辞：受保护文件的备用数据流引用 / 同 inode 的别名路径 / tracked 本名。 */
export function refusalMessage(via: RefusalVia): string {
  const suffix =
    via === "stream"
      ? " (an NTFS alternate data stream of it)"
      : via === "alias"
        ? " (same file identity via an alias path)"
        : "";
  return (
    `refusing to overwrite the tracked authoritative baseline${suffix} outside CI: pass an explicit out path ` +
    `(e.g. \`bun run bench:record bench/baseline.local.json\`); authoritative re-record is the CI record job (docs/adr/0002)`
  );
}

/**
 * 写可达性预检（R10R3-B-m4/C-m1）：守卫只管 tracked 家族，不校验"这个 out 路径写不写得下去"。
 * 错拼目录 / 只读卷 / 空宿主（`:stream` 折叠后）此前要跑满 10×3 采样才在 writeFileSync 处 ENOENT，
 * 白烧约 90s 且失败信号指向错误。改为采样前即刻 throw。**不做创建探测**（不 mkdir、不 touch、
 * 不以 "a" 模式打开——那会留下 0 字节文件或改动 mtime），也不宣称消除 TOCTOU：预检与写之间的窗口
 * 与残余①②同型，本步只把"必然失败"提前到失败最便宜处。
 *
 * 平台边界（R10R4-B-m2 成文）：目录侧的 `W_OK` 在 win32 近乎恒真——libuv 的 `fs.access` 只看只读
 * **属性**且对目录忽略该属性，故 ACL deny 的目录会假阳性放行（后果仅退回"跑满采样后 ENOENT"的旧行为，
 * 无正确性损失）；Linux（CI 与 record job 所在处）由内核 `access(2)` 真拦。文件侧的 `W_OK` 两平台都可靠。
 */
export function assertWritableOutPath(
  fate: OutPathFate,
  plat: string = platform(),
): void {
  const { outPath, outHost } = fate;
  if (outHost.trim() === "") {
    throw new Error(
      `invalid out path ${outPath}: its host is empty (a bare ":stream" suffix has no file to write to)`,
    );
  }
  // NTFS 流名的字面约束（R10R4-A-m2）：宿主折叠后剩下的后缀若是 `:` + (空串 | 含冒号)，该路径**写不出**
  // 任何东西——实测 `f:`、`f::`、`f:a:b` 三种形态即使宿主存在也一律 ENOENT（`f:tag`、`f:$DATA` 才合法）。
  // 此前预检只看宿主，这三类穿过预检、跑满 10×3 采样才在 writeFileSync 处失败，正是本函数要消灭的形态。
  // posix 上 `:` 是普通文件名字符（且 hostPath 恒等 → 后缀为空），故整条判据只在 win32 生效。
  if (plat === "win32" && outHost !== outPath) {
    const stream = outPath.slice(outHost.length + 1);
    if (stream === "" || stream.includes(":")) {
      throw new Error(
        `invalid out path ${outPath}: an NTFS alternate data stream name must be non-empty and contain no ':' ` +
          `(this form always fails with ENOENT, even when the host file exists)`,
      );
    }
  }
  const dir = dirname(outHost);
  if (!existsSync(dir)) {
    throw new Error(
      `out path ${outHost}: parent directory ${dir} does not exist (create it first; bench:record never mkdirs)`,
    );
  }
  try {
    accessSync(dir, constants.W_OK);
  } catch (e) {
    throw new Error(`out path ${outHost}: parent directory ${dir} is not writable (${String(e)})`);
  }
  if (existsSync(outHost)) {
    if (!statSync(outHost).isFile()) {
      throw new Error(`out path ${outHost} exists but is not a regular file`);
    }
    try {
      accessSync(outHost, constants.W_OK);
    } catch (e) {
      throw new Error(`out path ${outHost} is not writable (${String(e)})`);
    }
  }
}
