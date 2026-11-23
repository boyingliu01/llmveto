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

  // 注意：这里**不能**用 AKIAIOSFODNN7EXAMPLE —— 那是 AWS 官方文档示例值，
  // 已被 DOCUMENTED_EXAMPLE_VALUES 放行（见文件头）。用合规但非示例的假值，
  // 验证的仍是"AWS 格式能被检出"这一件事。
  it("AC-VETO-003-01: AWS AKIA 命中（非官方示例值）", () => {
    const r = egressSecretScan(req("aws access key: AKIAXXXXXXXXXXXXXXXX"));
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

  // ── PEM：只认「头 + 主体」，光有头部是文档/夹具形态（2026-11-24 线上误报）──
  it("PEM 空壳（本仓库夹具原文）→ clean：讨论 PEM 格式不应被自己的网关拦下", () => {
    // 这一行自 2026-09-15 起就在 tests/fixtures/threats/T1b/secrets.yaml 里，
    // 旧规则只认头部，导致任何引用该夹具的会话请求都 502。
    const fixture = "-----BEGIN RSA PRIVATE KEY----- payload -----END RSA PRIVATE KEY-----";
    expect(egressSecretScan(req(fixture)).verdict).toBe("clean");
    // 讨论格式的写法同样不该命中
    expect(egressSecretScan(req("PEM 文件以 -----BEGIN OPENSSH PRIVATE KEY----- 开头")).verdict).toBe("clean");
  });

  it("PEM 真块（头 + base64 主体）仍命中：收紧没有削弱检测", () => {
    const realLike = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZWQyNTUxOQAAACB\n-----END OPENSSH PRIVATE KEY-----";
    const r = egressSecretScan(req(realLike));
    expect(r.verdict).toBe("finding");
    expect(r.evidence.some((f) => f.rule_id === "pem-private-key")).toBe(true);
  });

  it("PEM 成块形态（多行，含截断示例）→ 仍命中：收紧没有误伤已冻结的测试契约", () => {
    // 判据是「头尾是否分处不同行」。多行块即使主体很短也按真块处理——
    // 这与 AC-VETO-003-01 的既有样例一致，收紧不能与它冲突。
    expect(egressSecretScan(req("-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----")).verdict).toBe("finding");
  });

  // ── 官方文档示例值放行（防止"开发本项目的会话被自己拦下"）──
  it("官方文档示例值 AKIAIOSFODNN7EXAMPLE → clean（不阻断）", () => {
    const r = egressSecretScan(req("aws_access_key_id = AKIAIOSFODNN7EXAMPLE"));
    expect(r.verdict).toBe("clean");
  });

  it("官方文档示例值 ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij → clean", () => {
    const r = egressSecretScan(req("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij pushed"));
    expect(r.verdict).toBe("clean");
  });

  it("白名单是逐字匹配：示例值被改动一位后仍命中（不是模式豁免）", () => {
    const r = egressSecretScan(req("AKIAXXXXXXXXXXXXXXXX"));
    expect(r.verdict).toBe("finding");
    expect(r.evidence.some((f) => f.rule_id === "aws-akia")).toBe(true);
  });

  it("同一请求里示例值与真实密钥并存 → 仍因真实密钥命中", () => {
    const r = egressSecretScan(req("example AKIAIOSFODNN7EXAMPLE real AKIAXXXXXXXXXXXXXXXX"));
    expect(r.verdict).toBe("finding");
    expect(r.evidence.some((f) => f.rule_id === "aws-akia")).toBe(true);
  });

  it("非示例的 sk- / sk-ant- 占位串仍被检出（白名单不扩大）", () => {
    expect(egressSecretScan(req("sk-abcdefghijklmnopqrstuvwxyz1234")).verdict).toBe("finding");
    expect(egressSecretScan(req("sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx")).verdict).toBe("finding");
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
        "key1=sk-abcdefghijklmnopqrstuvwxyz012345 key2=AKIAXXXXXXXXXXXXXXXX",
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
