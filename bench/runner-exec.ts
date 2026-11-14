// @no-test-required: CI 入口脚本的唯一执行边界（check-regression.ts / record-baseline.ts 专用）；失败即 fail-loud 抛出并在 CI 日志直接可见，核心判定由 regression-formula.test.ts 覆盖、写入路径由 out-path-guard.test.ts 覆盖。
import { spawnSync } from "node:child_process";

/**
 * 跑一个 bench runner 并返回其 stdout —— record-baseline / check-regression 两条 CI 入口的唯一执行边界。
 *
 * 为什么单列 `res.error` 判据（R11）：`spawnSync` 在**没能启动**子进程时（bun 不在 PATH、EPERM、被杀）
 * 返回 `status === null`，真正的成因只在 `error` 上。此前两个脚本都只比 `status !== 0`，这类失败会被报成
 * `exited null:` —— 空 stderr 且指向错误方向（看起来像"跑挂了"而非"没跑起来"）。
 *
 * 使用 spawnSync + argv 数组而非 shell 字符串，避免任何 shell 元字符解析面。
 */
export function runRunner(file: string, opts: { readonly echo?: boolean } = {}): string {
  let res: ReturnType<typeof spawnSync>;
  try {
    res = spawnSync("bun", ["run", file], { encoding: "utf8" });
  } catch (err) {
    throw new Error(`runner ${file} could not be started: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
  if (res.error !== undefined) throw new Error(`runner ${file} failed to spawn: ${res.error.message}`, { cause: res.error });
  if (res.status !== 0) throw new Error(`runner ${file} exited ${res.status}: ${res.stderr ?? ""}`);
  if (opts.echo === true) process.stdout.write(res.stdout);
  return res.stdout;
}
