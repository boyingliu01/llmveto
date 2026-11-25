import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codexAdapter, MANAGED_CONFIG_IDS } from "../../../src/adapters/codex.ts";

// @test REQ-V2bA-07 / AC-V2bA-07a~c / REQ-V2bA-08a
// @intent Codex 的配置是 TOML（`~/.codex/config.toml`），受管项两键：
//         `model_providers.llmveto.base_url` 与 `model_providers.llmveto.wire_api`。
//
// 写回必须是**定点编辑**：解析只用来定位，替换用行级精确匹配。
// 判据是"除目标键外逐字节相同"——含注释、键序、CRLF。
// 全量 parse→stringify 会丢掉用户所有注释，那是"静默丢用户注意力"，可测但不可接受。

const dir = mkdtempSync(join(tmpdir(), "llmveto-codex-"));
let n = 0;

function freshFile(content: string | null): string {
  n += 1;
  const p = join(dir, `config-${n}.toml`);
  if (content !== null) writeFileSync(p, content, "utf8");
  return p;
}

function envFor(p: string): Record<string, string> {
  return { LLMVETO_CODEX_CONFIG: p };
}

const EXISTING = `# my codex config — 用户注释必须保住
model = "gpt-5-codex"
model_provider = "llmveto"
approval_policy = "on-request"

[model_providers.llmveto]
name = "llmveto"
base_url = "http://127.0.0.1:8787/codex/openai/v1"
wire_api = "responses"
# keep this note
env_key = "OPENAI_API_KEY"

[profiles.fast]
model = "o4-mini"
`;

describe("SL-09 Codex 适配器（REQ-V2bA-07）", () => {
  it("受管项恰好两个：base_url 与 wire_api", () => {
    expect(MANAGED_CONFIG_IDS.map((c) => c.id)).toEqual([
      "codex.model_providers.llmveto.base_url",
      "codex.model_providers.llmveto.wire_api",
    ]);
  });

  it("已配置且一致时：写入后除目标键外逐字节相同（含注释/键序/CRLF）（AC-V2bA-07a）", () => {
    const p = freshFile(EXISTING);
    const before = readFileSync(p, "utf8");
    codexAdapter.applyManagedConfig(envFor(p), "http://127.0.0.1:8787");
    expect(readFileSync(p, "utf8")).toBe(before); // 幂等：值本来就对，一个字节都不该动
  });

  it("值不同时只改目标行，其它字节不动（AC-V2bA-07a）", () => {
    const before = EXISTING.replace("http://127.0.0.1:8787", "https://relay.example.com");
    const p = freshFile(before);
    codexAdapter.applyManagedConfig(envFor(p), "http://127.0.0.1:8787");
    const after = readFileSync(p, "utf8");
    // 逐字节差分：把改动后的内容按"目标键的行"还原回去，必须与原文**逐字节相同**。
    const restored = after.replace(
      'base_url = "http://127.0.0.1:8787/codex/openai/v1"',
      'base_url = "https://relay.example.com/codex/openai/v1"',
    );
    expect(restored).toBe(before);
    // 且除那一行外没有任何其它变化
    expect(after.split("\n").length).toBe(before.split("\n").length);
  });

  it("CRLF 文件写回后仍是 CRLF（不做行尾归一化）", () => {
    const crlf = EXISTING.replace(/\n/g, "\r\n").replace("http://127.0.0.1:8787", "https://relay.example.com");
    const p = freshFile(crlf);
    codexAdapter.applyManagedConfig(envFor(p), "http://127.0.0.1:8787");
    const after = readFileSync(p, "utf8");
    expect(after.includes("\r\n")).toBe(true); // 仍是 CRLF
    expect(after.replace(/\r\n/g, "\n")).toBe(EXISTING); // 归一化后与期望一致
  });

  it("provider 块缺失时创建新块（AC-V2bA-07b）", () => {
    const p = freshFile('model = "gpt-5"\n');
    codexAdapter.applyManagedConfig(envFor(p), "http://127.0.0.1:8787");
    const after = readFileSync(p, "utf8");
    expect(after).toContain("[model_providers.llmveto]");
    expect(after).toContain('base_url = "http://127.0.0.1:8787/codex/openai/v1"');
    expect(after).toContain('wire_api = "responses"');
    expect(after.startsWith('model = "gpt-5"\n')).toBe(true); // 原有内容原样保留
  });

  it("文件不存在时创建（AC-V2bA-07b）", () => {
    const p = freshFile(null);
    codexAdapter.applyManagedConfig(envFor(p), "http://127.0.0.1:8787");
    expect(readFileSync(p, "utf8")).toContain("[model_providers.llmveto]");
  });

  it("多处同形目标键 → 拒绝写入并报错，文件不被修改（AC-V2bA-07c）", () => {
    const dup = `${EXISTING}\n[model_providers.other]\nbase_url = "https://x"\n`;
    const p = freshFile(dup.replace("[model_providers.other]", "[model_providers.llmveto]"));
    const before = readFileSync(p, "utf8");
    expect(() => codexAdapter.applyManagedConfig(envFor(p), "http://127.0.0.1:8787")).toThrow(/多处|duplicate|重复/);
    expect(readFileSync(p, "utf8")).toBe(before);
  });

  it("读回后漂移为空；改值后检出对应条目 id", () => {
    const p = freshFile(EXISTING);
    const current = codexAdapter.readCurrentConfig(envFor(p));
    expect(codexAdapter.detectDrift(current, "http://127.0.0.1:8787")).toEqual([]);
    const drifted = codexAdapter.detectDrift({ model_providers: { llmveto: { base_url: "https://x", wire_api: "chat" } } }, "http://127.0.0.1:8787");
    expect(drifted.map((d) => d.id).sort()).toEqual([
      "codex.model_providers.llmveto.base_url",
      "codex.model_providers.llmveto.wire_api",
    ]);
  });

  it("写回失败不留半截文件，覆盖前留 .bak（AC-V2bA-08a2）", () => {
    const p = freshFile(EXISTING.replace("http://127.0.0.1:8787", "https://relay.example.com"));
    codexAdapter.applyManagedConfig(envFor(p), "http://127.0.0.1:8787");
    expect(readFileSync(`${p}.bak`, "utf8")).toContain("https://relay.example.com");
  });
});
