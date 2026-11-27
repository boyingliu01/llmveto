import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadWatchList } from "../../../src/audit/watch-list.ts";

// @test REQ-V3-02
// @intent 读用户声明的 agent 清单。
//
//         **三种失败都不能是 PASS**（设计 D-04）：文件不存在、JSON 损坏、清单为空。
//         PASS 意味着"检查过且没问题"，没检查过的东西不能报 PASS——
//         这是本项目反复出现的教训（coverageOf / persistState / Gate 8 的 reason:""）。
//
//         本模块**不引入任何采集机制**：只读用户自己写的清单。
//         它不做绕过检测，也不假装知道网关外发生了什么。

let dirs: string[] = [];
function temp(content?: string): string {
  const d = mkdtempSync(join(tmpdir(), "watch-"));
  dirs.push(d);
  const f = join(d, "watched.json");
  if (content !== undefined) writeFileSync(f, content, "utf8");
  return f;
}
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe("正常加载", () => {
  it("读取 agents 与 window_days", () => {
    const r = loadWatchList(temp(JSON.stringify({ schema_version: 1, agents: ["a", "b"], window_days: 14 })));
    expect(r.status).toBe("ok");
    expect(r.agents).toEqual(["a", "b"]);
    expect(r.windowDays).toBe(14);
  });

  it("window_days 缺省为 7", () => {
    const r = loadWatchList(temp(JSON.stringify({ schema_version: 1, agents: ["a"] })));
    expect(r.windowDays).toBe(7);
  });

  it("去重但保持顺序", () => {
    const r = loadWatchList(temp(JSON.stringify({ schema_version: 1, agents: ["b", "a", "b"] })));
    expect(r.agents).toEqual(["b", "a"]);
  });
});

describe("三种失败都不是 PASS（设计 D-04）", () => {
  it("文件不存在 → status=absent（doctor 报 SKIP，不是 PASS）", () => {
    const r = loadWatchList(temp());
    expect(r.status).toBe("absent");
    expect(r.agents).toEqual([]);
  });

  it("JSON 损坏 → status=invalid 并带错误信息", () => {
    const r = loadWatchList(temp("{ not json"));
    expect(r.status).toBe("invalid");
    expect(r.error).toBeDefined();
  });

  it("声明为空数组 → status=empty（不是 ok）", () => {
    const r = loadWatchList(temp(JSON.stringify({ schema_version: 1, agents: [] })));
    expect(r.status).toBe("empty");
  });

  it("缺 agents 字段 → invalid", () => {
    expect(loadWatchList(temp(JSON.stringify({ schema_version: 1 }))).status).toBe("invalid");
  });

  it("agents 不是数组 → invalid", () => {
    expect(loadWatchList(temp(JSON.stringify({ schema_version: 1, agents: "a,b" }))).status).toBe("invalid");
  });

  it("agents 含非字符串元素 → invalid", () => {
    expect(loadWatchList(temp(JSON.stringify({ schema_version: 1, agents: ["a", 1] }))).status).toBe("invalid");
  });
});

describe("window_days 校验", () => {
  it("超出 1..90 → invalid（不是静默钳制）", () => {
    expect(loadWatchList(temp(JSON.stringify({ schema_version: 1, agents: ["a"], window_days: 0 }))).status).toBe("invalid");
    expect(loadWatchList(temp(JSON.stringify({ schema_version: 1, agents: ["a"], window_days: 91 }))).status).toBe("invalid");
  });

  it("边界值 1 和 90 → ok", () => {
    expect(loadWatchList(temp(JSON.stringify({ schema_version: 1, agents: ["a"], window_days: 1 }))).status).toBe("ok");
    expect(loadWatchList(temp(JSON.stringify({ schema_version: 1, agents: ["a"], window_days: 90 }))).status).toBe("ok");
  });

  it("非整数 → invalid", () => {
    expect(loadWatchList(temp(JSON.stringify({ schema_version: 1, agents: ["a"], window_days: 7.5 }))).status).toBe("invalid");
  });
});

describe("schema_version", () => {
  it("未知版本 → invalid", () => {
    expect(loadWatchList(temp(JSON.stringify({ schema_version: 2, agents: ["a"] }))).status).toBe("invalid");
  });
});

describe("不做大小写归一（设计 D-02）", () => {
  it("Codex 与 codex 是两个不同的 id（归一化会制造假匹配）", () => {
    const r = loadWatchList(temp(JSON.stringify({ schema_version: 1, agents: ["Codex", "codex"] })));
    expect(r.agents).toEqual(["Codex", "codex"]);
  });
});
