import { describe, expect, it } from "vitest";
import {
  checkCanaryReturnScan,
  CANARY_RETURN_SCAN_SPEC,
} from "../../../src/checkers/canary-return-scan.ts";
import type { ScanUnit } from "../../../src/shared/types.ts";

// @test REQ-V2a-05 / SL-08
// @intent T1a canary-return-scan: 跨会话串流检出（快照匹配 + 自排除）
// @covers AC-V2a-06 AC-V2a-08（在途语义） AC-V2a-19②

const unit = (text: string, meta: Record<string, unknown>): ScanUnit => ({
  direction: "response",
  transport: "non-stream",
  text,
  meta,
});

describe("SL-08 canary-return-scan (REQ-V2a-05)", () => {
  it("AC-V2a-06: 单 canary 命中 → finding", () => {
    const r = checkCanaryReturnScan(unit("hello CANARY_abc123 world", {
      canary_candidates: ["CANARY_abc123"],
    }));
    expect(r.verdict).toBe("finding");
    expect(r.evidence[0]?.rule_id).toBe("canary-detected-in-response");
    expect(r.evidence[0]?.threat).toBe("T1a");
    expect(r.evidence[0]?.checker).toBe("canary-return-scan");
  });

  it("AC-V2a-06: 多 canary 命中 → finding（报告首个）", () => {
    const r = checkCanaryReturnScan(unit("first CANARY_x second CANARY_y", {
      canary_candidates: ["CANARY_x", "CANARY_y"],
    }));
    expect(r.verdict).toBe("finding");
    expect(r.evidence).toHaveLength(1); // 只报首个
    expect(r.evidence[0]?.rule_id).toBe("canary-detected-in-response");
  });

  it("无匹配 → clean", () => {
    const r = checkCanaryReturnScan(unit("normal response", {
      canary_candidates: ["CANARY_not_present"],
    }));
    expect(r.verdict).toBe("clean");
    expect(r.evidence).toHaveLength(0);
  });

  it("空 canary_candidates → clean", () => {
    const r = checkCanaryReturnScan(unit("any text", {
      canary_candidates: [],
    }));
    expect(r.verdict).toBe("clean");
  });

  it("缺失 meta.canary_candidates → clean", () => {
    const r = checkCanaryReturnScan(unit("any text", {}));
    expect(r.verdict).toBe("clean");
  });

  it("负样本：自身 canary 已排除于快照 → 不命中（自排除保证 FP=0）", () => {
    // 场景：sess-A 的请求，快照由 store.snapshot("sess-A") 生成，已排除 sess-A 自己的 canary
    // 响应中出现的是 sess-A 自己的 canary（正常回显），不应触发 finding
    const r = checkCanaryReturnScan(unit("echo: MY_OWN_CANARY", {
      canary_candidates: [], // 快照中已排除自身 → 空数组
    }));
    expect(r.verdict).toBe("clean"); // 自排除保证零误报
  });

  it("AC-V2a-08/AC-V2a-19②: 在途语义——快照取于轮换前，响应含旧 token → 仍 finding", () => {
    // 场景：请求开始时快照为 [OLD_CANARY]，处理中发生轮换，但响应仍用原始快照判定
    const r = checkCanaryReturnScan(unit("response with OLD_CANARY leaked", {
      canary_candidates: ["OLD_CANARY"], // 原始快照（轮换前的状态）
    }));
    expect(r.verdict).toBe("finding"); // 在途请求按原始快照判
  });

  it("纯函数性 + spec 声明", () => {
    const u = unit("test CANARY_z", { canary_candidates: ["CANARY_z"] });
    expect(checkCanaryReturnScan(u)).toEqual(checkCanaryReturnScan(u));
    expect(CANARY_RETURN_SCAN_SPEC.safetyClass).toBe(true); // T1a 安全类
    expect(CANARY_RETURN_SCAN_SPEC.side).toBe("response");
    expect(CANARY_RETURN_SCAN_SPEC.synchronous).toBe(true);
  });
});
