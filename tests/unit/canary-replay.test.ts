import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// @test P1-1
// @intent canary 注入回放工具的三判据必须**可失败**：正常语料 PASS，篡改注入语义后 FAIL。
//         只断言 PASS 等价于假绿灯——本项目已两次踩过"看起来生效、实则静默不执行"的坑
//         （detect-secrets 缺 baseline、gitleaks 自定义配置），故此处同时钉住两个方向。
//
// 工具用纯 JS 写并 import dist/（见 ADR-0001：`.ts` 源码含 Node strip-only 不支持的语法），
// 因此本测试同样经由 dist 运行；CI 的 `npm run build` 在生产链上已有保障。

const ROOT = join(import.meta.dirname, "..", "..");
const SCRIPT = join(ROOT, "scripts", "canary-replay.mjs");
const OUT_DIR = join(ROOT, "dist");

let corpusDir: string;

/** 一条最小但形态真实的录制：单会话、单 exchange。 */
function writeCorpus(dir: string, content: string): void {
  writeFileSync(join(dir, "session-01.json"), JSON.stringify({
    session_id: "replay-test-1",
    client: "dsh",
    model: "test-model",
    exchanges: [{
      request_body: { model: "test-model", messages: [{ role: "user", content }] },
      response_status: 200,
      response: { finish_reason: "stop", content: "" },
    }],
  }));
}

function runReplay(script: string, dir: string): { verdict: string; out: string } {
  let stdout: string;
  try {
    stdout = execFileSync(process.execPath, [script, "--dir", dir], { encoding: "utf8", cwd: ROOT });
  } catch (err) {
    stdout = String((err as { stdout?: string }).stdout ?? "");
  }
  const report = JSON.parse(readFileSync(join(dir, "replay-report.json"), "utf8")) as { verdict: string };
  return { verdict: report.verdict, out: stdout };
}

beforeAll(() => {
  corpusDir = mkdtempSync(join(tmpdir(), "llmveto-replay-"));
});
afterAll(() => {
  rmSync(corpusDir, { recursive: true, force: true });
});

describe("canary 注入回放（P1-1）", () => {
  it("正向：真实语义的注入 → 三判据全过，verdict=PASS", () => {
    const dir = mkdtempSync(join(corpusDir, "ok-"));
    writeCorpus(dir, "请帮我看一下这个配置");
    const { verdict } = runReplay(SCRIPT, dir);
    expect(verdict).toBe("PASS");
    // 判据细节也要落盘可查，否则"PASS"只是一个字
    const report = JSON.parse(readFileSync(join(dir, "replay-report.json"), "utf8")) as {
      criterion_1_finish_reason_no_migration: { identical_after_canary_removal: string };
      criterion_3_review: { append_only: boolean; injected: number };
    };
    expect(report.criterion_1_finish_reason_no_migration.identical_after_canary_removal).toBe("1/1");
    expect(report.criterion_3_review.append_only).toBe(true);
    expect(report.criterion_3_review.injected).toBe(1);
  }, 60_000);

  it("反向：把 inject 换成改写既有字节的版本 → verdict=FAIL", () => {
    // 反向探针的做法：复制工具本体，只替换 inject 的产出（模拟只增不改被破坏的回归）。
    const dir = mkdtempSync(join(corpusDir, "bad-"));
    writeCorpus(dir, "ORIGINAL_SENTINEL");
    // 只做两处纯文本替换：dist 路径改绝对、inject 包一层"先摘 canary 再改写既有字节"。
    // 不拼装整段代码——引号/转义会污染生成物（实测出过 SyntaxError）。
    const TAMPER_FN = [
      "",
      "const inject = (b, c) => {",
      "  const r = realInject(b, c);",
      "  if (!r.injected) return r;",
      "  const stripped = r.body.split(c).join(String.fromCharCode(39, 39));",
      '  const tampered = stripped.split("ORIGINAL_SENTINEL").join("TAMPERED" + c);',
      "  return { ...r, body: tampered };",
      "};",
      "function loadRecordings(dir) {",
    ].join("\n");
    const src = readFileSync(SCRIPT, "utf8")
      // 正则吃掉原有的引号，替换串自带引号（用 JSON.stringify 会多出一对，实测出过 SyntaxError）
      .replace(/from "\.\.\/dist\//g, `from "${OUT_DIR}/`)
      .replace("import { inject } from ", "import { inject as realInject } from ")
      .replace("\nfunction loadRecordings(dir) {", TAMPER_FN);
    const broken = join(dir, "replay-broken.mjs");
    writeFileSync(broken, src);
    const { verdict } = runReplay(broken, dir);
    expect(verdict).toBe("FAIL");
  }, 60_000);
});
