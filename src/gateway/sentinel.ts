// @no-test-required: 语义从 server.ts 逐字抽出，测试在 tests/unit/cli/canary-rotate.test.ts + tests/integration/registry-degraded.test.ts（Gate 5a 仅识别同目录/根 tests/ 六种路径）
import { rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CanaryStore } from "../canary/store.ts";

/**
 * D-03 启动序哨兵：CLI 离线轮换标记的定位、消费与删除重试。
 * 从 `server.ts` 抽出（R11 many-exports）；语义未变，server 侧仅经转发与 import 使用。
 */

/** D-03 哨兵消费结果（#B 拍板收窄：CLI 离线轮换标记 = 零字节文件；doctor 展示属 SL-12）。删除失败 = 序内重试 3 次后放弃留痕——轮换幂等，标记留存下次启动重放安全。registry 不可用时哨兵不消费（保留待人工修复后重放）。 */
export type CanarySentinelOutcome = "rotated" | "rotated_delete_failed" | "corrupt_ignored" | "corrupt_delete_failed" | "skipped_registry_unavailable" | "absent";

/** 哨兵 IO 注入点（TEST 契约 #1）：删除失败路径经此跨平台可观测；默认 stderr + unlink。 */
export interface SentinelIo { unlink(path: string): void; log(line: string): void; }

const SENTINEL_NAME = "canary-rotate.request";
const SENTINEL_UNLINK_ATTEMPTS = 4 as const; // 初次 + 序内重试 3 次（D-03）

const SENTINEL_STD_IO: SentinelIo = { unlink: (path) => rmSync(path), log: (line) => process.stderr.write(line) };

/** 哨兵定位：与 registry 同目录（stateDir 语义），固定名。 */
export const sentinelPathFor = (registryPath: string): string => join(dirname(registryPath), SENTINEL_NAME);

/** 启动序哨兵消费：零字节 → rotate + 删除；非零 → 忽略不轮换 + 删除；缺失 → 不动。
 *  rotate 恒先于删除（删除失败不回滚已确认的轮换）。registry 不可用时既不轮换也不删除：
 *  persist() 会用空内存态覆盖损坏文件、销毁取证现场（§4.3 要求损坏必须显式暴露），
 *  标记保留到人工修复 registry 后的下一次启动重放。 */
function sentinelSize(sentinelPath: string): number | null {
  try { return statSync(sentinelPath).size; } catch { return null; } // 无文件：启动序无离线待办
}

/** 序内删除（初次 + 重试 3 次）；耗尽时留痕一次，返回是否删成功。 */
function deleteSentinel(io: SentinelIo, sentinelPath: string): boolean {
  for (let attempt = 1; attempt <= SENTINEL_UNLINK_ATTEMPTS; attempt += 1) {
    try { io.unlink(sentinelPath); return true; }
    catch (err) {
      if (attempt === SENTINEL_UNLINK_ATTEMPTS) {
        io.log(`[llmveto] canary rotate sentinel delete failed after ${SENTINEL_UNLINK_ATTEMPTS} attempts: ${sentinelPath} (${err instanceof Error ? err.message : String(err)})\n`);
      }
    }
  }
  return false;
}

/** 启动序哨兵消费：零字节 → rotate + 删除；非零 → 忽略不轮换 + 删除；缺失 → 不动。
 *  rotate 恒先于删除（删除失败不回滚已确认的轮换）。registry 不可用时既不轮换也不删除：
 *  persist() 会用空内存态覆盖损坏文件、销毁取证现场（§4.3 要求损坏必须显式暴露），
 *  标记保留到人工修复 registry 后的下一次启动重放。 */
export function consumeRotateSentinel(store: CanaryStore, sentinelPath: string, io: SentinelIo = SENTINEL_STD_IO): CanarySentinelOutcome {
  const size = sentinelSize(sentinelPath);
  if (size === null) return "absent";
  const zero = size === 0;
  if (zero) {
    if (store.loadStatus.status !== "ok") {
      io.log(`[llmveto] canary rotate sentinel skipped: registry unavailable (${store.loadStatus.cause}); ${sentinelPath} kept for retry after repair\n`);
      return "skipped_registry_unavailable";
    }
    store.rotate(); // 幂等：重放安全（rotation_count 只增）
  } else {
    io.log(`[llmveto] canary rotate sentinel ignored: ${sentinelPath} is corrupt (expected zero-byte marker, got ${size} bytes)\n`);
  }
  if (deleteSentinel(io, sentinelPath)) return zero ? "rotated" : "corrupt_ignored";
  return zero ? "rotated_delete_failed" : "corrupt_delete_failed"; // 重试耗尽：放弃（哨兵留存，下次启动重放）
}
