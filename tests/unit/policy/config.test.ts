import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type PolicyConfig, loadPolicyConfig } from "../../../src/policy/config.ts";

// @test REQ-V3-01
// @intent 策略可配置化的边界（docs/plans/2026-11-27-v3-policy-config.md）。
//
//         这个模块存在的唯一理由：`credential-file-read` 是全系统唯一有阻断权的规则，
//         开放配置后它可以被一行配置降级为 warn —— 等于拆掉唯一防线。
//
//         三类配置（设计文档）：
//           A 偏好   —— 完全可配
//           B 降级   —— 观测类可降级，但要留痕
//           C 关闭   —— 阻断类**不可**降级，除非走 acknowledged_risks 且带理由与有效期

let dirs: string[] = [];
function tempFile(content: string): string {
  const d = mkdtempSync(join(tmpdir(), "policy-"));
  dirs.push(d);
  const f = join(d, "policy.json");
  writeFileSync(f, content, "utf8");
  return f;
}
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

/** 90 天界限的基准时刻（测试固定，不依赖真实时钟）。 */
const NOW = new Date("2026-11-27T00:00:00Z").getTime();
const DAY_MS = 24 * 3600 * 1000;
const ACK_MAX_DAYS = 90;

/** 造一份含 overrides 的配置文本；省掉每个用例重复的 JSON 拼装。 */
function configText(overrides: readonly Record<string, unknown>[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ schema_version: 1, overrides, ...extra });
}

/** 阻断规则的降级 override（多数用例都要它）。 */
function downgradeTo(action: string): Record<string, unknown> {
  return { checker: "dangerous-command-scan", rule_id: "credential-file-read", finding_action: action };
}

function load(content: string): PolicyConfig {
  return loadPolicyConfig(tempFile(content), { now: () => NOW });
}

describe("AC-1 阻断规则降级被拒（C 类）", () => {
  it("把 credential-file-read 从 block 改成 warn，且未写 acknowledged_risks → 拒绝", () => {
    const r = load(configText([downgradeTo("warn")]));
    expect(r.status).toBe("rejected");
    expect(r.error).toContain("credential-file-read");
    expect(r.error).toContain("acknowledged_risks");
  });

  it("改成 allow 同样被拒", () => {
    expect(load(configText([downgradeTo("allow")])).status).toBe("rejected");
  });

  it("保持 block（不降级）→ 接受", () => {
    expect(load(configText([downgradeTo("block")])).status).toBe("ok");
  });
});

describe("AC-2 / AC-3 逃生舱的约束", () => {
  const ack = (over: Record<string, unknown> = {}) =>
    configText([downgradeTo("warn")], {
      acknowledged_risks: [
        { rule_id: "credential-file-read", action: "warn", reason: "误报太多", expires_at: "2026-12-20T00:00:00Z", ...over },
      ],
    });

  it("理由、有效期齐全且在 90 天内 → 接受并标记降级", () => {
    const r = load(ack());
    expect(r.status).toBe("ok");
    expect(r.degraded).toContain("credential-file-read");
  });

  it("AC-2：理由为空串 → 拒绝", () => {
    const r = load(ack({ reason: "" }));
    expect(r.status).toBe("rejected");
    expect(r.error).toContain("reason");
  });

  it("AC-2：理由缺失 → 拒绝", () => {
    const r = load(ack({ reason: undefined }));
    expect(r.status).toBe("rejected");
  });

  it("AC-3：缺少 expires_at → 拒绝", () => {
    const r = load(ack({ expires_at: undefined }));
    expect(r.status).toBe("rejected");
    expect(r.error).toContain("expires_at");
  });

  it("AC-3：已过期 → 拒绝", () => {
    const r = load(ack({ expires_at: "2026-11-01T00:00:00Z" }));
    expect(r.status).toBe("rejected");
    expect(r.error).toContain("expired");
  });

  it("AC-3：超过 90 天 → 拒绝（否则写 2099 就等于永久关闭）", () => {
    const r = load(ack({ expires_at: "2099-12-31T00:00:00Z" }));
    expect(r.status).toBe("rejected");
    expect(r.error).toContain("90");
  });

  it("AC-3 边界：恰好 90 天 → 接受", () => {
    const in90 = new Date(NOW + ACK_MAX_DAYS * DAY_MS).toISOString();
    expect(load(ack({ expires_at: in90 })).status).toBe("ok");
  });

  it("AC-3 边界：90 天多 1 秒 → 拒绝", () => {
    const over90 = new Date(NOW + ACK_MAX_DAYS * DAY_MS + 1000).toISOString();
    expect(load(ack({ expires_at: over90 })).status).toBe("rejected");
  });
});

describe("AC-6 观测类降级无需登记（B 类）", () => {
  it("观测类 checker 降级 → 接受，但记入 degraded", () => {
    const r = load(configText([{ checker: "model-label-consistency", finding_action: "allow" }]));
    expect(r.status).toBe("ok");
    expect(r.degraded).toContain("model-label-consistency");
  });
});

describe("AC-8 配置错误回退默认（自审结论，推翻最初的 fail-fast）", () => {
  it("JSON 语法错误 → 不抛错，回退默认并报告", () => {
    const r = load("{ not json");
    expect(r.status).toBe("rejected");
    expect(r.fallback).toBe(true);
    expect(r.degraded).toEqual([]);
  });

  it("回退后 degraded 为空 = 没有任何降级生效", () => {
    const r = load(JSON.stringify({ schema_version: 99, overrides: [] }));
    expect(r.degraded).toEqual([]);
  });

  it("文件不存在 → ok（没有配置就是默认，不是错误）", () => {
    const r = loadPolicyConfig("/nonexistent/policy.json", { now: () => NOW });
    expect(r.status).toBe("ok");
    expect(r.degraded).toEqual([]);
  });
});

describe("schema 校验", () => {
  it("未知 schema_version → 拒绝", () => {
    expect(load(JSON.stringify({ schema_version: 2, overrides: [] })).status).toBe("rejected");
  });

  it("finding_action 非法值 → 拒绝", () => {
    const r = load(
      JSON.stringify({ schema_version: 1, overrides: [{ checker: "x", finding_action: "destroy" }] }),
    );
    expect(r.status).toBe("rejected");
  });

  it("空配置对象 → 接受（等于默认）", () => {
    expect(load(JSON.stringify({ schema_version: 1 })).status).toBe("ok");
  });
});
