#!/usr/bin/env node
// 本地开发环境修补：glibc < 2.38 的发行版（Ubuntu 22.04 等）无法运行
// @archlinter/cli-linux-x64 的 gnu 二进制。@archlinter/cli 的启动器按
// `ldd --version` 判断 libc 是否 musl，glibc 系统永远选 gnu 版，且没有覆盖开关。
// 因此把 gnu 二进制替换成同版本的 musl 二进制——行为一致、无 GLIBC 依赖。
//
// 特性：
//   - 幂等：已经是 musl 二进制（或已打补丁）则跳过。
//   - 保守：glibc 版本已满足（>= 2.38）时不动任何文件。
//   - 失败不致命：只打印提示，不让 bun install 失败。
// 注意：`bun install` / `npm ci` 会重新下载 gnu 二进制，所以装完依赖后需要手动跑一次：
//   bun run dev:patch-archlint
//
// **不挂在 postinstall 上**（v2b-A 修复）：postinstall 会被每一个 `npm i -g llmveto` 的使用者执行，
// 而这个路径（node_modules/@archlinter/...）只有在**本仓库开发时**才存在。
// 挂在 postinstall 上曾经导致 release gate 的 install-tarball 步失败：
// 打包产物里没有 scripts/ 目录，安装后 `node scripts/patch-archlint-musl.mjs` 直接 MODULE_NOT_FOUND。

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const GNUC_REQUIRED = [2, 38];
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const gnuBin = join(root, "node_modules/@archlinter/cli-linux-x64/bin/archlint");
const muslBin = join(root, "node_modules/@archlinter/cli-linux-x64-musl/bin/archlint");

/** 读 glibc 版本（形如 [2, 35]）；纯 musl 系统或读不到时返回 null。 */
function glibcVersion() {
  const ldd = spawnSync("ldd", ["--version"], { encoding: "utf8" });
  const m = /GLIBC (\d+)\.(\d+)/.exec(`${ldd.stdout}${ldd.stderr}`);
  return m === null ? null : [Number(m[1]), Number(m[2])];
}

function atLeast([maj, min], [reqMaj, reqMin]) {
  return maj > reqMaj || (maj === reqMaj && min >= reqMin);
}

/** gnu 与 musl 二进制内容相同 => 已是打过补丁的状态（读失败也按"不相同"处理）。 */
function sameContent() {
  try {
    const [a, b] = [readFileSync(gnuBin), readFileSync(muslBin)];
    return a.equals(b);
  } catch {
    return false;
  }
}

/** 平台/文件/已打补丁 三类前提，任一不满足就整只跳过。 */
function preconditionsMet() {
  if (process.platform !== "linux") return false;
  if (process.arch !== "x64") return false;
  return existsSync(gnuBin) && existsSync(muslBin) && !sameContent();
}

/** 需要修补时返回 glibc 版本，否则返回 null。 */
function patchNeeded() {
  if (!preconditionsMet()) return null;
  const glibc = glibcVersion();
  if (glibc === null) return null; // musl 发行版：启动器本就选 musl 包
  if (atLeast(glibc, GNUC_REQUIRED)) return null; // gnu 二进制可用，无需修补
  return glibc;
}

function main() {
  const glibc = patchNeeded();
  if (glibc === null) return;
  copyFileSync(muslBin, gnuBin);
  console.log(
    `[patch-archlint-musl] glibc ${glibc.join(".")} < ${GNUC_REQUIRED.join(".")}：` +
      "已在 @archlinter/cli-linux-x64 中换入 musl 二进制",
  );
}

try {
  main();
} catch (err) {
  console.warn("[patch-archlint-musl] 跳过（非致命）：", err);
}
