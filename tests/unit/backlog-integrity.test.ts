import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * R7-B2：`.sprint-state/bench-backlog.md` 是 bench 面 Minor 的唯一持久登记处，此前"ID 失联"只能靠走查
 * grep 发现——原登记文件 `.sprint-state/bench-rerecord-todo.md` 按其自述关闭条件在 `730f82e` 自毁、
 * 六个 ID 未在任何 tracked 载体承接，即该类事故。三条规格（本表要求实现前先定死）：
 *   ① 守卫放置：单测门。本仓库 CI 只有 bench.yml（无 test job），而 vitest 是 pre-commit 钩子与
 *      `bun run test` 的必经门，故守卫放在这里；不新增 workflow 步骤，避免触碰 CI 门禁面。
 *   ② 合法删除 vs 静默丢失：显式 ID 锁清单 + **超集**断言（比对表行 ID 列，不做整文件 substring 匹配，
 *      否则"行被删、ID 仍在正文他处被提及"会漏判）。本表惯例是"行不删、只改状态列"，
 *      因此锁清单等于全集；静默丢失（脚本自毁、误 revert、写截断）直接 fail，而**合法**裁剪某行必须
 *      同步下调锁清单——那是一个刻意、进 diff、走查可见的动作，守卫不阻止它也不假装能阻止。
 *   ③ 失败面：vitest 非零退出（本地 pre-commit + 任何全量测试运行）。
 * 新增行无需改本测试（超集断言只增不严）。
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
] as const;

/** 表数据行 = 以 `|` 开头、且首格既非表头 `ID` 也非分隔线的行；本文件所有表均为 5 列。 */
function tableRows(md: string): string[][] {
  const rows: string[][] = [];
  for (const line of md.split(/\r?\n/)) {
    const s = line.trim();
    if (!s.startsWith("|")) continue;
    const cells = s
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
    const first = cells[0] ?? "";
    if (first === "ID" || /^[-:\s]+$/.test(first)) continue;
    rows.push(cells);
  }
  return rows;
}

/** 规范 ID 记号；`R2-A-M2 / R2-C-M1` 型合写行按 `/` 拆开，`（并入 R8-B-M1）` 型说明格不入选。 */
const ID_TOKEN = /^R[A-Za-z0-9]*-[A-Za-z0-9-]+$/;

/** 只取表行的 **ID 列**：整文件 substring 匹配会漏判"行被删但 ID 在正文他处仍被提及"的形态。 */
function idColumn(md: string): Set<string> {
  const out = new Set<string>();
  for (const cells of tableRows(md)) {
    for (const part of (cells[0] ?? "").split("/")) {
      const q = part.replace(/`/g, "").trim();
      if (ID_TOKEN.test(q)) out.add(q);
    }
  }
  return out;
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
    expect(r.status, `git ls-files 失败（status=${r.status}）：${r.stderr?.trim() ?? "git 不可用"}`).toBe(0);
  });

  it("锁清单中每个 ID 仍在登记处的 ID 列内（缺 ID 即 fail-loud）", () => {
    const ids = idColumn(readFileSync(path, "utf8"));
    const missing = LOCKED_IDS.filter((id) => !ids.has(id));
    expect(missing, `以下 backlog ID 已从 ${BACKLOG_REL} 的表行 ID 列消失；合法裁剪须同步下调 LOCKED_IDS`).toEqual([]);
  });

  it("每条数据行为 5 格且 ID/状态非空（拦截写截断与半行覆盖）", () => {
    const rows = tableRows(readFileSync(path, "utf8"));
    // 行数棘轮：只增不减。裁剪行须同步下调本常量——与下调锁清单同样是刻意且进 diff 的动作。
    const MIN_BACKLOG_ROWS = 37;
    expect(rows.length, `${BACKLOG_REL} 表行数低于棘轮下界 ${MIN_BACKLOG_ROWS}（当前 ${rows.length}）`).toBeGreaterThanOrEqual(
      MIN_BACKLOG_ROWS,
    );
    const malformed = rows.filter((c) => c.length !== 5 || c[0] === "" || c[4] === "");
    expect(malformed, `表行须为「ID | 位置 | 内容 | 来源 | 状态」5 格`).toEqual([]);
  });

  it("守卫自检（防空转）：ID 列覆盖锁清单，且人为删行形态确会被拦", () => {
    const md = readFileSync(path, "utf8");
    const ids = idColumn(md);
    // 超集方向：新增行无需改本测试；只拦"锁清单里的 ID 不见了"。
    expect(ids.size).toBeGreaterThanOrEqual(LOCKED_IDS.length);
    const victim = LOCKED_IDS[0] ?? "";
    const stripped = md
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith(`| ${victim} |`))
      .join("\n");
    expect(stripped.length, `未找到 ${victim} 的表行，自检前提失效`).toBeLessThan(md.length);
    expect(idColumn(stripped).has(victim)).toBe(false);
    expect(LOCKED_IDS.filter((id) => !idColumn(stripped).has(id))).toContain(victim);
  });
});
