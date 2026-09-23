import { accessSync, chmodSync, constants, existsSync, linkSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  TRACKED_BASELINE,
  assertOutPathArg,
  assertWritableOutPath,
  canonicalPath,
  fileIdentity,
  hostPath,
  identityOf,
  inspectOutPath,
  lexicalForPlat,
  refusalMessage,
  statThrows,
} from "./out-path-guard.ts";
import {
  ADS_FORMS,
  GUARD_FORM_CASES,
  LEGAL_FORMS,
  NAME_VARIANT_FORMS,
  PRECHECK_PASS_POSIX_FORMS,
  PRECHECK_PASS_WIN32_FORMS,
  PRECHECK_THROW_FORMS,
  SYNTH_BASELINE,
  SYNTH_STREAMS,
  type GuardFormCase,
} from "./out-path-guard.cases.ts";

// @test REQ-VETO-013
// @intent tracked 基线写入守卫的**形态矩阵**进入 vitest / CI 阻断步（R10R4-C-m4）。该判据自 R8 起连续五轮
//         被走查出路径形态类缺陷，而每一轮的证据都只有人工探针——因为实现住在本文件之外的 record-baseline.ts
//         （可执行脚本，不在 vitest include 面）。抽成 out-path-guard.ts 后本文件就是那张矩阵：删掉任一条
//         折叠判据即红，不再依赖"下次有人手工试一遍"。
//
// 平台注记：宿主折叠与流名字面约束都是 **win32 专有**判据，而 CI 跑在 linux。`plat` 形参是这些分支在 CI 上
//         唯一可达的路径（理由见 out-path-guard.ts 的 hostPath 文档注）。凡涉及 win32 判据的断言一律显式传 plat。
//         "显式传"这件事本身有过一次实测翻车（R10 推送后的 CI 红）：`assertWritableOutPath` 曾自带第二个
//         `plat` 形参，用例只给 `fate` 传了 `plat` → 预检按**宿主**平台取默认值 → 流名判据在 linux 上整条被跳过
//         （本机 win32 全绿）。现在平台随 `OutPathFate.plat` 一起产出，测试与生产都拿不到第二个平台事实源。
//
// 已命名的 uncovered 面（不以恒真断言冒充覆盖）：
//   1. `UNC //localhost/d$/…`、`\\?\d:\…`、8.3 短名三类的**端到端**折叠需要 win32 realpath 与 admin-share
//      权限配合，在 linux CI 上必然得到"看环境的假绿/假红"。其**字符串层**判据（宿主折叠 + 盘符冒号不剥）
//      已在第一组跨平台覆盖；端到端人工复跑记录见 docs/adr/0002 补遗一·验证节。
//      注：`\` 型分隔符写法**不再**属于本条——词法回退按被建模的平台解释分隔符后，它在两平台都折得到
//      （见下方 "词法回退按**被建模的平台**解释" 一条；R10 推送前这里曾是一条 linux 假红）。
//   2. **整棵文件系统都报 `ino === 0`**（9p / 部分网络盘）这一环境本身造不出来，故"在该环境上跑一次真实
//      录制"不在覆盖面内。但**判据本身**已两处受测：`identityOf` 的哨兵退让是平台无关的纯函数断言；
//      win32 上 `\\.\NUL` 是一个真实存在、`statSync` 成功且报 `dev=0 ino=0` 的路径（本机实测），
//      故"`ino === 0` 时身份判据退让**且不该告警**"这一整链在 `runIf(win32)` 用例里端到端成立。
//      CI（linux）只跑前者——后者标注为平台专有，不写成恒真断言冒充跨平台覆盖。
//   3. 承上：`identityAbsent` 的**两个方向**里，`true`（tracked 侧 stat 抛错 → 定向告警）走真实缺失宿主、
//      平台无关，CI 必跑；`false`（`ino === 0` 的正常降级 → 不许告警）的端到端腿只有 win32 的 NUL 用例钉住。
//      故变异 M-d（两类 null 混类）与 M-k（`identityAbsent` 恒假）在 linux CI 上**都**存活，平台无关的
//      `identityOf` 半支必红。两条一起命名，不只报其中一条（R10R5-C-m1）。
//   4. 反斜杠别名在 **posix 宿主**上的**身份腿**不可达（R11R1-A-m2）：linux 上 `statSync("bench\\
//      baseline.json")` 查的是一个含反斜杠的字面文件名 → 不存在 → 身份为 null，即便词法折叠已把名字折对。
//      故同一用例在两台宿主上"绿的不是同一条腿"——win32 宿主 `sameName ∧ sameInode` 双真，posix 宿主只有
//      `sameName` 真（本文件里 `sameNameWin32` 那一断言即此）。后果良性：tracked 拒绝由名字腿独立承担，
//      身份腿只是第二道。这是 R11 名字折叠修复的**边界**，不是本批引入的回归，也不写成条件断言冒充双平台。
//   5. 承上第 4 条，同一边界也管**预检的宿主 FS 腿**（`R11R1-B-m1` 的处置）：`lexicalForPlat` 只接词法面
//      （`canonicalPath` 的回退分支与 `dirname` 取父），`existsSync` / `statSync` / `accessSync` 一律按
//      **字面** `outHost` 问宿主。这是**故意**的：预检的职责是"待会儿 `writeFileSync` 开得开吗"，而
//      `writeFileSync` 用的是字面名——在 posix 宿主上把 `bench\x` 改写成 `bench/x` 去探测，探的是**另一个
//      文件**的可写性，比"探不到"更错。故 posix 宿主 + win32 建模下这几腿只是对建模名的探测，
//      不等于 win32 实机；生产侧 `plat === platform()`，两种读法逐字同形（该等价性由 lexicalForPlat
//      的纯字符串用例与下面那条 `runIf(win32)` 用例钉住）。

const W = "win32";
const L = "linux";

// 形态清单与**期望判定**住在 `bench/out-path-guard.cases.ts`（R11R1-A-M2）：本文件（CI 执行面）与本机
// WSL 的预推送探针读同一张表，"探针绿"与"CI 绿"自此不再是两套断言。`ADS_FORMS` / `SYNTH_STREAMS` 被
// hostPath 那组用例单独取用（它们断言的是折叠结果，不是 refusal）。
const win32Cases = GUARD_FORM_CASES.filter((c) => c.expectWin32 === "stream");
const trackedNameCases = GUARD_FORM_CASES.filter((c) => c.expectWin32 === "tracked");
const legalCases = GUARD_FORM_CASES.filter((c) => c.expectWin32 === null);
const posixCases = GUARD_FORM_CASES.filter((c) => c.expectPosix !== undefined);

const inspected = (c: GuardFormCase, plat: string) =>
  inspectOutPath(c.form, c.tracked === undefined ? { plat } : { plat, tracked: c.tracked });

describe("期望表自身的结构元断言（共因失效面：R11R1-C-M2 / A-m6 / B-m4）", () => {
  // 单点化把"探针一份断言、CI 一份断言"换成一张表，代价是**表本身写错则两侧同绿**。下面几条
  // **不调用** hostPath / canonicalPath，只用另一套字符串表达式把"每一族该长什么样"写死，
  // 故表里一条形态被误删、误标或写错宿主时，这里先红，不必等消费者。
  // 能力边界（不吹）：防"某族被静默裁剪 / 标签写错"，**不**防"等量替换两条形态"——后者在字符串层不可判，
  //   下界只挡净减（与登记处 `MIN_BACKLOG_ROWS` 的已知限界同类，`R10R3-A-m3` 成文）。
  const tailOf = (form: string) => form.split(/[/\\]/).pop() ?? "";
  const lexicalName = (form: string) =>
    form
      .replace(/\\/g, "/")
      .split("/")
      .filter((seg) => seg !== "" && seg !== ".")
      .join("/")
      .toLowerCase();
  /** 与 `hostPath` 的 `lastIndexOf` + `slice` 无共享代码的"流后缀"取法（元断言要的是独立性）。 */
  const streamOf = (form: string): string | null => {
    const tail = tailOf(form);
    const i = tail.indexOf(":");
    return i === -1 ? null : tail.slice(i + 1);
  };

  // 刻意**不**钉各族的绝对条数（那会让每次合法的"加一条形态"都变成三处同步）；钉的是**下界**，
  // 与登记处的 `MIN_BACKLOG_ROWS` 同一惯例：合法裁剪必须同批下调本表并进 diff、走查可见；新增族成员
  // 不必动这里。实测判别力：删掉 ADS_FORMS 的一条 → 本条红（变异 M1）。
  const MIN_FORMS: Record<string, number> = { ADS_FORMS: 6, SYNTH_STREAMS: 6, NAME_VARIANT_FORMS: 4, LEGAL_FORMS: 5 };

  it("分组守恒：表长 = 四族之和、各族不少于登记下界、形态全局唯一", () => {
    expect(GUARD_FORM_CASES.length).toBe(
      ADS_FORMS.length + SYNTH_STREAMS.length + NAME_VARIANT_FORMS.length + LEGAL_FORMS.length,
    );
    const sizes: Record<string, number> = {
      ADS_FORMS: ADS_FORMS.length,
      SYNTH_STREAMS: SYNTH_STREAMS.length,
      NAME_VARIANT_FORMS: NAME_VARIANT_FORMS.length,
      LEGAL_FORMS: LEGAL_FORMS.length,
    };
    for (const [name, min] of Object.entries(MIN_FORMS)) {
      expect([name, sizes[name] >= min]).toEqual([name, true]);
    }
    const forms = GUARD_FORM_CASES.map((c) => c.form);
    expect(new Set(forms).size).toBe(forms.length);
  });

  it("标 `stream` 的每条都是「末段含冒号」的真流引用；标 `tracked` 的每条词法名恰是本名且末段无冒号", () => {
    for (const c of GUARD_FORM_CASES.filter((x) => x.expectWin32 === "stream")) {
      expect([c.form, tailOf(c.form).includes(":")]).toEqual([c.form, true]);
    }
    for (const c of GUARD_FORM_CASES.filter((x) => x.expectWin32 === "tracked")) {
      expect([c.form, lexicalName(c.form)]).toEqual([c.form, TRACKED_BASELINE]);
      expect([c.form, tailOf(c.form).includes(":")]).toEqual([c.form, false]);
    }
  });

  it("放行族的每条末段都**不是** `baseline.json`（防把 tracked 变体误标成放行）", () => {
    for (const c of GUARD_FORM_CASES.filter((x) => x.expectWin32 === null)) {
      expect([c.form, tailOf(c.form).toLowerCase() === "baseline.json"]).toEqual([c.form, false]);
      expect([c.form, lexicalName(c.form) === TRACKED_BASELINE]).toEqual([c.form, false]);
    }
  });

  it("预检族自洽：win32 必 throw 者的流后缀恰为「空串或含冒号」，posix 对照组与 win32 拒族同形", () => {
    for (const form of PRECHECK_THROW_FORMS) {
      const s = streamOf(form);
      expect([form, s === "" || (s !== null && s.includes(":"))]).toEqual([form, true]);
    }
    for (const form of PRECHECK_PASS_WIN32_FORMS) {
      const s = streamOf(form);
      expect([form, s !== null && s !== "" && !s.includes(":")]).toEqual([form, true]);
    }
    // 同一批畸形形态在 posix 建模下必须**整条不生效**（下方预检用例证其放行）：这钉的是"该判据
    // 属 win32 专有而非通用字面约束"，若有人把两组写成不相干的形态，这里先红。
    const thrown: readonly string[] = PRECHECK_THROW_FORMS;
    for (const form of PRECHECK_PASS_POSIX_FORMS) {
      expect([form, thrown.includes(form)]).toEqual([form, true]);
    }
  });
});

describe("hostPath：win32 宿主折叠（把 `:` 后缀剥回宿主文件）", () => {
  it("末段流后缀一律剥掉，含多级流与经典默认流", () => {
    for (const form of ADS_FORMS) {
      expect(hostPath(form, W)).toBe(form.startsWith("bench\\") ? "bench\\baseline.json" : TRACKED_BASELINE);
    }
  });

  it("别名前缀（UNC / admin share / 设备命名空间）+ 新流名：只剥最后一个冒号段", () => {
    expect(hostPath("//localhost/d$/projects/llmveto/bench/baseline.json:zzz", W)).toBe(
      "//localhost/d$/projects/llmveto/bench/baseline.json",
    );
    expect(hostPath("\\\\?\\d:\\projects\\llmveto\\bench\\baseline.json:zzz", W)).toBe(
      "\\\\?\\d:\\projects\\llmveto\\bench\\baseline.json",
    );
  });

  it("盘符相对与 UNC 共享根里的冒号**不是**流分隔符（只认最后一个分隔符之后的冒号）", () => {
    expect(hostPath("C:f.json:tag", W)).toBe("C:f.json");
    expect(hostPath("C:\\dir\\f.json", W)).toBe("C:\\dir\\f.json");
    expect(hostPath("//localhost/d$/x/y.json", W)).toBe("//localhost/d$/x/y.json");
    // 裸 `f:` 由 `/^[A-Za-z]:/` 分支识别为**盘符根**，不是"文件 f 的空流名"——两种解读结论不同，钉死。
    expect(hostPath("f:", W)).toBe("f:");
    expect(hostPath("f:", L)).toBe("f:");
    // 单字母盘符宿主 + 多级流：`start = 2` 之后**第一个**冒号在索引 3，故折到 `f:a`（宿主）+ 流名 `b`，
    // 是合法可写形态（`out-path-guard.ts` 的 R10R5-B-m1 注释与 ADR 补遗四都如此声称；本轮走查有专家
    // 按"`sep + 1` = 2 ⇒ 切到 `f:`"读过，实跑证否）。**钉成断言**而非留在注释里。
    expect(hostPath("f:a:b", W)).toBe("f:a");
    expect(hostPath("D:h.txt:w9", W)).toBe("D:h.txt");
  });

  it("posix 上 `:` 是普通文件名字符 → 恒等（realpath 本就能区分该文件与 tracked）", () => {
    for (const form of [...ADS_FORMS, ...SYNTH_STREAMS, "//localhost/d$/x/baseline.json:zzz"]) {
      expect(hostPath(form, L)).toBe(form);
    }
  });

  it("不传 plat 时取真实平台（默认参数不改变既有调用方语义）", () => {
    const form = `${TRACKED_BASELINE}:s`;
    expect(hostPath(form)).toBe(process.platform === "win32" ? TRACKED_BASELINE : form);
  });
});

describe("canonicalPath：名字折叠（realpath 优先，退化词法；大小写按平台）", () => {
  it("同一文件的词法变体折到同一串", () => {
    const tracked = canonicalPath(TRACKED_BASELINE, L);
    for (const alias of ["./bench/baseline.json", "bench/./baseline.json", TRACKED_BASELINE]) {
      expect(canonicalPath(alias, L)).toBe(tracked);
    }
  });

  it("大小写折叠只在大小写不敏感平台生效", () => {
    // 断言用**两侧都不存在**的合成路径族：真实 win32 上 realpath 会自行返回正确大小写的长名（实测
    // `bench/BASELINE.JSON` → `D:\projects\llmveto\bench\baseline.json`），那是与 plat 无关的第三道防线，
    // 混进来会让本条只在 linux 上成立。
    const upper = "bench/no-such-family.JSON";
    const lower = "bench/no-such-family.json";
    expect(canonicalPath(upper, W)).toBe(canonicalPath(lower, W));
    expect(canonicalPath(upper, "darwin")).toBe(canonicalPath(lower, "darwin"));
    expect(canonicalPath(upper, L)).not.toBe(canonicalPath(lower, L));
  });

  it("词法回退按**被建模的平台**解释 `\\`（linux CI 上也折得动 win32 分隔符）", () => {
    // 两侧都不存在的合成宿主：realpath 在三平台一致抛错 → 必走词法回退，故本条判的是 `lexicalForPlat`
    // 本身，而不是宿主文件系统的脾气。R10 推送前这里是**一条 linux 假红**：posix 的 `resolve` 把 `\`
    // 当普通文件名字符，`bench\\no-such-family.json` 折不到 `bench/no-such-family.json`。
    expect(canonicalPath("bench\\no-such-family.json", W)).toBe(canonicalPath(SYNTH_BASELINE, W));
    expect(canonicalPath("bench\\no-such-family.JSON", W)).toBe(canonicalPath(SYNTH_BASELINE, W));
    // 同一形态在 posix 建模下**不得**被折成分隔符（win32 判据不得越平台误伤）。这条只在宿主非 win32 时
    // 有意义：win32 宿主的 `resolve` 自己就把 `\` 当分隔符，与 plat 无关，故不在此断言。
    if (process.platform !== "win32") {
      expect(canonicalPath("bench\\no-such-family.json", L)).not.toBe(canonicalPath(SYNTH_BASELINE, L));
    }
  });

  it("lexicalForPlat 的改写规则本身（平台无关、不碰文件系统，两平台 CI 都跑 —— R11R1-A-m1）", () => {
    // 上面那条"等价性"用例是 it.runIf(win32)，即在 linux CI 上被 skip；在它被 skip 的地方，
    // 本条纯字符串断言仍在跑：win32 建模下 `\` → `/`（全部、含 UNC 前缀），其余平台恒等。
    expect(lexicalForPlat("bench\\baseline.json", W)).toBe("bench/baseline.json");
    expect(lexicalForPlat("\\\\srv\\share\\a\\b.json", W)).toBe("//srv/share/a/b.json");
    expect(lexicalForPlat("bench/baseline.json", W)).toBe("bench/baseline.json");
    expect(lexicalForPlat("bench\\baseline.json", L)).toBe("bench\\baseline.json");
    expect(lexicalForPlat("bench\\baseline.json", "darwin")).toBe("bench\\baseline.json");
    // 恒等分支不吞字符：posix 建模下 `\` 是合法文件名字符，改写它才是 bug。
    expect(lexicalForPlat("a\\b", L)).toBe("a\\b");
  });

  it.runIf(process.platform === "win32")(
    "win32 宿主上「把 `\\` 换成 `/`」不改变任何判定（lexicalForPlat 的等价性承诺，非显然）",
    () => {
      // 文档注里"生产两平台行为逐字不变"的整条论证押在这个等价性上，所以把它钉成断言而不是叙述。
      for (const [back, fwd] of [
        ["bench\\baseline.json", TRACKED_BASELINE],
        ["bench\\baseline.local.json", "bench/baseline.local.json"],
        ["bench\\no-such-family.json", "bench/no-such-family.json"],
      ] as const) {
        expect(canonicalPath(back, W)).toBe(canonicalPath(fwd, W));
        expect(inspectOutPath(back, { plat: W }).refusal).toBe(inspectOutPath(fwd, { plat: W }).refusal);
        expect(fileIdentity(back)).toBe(fileIdentity(fwd));
      }
    },
  );
});

describe("inspectOutPath：tracked 家族拒绝矩阵（补遗一的 17 形态，改为自动化）", () => {
  it("win32 下六种流形态 → refusal='stream'（宿主折叠先于名字与身份判据生效）", () => {
    for (const c of win32Cases) {
      const f = inspected(c, W);
      expect([c.form, f.refusal]).toEqual([c.form, "stream"]);
      // 机制断言（与下面的结构元断言同一族：标签不许与机制脱钩）：`"stream"` 这个理由**只能**来自
      // "宿主折叠确实发生了"这条腿；只钉标签与结果的话，将来有人把理由硬编码成 stream 也不会红。
      expect([c.form, f.outHost === c.form]).toEqual([c.form, false]);
      // 同一套后缀换成不存在的宿主，结论不变（证明拒绝来自**字符串折叠**而非宿主的真实存在）；
      // 真实宿主那一族另钉 sameName：宿主折叠必须把它折回 tracked 的同一个名字。
      if (c.sameNameWin32) expect([c.form, f.sameName]).toEqual([c.form, true]);
    }
  });

  it("win32 下名字变体（相对前缀 / 中间 `.` / 大小写 / 本名）→ refusal='tracked'", () => {
    for (const c of trackedNameCases) {
      const f = inspected(c, W);
      expect([c.form, f.refusal]).toEqual([c.form, "tracked"]);
      expect([c.form, f.outHost]).toEqual([c.form, c.form]);
    }
  });

  it("同一批 `:` 形态在 posix 下是**另一个文件**的名字 → 放行（win32 判据不得越平台误伤）", () => {
    // 合成族（两侧都不存在，realpath 在三平台一致抛错 → 走词法 resolve）：本组要断言的是 **plat 这条
    // 字符串判据**，不能让宿主文件系统的折叠混进来。真实 tracked 基线上 `…::$DATA` 在 win32 会被
    // realpath 自己折回宿主（见下一条），那是 plat 之外的独立防线，不是本组语义。
    for (const c of posixCases) {
      expect([c.form, inspected(c, L).refusal]).toEqual([c.form, c.expectPosix]);
    }
  });

  it.runIf(process.platform === "win32")(
    "win32 宿主的 realpath 独立折叠默认流（plat 之外的第三道防线，不得被模拟平台掩盖）",
    () => {
      expect(canonicalPath("bench\\baseline.json::$DATA", L)).toBe(canonicalPath(TRACKED_BASELINE, L));
      expect(inspectOutPath("bench\\baseline.json::$DATA", { plat: L }).refusal).toBe("tracked");
    },
  );

  it("合法 out 路径全部放行（上两条拒绝形态的对照组，含 `x:y` 型畸形短名与盘符相对）", () => {
    for (const c of legalCases) {
      expect([c.form, inspected(c, W).refusal]).toEqual([c.form, null]);
    }
  });

  it("健康仓内 tracked 基线可读 → identityAbsent=false（告警判据不虚报）", () => {
    const f = inspectOutPath("bench/baseline.local.json", { plat: W });
    expect(f.identityAbsent).toBe(false);
    expect(fileIdentity(TRACKED_BASELINE)).toMatch(/^\d+:\d+$/);
  });
});

describe("assertOutPathArg：argv 形态拒绝", () => {
  it("空串 / 纯空白 → empty out path", () => {
    for (const form of ["", "   ", "\t"]) {
      expect(() => assertOutPathArg(form)).toThrow(/empty out path/);
    }
  });

  it("`-` 开头 → unknown flag（含 `--help`）", () => {
    for (const form of ["-", "--help", "-o"]) {
      expect(() => assertOutPathArg(form)).toThrow(/unknown flag/);
    }
  });

  it("正常路径与盘符相对路径不受影响（`-` 只认首字符）", () => {
    for (const form of [TRACKED_BASELINE, "bench/my-baseline.json", "C:baseline.local.json"]) {
      expect(() => assertOutPathArg(form)).not.toThrow();
    }
  });
});

describe("身份判据（真实链接，跨平台可跑）", () => {
  // skipIf/runIf 的能力探测必须在**收集阶段**求值，故全部放在 describe 体内而非 beforeAll。
  const root = mkdtempSync(join(tmpdir(), "llmveto-guard-"));
  const tracked = join(root, "baseline.json");
  const aliasPath = join(root, "alias.json");
  const linkPath = join(root, "via-symlink.json");
  const freshPath = join(root, "not-yet-recorded.json");
  writeFileSync(tracked, "{}\n", "utf8");
  const canLink = (() => {
    try {
      linkSync(tracked, aliasPath);
      return true;
    } catch {
      return false; // 部分文件系统不支持硬链接（若干网络盘 / 容器挂载）
    }
  })();
  const canSymlink = (() => {
    try {
      symlinkSync(tracked, linkPath);
      return true;
    } catch {
      return false; // win32 建 symlink 需特权
    }
  })();

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // skipIf 的第二个原因行硬链接不支持；符号链接在 win32 无特权时不可用。
  it.skipIf(!canLink)("硬链接别名：名字不等、dev:ino 全等 → refusal='alias'", () => {
    const f = inspectOutPath(aliasPath, { tracked });
    expect(f.sameName).toBe(false);
    expect(f.sameInode).toBe(true);
    expect(f.refusal).toBe("alias");
  });

  it.skipIf(!canSymlink)("符号链接：realpath 折叠名字 → refusal='tracked'（走名字分支而非 alias）", () => {
    const f = inspectOutPath(linkPath, { tracked });
    expect(f.sameName).toBe(true);
    expect(f.refusal).toBe("tracked");
  });

  it("同目录下的另一个真实文件 → 放行（双判据皆假）", () => {
    const other = join(root, "other.json");
    writeFileSync(other, "{}\n", "utf8");
    const f = inspectOutPath(other, { tracked });
    expect([f.sameName, f.sameInode, f.refusal]).toEqual([false, false, null]);
  });

  it("首次录制的目标尚不存在 → 放行且**不**告警（out 侧 stat 失败是合法高频场景）", () => {
    const f = inspectOutPath(freshPath, { tracked });
    expect(f.refusal).toBeNull();
    expect(f.identityAbsent).toBe(false);
    expect(fileIdentity(freshPath)).toBeNull();
    expect(statThrows(freshPath)).toBe(true);
  });

  it("tracked 侧 stat 抛错 → identityAbsent=true（守卫降级为纯名字判定，须定向告警）", () => {
    const f = inspectOutPath(aliasPath, { tracked: join(root, "no-such-tracked.json") });
    expect(f.identityAbsent).toBe(true);
    expect(f.sameInode).toBe(false);
  });
});

describe("`ino === 0` 哨兵：身份判据退让且**不**告警（两类 null 成因的分行）", () => {
  // win32 上 `\\.\NUL` 是设备命名空间里的固定路径，真实存在、statSync 成功且报 dev=0/ino=0（本机实测，
  // 记录于 docs/adr/0002 补遗一·验证节）—— "文件系统报不出文件 ID"这一支唯一能白手构造的实例，
  // 无需 9p / 网络盘挂载。能力边界就是平台本身，故用 runIf 而非运行时探测。
  const NUL = "\\\\.\\NUL";

  it("identityOf：`ino === 0` 一律退让为 null，与 dev 无关；非零才成形", () => {
    expect(identityOf({ dev: 0, ino: 0 })).toBeNull();
    expect(identityOf({ dev: 119610712, ino: 0 })).toBeNull();
    expect(identityOf({ dev: 7, ino: 9 })).toBe("7:9");
  });

  it.runIf(process.platform === "win32")(
    "win32 真实哨兵路径（`\\\\.\\NUL`）：身份退让为 null、stat 未抛错 → identityAbsent 必须为假",
    () => {
      // 与"tracked 不存在"那一条的**唯一**区别就是成因：那里 stat 抛错 → 该告警；这里 stat 成功但
      // ino=0 → 正常降级，不该告警。混类（`identityAbsent = trackedIdentity === null`）在此转红。
      expect(statThrows(NUL)).toBe(false);
      expect(fileIdentity(NUL)).toBeNull();
      const f = inspectOutPath(TRACKED_BASELINE, { tracked: NUL, plat: W });
      expect(f.identityAbsent).toBe(false);
      expect(f.sameInode).toBe(false);
    },
  );
});

describe("assertWritableOutPath：采样前的写可达性预检", () => {
  const root = mkdtempSync(join(tmpdir(), "llmveto-writable-"));
  const probePath = join(root, "probe-mode.json");
  writeFileSync(probePath, "{}\n", "utf8");
  chmodSync(probePath, 0o000);
  // 自校准：root 下 accessSync(W_OK) 恒成功，部分 win32 ACL 亦然，此时"不可写"这一支在本环境不可观测。
  // 与其留一条会在 CI 假红的断言，不如显式 skip 并把原因写在这里。
  let wOkObservable = false;
  try {
    accessSync(probePath, constants.W_OK);
  } catch {
    wOkObservable = true;
  }
  chmodSync(probePath, 0o600);

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const fate = (p: string, plat?: string) => inspectOutPath(p, plat === undefined ? {} : { plat });

  it("空宿主（裸 `:stream` 折叠后 / 纯空白）→ 即刻 throw，不跑满 10×3 采样", () => {
    expect(() => assertWritableOutPath(fate(":probestream", W))).toThrow(/host is empty/);
    expect(() => assertWritableOutPath(fate("   ", W))).toThrow(/host is empty/);
  });

  it("NTFS 流名字面约束（R10R4-A-m2）：空流名 / 流名含冒号 → 预检即拒（实测该型即使宿主存在也 ENOENT）", () => {
    for (const form of PRECHECK_THROW_FORMS) {
      expect(() => assertWritableOutPath(fate(form, W))).toThrow(/alternate data stream name/);
    }
  });

  it("合法流名（`tag` / `$DATA`）不被误拒；posix 上整条判据不生效", () => {
    for (const form of PRECHECK_PASS_WIN32_FORMS) {
      expect(() => assertWritableOutPath(fate(form, W))).not.toThrow();
    }
    for (const form of PRECHECK_PASS_POSIX_FORMS) {
      expect(() => assertWritableOutPath(fate(form, L))).not.toThrow();
    }
  });

  it("父目录不存在 → throw 并指名缺哪个目录（record 从不 mkdir）", () => {
    expect(() => assertWritableOutPath(fate(join(root, "no-such-dir", "out.json")))).toThrow(
      /parent directory .* does not exist/,
    );
  });

  it("目标已存在但不是普通文件（目录）→ throw。这条在 win32 上不可省：目录的 W_OK 近乎恒真（R10R4-B-m2）。", () => {
    const dir = join(root, "a-dir");
    mkdirSync(dir, { recursive: true });
    expect(existsSync(dir)).toBe(true);
    expect(statSync(dir).isFile()).toBe(false);
    expect(() => assertWritableOutPath(fate(dir))).toThrow(/is not a regular file/);
  });

  it("已存在的普通文件 / 尚不存在的新文件 → 放行（健康录制路径零误伤）", () => {
    const existing = join(root, "existing.json");
    writeFileSync(existing, "{}\n", "utf8");
    expect(() => assertWritableOutPath(fate(existing))).not.toThrow();
    expect(() => assertWritableOutPath(fate(join(root, "new.json")))).not.toThrow();
  });

  it.skipIf(!wOkObservable)("文件不可写 → throw（W_OK 在本环境不受 mode 影响时该支不可观测）", () => {
    const denied = join(root, "denied.json");
    writeFileSync(denied, "{}\n", "utf8");
    chmodSync(denied, 0o000);
    try {
      expect(() => assertWritableOutPath(fate(denied))).toThrow(/is not writable/);
    } finally {
      chmodSync(denied, 0o600);
    }
  });
});

describe("refusalMessage：三种理由措辞逐字可辨", () => {
  it("stream / alias / tracked 各带自己的限定语，且共同指向 CI record job", () => {
    expect(refusalMessage("stream")).toContain("an NTFS alternate data stream of it");
    expect(refusalMessage("alias")).toContain("same file identity via an alias path");
    expect(refusalMessage("tracked")).not.toContain("alternate data stream");
    expect(refusalMessage("tracked")).not.toContain("alias path");
    for (const via of ["stream", "alias", "tracked"] as const) {
      expect(refusalMessage(via)).toContain("refusing to overwrite the tracked authoritative baseline");
      expect(refusalMessage(via)).toContain("docs/adr/0002");
    }
  });
});
