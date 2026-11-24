// @no-test-required: 测试辅助（读文档与切片清单），被 tests/unit/protocol-coverage.test.ts 与 tests/unit/doc-consistency.test.ts 使用；辅助代码本身无独立行为
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** 读取仓库根下的文本文件（测试用，避免每个文件各写一遍路径拼接）。 */
export function readText(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");
}

export interface SliceEntry {
  readonly id: string;
  readonly requirements: readonly string[];
  readonly status: string;
}

/** 读切片清单。 */
export function readManifest(): { slices: SliceEntry[] } {
  return JSON.parse(readText(".sprint-state/slices-manifest.json")) as { slices: SliceEntry[] };
}
