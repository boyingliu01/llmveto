import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * R7-B2：`.sprint-state/bench-backlog.md` 是 bench 面 Minor 的唯一持久登记处，此前"ID 失联"只能靠走查
 * grep 发现——原登记文件 `.sprint-state/bench-rerecord-todo.md` 按其自述关闭条件在 `730f82e` 自毁、
 * 六个 ID 未在任何 tracked 载体承接，即该类事故。三条规格（本表要求实现前先定死）：
 *   ① 守卫放置：单测门 + CI 步骤。vitest 是 pre-commit 钩子与 `bun run test` 的必经门；R10R1-A-M1/C-M1
 *      另在 `.github/workflows/bench.yml` 的 bench job 加独立阻断步（只跑本文件），使强制面覆盖到
 *      "绕过本地钩子直接进入 main 的提交"这一升级前唯一的空档。
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
] as const;

/** 规范 ID 记号；`R2-A-M2 / R2-C-M1` 型合写行按 `/` 拆开，`（并入 R8-B-M1）` 型说明格不入选。 */
const ID_TOKEN = /^R[A-Za-z0-9]*-[A-Za-z0-9-]+$/;

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
 * 按块解析 markdown 表格：连续 `|` 开头行构成一块，且第二行必须是全 `-`/`:` 分隔线，否则不视为表格
 * （正文里以 `|` 起始的引用行、ASCII 竖排段都不入表）。
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
  for (const line of md.split(/\r?\n/)) {
    if (line.trim().startsWith("|")) block.push(line.trim());
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
    // 行数棘轮：只增不减。裁剪行须同步下调本常量——与下调锁清单同样是刻意且进 diff 的动作。
    const MIN_BACKLOG_ROWS = 55;
    expect(rows.length, `${BACKLOG_REL} 表行数低于棘轮下界 ${String(MIN_BACKLOG_ROWS)}（当前 ${String(rows.length)}）`).toBeGreaterThanOrEqual(
      MIN_BACKLOG_ROWS,
    );
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
});
