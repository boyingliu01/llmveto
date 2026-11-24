import { describe, expect, it } from "vitest";
import { CLIENT_WIRE_FORMATS, wireFormatOf } from "../../../src/shared/client-wire-format.ts";

// @test REQ-V2bA-10 / AC-V2bA-10a
// @intent 客户端线格式声明必须是**纯数据**（layers: shared 不得依赖 adapters/gateway），
//         且"无法确定"必须是一等值（null），不能靠猜。

describe("SL-07 客户端线格式声明（REQ-V2bA-10）", () => {
  it("三个新客户端都有声明，且格式逐字校验", () => {
    expect(wireFormatOf("claude-code")?.format).toBe("anthropic-messages");
    expect(wireFormatOf("codex")?.format).toBe("openai-responses");
    // promptfoo 的格式取决于用户配置，声明为 null 是一等值而不是"忘记写"
    expect(wireFormatOf("promptfoo")?.format).toBeNull();
    expect(CLIENT_WIRE_FORMATS.map((c) => c.client)).toEqual(["opencode", "delphi", "claude-code", "codex", "promptfoo"]);
  });

  it("无法确定的客户端必须声明为 null（doctor 据此报 coverage_unknown）", () => {
    expect(wireFormatOf("promptfoo")?.format).toBeNull();
  });

  it("未登记的客户端返回 undefined（不受管，不参与覆盖判定）", () => {
    expect(wireFormatOf("some-random-client")).toBeUndefined();
  });

  it("每条声明都写明判定依据（可追溯，不是拍脑袋）", () => {
    for (const c of CLIENT_WIRE_FORMATS) expect(c.basis.length, `${c.client} 缺依据`).toBeGreaterThan(10);
  });

  it("表是冻结的，且 client 名唯一", () => {
    expect(Object.isFrozen(CLIENT_WIRE_FORMATS)).toBe(true);
    const names = CLIENT_WIRE_FORMATS.map((c) => c.client);
    expect(new Set(names).size).toBe(names.length);
  });
});
