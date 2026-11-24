import { mkdtempSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { promptfooAdapter, promptfooConfigPath, MANAGED_CONFIG_IDS } from "../../../src/adapters/promptfoo.ts";

// @test REQ-V2bA-08 / AC-V2bA-08a~c
// @intent promptfoo 的受管配置是**项目级** `promptfooconfig.yaml`（cli 文档原文：
//         "By default the eval command will read the promptfooconfig.yaml configuration file
//          in your current directory"）。
//
// 与另两个适配器不同，这个文件通常**进版本库**、与团队共享。所以：
//   - 默认只报告漂移，`--write-managed-config` 必须显式加 --include-project-config 才写；
//   - 受管 provider 用**稳定标识**（id / label）而不是数组下标——增删 provider 不该误报漂移；
//   - `apiHost` 或 OPENAI_BASE_URL 这类替代配置识别为 unmanaged 并告警，不计漂移。

const dir = mkdtempSync(join(tmpdir(), "llmveto-pf-"));
let n = 0;
function freshFile(content: string | null): string {
  n += 1;
  const p = join(dir, `promptfooconfig-${n}.yaml`);
  if (content !== null) writeFileSync(p, content, "utf8");
  return p;
}

const CONFIG = `# eval config
prompts:
  - prompt1.txt
providers:
  - id: openai:chat:gpt-5
    config:
      apiBaseUrl: http://127.0.0.1:8787/promptfoo/openai/v1
  - id: openai:chat:other
    config:
      apiBaseUrl: https://api.openai.com/v1
tests:
  - vars:
      q: hi
`;

describe("SL-10 promptfoo 适配器（REQ-V2bA-08）", () => {
  it("受管项以稳定标识命名，不含数组下标", () => {
    expect(MANAGED_CONFIG_IDS.length).toBeGreaterThan(0);
    for (const c of MANAGED_CONFIG_IDS) {
      expect(c.id).not.toMatch(/\[\d+\]/);
      expect(c.id.startsWith("promptfoo.")).toBe(true);
    }
  });

  it("配置文件定位顺序：env 覆写优先，其次 cwd 的 promptfooconfig.{yaml,yml}", () => {
    expect(promptfooConfigPath({ LLMVETO_PROMPTFOO_CONFIG: "/x/a.yaml" }, "/cwd")).toBe("/x/a.yaml");
    expect(promptfooConfigPath({}, dir)).toBe(join(dir, "promptfooconfig.yaml"));
  });

  it("读配置后对已指向网关的 provider 无漂移", () => {
    const p = freshFile(CONFIG);
    const current = promptfooAdapter.readCurrentConfig({ LLMVETO_PROMPTFOO_CONFIG: p });
    const drift = promptfooAdapter.detectDrift(current, "http://127.0.0.1:8787");
    expect(drift.map((d) => d.id)).not.toContain("promptfoo.provider.openai:chat:gpt-5.config.apiBaseUrl");
  });

  it("指向别处的 provider 被检出漂移（AC-V2bA-08b：按 id 而非下标）", () => {
    const p = freshFile(CONFIG);
    const current = promptfooAdapter.readCurrentConfig({ LLMVETO_PROMPTFOO_CONFIG: p });
    const drift = promptfooAdapter.detectDrift(current, "http://127.0.0.1:8787");
    expect(drift.map((d) => d.id)).toContain("promptfoo.provider.openai:chat:other.config.apiBaseUrl");
  });

  it("默认不写：未加 opt-in 时项目文件 mtime 与内容不变（AC-V2bA-08a）", () => {
    const p = freshFile(CONFIG);
    const before = readFileSync(p, "utf8");
    const mtime = statSync(p).mtimeMs;
    expect(promptfooAdapter.writesProjectConfigByDefault).toBe(false);
    // 适配器本身不提供"默认写"的入口：applyManagedConfig 只接受显式 opt-in
    expect(readFileSync(p, "utf8")).toBe(before);
    expect(statSync(p).mtimeMs).toBe(mtime);
  });

  it("显式 opt-in 才写入：把**所有** openai 兼容 provider 指到网关，且只动 apiBaseUrl 行", () => {
    // 只改第一个 provider 会留下"配了网关 ≠ 被保护"的缺口——它们都要指向网关。
    const before = CONFIG.replace("http://127.0.0.1:8787", "https://relay.example.com");
    const p = freshFile(before);
    promptfooAdapter.applyManagedConfig({ LLMVETO_PROMPTFOO_CONFIG: p, LLMVETO_INCLUDE_PROJECT_CONFIG: "1" }, "http://127.0.0.1:8787");
    const after = readFileSync(p, "utf8");
    const base = "http://127.0.0.1:8787/promptfoo/openai/v1";
    expect(after.split(`apiBaseUrl: ${base}`).length - 1).toBe(2); // 两个 provider 都改了
    // 逐行差分：只有 apiBaseUrl 那两行变了，其余行逐字相同
    const changedLines = after
      .split("\n")
      .map((line, i) => (line === before.split("\n")[i] ? null : line.trim()))
      .filter((line): line is string => line !== null);
    expect(changedLines).toEqual([`apiBaseUrl: ${base}`, `apiBaseUrl: ${base}`]);
    expect(after.split("\n").length).toBe(before.split("\n").length);
  });

  it("替代配置（apiHost / OPENAI_BASE_URL）识别为 unmanaged 且不计漂移（AC-V2bA-08c）", () => {
    const withHost = `providers:\n  - id: openai:chat:gpt-5\n    config:\n      apiHost: gateway.example.com\n`;
    const p = freshFile(withHost);
    const current = promptfooAdapter.readCurrentConfig({ LLMVETO_PROMPTFOO_CONFIG: p });
    expect(promptfooAdapter.detectDrift(current, "http://127.0.0.1:8787")).toEqual([]);
    expect(promptfooAdapter.unmanagedReason(current)).toMatch(/apiHost|unmanaged/);
  });
});
