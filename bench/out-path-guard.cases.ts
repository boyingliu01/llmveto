// @no-test-required: 纯数据模块（形态清单 + 期望判定），无逻辑；其消费者即判据的执行面 ——
//   bench/out-path-guard.test.ts（CI 阻断步）与 var/probe-linux-r11.ts（预推送 linux 探针）都只读它。
//   本文件不需要自己的 .test.ts：给它写断言等价于"断言这张表等于它自己"，恒真。要红只能通过消费者。
//   但"表错则两侧同绿"这一共因面**不是**无人守：消费者侧有一族结构元断言（测试文件里
//   「期望表自身的结构元断言」一节），它们只用另一套字符串表达式核"每族该长什么样"，不调用判据实现。
// 写入守卫的**形态 × 期望**单表（R11R1-A-M2）。
//
// 为什么要有这个文件：本仓的守卫判据是"平台可注入"的字符串判据，而它的两次真实翻车都发生在
// "**只有 CI 是 linux**"这个结构性盲区里（R10 推送后 16 秒转红的那两条即在此）。当时的预推送 linux
// 通道是一条**手写断言**的探针（`node --experimental-strip-types` 直取判据模块，绕开 vitest 的原生绑定），
// 于是"探针绿"与"CI 的 vitest 绿"是两套代码里的两套期望值——它们可以各自漂移，而这正是本表要消除的：
// 形态清单与期望结果只在此处写一次，`out-path-guard.test.ts`（CI 执行面）与 linux 预推送探针
// （本机 WSL）共用同一份，探针不再自带第二份判断。
//
// 本表**不**声称闭掉的残余（如实命名）：vitest 自身的分支选择（`it.runIf` / `it.skipIf` 在两台宿主上各选
// 哪一支）、`chmod 0` 的真实 EPERM 可观测性、符号链接与硬链接的能力探测，以及 `tests/integration/**` 与
// `tests/e2e/**` 至今无 CI 执行面那一段（登记为 `R10R2-A-m2`）——这些仍只在各自 runner 上暴露。本表覆盖的是
// "同一批形态在两种平台建模下的拒绝理由"这一族字符串判据，恰好就是把本仓烧过两次的那一族。
import { TRACKED_BASELINE, type RefusalVia } from "./out-path-guard.ts";

/** 合成宿主：两侧都不存在 → realpath 在三平台一致抛错 → 判定必然来自词法折叠，不受宿主文件系统干扰。 */
export const SYNTH_BASELINE = "bench/no-such-family.json";

/**
 * 受保护基线的历史流穿透形态（R10R2-C-M1 的收口对象），取自 docs/adr/0002 补遗一·验证节。
 * 其中 `bench\baseline.json::$DATA`（反斜杠宿主写法）同时是 `R11-CI-1` 红灯 ① 的正身形态。
 */
export const ADS_FORMS = [
  `${TRACKED_BASELINE}:probestream`,
  `${TRACKED_BASELINE}:probestreamC`,
  `${TRACKED_BASELINE}:NEW:two`,
  `${TRACKED_BASELINE}:$DATA`,
  "bench\\baseline.json::$DATA",
  `${TRACKED_BASELINE}:brandnewstream`,
] as const;

/** 同一套流后缀挂在一个**两侧都不存在**的合成宿主上：断言纯字符串判据，不受宿主文件系统折叠干扰。 */
export const SYNTH_STREAMS = [
  `${SYNTH_BASELINE}:probestream`,
  `${SYNTH_BASELINE}:probestreamC`,
  `${SYNTH_BASELINE}:NEW:two`,
  `${SYNTH_BASELINE}:$DATA`,
  "bench\\no-such-family.json::$DATA",
  `${SYNTH_BASELINE}:brandnewstream`,
] as const;

/** 名字变体一族：折叠后仍必须是 tracked 本名。 */
export const NAME_VARIANT_FORMS = [
  "./bench/baseline.json",
  "bench/./baseline.json",
  "bench/BASELINE.JSON",
  TRACKED_BASELINE,
] as const;

/** 对照组：合法 out 路径在两种平台建模下都必须放行（拒绝面不得扩成误伤面）。 */
export const LEGAL_FORMS = [
  "bench/baseline.local.json",
  "bench/dir/../baseline.local.json",
  "C:\\tmp\\baseline.other.json",
  "C:baseline.local.json",
  "x:y",
] as const;

/** 一条形态及其在两种平台建模下**应当**得到的判定。 */
export interface GuardFormCase {
  readonly form: string;
  /** `inspectOutPath` 的 `tracked` 注入点：合成宿主一族用它把判据钉在纯字符串面上。 */
  readonly tracked?: string;
  /** 按 win32 建模时的期望拒绝理由（`null` = 放行）。 */
  readonly expectWin32: RefusalVia | null;
  /**
   * 按 posix（linux）建模时的期望拒绝理由；`undefined` = 本行在 posix 建模下**不**作断言。
   * 真实 tracked 宿主那一族即属此类：posix 建模下它的 `refusal` 由 realpath 折叠决定（属 `plat`
   * 之外的另一道防线），断言它会混入宿主文件系统语义，见测试「win32 宿主的 realpath 独立折叠默认流」。
   */
  readonly expectPosix?: RefusalVia | null;
  /** win32 建模下该形态须与 tracked 折到同一**名字**（宿主折叠生效的直接证据）。 */
  readonly sameNameWin32?: true;
  /** win32 建模下 `outHost` 逐字等于输入形态（名字变体一族：折叠不得把宿主改写成别的东西）。 */
  readonly hostIsFormWin32?: true;
}

export const GUARD_FORM_CASES: readonly GuardFormCase[] = [
  ...ADS_FORMS.map(
    (form): GuardFormCase => ({ form, expectWin32: "stream", sameNameWin32: true }),
  ),
  ...SYNTH_STREAMS.map(
    (form): GuardFormCase => ({
      form,
      tracked: SYNTH_BASELINE,
      expectWin32: "stream",
      expectPosix: null,
    }),
  ),
  ...NAME_VARIANT_FORMS.map(
    (form): GuardFormCase => ({ form, expectWin32: "tracked", hostIsFormWin32: true }),
  ),
  ...LEGAL_FORMS.map((form): GuardFormCase => ({ form, expectWin32: null, expectPosix: null })),
];

/** 写可达性预检必须**即刻**拒的形态（win32 建模；空流名 / 流名含冒号，R10R4-A-m2）。 */
export const PRECHECK_THROW_FORMS = ["mydata:", "mydata::", "mydata:a:b", `${TRACKED_BASELINE}:`] as const;

/** 预检对照组：合法流名不被误拒（win32）；同一批畸形形态在 posix 上整条判据不生效。 */
export const PRECHECK_PASS_WIN32_FORMS = ["mydata:tag", "mydata:$DATA"] as const;
export const PRECHECK_PASS_POSIX_FORMS = ["mydata:", "mydata:a:b"] as const;
