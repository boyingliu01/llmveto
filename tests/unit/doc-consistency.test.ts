import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * S-DOCS（v2a 切片 SL-15）：文档订正的 grep 型守卫（AC-V2a-15 / AC-V2a-16①-⑦ +
 * 拍板项同批订正 #B/#C/#D/#G + AC-V2a-17 头名占位名订正）。
 *
 * 权威依据 = 冻结契约 `docs/plans/2026-09-27-v2a-requirements.md`：
 *   - 第 238 行 AC-V2a-15 —— REQ 登记表 T2c 行"缺口理由"须逐字包含
 *     `tool-call 参数路径 v1 实际未覆盖，v2a 起覆盖`，由本文件把守；
 *   - 第 239 行 AC-V2a-16 —— 七处订正（①-⑦）各有断言，由本文件把守，防表述漂移；
 *   - 第 240 行 AC-V2a-17 —— `x-llveto-session` 是占位名，定案头名复用既有
 *     `x-llmveto-session-id`（v2a 设计 D-06），订正并入本断言域 [R2 T-m1]；
 *   - 第 7 行设计批准记录 —— 拍板项 #B/#C/#G 的规约同批订正已随冻结契约落盘，本文件
 *     守其不被回退；#D（doctor 封闭枚举 4→6 的 v1 文字订正）属 BUILD 期 doc-consistency
 *     断言域，订正文本以 v2a 设计 D-03 / D-08 / D-12 / D-14 定案为准。
 *
 * 断言风格与 `backlog-integrity.test.ts` 同族：读文件 → 断言包含/不包含。
 * 每条断言的失败信息点名"哪一处订正漂移了"（订正点编号 + 文件 + 期望短语）。
 *
 * 能力边界（成文优于假装覆盖）：本文件只守"逐字短语在不在"，不守语义真伪——
 * 把文档措辞改写并同时改本测试可以绕过，那类改动属切片契约变更，必须走显式 diff、
 * 走查可见；字符串检查不冒充语义评审。
 *
 * 落点说明（SL-15 切片契约的 file_budget=6）：⑥⑦ 的"REQ 登记表加注"落
 * `docs/issues/5-roadmap.md`（切片契约显式点名）；AC-V2a-15 短语双落点（需求文档 §7
 * T2c 行 + ROADMAP 加注节）。`docs/issues/1-req-threat-model.md`（登记表本体）不在
 * 本切片 file_budget 内，本文件不对它断言——见切片报告 concerns。
 */

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const REQ_REL = "docs/plans/2026-09-27-v2a-requirements.md";
const DESIGN_V1_REL = "docs/issues/2-design-v1.md";
const TEST_REL = "docs/issues/4-test-validation.md";
const ROADMAP_REL = "docs/issues/5-roadmap.md";
const README_REL = "README.md";

const read = (rel: string): string => readFileSync(`${REPO_ROOT}${rel}`, "utf8");

/** 全部短语都须出现；缺任何一个即红，红句点名缺的是哪个短语。 */
function expectContains(doc: string, phrases: readonly string[], drift: string): void {
  const missing = phrases.filter((p) => !doc.includes(p));
  expect(
    missing,
    `${drift} 漂移：以下逐字短语缺失（措辞被改写/删除即判红，订正文本不得意译）：\n  ${missing.join("\n  ")}`,
  ).toEqual([]);
}

/** 全部短语都不得出现；出现即红（旧表述回潮/占位名残留的探测方向）。 */
function expectNotContains(doc: string, phrases: readonly string[], drift: string): void {
  const present = phrases.filter((p) => doc.includes(p));
  expect(
    present,
    `${drift} 漂移：以下旧表述/占位名不得再出现（订正被回退或只改了一半）：\n  ${present.join("\n  ")}`,
  ).toEqual([]);
}

describe("doc-consistency（S-DOCS：AC-V2a-15/16 七处 + 拍板项同批订正的 grep 守卫）", () => {
  it("权威依据在位：需求文档 AC-V2a-15/16/17 三行与本守卫的指名未被移除（守卫自身的前提检查）", () => {
    expectContains(
      read(REQ_REL),
      [
        "AC-V2a-15",
        "AC-V2a-16",
        "AC-V2a-17",
        "tests/unit/doc-consistency.test.ts",
      ],
      "权威依据（需求文档 §6 第 238-240 行）",
    );
  });

  it("AC-V2a-15：REQ 登记表 T2c 行缺口理由含逐字短语（需求文档 §7 T2c 行 + ROADMAP 加注节双落点）", () => {
    const phrase = "tool-call 参数路径 v1 实际未覆盖，v2a 起覆盖";
    expectContains(
      read(REQ_REL),
      [phrase],
      "需求文档 §7 残余风险登记表申报变更表 T2c 行（AC-V2a-15）",
    );
    expectContains(
      read(ROADMAP_REL),
      [phrase],
      "docs/issues/5-roadmap.md 的 T2c 行缺口理由加注（AC-V2a-15）",
    );
  });

  it("① TEST 契约 #4 action_taken 行：degraded_observational 的可达性表述由 v1 fixture 不覆盖 订正为 v2a 起覆盖", () => {
    const doc = read(TEST_REL);
    expectContains(
      doc,
      ["verify schema 须允许该枚举但 v2a 起覆盖"],
      "① TEST 契约 #4 action_taken 行（degraded_observational 订正为 v2a 起覆盖）",
    );
    expectNotContains(
      doc,
      ["v1 fixture 不覆盖"],
      "① TEST 契约 #4 action_taken 行（旧表述 v1 fixture 不覆盖 须已被替换）",
    );
  });

  it("② TEST 契约 #4 action_taken 行：枚举可达性断言更新为 v1 记录集内仍为 0", () => {
    expectContains(
      read(TEST_REL),
      ["v1 记录集内仍为 0"],
      "② TEST 契约 #4 action_taken 行（v1 记录集内仍为 0）",
    );
  });

  it("③ TEST 契约 #4 canary 字段：保留位加注（v2a 起仍恒 null，命中写 findings[]）", () => {
    expectContains(
      read(TEST_REL),
      ["保留位（v2a 起仍恒 null，命中写 `findings[]`）"],
      "③ TEST 契约 #4 canary 字段（保留位加注）",
    );
  });

  it("④ README §CLI：命令集 5→6（canary rotate，v2a 设计 D-14）且 doctor 封闭枚举 4→6 同步", () => {
    const doc = read(README_REL);
    expectContains(
      doc,
      [
        "command set 5→6",
        "llmveto canary rotate",
        "doctor.canary-registry",
        "doctor.coverage-counters",
      ],
      "④ README §CLI（命令集 5→6 + doctor 封闭枚举 4→6 同步）",
    );
    expectNotContains(
      doc,
      ["v1 is frozen at 5 commands", "`canary rotate` (canary rotation) belong to v2"],
      "④ README §CLI（旧的 5 命令冻结表述与 canary rotate 属 v2 的旧句须已被替换）",
    );
  });

  it("④ README 不提供清单：T2b（v2→v3）与 T2c（v1 边界）表述同步", () => {
    const doc = read(README_REL);
    expectContains(
      doc,
      [
        "Response-injection protection (T2b, v3",
        "covered only from v2a",
        "streaming-hit `offsets` are not forensically usable in v1",
      ],
      "④ README 不提供清单（T2b 与 T2c 表述同步）",
    );
    expectNotContains(
      doc,
      ["(T2b, v2)"],
      "④ README 不提供清单（T2b 旧期次 v2 须已被订正为 v3）",
    );
  });

  it("⑤ TEST 契约 #4 latency 行 + reason 行：背离登记加注（标量 total_ms 语义 / 可选位自 v2a 实装）", () => {
    expectContains(
      read(TEST_REL),
      [
        "v1 实现为标量 `total_ms` 语义，`{ttft_ms, request_gate_ms, scan_ms}` 四元组未实装（背离，排期未定）",
        "v1 契约有此可选位、实现自 v2a 起实装，词汇表 = §4.5 六值",
      ],
      "⑤ TEST 契约 #4（latency 行 + reason 行背离加注）",
    );
  });

  it("⑥ ROADMAP：REQ 登记表 T4a 行加注（链内不落上游自报 usage / cache_reported 原值）", () => {
    expectContains(
      read(ROADMAP_REL),
      ["链内不落上游自报 `usage` / `cache_reported` 原值（契约 #4 可选位未实装），v2a 判定仅取 `ScanUnit.meta.usage`"],
      "⑥ docs/issues/5-roadmap.md 的 T4a 行加注（AC-V2a-16⑥）",
    );
  });

  it("⑦ ROADMAP：REQ 登记表 T2c 行能力边界加注（流式 findings[].offsets 在 v1 不可用）", () => {
    expectContains(
      read(ROADMAP_REL),
      ["流式命中在 v1 的 `findings[].offsets` 不可用（网关侧游标双重推进，§5 第四处），v2a 修复后方可作定位取证"],
      "⑦ docs/issues/5-roadmap.md 的 T2c 行能力边界加注（AC-V2a-16⑦）",
    );
  });

  it("#B 需求文档 §4.3：离线轮换许可按 D-03 窄化（标记文件 canary-rotate.request 零字节哨兵，网关启动序消费）", () => {
    expectContains(
      read(REQ_REL),
      ["canary-rotate.request", "零字节哨兵", "由网关下次启动时消费并执行轮换"],
      "#B 需求文档 §4.3 registry 唯一写者行（离线轮换窄化为标记文件）",
    );
  });

  it("#C 需求文档 §7 P4 第⑦条：无声明 tools 即漏检（只扩披露不扩能力；已随设计批准落盘，本条守其不被回退）", () => {
    expectContains(
      read(REQ_REL),
      ["⑦ [设计批准 2026-09-29 #C]", "请求未声明任何 `tools` 时", "属漏检"],
      "#C 需求文档 §7 P4 漏检族第⑦条",
    );
  });

  it("#D v1 DESIGN：doctor 封闭枚举 4→6 文字订正（新增 canary-registry 与 coverage-counters，AC-VETO-008-02 同批）", () => {
    expectContains(
      read(DESIGN_V1_REL),
      [
        "doctor.canary-registry",
        "doctor.coverage-counters",
        "由 v1 的 4 项扩为 6 项",
        "AC-VETO-008-02 文字同批订正",
      ],
      "#D docs/issues/2-design-v1.md 的 doctor 检查项封闭枚举（AC-VETO-008-02 同批订正）",
    );
  });

  it("#G 需求文档 AC-V2a-25：offsets 计量单位钉死为 UTF-16 code unit index（已随设计批准落盘，本条守其不被回退）", () => {
    expectContains(
      read(REQ_REL),
      ["计量单位钉死 [设计批准 2026-09-29 #G]", "UTF-16 code unit index"],
      "#G 需求文档 AC-V2a-25（offsets 计量单位）",
    );
  });

  it("AC-V2a-17：占位头名 x-llveto-session 已订正为 x-llmveto-session-id（需求文档与 README 无残留）", () => {
    const req = read(REQ_REL);
    const readme = read(README_REL);
    expectContains(
      req,
      ["x-llmveto-session-id"],
      "AC-V2a-17 需求文档（定案头名 x-llmveto-session-id，v2a 设计 D-06）",
    );
    expectNotContains(
      req,
      ["x-llveto-session"],
      "AC-V2a-17 需求文档（占位名 x-llveto-session 须全部订正，含 §4.3 / AC-V2a-17 / §10.1-10）",
    );
    expectNotContains(
      readme,
      ["x-llveto-session"],
      "AC-V2a-17 README（占位名不得引入；docs 里如有同占位名一并订正的守卫方向）",
    );
  });
});
