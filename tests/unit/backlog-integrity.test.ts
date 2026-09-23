import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * R7-B2：`.sprint-state/bench-backlog.md` 是 bench 面 Minor 的唯一持久登记处，此前"ID 失联"只能靠走查
 * grep 发现——原登记文件 `.sprint-state/bench-rerecord-todo.md` 按其自述关闭条件在 `730f82e` 自毁、
 * 六个 ID 未在任何 tracked 载体承接，即该类事故。三条规格（本表要求实现前先定死）：
 *   ① 守卫放置：单测门 + CI 步骤。vitest 是 pre-commit 钩子与 `bun run test` 的必经门；R10R1-A-M1/C-M1
 *      另在 `.github/workflows/bench.yml` 的 bench job 加独立阻断步，使强制面覆盖到"绕过本地钩子直接进入
 *      main 的提交"这一升级前唯一的空档。该步由 R10R2-A-m2/B-2/C-m1 从"只跑本文件"扩为单测面，
 *      再由 R10R3-A-M1 定形为 `find` 三个根目录产出的**逐个文件路径**列表（判据公式与估计量口径的
 *      同源测试一并纳入；用例数随批次漂移故不在此写死，本机墙钟 <2s）。R10R4-B-M1 又补上该步的
 *      fail-loud 另一半：三个锚点目录任一缺失、或 find/sort 任一步非零退出，即刻 exit 1 并指名成因，
 *      不再以缩减后的文件集静默变绿。本步的文件集由 `find` 动态产出，故新增受测文件（如 R10R4-C-m4 的
 *      `bench/out-path-guard.test.ts`）自动进入 CI 阻断面，无需改本测试或改 workflow。
 *   ② 合法删除 vs 静默丢失：显式 ID 锁清单 + **超集**断言（比对表行 ID 列，不做整文件 substring 匹配，
 *      否则"行被删、ID 仍在正文他处被提及"会漏判）。本表惯例是"行不删、只改状态列"，
 *      因此锁清单等于全集；静默丢失（脚本自毁、误 revert、写截断）直接 fail，而**合法**裁剪某行必须
 *      同步下调锁清单——那是一个刻意、进 diff、走查可见的动作，守卫不阻止它也不假装能阻止。
 *   ③ 失败面：vitest 非零退出（本地 pre-commit + 任何全量测试运行 + CI bench job 的守卫步骤）。
 * 新增行无需改本测试（超集断言只增不严）。
 *
 * **能力边界**（成文优于假装覆盖，R10R1-A-N4/C-m2/B-R10-5）：
 *   - 本守卫只管"表行存在性"，**不管状态列的语义真伪**：把整列 `OPEN` 改写成 `已消化` 而实际未落地，
 *     它测不出。该面由走查（三位专家逐行核对状态列与本批落地清单）承担，不由字符串检查冒充。
 *   - ID 锁清单只覆盖表行首格的 `R…-…` 规范 ID。`OC-1`（观测待办）是正文 bullet、不在任何表行 ID 列内，
 *     故既不被收集也不被锁定——它的保全靠「R10 批次」小节的正文与本注释的点名，不属本守卫语义域。
 *   - "被 git 跟踪"一步在**环境缺件**时退化为跳过（warn）而非 fail：git 可执行文件缺失（spawn 失败），
 *     或整棵树没有 `.git`（status 128 + "not a git repository"）。两者都不是登记处丢失。与"git 在、仓在、
 *     文件未跟踪"（status 1）严格区分，后者必须 fail。
 *   - 本 parser 有两处与 GFM 的**有意偏差**，方向皆为"少认一张表 → 少一条断言"，不会造假红（R10R2-B-5
 *     成文）：分隔线单元含内部空格（`| -- -- |` 型）的 `|` 块不认作表格；`\\|`（双反斜杠紧跟竖线）被折叠进
 *     同一格，而 GFM 认作"转义反斜杠 + 列分隔符"而拆两格。两者当前登记处均无实例（`grep '^```'` = 0、
 *     分隔线一律 `|---|`），ID 丢失仍由锁清单兜底。
 *   - 围栏识别另有两处曾在 R10R2 引入、R10R3 已按 GFM 收口的偏差（A-m2 / B-m1 / B-m2）：闭合行带 info string
 *     （` ```ts `）不再被当闭合（此前其后示例表会变成幻影表 → 多认表，正是有害方向）；缩进 >3 空格的 ` ``` `
 *     行不再开启/闭合围栏（此前 4 空格缩进的缩进代码会被当围栏，把它后面的真实登记处表吞掉 → 假红）。
 *     现实现与 GFM 一致并由 fixture 固化；残余偏差是开启行的 info string 内容不做校验（GFM 只禁 ``` 围栏的
 *     info string 含反引号），当前无实例。
 *   - 行数棘轮常量**恒等于当前实测行数**（历史 55=55、68=68），且自 `R11R8-A-m1` / `B-m2` 起断言方向由
 *     "只增不减的 `≥`"改为**恒等**：文档一直主张等号而机器只守下界，于是"多出一行"（幻影表、正文竖排段被认成表、
 *     一行被拆成两行）全都不红，而这类形态恰恰会掩护同一批悄悄删掉另一行。任何合法改动（裁行 **或** 加行）都必须
 *     同批改本常量并进 diff（与下调锁清单同一动作，走查可见）。看到"常量 = 实测"不要反射式放宽——
 *     先确认动的是哪一行、为何动（登记处「状态列约定」同步成文此惯例，R10R3-A-m3/C-m1）。
 *     **恒等断言有两条独立盲区，不是一条**（`R11R9-A-M2` / `B-M5` 成文；此前只写了第一条，会让读者以为
 *     恒等已覆盖全部"多行"场景）：① 一批内同时 `+N` 行、`−N` 行的自我抵消；② 插一张行格皆规整的幻影表
 *     **并把本常量同向上调**（常量迁就幻影）。②不可机器判——本常量就是这条断言自身的意图，任何常量都可被
 *     同批改写，给它再加一条"常量变化量须等于净增行数"的元断言只是把可改写的常量挪了个位置。机器能保证的
 *     是那批**必须改本常量才会绿**，即它必然进 diff、走查必然看得见；登记处「行数棘轮约定」按此成文。
 *   - 表结构另有两条**互补**的行级断言，各自的盲区都成文写在对应 `it` 里：`unterminatedTableLines`
 *     只拦"以 `|` 起首却不以 `|` 收尾"这一类截断（`R11R7-SR-2`），首格形状断言只拦"首格既非规范 ID 也不在
 *     `IDLESS_ROW_CELLS`"这一类异形（`R11R8-C-M1`）。两者共同的残余是"拆出的后半格数、收尾、首格形状三件全合"，
 *     那已是内容错误而非结构破损，归上面第一条「能力边界」（语义真伪由走查判）。
 *     **两维互补的强度要说准**（`R11R9-A-M3` / `B-M6`）："被拆出的后半首格**必**为散文"不成立——拆点落在
 *     ID 单元内部时（`| R11R9-` 换行 `A-m1 | … |`）后半首格仍合 `ID_TOKEN` 形状，此时**只有**行数恒等能红。
 *     故准确表述是"身份维**通常**先红、数量维恒红"；反过来一张行格皆规整的幻影表**只有**恒等能红（锁清单
 *     是超集方向、白名单不自腐，两者对幻影都无增量）。
 *   - `IDLESS_ROW_CELLS` 是首格异形行的**唯一**豁免口，扩写它的标准（`R11R9-C-m1` 成文）：仅当登记处新增一行
 *     **刻意不带** `R…-…` ID 的说明行时才可加条目，且必须同批在登记处头部「三种计数的定义体」的差值算式里
 *     数到它——该断言要求白名单长度恒等于实测无 ID 行数，单独塞一条豁免而不造出真无 ID 行会直接红。
 *   - 自 `R11R9-A-M1` / `B-M1` / `C-M2` 起，本文件还管**批内交付物**两件：起点小节及其之后每批正文须含
 *     linux 三数记号、须申报与实测相等的 `限定词行数=N`。两条都只**数串**，不判语义：前者判"记号在不在"，
 *     一批写 `滤前 0 滤后 0 @@ 0` 照样绿，数对不对由走查复跑那条 git 命令判；后者判"申报与实测是否一致"，
 *     不判"这一行该不该带限定词"。即它们把旧措辞义务里**可数**的那一半抬进了 CI 阻断面，剩下那一半仍是散文。
 *     两条**同守 `startFound`**（起点小节标题被改 ⇒ 两条同时红，而不是第二条静默管零批——该不对称由
 *     `R11R10-SR-2` 的一次实跑探针暴露并补齐）。第一条按**整批正文**数记号：同一记号在该批出现多次时，
 *     删其中一处不红、须全删才红，故"报在同一条 bullet 里"仍只由头部那句散文条款管（严于本断言，刻意的）。
 */

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BACKLOG_REL = ".sprint-state/bench-backlog.md";

const LOCKED_IDS = [
  "R6-B2",
  "R6-B1",
  "R6-C2",
  "R6-A3",
  "R6-A2",
  "R6-B4",
  "R7-A-M2",
  "R7-A-M3",
  "R7-C-R2",
  "R7-B2",
  "R8-A-M1",
  "R8-A-M2",
  "R8-B-M1",
  "R8-B-M2",
  "R8-B-M3",
  "R8-C-R1",
  "R8-C-R2",
  "R2-X-1",
  "R2-A-M2",
  "R2-C-M1",
  "R2-B-2",
  "R2-C-M2",
  "R2-B-1",
  "R2-A-M3",
  "R9-A-1",
  "R9-A-2",
  "R9-A-3",
  "R9-B-1",
  "R9-C-M1",
  "R9-B-2",
  "R9R2-A-N1",
  "R9R2-B-1",
  "R9R2-B-2",
  "R9R2-B-3",
  "R9R2-B-4",
  "R9R2-B-5",
  "R9R2-B-6",
  "R9R2-C-1",
  "R9R2-C-2",
  "R10-A-M1",
  "R10-C-M1",
  "R10-B-3",
  "R10-B-1",
  "R10-A-N1",
  "R10-B-2",
  "R10-C-m4",
  "R10-A-N2",
  "R10-A-N3",
  "R10-C-m3",
  "R10-A-N4",
  "R10-C-m2",
  "R10-A-N5",
  "R10-A-N6",
  "R10-B-4",
  "R10-C-m1",
  "R10-B-5",
  "R10-C-m5",
  "R10R2-C-M1",
  "R10R2-A-m1",
  "R10R2-B-1",
  "R10R2-A-m2",
  "R10R2-B-2",
  "R10R2-C-m1",
  "R10R2-B-3",
  "R10R2-C-m2",
  "R10R2-A-m3",
  "R10R2-B-4",
  "R10R2-B-5",
  "R10R2-C-m3",
  "R10R2-A-m4",
  "R10R3-A-M1",
  "R10R3-A-m1",
  "R10R3-A-m2",
  "R10R3-A-m3",
  "R10R3-A-m4",
  "R10R3-A-N1",
  "R10R3-B-m1",
  "R10R3-B-m2",
  "R10R3-B-m3",
  "R10R3-B-m4",
  "R10R3-C-m1",
  "R10R3-C-m2",
  "R10R3-C-m3",
  "R10R4-B-M1",
  "R10R4-A-m1",
  "R10R4-C-m2",
  "R10R4-A-m2",
  "R10R4-B-m1",
  "R10R4-B-m2",
  "R10R4-C-m1",
  "R10R4-C-m3",
  "R10R4-C-m4",
  "R11-CI-1",
  "R10R5-A-m1",
  "R10R5-B-m2",
  "R10R5-A-m2",
  "R10R5-A-m3",
  "R10R5-B-m1",
  "R10R5-B-m3",
  "R10R5-C-m1",
  "R10R5-C-m2",
  "R11-SR-1",
  "R11R1-A-M1",
  "R11R1-A-M2",
  "R11R1-A-m1",
  "R11R1-A-m2",
  "R11R1-A-m3",
  "R11R1-A-m4",
  "R11R1-A-m5",
  "R11-INC-1",
  "R11R1-A-m6",
  "R11R1-B-M1",
  "R11R1-B-M2",
  "R11R1-B-m1",
  "R11R1-B-m2",
  "R11R1-B-m3",
  "R11R1-B-m4",
  "R11R1-B-m5",
  "R11R1-C-M1",
  "R11R1-C-M2",
  "R11R2-A-m1",
  "R11R2-A-m2",
  "R11R2-A-m3",
  "R11R2-B-m1",
  "R11R2-B-m2",
  "R11R2-B-m3",
  "R11R2-C-m1",
  "R11R2-C-m2",
  "R11R3-B-m1",
  "R11R3-B-m2",
  "R11R3-C-m1",
  "R11R3-C-m2",
  "R11R4-B-m1",
  "R11R4-B-m2",
  "R11R4-C-m1",
  "R11R4-C-m2",
  "R11R4-SR-1",
  "R11R5-A-m1",
  "R11R5-B-m1",
  "R11R5-B-m2",
  "R11R5-B-m3",
  "R11R5-B-m4",
  "R11R5-B-m5",
  "R11R5-C-m1",
  "R11R5-C-m2",
  "R11R6-A-M1",
  "R11R6-A-m1",
  "R11R6-B-m1",
  "R11R6-B-m2",
  "R11R6-B-m3",
  "R11R6-B-m4",
  "R11R6-B-m5",
  "R11R6-C-M1",
  "R11R6-C-M2",
  "R11R6-C-m1",
  "R11R6-C-m2",
  "R11R7-A-M1",
  "R11R7-A-m1",
  "R11R7-A-m2",
  "R11R7-A-m3",
  "R11R7-B-M1",
  "R11R7-B-M2",
  "R11R7-B-m1",
  "R11R7-B-m2",
  "R11R7-B-m3",
  "R11R7-B-m4",
  "R11R7-B-m5",
  "R11R7-C-m1",
  "R11R7-C-m2",
  "R11R7-C-m3",
  "R11R7-C-m4",
  "R11R7-SR-1",
  "R11R7-SR-2",
  "R11R8-A-M1",
  "R11R8-B-M1",
  "R11R8-B-M2",
  "R11R8-B-M3",
  "R11R8-C-M1",
  "R11R8-A-m1",
  "R11R8-B-m2",
  "R11R8-A-m2",
  "R11R8-B-m4",
  "R11R8-C-m1",
  "R11R8-B-m1",
  "R11R8-B-m7",
  "R11R8-B-m5",
  "R11R8-B-m6",
  "R11R8-B-m3",
  "R11R8-SR-1",
  "R11R9-A-M1",
  "R11R9-B-M1",
  "R11R9-C-M2",
  "R11R9-A-M2",
  "R11R9-B-M5",
  "R11R9-A-M3",
  "R11R9-B-M6",
  "R11R9-B-M2",
  "R11R9-B-M3",
  "R11R9-B-M4",
  "R11R9-B-M7",
  "R11R9-B-M8",
  "R11R9-C-M1",
  "R11R9-A-m1",
  "R11R9-B-m2",
  "R11R9-A-m2",
  "R11R9-C-m2",
  "R11R9-B-m1",
  "R11R9-A-m4",
  "R11R9-B-m3",
  "R11R9-B-m4",
  "R11R9-A-m3",
  "R11R9-A-m5",
  "R11R9-C-m1",
  "R11R10-SR-1",
  "R11R10-SR-2",
  "R11R10-SR-3",
] as const;

/** 规范 ID 记号；`R2-A-M2 / R2-C-M1` 型合写行按 `/` 拆开，`（并入 R8-B-M1）` 型说明格不入选。 */
const ID_TOKEN = /^R[A-Za-z0-9]*-[A-Za-z0-9-]+$/;

/**
 * ID 表里首格刻意**不写**规范 ID 的说明行（按整格全文匹配）。它就是登记处头部「三种计数的定义体」① 里
 * 那句"ID 格写成非 ID 的说明行"，也是差值算式中被减去的 `无 ID 行数`。
 * 新增这类行必须同批把整格文案登记进来 —— 与下调棘轮同型：刻意、进 diff、走查可见。每条又都被下面的
 * "白名单不自腐"断言要求仍能在文件里找到，所以删那行时漏删条目同样会红。
 * **扩写标准**（`R11R9-C-m1` 成文，防止本数组变成万能豁免口）：仅当登记处新增一行**刻意不带** `R…-…` ID 的
 * 说明行时才可加条目，且必须同批把它数进头部「三种计数的定义体」差值算式里的"无 ID 行数"——下面的
 * 长度对齐断言要求本数组长度恒等于实测无 ID 行数，所以"只想放行一条异形行"而没造出真无 ID 行，会直接红。
 */
const IDLESS_ROW_CELLS = ["（并入 R8-B-M1）"] as const;

/**
 * 拆一行表格。**转义 `\|` 不作分隔符**（R10R1-C-m1：旧实现裸 `split("|")`，一旦某格文案含 `\|`
 * 即凭空多出一格 → 格数断言假红）；行尾 `\|` 也不当收尾分隔符裁掉。
 */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i] ?? "";
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "|";
      i += 1;
      continue;
    }
    if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

interface MarkdownTable {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/**
 * 以 `|` 起首却不以 `|` 收尾的行 —— GFM 表格行必须单行，末格**内部**换行会把该行从中截断。
 * 围栏内不判（示例文本里的竖排行不归表格解析管，与 `parseTables` 同一口径）。
 * 本条存在的理由见 `R11R7-SR-2`：这类截断恰好在"格数与表头一致"断言的盲区里（截断点之后的格还留着，
 * 前半仍解析成满格数），所以它需要一条独立的、按**行**而非按**格**判的断言。
 * **本条的边界**（`R11R8-B-m3` / `C-M1` 成文，勿把"能红"读成"全覆盖"）：只拦"以 `|` 起首却不以 `|` 收尾"
 * 这一类；一行被拆成两行**且两行都以 `|` 收尾**时本条为绿，那类破坏改由首格形状断言（身份维）与行数**恒等**
 * 断言（数量维）拦，三条互不冗余、共同残余见各自 `it` 内注释。
 */
function unterminatedTableLines(md: string): string[] {
  const bad: string[] = [];
  let fence: { readonly ch: string; readonly len: number } | null = null;
  const lines = md.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const marker = fenceMarker(line, fence === null ? "open" : "close");
    if (fence !== null) {
      if (marker !== null && marker[0] === fence.ch && marker.length >= fence.len) fence = null;
      continue;
    }
    if (marker !== null) {
      fence = { ch: marker[0] ?? "`", len: marker.length };
      continue;
    }
    const t = line.trim();
    if (t.startsWith("|") && !t.endsWith("|")) bad.push(`${String(i + 1)}: ${t.slice(0, 40)}`);
  }
  return bad;
}

/**
 * 取一行的围栏标记（` ``` ` / `~~~` 前缀），按 GFM 判该行的**角色**（开启 or 闭合），不匹配返回 null。
 * 两条 GFM 规则是 R10R2 inFence 的欠账、R10R3 收口（A-m2 / B-m1 / B-m2）：
 *   - 缩进 >3 空格（tab 记 4）的 ` ``` ` 行是**缩进代码内容**，既不开启围栏也不闭合它；
 *   - 闭合行**不得带 info string** —— ` ```ts ` 在 GFM 里只是围栏内的一行文本，把它当闭合会让其后的
 *     示例表格变成幻影表（多认表 = 有害方向，正是 R10R2-A-m1 要堵的类）。
 */
function fenceMarker(raw: string, role: "open" | "close"): string | null {
  const lead = /^[ \t]*/.exec(raw)?.[0] ?? "";
  if (lead.replace(/\t/g, "    ").length > 3) return null;
  const t = raw.trim();
  const marker = /^(`{3,}|~{3,})/.exec(t)?.[0];
  if (marker === undefined) return null;
  if (role === "close" && new Set(t).size !== 1) return null;
  return marker;
}

/**
 * 按块解析 markdown 表格：连续 `|` 开头行构成一块，且第二行必须是全 `-`/`:` 分隔线，否则不视为表格
 * （正文里以 `|` 起始的引用行、ASCII 竖排段都不入表）。**代码围栏内的 `|` 行一律不入表**
 * （R10R2-A-m1/R10R2-B-1：文档示例表格会虚增棘轮行数——幻影行可掩护真实行被删，还会把缺「状态」列的
 * 示例表变成假红源）。围栏按 GFM：开启/闭合行的缩进均限 ≤3 空格（tab 记 4），闭合行须为同字符、
 * 不小于开启长度的**纯**标记串（带 info string 的行按 GFM 只是内容，R10R3-A-m2/B-m1/B-m2 收口）。
 */
function parseTables(md: string): MarkdownTable[] {
  const tables: MarkdownTable[] = [];
  let block: string[] = [];
  const flush = (): void => {
    if (block.length >= 2) {
      const header = splitRow(block[0] ?? "");
      const sep = splitRow(block[1] ?? "");
      if (sep.length > 0 && sep.every((c) => /^:?-+:?$/.test(c))) {
        tables.push({ header, rows: block.slice(2).map(splitRow) });
      }
    }
    block = [];
  };
  let fence: { readonly ch: string; readonly len: number } | null = null;
  for (const line of md.split(/\r?\n/)) {
    const t = line.trim();
    const marker = fenceMarker(line, fence === null ? "open" : "close");
    if (fence !== null) {
      if (marker !== null && marker[0] === fence.ch && marker.length >= fence.len) fence = null;
      flush();
      continue;
    }
    if (marker !== null) {
      fence = { ch: marker[0] ?? "`", len: marker.length };
      flush();
      continue;
    }
    if (t.startsWith("|")) block.push(t);
    else flush();
  }
  flush();
  return tables;
}

/**
 * 登记处的**backlog 表** = 表头首格为 `ID` 的表。列数与「状态」列位置一律**由表头推导**，不硬编码
 * （R10R1-A-N6：旧实现把 5 格写死，改表结构即假红）；无 `ID` 表头的表整体不参与断言。
 */
function backlogTables(md: string): MarkdownTable[] {
  return parseTables(md).filter((t) => (t.header[0] ?? "").trim() === "ID");
}

function idColumn(md: string): Set<string> {
  const out = new Set<string>();
  for (const table of backlogTables(md)) {
    for (const row of table.rows) {
      for (const part of (row[0] ?? "").split("/")) {
        const q = part.replace(/`/g, "").trim();
        if (ID_TOKEN.test(q)) out.add(q);
      }
    }
  }
  return out;
}

function allRows(md: string): { readonly table: MarkdownTable; readonly row: readonly string[] }[] {
  return backlogTables(md).flatMap((table) => table.rows.map((row) => ({ table, row })));
}

/**
 * ID 表里"看不出这是一条登记行"的首格：既不合 `ID_TOKEN` 形状（按 `/` 拆开后逐段判），也不在
 * `IDLESS_ROW_CELLS` 白名单内。空首格**不在本函数管辖**——那由「格数与 ID/状态非空」那条断言报，
 * 一处破坏只留一处红，归属才清楚（R11R8-C-M1 / B-m3 / A-m1）。
 */
function nonIdFirstCells(md: string): string[] {
  return allRows(md).flatMap(({ row }) => {
    const first = (row[0] ?? "").trim();
    if (first === "") return [];
    const parts = first.split("/").map((p) => p.replace(/`/g, "").trim());
    if (parts.every((p) => ID_TOKEN.test(p))) return [];
    return (IDLESS_ROW_CELLS as readonly string[]).includes(first)
      ? []
      : [`首格既非规范 ID 也不在 IDLESS_ROW_CELLS：[${first.slice(0, 46)}]`];
  });
}

/** 批次小节标题：`### …… 批次（……）`——登记处每一批的正文以此为界（`## 备注` 级不算）。 */
const BATCH_HEADING = /^### .+批次（/;

/** 一条义务从哪一批起受下面两条机器断言管辖。 */
const OBLIGATION_FROM = "### R11 R10 批次";

/**
 * linux 重跑义务的**三数记号**（`R11R9-A-M1` / `B-M1` / `C-M2` 三家同题的机器化）。
 * 旧判据的前件是"某批**宣布**本批无需重跑"——那是个需要读者识别的言语动作，"不宣布"（沉默、
 * 或改用"本批不涉及判据代码"这类同义说法）就在判据之外，是第五代逃逸。本条把判据换成
 * **该批正文里有没有这三个记号**：不再识别动作，只数串在不在。起点按**文档顺序**取，
 * 于是任何新批次自动落入管辖，无需自报"我是起算批"（那正是 `R11R8-SR-1` 起算批补丁的自指面，
 * 由 `R11R9-B-M2` 报出）。
 */
const LINUX_NUMBER_TOKENS = ["滤前", "滤后", "@@"] as const;

/** 状态列限定词（登记处「状态列约定」`R11R4-C-m1` 起）：纯措辞义务必须显式声明它不是机器门。 */
const QUALIFIER = "成文义务，非机器门";

interface BatchSection {
  readonly heading: string;
  readonly body: string;
}

/** 按 `### …… 批次（` 切批：返回每批的标题行与该批正文（到下一批标题或下一个 `## ` 小节为止）。 */
function batchSections(md: string): BatchSection[] {
  const out: { heading: string; body: string[] }[] = [];
  let cur: { heading: string; body: string[] } | null = null;
  for (const line of md.split(/\r?\n/)) {
    if (BATCH_HEADING.test(line)) {
      cur = { heading: line.trim(), body: [] };
      out.push(cur);
      continue;
    }
    if (/^##(?!#)/.test(line)) {
      cur = null;
      continue;
    }
    if (cur !== null) cur.body.push(line);
  }
  return out.map((s) => ({ heading: s.heading, body: s.body.join("\n") }));
}

/** 起点及其之后的所有批次小节；`startFound=false` 时由调用方判红，不静默返回空集。 */
function managedSections(md: string): { readonly startFound: boolean; readonly managed: readonly BatchSection[] } {
  const all = batchSections(md);
  const at = all.findIndex((s) => s.heading.startsWith(OBLIGATION_FROM));
  return { startFound: at >= 0, managed: at < 0 ? [] : all.slice(at) };
}

/** 一批正文里 linux 三数记号的缺项（空数组 = 该批齐）。 */
function missingLinuxTokens(section: BatchSection): string[] {
  return LINUX_NUMBER_TOKENS.filter((t) => !section.body.includes(t));
}

/** 该批各 ID 表里状态列含限定词的行数（状态列位置按表头推导，不硬编码格号）。 */
function qualifiedRows(body: string): number {
  let n = 0;
  for (const table of backlogTables(body)) {
    const idx = table.header.findIndex((h) => h.trim() === "状态");
    if (idx < 0) continue;
    for (const row of table.rows) {
      if ((row[idx] ?? "").includes(QUALIFIER)) n += 1;
    }
  }
  return n;
}

/** 该批「裁决口径」自报的 `限定词行数=N`；未申报返回 null（`R11R9-B-m3`：自报计数与实际不符的机器化）。 */
function declaredQualifierRows(body: string): number | null {
  const m = /限定词行数=(\d+)/.exec(body);
  return m === null ? null : Number(m[1]);
}

/** 删去某个 ID 的表行（按解析后的首格匹配，不按字面 `| ID |` 前缀——空格/转义变体同样要能删中）。 */
function dropRowWithId(md: string, id: string): string {
  const keep = md
    .split(/\r?\n/)
    .filter((line) => !(line.trim().startsWith("|") && (splitRow(line)[0] ?? "").trim() === id));
  return keep.join("\n");
}

describe("bench backlog 登记处完整性（R7-B2 机器守卫）", () => {
  const path = REPO_ROOT + BACKLOG_REL;

  it("登记处文件实存且非空（拦截按自毁条款删除整文件的事故形态）", () => {
    expect(existsSync(path), `${BACKLOG_REL} 必须存在`).toBe(true);
    expect(readFileSync(path, "utf8").trim().length).toBeGreaterThan(0);
  });

  it("登记处文件被 git 跟踪（拦截 `git rm` 后磁盘留档的半丢失形态）", () => {
    const r = spawnSync("git", ["-C", REPO_ROOT, "ls-files", "--error-unmatch", BACKLOG_REL], {
      encoding: "utf8",
    });
    // 三种"非丢失"红必须与真丢失区分（R10R1-A-N5）：git 可执行文件缺失（spawn 失败 → status null）、
    // 树无 .git（status 128 + "not a git repository"）皆为环境缺件 → warn 后跳过；
    // 而 git 在、仓在、文件未跟踪 → status 1，落下面的断言 fail（这才是本步要拦的形态）。
    const stderr = r.stderr ?? "";
    if (r.status === null || (r.status === 128 && /not a git repository/i.test(stderr))) {
      const why = r.status === null ? (r.error instanceof Error ? r.error.message : "spawn failed") : "not a repository";
      console.warn(`[backlog-integrity] git unavailable (${why}); tracked-check skipped`);
      return;
    }
    expect(r.status, `git ls-files 失败（status=${String(r.status)}）：${stderr.trim()}`).toBe(0);
  });

  it("锁清单中每个 ID 仍在登记处的 ID 列内（缺 ID 即 fail-loud）", () => {
    const ids = idColumn(readFileSync(path, "utf8"));
    const missing = LOCKED_IDS.filter((id) => !ids.has(id));
    expect(missing, `以下 backlog ID 已从 ${BACKLOG_REL} 的表行 ID 列消失；合法裁剪须同步下调 LOCKED_IDS`).toEqual([]);
  });

  it("每条数据行的格数与该表表头一致，且 ID/状态两格非空（拦截写截断与半行覆盖）", () => {
    const rows = allRows(readFileSync(path, "utf8"));
    // 行数棘轮：自 R11R8-A-m1/B-m2 起取**恒等**而非下界（常量名保留 `MIN_` 前缀是历史名，登记处多批按此名引用，
    // 改名会造出第二处口径）。登记处「行数棘轮约定」一直成文的是"常量**恒等于**实测"，而机器只守了 `≥`：
    // 于是"多出一行"（幻影表、把正文竖排段认成表、一行被拆成两行）全都不红，而这类形态恰恰会掩护
    // "同一批悄悄删掉另一行"。取等号后那条文档主张第一次有机读的那一半；剩余额度 = 登记处同条 bullet 里
    // 写明的**两条**已知盲区（`R11R9-A-M2` / `B-M5` 起由"仅剩一条"改写为并列两条）：① 一批内 `+N` 与 `−N`
    // 自我抵消（行数净变化为零）；② 常量迁就幻影表（同批插一张规整幻影表并把本常量同向上调）。
    // ② 不可由元断言承接：机器读的"常量"与"实测"是同一个表达式，同向上调恒绿，另立事实源即造第二数。
    // 两条都进 diff、由走查可见，不由本断言假装能拦。
    // 下界**恒取实测行数**（历史 55=55、68=68，其后各批同样恒等，见下一行注释）：这不是假红，而是设计（"合法裁剪必须同批
    // 改常量"的机器化）；见文件头「能力边界」末条与登记处「状态列约定」（R10R3-A-m3/C-m1 成文）。
    // 171 = R11 R8 批次后的实测数据行数（19 张 ID 表，该批新增 17 行 = `R11R7-A-*` 4 + `R11R7-B-*` 7 +
    // `R11R7-C-*` 4 + `R11R7-SR-*` 2；3 Major + 12 Minor + 自查 2）。
    // 187 = R11 R9 批次后的实测数据行数（20 张 ID 表，本批新增 16 行 = `R11R8-A-*` 3 + `R11R8-B-*` 10 +
    // `R11R8-C-*` 2 + `R11R8-SR-*` 1；5 Major + 10 Minor + 自查 1）。
    // 214 = R11 R10 批次后的实测数据行数（21 张 ID 表，本批新增 27 行 = `R11R9-A-*` 8 + `R11R9-B-*` 12 +
    // `R11R9-C-*` 4 + `R11R10-SR-*` 3；13 Major + 11 Minor + 自查 3）。
    // 注：行数 ≠ ID 数（214 行 / 216 ID），算式定义在登记处头部「三种计数的定义体」，此处只引不算第二源。
    const MIN_BACKLOG_ROWS = 214;
    expect(
      rows.length,
      `${BACKLOG_REL} 表行数 ≠ 棘轮常量 ${String(MIN_BACKLOG_ROWS)}（当前 ${String(rows.length)}）：` +
        `少行 = 静默丢失或合法裁剪未同批下调常量；多行 = 幻影表 / 竖排段被认成表 / 一行被拆成两行`,
    ).toBe(MIN_BACKLOG_ROWS);
    const malformed = rows.flatMap(({ table, row }) => {
      const problems: string[] = [];
      if (row.length !== table.header.length) {
        problems.push(`格数 ${String(row.length)} ≠ 表头 ${String(table.header.length)}：${row[0] ?? ""}`);
      }
      if ((row[0] ?? "").trim() === "") problems.push("ID 列为空");
      const statusIdx = table.header.findIndex((h) => h.trim() === "状态");
      if (statusIdx < 0) problems.push(`表头缺「状态」列：${table.header.join(",")}`);
      else if ((row[statusIdx] ?? "").trim() === "") problems.push(`状态列为空：${row[0] ?? ""}`);
      return problems;
    });
    expect(malformed, `表行结构不合该表表头契约`).toEqual([]);
  });

  it("表格行单行契约：以 `|` 起首的行须以 `|` 收尾（R11R7-SR-2，拦末格内换行的静默截断）", () => {
    const md = readFileSync(path, "utf8");
    const bad = unterminatedTableLines(md);
    expect(bad, `被换行截断的表行（尾部文字会脱离表格、不进入任何断言）：\n  ${bad.join("\n  ")}`).toEqual([]);
    // 防空转，并固化"为什么上一条断言不够"：把一条真表行的收尾 `|` 去掉，本条必须转红，而**格数不变**
    // ——即截断点之后的格仍在，上一条按格数判据看不见它（R11 R7 批落地时实测 `malformed=none`）。
    const lines = md.split(/\r?\n/);
    const target = lines.findIndex((l) => l.trim().startsWith("| R11R7-A-M1 "));
    expect(target, "自检前提失效：登记处里找不到 `R11R7-A-M1` 的表行").toBeGreaterThanOrEqual(0);
    const row = lines[target] ?? "";
    const cut = row.replace(/\|\s*$/, "");
    expect(cut.length, "自检前提失效：该行不以 `|` 收尾，fixture 无截断可造").toBeLessThan(row.length);
    expect(splitRow(cut).length, "截断后格数应仍等于截断前，否则上一条断言已覆盖本条、本条冗余").toBe(
      splitRow(row).length,
    );
    expect(unterminatedTableLines(md.replace(row, cut))).toHaveLength(1);
  });

  it("ID 表每行首格须合规范 ID 形状，或整格命中 IDLESS_ROW_CELLS（R11R8-C-M1 / B-m3 / A-m1）", () => {
    const md = readFileSync(path, "utf8");
    expect(nonIdFirstCells(md), "登记处出现无法识别为登记行的表行").toEqual([]);
    const rows = allRows(md);
    // 白名单不自腐：条目若已不在文件里（那行被合法裁掉却忘了同批删条目），本条转红。
    const stale = IDLESS_ROW_CELLS.filter((c) => !rows.some(({ row }) => (row[0] ?? "").trim() === c));
    expect(stale, `IDLESS_ROW_CELLS 有条目已不在登记处：${stale.join(", ")}`).toEqual([]);
    // 长度与「三种计数的定义体」的差值算式对齐：本数组长度 = 算式里的 `无 ID 行数`。
    // 判"有无 ID"只看首格 `/` 前的那一段（合写行 `R2-A-M2 / R2-C-M1` 的首段是规范 ID，不算无 ID 行）。
    const idlessRows = rows.filter(({ row }) => {
      const head = ((row[0] ?? "").trim().split("/")[0] ?? "").replace(/`/g, "").trim();
      return !ID_TOKEN.test(head);
    });
    expect(idlessRows.length, "无 ID 说明行数与 IDLESS_ROW_CELLS 长度不等").toBe(IDLESS_ROW_CELLS.length);

    // 防空转，并固化"本条与 SR-2 那条、与行数恒等那条**三者互不冗余**"：一条真行被换行**拆成两行**、两行都以
    // `|` 收尾且格数仍等于表头时，SR-2 那条（按行判收尾）与「格数与非空」那条**皆为绿**——本条从"身份"这一维
    // 红（拆出的后半首格是散文），行数恒等那条从"数量"那一维红（`+1` 行）。**"本条先红"不是恒真**
    // （`R11R9-A-M3` / `B-M6`）：拆点落在 ID 单元内部时（`| R11R9-` 换行 `A-m1 | … |`）后半首格仍合
    // `ID_TOKEN` 形状，本条为绿，只有恒等那条红。准确的分工是"身份维**通常**先红、数量维**恒**红"；
    // 反向一张行格皆规整的幻影表则**只有**恒等能红（锁清单超集方向与白名单不自腐对幻影都无增量）。
    // fixture 即前者的形态等价物（格数与表头一致、两行都以 `|` 收尾、行数变化不在本 fixture 的判据内）。
    const fixture = [
      "| ID | 位置 | 内容 | 来源 | 状态 |",
      "|---|---|---|---|---|",
      "| R9-Z-9 | bench/x.ts | 真行 | R9 A | 已消化 |",
      "| （被拆出的后半，首格是散文） | bench/x.ts | 补记 | R9 A | 已消化 |",
    ].join("\n");
    expect(nonIdFirstCells(fixture), "自检前提失效：fixture 里的散文首格没被判为异形").toHaveLength(1);
    expect(unterminatedTableLines(fixture), "本条要拦的正是 SR-2 那条看不见的形态，故此处必须为空").toEqual([]);
    expect(
      allRows(fixture).every(({ table, row }) => row.length === table.header.length),
      "同上：格数那条也看不见它，故 fixture 每行格数须仍等于表头",
    ).toBe(true);
    // **残余**（成文，不假装覆盖）：若拆出的后半同时满足"格数等于表头 + 以 `|` 收尾 + 首格形似规范 ID"，
    // 本条与 SR-2 那条都为绿。那已经不是一个**结构**破损而是一条**内容**错误（两行各自都像合法登记行），
    // 落在本文件头「能力边界」第一条（状态列语义真伪由走查判）的语义域内，不由字符串检查冒充。
  });

  it("自起点起的每一批正文须含 linux 义务三数记号（R11R9-A-M1 / B-M1 / C-M2 的机器化）", () => {
    const md = readFileSync(path, "utf8");
    const { startFound, managed } = managedSections(md);
    // 起点未命中 = 本条会静默管零批 → 必须红，且指名要改的是本常量而不是小节标题。
    expect(startFound, `登记处找不到起点小节「${OBLIGATION_FROM}…」；改标题须同批改本常量`).toBe(true);
    expect(managed.length, "起点之后零批次小节 = 本条空转").toBeGreaterThanOrEqual(1);
    const missing = managed.flatMap((s) => {
      const miss = missingLinuxTokens(s);
      return miss.length === 0 ? [] : [`${s.heading.slice(0, 30)} 缺记号：${miss.join("、")}`];
    });
    expect(
      missing,
      `${BACKLOG_REL} 里起点之后的某批未交付 linux 三数（\`滤前\`/\`滤后\`/\`@@\`）——` +
        `本条把"有没有报"从**识别言语动作**改成**数串在不在**，故沉默、同义改写、报在他条 bullet 都拦得住`,
    ).toEqual([]);

    // 防空转：起点后第二批缺 `@@` 必须红，补齐必须绿；且证明"起点之前不受管辖"这一支是真的。
    const before = ["### R11 R9 批次（旧批，不受管辖）", "正文只有 滤前 与 滤后。", ""].join("\n");
    const gap = `${before}### R11 R10 批次（起点）\n滤前 9 滤后 0。\n\n### R11 R11 批次（下一批）\n滤前 9 滤后 0 @@ 3。\n`;
    const fixed = gap.replace("滤前 9 滤后 0。\n", "滤前 9 滤后 0 @@ 3。\n");
    const gapManaged = managedSections(gap);
    expect(gapManaged.startFound, "fixture 前提失效：没命中起点").toBe(true);
    expect(gapManaged.managed.map((s) => s.heading), "起点之前那批不该入管辖").toEqual([
      "### R11 R10 批次（起点）",
      "### R11 R11 批次（下一批）",
    ]);
    expect(gapManaged.managed.flatMap(missingLinuxTokens), "缺 `@@` 的那批必须被点名").toEqual(["@@"]);
    expect(managedSections(fixed).managed.flatMap(missingLinuxTokens), "补齐后必须为绿").toEqual([]);
    // **残余**（成文，不假装覆盖）：本条只判**记号在不在**，不判**数对不对**——一批写 `滤前 0 滤后 0 @@ 0`
    // 也绿。数的真伪由走查复跑那条 git 命令判（与文件头「能力边界」第一条同一语义域）。
  });

  it("自起点起的每一批须申报「限定词行数=N」且与实测相等（R11R9-B-m3 的机器化）", () => {
    const md = readFileSync(path, "utf8");
    const { startFound, managed } = managedSections(md);
    // 与上一条同一形状：起点未命中 = 本条静默管零批。两条都要守，缺一条就是半套（`R11R10-SR-2` 的实跑发现）。
    expect(startFound, `登记处找不到起点小节「${OBLIGATION_FROM}…」；改标题须同批改本常量`).toBe(true);
    const problems = managed.flatMap((s) => {
      const declared = declaredQualifierRows(s.body);
      const measured = qualifiedRows(s.body);
      if (declared === null) return [`${s.heading.slice(0, 30)} 未申报 限定词行数=N`];
      return declared === measured ? [] : [`${s.heading.slice(0, 30)} 申报 ${String(declared)} ≠ 实测 ${String(measured)}`];
    });
    expect(
      problems,
      `${BACKLOG_REL} 的该批自报状态列限定词行数与实测不符或未申报——本条堵的是"自报计数靠自觉"` +
        `（Round 9 出卷方自报 9、评审员数出 15、实测 8，三个数只有本条能判谁对）`,
    ).toEqual([]);

    // 防空转：三类形态（相等 / 不等 / 未申报）各验一次，且状态列位置由表头推导（此处故意把状态放第 3 列）。
    const head = "| ID | 状态 | 位置 |\n|---|---|---|\n";
    const two = `| R9-Q-1 | 已消化（${QUALIFIER}） | bench/a.ts |\n| R9-Q-2 | 已消化（机器改动） | bench/b.ts |\n`;
    const sec = (decl: string): string => `### R11 R10 批次（起点）\n${head}${two}${decl}\n`;
    expect(qualifiedRows(`${head}${two}`), "fixture 前提失效：状态列第 2 列应数出 1 行").toBe(1);
    expect(declaredQualifierRows(sec("限定词行数=1")), "同上：申报值应可读").toBe(1);
    expect(managedSections(sec("限定词行数=1")).managed.flatMap((s) =>
      declaredQualifierRows(s.body) === qualifiedRows(s.body) ? [] : ["red"],
    )).toEqual([]);
    expect(managedSections(sec("限定词行数=7")).managed.flatMap((s) =>
      declaredQualifierRows(s.body) === qualifiedRows(s.body) ? [] : ["red"],
    )).toEqual(["red"]);
    expect(managedSections(sec("")).managed.flatMap((s) => (declaredQualifierRows(s.body) === null ? ["red"] : []))).toEqual([
      "red",
    ]);
    // **残余**：本条判"申报与实测是否一致"，**不判"该行该不该带限定词"**——后者是语义判断，仍归走查。
  });

  it("守卫自检（防空转）：ID 列覆盖锁清单，且人为删行形态确会被拦", () => {
    const md = readFileSync(path, "utf8");
    const ids = idColumn(md);
    // 超集方向：新增行无需改本测试；只拦"锁清单里的 ID 不见了"。
    expect(ids.size).toBeGreaterThanOrEqual(LOCKED_IDS.length);
    const victim = LOCKED_IDS[0] ?? "";
    const stripped = dropRowWithId(md, victim);
    expect(stripped.length, `未找到 ${victim} 的表行，自检前提失效`).toBeLessThan(md.length);
    expect(idColumn(stripped).has(victim)).toBe(false);
    expect(LOCKED_IDS.filter((id) => !idColumn(stripped).has(id))).toContain(victim);
  });

  it("解析器自检（防空转）：转义 `\\|` 不增格、非表格竖排行不入表", () => {
    // 直接在内存 fixture 上验，不依赖真实文件将来是否含 `\|`——C-m1 的假红形态由此固化。
    const fixture = [
      "| ID | 位置 | 内容 | 来源 | 状态 |",
      "|---|---|---|---|---|",
      "| R9-Z-1 | bench/x.ts | 文案含转义 `a \\| b` 与 `c\\|d` | R9 A | OPEN |",
      "",
      "正文里以 | 起始但不是表格的行 | 不该入表 |",
    ].join("\n");
    expect(splitRow("| a \\| b |")).toEqual(["a | b"]);
    const tables = backlogTables(fixture);
    expect(tables.length).toBe(1);
    expect(tables[0]?.rows.length).toBe(1);
    expect(tables[0]?.rows[0]?.[2]).toBe("文案含转义 `a | b` 与 `c|d`");
    expect(idColumn(fixture)).toEqual(new Set(["R9-Z-1"]));
  });

  it("解析器自检（防空转）：代码围栏内的示例表格不入表（R10R2-A-m1/R10R2-B-1）", () => {
    const fixture = [
      "文档里举的表示例（不是登记处行，不该计入棘轮）：",
      "```md",
      "| ID | 状态 |",
      "|---|---|",
      "| R9-FAKE-1 | OPEN |",
      "```",
      "| ID | 位置 | 内容 | 来源 | 状态 |",
      "|---|---|---|---|---|",
      "| R9-Z-2 | bench/y.ts | 真行 | R9 B | OPEN |",
      "```",
      "| ID | 状态 |",
      "|---|---|",
      "| R9-FAKE-2 | OPEN |",
    ].join("\n");
    const tables = backlogTables(fixture);
    expect(tables.length).toBe(1);
    expect(tables[0]?.rows.map((r) => r[0])).toEqual(["R9-Z-2"]);
    expect(idColumn(fixture)).toEqual(new Set(["R9-Z-2"]));
    // 未闭合围栏把其后内容一并排除（保守方向：少认表）——真实文件若被打断，行数棘轮断言会亮红，不会静默失守。
    expect(parseTables(fixture).length).toBe(1);
  });

  it("解析器自检（防空转）：围栏的 GFM 缩进与 info string 两条闭合规则（R10R3-A-m2/B-m1/B-m2）", () => {
    // ① 带 info string 的行按 GFM 只是围栏内容，不得充当闭合 → 其后的示例表**不该**入表。
    const infoString = [
      "```md",
      "```ts",
      "| ID | 状态 |",
      "|---|---|",
      "| R9-FAKE-TS | OPEN |",
      "```",
    ].join("\n");
    expect(fenceMarker("```ts", "close")).toBeNull();
    expect(fenceMarker("```", "close")).toBe("```");
    expect(parseTables(infoString).length, "闭合行带 info string → GFM 仍在围栏内，幻影表不得入表").toBe(0);
    expect(idColumn(infoString).has("R9-FAKE-TS")).toBe(false);
    // ② 4 空格缩进的 ``` 在 GFM 是缩进代码，不开启围栏 → 其后的**真实**表必须入表（少认 = 假红方向）。
    const indented = ["正文", "    ```", "| ID | 状态 |", "|---|---|", "| R9-REAL-IND | OPEN |", "    ```"].join("\n");
    expect(fenceMarker("    ```", "open")).toBeNull();
    expect(fenceMarker("   ```", "open"), "GFM 允许 ≤3 空格缩进的围栏").toBe("```");
    expect(idColumn(indented), "4 空格缩进行不该吞掉真表").toEqual(new Set(["R9-REAL-IND"]));
    // ③ 闭合的**配平**两支（同字符 + 长度 ≥ 开启长度）必须穿过 parseTables 验，不能只停在 fenceMarker
    //    的单元断言上（R10R4-B-m1：上一批此处的注释宣称"短的/异字符的闭合串不闭合"，实测把
    //    `marker[0] === fence.ch && marker.length >= fence.len` 整条删掉，①②两支与③的旧断言全部照样绿）。
    //    三组都是"开一条围栏 → 关不上 → 其后真表被吞"与"关得上 → 真表入表"的**成对**判别力。
    const after = ["| ID | 状态 |", "|---|---|", "| R9-AFTER-FENCE | OPEN |"];
    expect(fenceMarker("```", "close")).toBe("```"); // 单元层：3 反引号本身是合法闭合串，配平与否要看开启长度
    expect(parseTables(["````", "```", ...after].join("\n")).length, "3 反引号闭不了 4 反引号开启的围栏").toBe(0);
    expect(idColumn(["````", "```", "````", ...after].join("\n"))).toEqual(new Set(["R9-AFTER-FENCE"]));
    expect(parseTables(["~~~", "```", ...after].join("\n")).length, "反引号闭不了波浪号围栏").toBe(0);
    expect(idColumn(["~~~", "```", "~~~", ...after].join("\n"))).toEqual(new Set(["R9-AFTER-FENCE"]));
  });
});
