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
  refusalMessage,
  statThrows,
} from "./out-path-guard.ts";

// @test REQ-VETO-013
// @intent tracked 基线写入守卫的**形态矩阵**进入 vitest / CI 阻断步（R10R4-C-m4）。该判据自 R8 起连续五轮
//         被走查出路径形态类缺陷，而每一轮的证据都只有人工探针——因为实现住在本文件之外的 record-baseline.ts
//         （可执行脚本，不在 vitest include 面）。抽成 out-path-guard.ts 后本文件就是那张矩阵：删掉任一条
//         折叠判据即红，不再依赖"下次有人手工试一遍"。
//
// 平台注记：宿主折叠与流名字面约束都是 **win32 专有**判据，而 CI 跑在 linux。`plat` 形参是这些分支在 CI 上
//         唯一可达的路径（理由见 out-path-guard.ts 的 hostPath 文档注）。凡涉及 win32 判据的断言一律显式传 plat。
//
// 已命名的 uncovered 面（不以恒真断言冒充覆盖）：
//   1. `UNC //localhost/d$/…`、`\\?\d:\…`、8.3 短名三类的**端到端**折叠需要 win32 realpath 与 admin-share
//      权限配合，在 linux CI 上必然得到"看环境的假绿/假红"。其**字符串层**判据（宿主折叠 + 盘符冒号不剥）
//      已在第一组跨平台覆盖；端到端人工复跑记录见 docs/adr/0002 补遗一·验证节。
//   2. **整棵文件系统都报 `ino === 0`**（9p / 部分网络盘）这一环境本身造不出来，故"在该环境上跑一次真实
//      录制"不在覆盖面内。但**判据本身**已两处受测：`identityOf` 的哨兵退让是平台无关的纯函数断言；
//      win32 上 `\\.\NUL` 是一个真实存在、`statSync` 成功且报 `dev=0 ino=0` 的路径（本机实测），
//      故"`ino === 0` 时身份判据退让**且不该告警**"这一整链在 `runIf(win32)` 用例里端到端成立。
//      CI（linux）只跑前者——后者标注为平台专有，不写成恒真断言冒充跨平台覆盖。

const W = "win32";
const L = "linux";

/** 受保护基线的历史流穿透形态（R10R2-C-M1 的收口对象），取自 docs/adr/0002 补遗一·验证节。 */
const ADS_FORMS = [
  `${TRACKED_BASELINE}:probestream`,
  `${TRACKED_BASELINE}:probestreamC`,
  `${TRACKED_BASELINE}:NEW:two`,
  `${TRACKED_BASELINE}:$DATA`,
  `bench\\baseline.json::$DATA`,
  `${TRACKED_BASELINE}:brandnewstream`,
] as const;

/** 同一套流后缀挂在一个**两侧都不存在**的合成宿主上：断言纯字符串判据，不受宿主文件系统折叠干扰。 */
const SYNTH = "bench/no-such-family.json";
const SYNTH_STREAMS = [
  `${SYNTH}:probestream`,
  `${SYNTH}:probestreamC`,
  `${SYNTH}:NEW:two`,
  `${SYNTH}:$DATA`,
  `bench\\no-such-family.json::$DATA`,
  `${SYNTH}:brandnewstream`,
] as const;

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
  });

  it("posix 上 `:` 是普通文件名字符 → 恒等（realpath 本就能区分该文件与 tracked）", () => {
    for (const form of [...ADS_FORMS, "//localhost/d$/x/baseline.json:zzz"]) {
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
});

describe("inspectOutPath：tracked 家族拒绝矩阵（补遗一的 17 形态，改为自动化）", () => {
  it("win32 下六种流形态 → refusal='stream'（宿主折叠先于名字与身份判据生效）", () => {
    for (const form of ADS_FORMS) {
      const f = inspectOutPath(form, { plat: W });
      expect([form, f.refusal]).toEqual([form, "stream"]);
      expect(f.sameName).toBe(true);
    }
    // 同一套后缀换成不存在的宿主，结论不变（证明拒绝来自**字符串折叠**而非宿主的真实存在）。
    for (const form of SYNTH_STREAMS) {
      expect([form, inspectOutPath(form, { plat: W, tracked: SYNTH }).refusal]).toEqual([form, "stream"]);
    }
  });

  it("win32 下名字变体（相对前缀 / 中间 `.` / 大小写 / 本名）→ refusal='tracked'", () => {
    for (const form of ["./bench/baseline.json", "bench/./baseline.json", "bench/BASELINE.JSON", TRACKED_BASELINE]) {
      const f = inspectOutPath(form, { plat: W });
      expect([form, f.refusal]).toEqual([form, "tracked"]);
      expect(f.outHost).toBe(form);
    }
  });

  it("同一批 `:` 形态在 posix 下是**另一个文件**的名字 → 放行（win32 判据不得越平台误伤）", () => {
    // 合成族（两侧都不存在，realpath 在三平台一致抛错 → 走词法 resolve）：本组要断言的是 **plat 这条
    // 字符串判据**，不能让宿主文件系统的折叠混进来。真实 tracked 基线上 `…::$DATA` 在 win32 会被
    // realpath 自己折回宿主（见下一条），那是 plat 之外的独立防线，不是本组语义。
    for (const form of SYNTH_STREAMS) {
      expect([form, inspectOutPath(form, { plat: L, tracked: SYNTH }).refusal]).toEqual([form, null]);
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
    for (const form of [
      "bench/baseline.local.json",
      "bench/dir/../baseline.local.json",
      "C:\\tmp\\baseline.other.json",
      "C:baseline.local.json",
      "x:y",
    ]) {
      expect([form, inspectOutPath(form, { plat: W }).refusal]).toEqual([form, null]);
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
    for (const form of ["mydata:", "mydata::", "mydata:a:b", `${TRACKED_BASELINE}:`]) {
      expect(() => assertWritableOutPath(fate(form, W))).toThrow(/alternate data stream name/);
    }
  });

  it("合法流名（`tag` / `$DATA`）不被误拒；posix 上整条判据不生效", () => {
    for (const form of ["mydata:tag", "mydata:$DATA"]) {
      expect(() => assertWritableOutPath(fate(form, W))).not.toThrow();
    }
    for (const form of ["mydata:", "mydata:a:b"]) {
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
