import { describe, expect, it } from "vitest";
import { egressSecretScan } from "../../../src/checkers/egress-secret-scan.ts";
import type { ScanUnit } from "../../../src/shared/types.ts";

// @test REQ-VETO-003
// @intent 出站凭据扫描：命中 5 类模式化凭据 → verdict=finding；benign / 无 auth 头输入 → clean
// @covers AC-VETO-003-01, AC-VETO-003-02, AC-VETO-003-03, AC-VETO-003-04
// @edge_cases pem_multiline, adjacent_matches, empty_body

function req(text: string): ScanUnit {
  return { direction: "request", transport: "non-stream", text, meta: {} };
}

describe("egress-secret-scan (REQ-VETO-003)", () => {
  it("AC-VETO-003-01: OpenAI sk- 命中 → finding + rule_id=openai-sk", () => {
    const r = egressSecretScan(req("please use key sk-abcdefghijklmnopqrstuvwxyz012345"));
    expect(r.verdict).toBe("finding");
    expect(r.evidence[0]).toMatchObject({
      checker: "egress-secret-scan",
      threat: "T1b",
      verdict: "finding",
      rule_id: "openai-sk",
    });
    expect(r.evidence[0]!.offsets!.length).toBeGreaterThan(0);
  });

  it("AC-VETO-003-01: Anthropic sk-ant- 命中", () => {
    const r = egressSecretScan(req("token sk-ant-api03-AbCdEf1234567890_xxxxxxxxxxxxx"));
    expect(r.verdict).toBe("finding");
    expect(r.evidence.some((f) => f.rule_id === "anthropic-sk-ant")).toBe(true);
  });

  it("AC-VETO-003-01: GitHub ghp_ 命中", () => {
    const r = egressSecretScan(
      req("auth=ghp_" + "A".repeat(36) + " trailing"),
    );
    expect(r.verdict).toBe("finding");
    expect(r.evidence.some((f) => f.rule_id === "github-ghp")).toBe(true);
  });

  it("AC-VETO-003-01: AWS AKIA 命中", () => {
    const r = egressSecretScan(req("aws access key: AKIAIOSFODNN7EXAMPLE"));
    expect(r.verdict).toBe("finding");
    expect(r.evidence.some((f) => f.rule_id === "aws-akia")).toBe(true);
  });

  it("AC-VETO-003-01: PEM 私钥块命中（多行）", () => {
    const r = egressSecretScan(
      req("preamble\n-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----\n"),
    );
    expect(r.verdict).toBe("finding");
    expect(r.evidence.some((f) => f.rule_id === "pem-private-key")).toBe(true);
  });

  it("AC-VETO-003-04: 纯函数 —— 同输入两次调用结果 deep-equal", () => {
    const u = req("hello sk-abcdefghijklmnopqrstuvwxyz012345");
    expect(egressSecretScan(u)).toEqual(egressSecretScan(u));
  });

  it("AC-VETO-003-01 edge: 空 body → clean", () => {
    expect(egressSecretScan(req("")).verdict).toBe("clean");
  });

  it("AC-VETO-003-01 edge: benign 文本 → clean", () => {
    const r = egressSecretScan(
      req("hello world, my name is Kim. I like apples and sk- is a common prefix but not a real key here."),
    );
    // "sk- " 后必须紧跟 ≥20 个 [A-Za-z0-9]；空格或非字母数字断开 → 不命中。
    expect(r.verdict).toBe("clean");
  });

  it("AC-VETO-003-01 edge: 多处命中 → 全部落 findings，每条 rule_id 独立", () => {
    const r = egressSecretScan(
      req(
        "key1=sk-abcdefghijklmnopqrstuvwxyz012345 key2=AKIAIOSFODNN7EXAMPLE",
      ),
    );
    expect(r.verdict).toBe("finding");
    const ids = new Set(r.evidence.map((f) => f.rule_id));
    expect(ids).toEqual(new Set(["openai-sk", "aws-akia"]));
  });

  it("AC-VETO-003-01: 短 sk-（<20 尾字符）不命中（缩窄 FP）", () => {
    const r = egressSecretScan(req("prefix sk-short123 suffix"));
    expect(r.verdict).toBe("clean");
  });
});
