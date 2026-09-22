import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/index.ts";
import { MANAGED_CONFIG_IDS as OPENCODE_IDS } from "../../src/adapters/opencode.ts";
import { MANAGED_CONFIG_IDS as DELPHI_IDS } from "../../src/adapters/delphi.ts";

// @test REQ-VETO-014
// @intent AC-VETO-014-06 doctor 漂移：受管配置未指向本地网关 → exit=1 且 FAIL 行包含漂移条目 id。
//         M1.2：doctor 真实读盘（缺失=全漂移），--write-managed-config 真实落盘。
// @covers AC-VETO-014-06

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "llmveto-e2e-doctor-")); });

describe("SL-14 e2e: doctor drift detection (REQ-VETO-014)", () => {
  it("AC-06 受管配置文件缺失 → doctor FAIL + 输出列出 MANAGED_CONFIG_IDS 条目 id", async () => {
    // M1.2：doctor 读取真实文件；env 指向不存在的临时路径 → detectDrift 视作全漂移
    const env = {
      LLMVETO_OPENCODE_CONFIG: join(dir, "missing-opencode.json"),
      LLMVETO_DELPHI_CONFIG: join(dir, "missing-delphi.json"),
      LLMVETO_GATEWAY_URL: "http://127.0.0.1:1", // 端口不可达不影响本用例断言的 drift 行
    };
    const res = await runCli("doctor", { stateDir: dir, args: [], env });
    expect(res.exitCode).toBe(1);
    const failLines = res.stdout.split("\n").filter((l) => l.startsWith("[FAIL]"));
    expect(failLines.length).toBeGreaterThan(0);
    const driftLine = failLines.find((l) => l.includes("doctor.config-drift"));
    expect(driftLine).toBeDefined();
    // 至少断言 3 个 opencode + 2 个 delphi 条目 id 全部出现
    for (const id of OPENCODE_IDS) expect(driftLine!).toContain(id.id);
    for (const id of DELPHI_IDS) expect(driftLine!).toContain(id.id);
  });

  it("M1.2 --write-managed-config 真实写盘 → 再跑 doctor 漂移项 PASS（config-drift 不再 FAIL）", async () => {
    const ocPath = join(dir, "managed", "opencode.json");
    const dpPath = join(dir, "managed", ".delphi-config.json");
    const env = {
      LLMVETO_OPENCODE_CONFIG: ocPath,
      LLMVETO_DELPHI_CONFIG: dpPath,
      LLMVETO_GATEWAY_URL: "http://127.0.0.1:8787",
    };
    const w = await runCli("doctor", { stateDir: dir, args: ["--write-managed-config"], env });
    // 两个受管文件应被真实创建
    expect(existsSync(ocPath)).toBe(true);
    expect(existsSync(dpPath)).toBe(true);
    expect(w.stdout).toContain("doctor.write-managed-config");

    // 写入的 opencode provider baseURL 应带路径路由 provider 段，且深合并保留了结构
    const oc = JSON.parse(readFileSync(ocPath, "utf8")) as {
      provider: Record<string, { options: { baseURL: string } }>;
      env: { OPENCODE_MODELS_URL: string };
    };
    expect(oc.provider.openai?.options.baseURL).toBe("http://127.0.0.1:8787/opencode/openai");
    expect(oc.env.OPENCODE_MODELS_URL).toBe("http://127.0.0.1:8787/opencode/models");

    // 再跑一次 doctor（不写盘）：config-drift 检查应 PASS（漂移已消除）
    const r = await runCli("doctor", { stateDir: dir, args: [], env });
    const driftLine = r.stdout.split("\n").find((l) => l.includes("doctor.config-drift"));
    expect(driftLine).toBeDefined();
    expect(driftLine!).toContain("[PASS]");
    expect(driftLine!).toContain("none");
  });

  it("M1.2 写盘后 tamper 真实文件 → doctor 精确报出被改条目", async () => {
    const ocPath = join(dir, "tamper", "opencode.json");
    const dpPath = join(dir, "tamper", ".delphi-config.json");
    const env = {
      LLMVETO_OPENCODE_CONFIG: ocPath,
      LLMVETO_DELPHI_CONFIG: dpPath,
      LLMVETO_GATEWAY_URL: "http://127.0.0.1:8787",
    };
    // 先写一次干净配置
    await runCli("doctor", { stateDir: dir, args: ["--write-managed-config"], env });
    // 篡改落盘文件：把 openai provider 指到外部（模拟用户/其他工具改走它处）
    const oc = JSON.parse(readFileSync(ocPath, "utf8")) as {
      provider: Record<string, { options: { baseURL: string } }>;
    };
    oc.provider.openai!.options.baseURL = "https://evil.example.com/v1";
    writeFileSync(ocPath, JSON.stringify(oc), "utf8");
    const r = await runCli("doctor", { stateDir: dir, args: [], env });
    const driftLine = r.stdout.split("\n").find((l) => l.includes("doctor.config-drift"))!;
    expect(driftLine).toContain("[FAIL]");
    expect(driftLine).toContain("opencode.provider.openai.options.baseURL");
    expect(driftLine).not.toContain("opencode.provider.anthropic.options.baseURL");
  });
});
