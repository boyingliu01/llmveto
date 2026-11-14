// @no-test-required: 语义从 out-path-guard.ts 逐字抽出，测试在 bench/out-path-guard.test.ts（判据执行面即该测试）。
import { statSync } from "node:fs";

/**
 * 文件**身份**判据（与"名字"折叠分家，R10R1-B-1：路径归一只折叠名字，同一字节另有名字时折叠不掉）。
 * 从 `out-path-guard.ts` 抽出，使"判别对象"的三个函数各居一处、模块导出面回到阈值内；
 * 对外入口仍经 guard 转发，调用方不受影响。
 */

/**
 * `stat` → 身份串。**单独成函数**是为了让 `ino === 0` 这条退让进入受测面（R10R4-C-m4 的同一动机）：
 * 真实文件系统要报出 0 需要 9p / 部分网络盘，CI（ubuntu-latest）造不出来，没有这个注入点，
 * "两个不同文件在哨兵文件系统上假等" 这条判据就只剩人工探针。
 * `win32` 上 `\\.\NUL` 是一个**真实存在且报 ino=0** 的路径（实测 `dev=0 ino=0`），故端到端一侧
 * 由 `out-path-guard.test.ts` 的 `it.runIf(win32)` 用例锚定；本函数负责平台无关的那一半。
 */
export function identityOf(st: { readonly dev: number; readonly ino: number }): string | null {
  return st.ino === 0 ? null : `${st.dev}:${st.ino}`;
}

/**
 * 折叠**身份**（R10R1-B-1）。`dev:ino` 由 libuv 在三平台统一暴露——win32 下即卷序列号 + FileId
 * （非"win32 无 inode"）。实测 win32/NTFS 上硬链接、NTFS 备用数据流、UNC/admin-share
 * （`\\localhost\d$\…`）三类别名形态的 dev/ino 与 tracked 文件全等，`\\?\` 设备命名空间与 `subst`
 * 盘则本就被 realpath 折叠。任一路径 stat 失败（尚不存在，或 ACL 令读取被拒）、或文件系统不报文件
 * ID（`ino === 0` 哨兵，见 `identityOf`）→ null，该条判据退让给路径折叠。
 * 退让**不是**同一回事（R10R3-A-m4/B-m3/C-m2）：out 侧 stat 失败是合法高频场景（首次录制目标尚不
 * 存在），告警会刷屏，故保持静默；tracked 侧 stat 失败即异常事件且使全部别名形态失效，另加定向告警。
 */
export function fileIdentity(p: string): string | null {
  try {
    return identityOf(statSync(p));
  } catch {
    return null;
  }
}

/**
 * 区分 `fileIdentity` 返回 null 的两种成因：stat 抛错（异常，值得告警）vs 文件系统不报文件 ID
 * （`ino === 0` 哨兵，正常降级，不该告警）。
 */
export function statThrows(p: string): boolean {
  try {
    statSync(p);
    return false;
  } catch {
    return true;
  }
}
