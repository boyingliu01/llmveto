import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  REGISTRY_VERSION,
  validateRegistryFile,
  type RegistryFile,
  type RegistryUnavailableCause,
} from "../shared/registry-file-schema.ts";

/**
 * @test REQ-V2a-07
 * @intent canary registry 存储与会话状态（D-02/DD-V2A-02 + D-05/DD-V2A-05）。
 * @no-test-required: 测试在 tests/unit/canary/store.test.ts（本项目测试布局为 tests/{unit,integration,e2e}/**，
 *                   Gate 5a 仅识别同目录/根 tests/ 六种路径，故在此登记真实位置而非声称免测）。
 *         唯一写者 = 常驻网关（单写者模型，无需跨进程锁，API 按单写者设计）；
 *         原子写 = 写 .tmp + renameSync（同卷原子：崩溃残留只能是旧完整文件，无半行）；
 *         加载校验三类损坏（非法 JSON / 版本不识别 / 结构不符）收敛为 registry_unavailable
 *         显式结果，由 gateway 侧映射为「不注入 + 顶层 reason + 计数」（§4.3，不得静默）；
 *         惰性淘汰 = 加载时 + 每次写入时按 lastSeen 排序，TTL 24h 与 LRU 64 先到为准；
 *         熵源与时钟可注入（单测表驱动固定值）；快照排除请求方自身（D-05，AC-V2a-06 负样本面）。
 *         注意：本模块与 src/gateway/registry.ts（checker 注册表）无关（D-10/T-M1 命名澄清）。
 */

/** §4.3 定值：session 自最后一条过闸请求起 24h 内视为活跃。 */
export const CANARY_TTL_MS = 24 * 60 * 60 * 1000;
/** §4.2 定值：活跃集合按 LRU 截断至 64（跨客户端共享）。 */
export const CANARY_LRU_CAPACITY = 64 as const;
/** AC-V2a-07：canary 串固定 27 字符 → 默认熵源 = 15 字符前缀 + 12 hex。 */
const CANARY_TOKEN_PREFIX = "llmveto-canary-";
/**
 * 热路径落盘节流：已有 session 的 lastSeen 刷新不再每请求 writeFileSync+renameSync
 * （同步 IO 落在事件循环上，尾延迟随并发放大）。分配新串与轮换仍然立即落盘；
 * lastSeen 最多滞后 60s，最坏后果 = 崩溃重启后把 60s 内活跃的会话当作更旧，TTL 24h 下可忽略。
 */
export const LAST_SEEN_PERSIST_INTERVAL_MS = 60_000;

/** 加载结果：ok 或收敛后的显式不可用（store 不把损坏 throw 给调用方，§4.3/D-02）。 */
export type RegistryLoadStatus =
  | { readonly status: "ok" }
  | { readonly status: "registry_unavailable"; readonly cause: RegistryUnavailableCause };

export interface CanaryStoreOptions {
  /** 熵源注入点；默认 crypto 随机 27 字符 token。 */
  readonly entropy?: () => string;
  /** 时钟注入点（epoch ms）；默认 Date.now。 */
  readonly now?: () => number;
}

interface MutableEntry {
  canary: string;
  last_seen: number;
} // 单条 registry 条目的可变形态（Map 内部用；持久化经 RegistryFile schema）

const defaultEntropy = (): string => CANARY_TOKEN_PREFIX + randomBytes(6).toString("hex");

export class CanaryStore {
  private readonly entries = new Map<string, MutableEntry>();
  private readonly entropy: () => string;
  private readonly now: () => number;
  private rotations = 0;
  private rotatedAtMs: number | null = null;
  private lastPersistAt = Number.NEGATIVE_INFINITY;
  /** 构造时同步加载；结果恒显式（ok / registry_unavailable），不 throw。 */
  readonly loadStatus: RegistryLoadStatus;

  constructor(readonly filePath: string, options: CanaryStoreOptions = {}) {
    this.entropy = options.entropy ?? defaultEntropy;
    this.now = options.now ?? Date.now;
    this.loadStatus = this.load();
  }

  private load(): RegistryLoadStatus {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch {
      return { status: "ok" }; // 文件缺失 = 首启空态（三个损坏类之外，首笔 assign 落盘）
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { status: "registry_unavailable", cause: "invalid_json" };
    }
    const checked = validateRegistryFile(parsed);
    if (typeof checked === "string") return { status: "registry_unavailable", cause: checked };
    for (const [session, entry] of Object.entries(checked.entries)) {
      this.entries.set(session, { canary: entry.canary, last_seen: entry.last_seen });
    }
    this.rotations = checked.rotation_count;
    this.rotatedAtMs = checked.last_rotated_at === null ? null : Date.parse(checked.last_rotated_at);
    this.prune(this.now()); // 惰性淘汰 ①：加载时（只清内存，不回写）
    return { status: "ok" };
  }

  /** 分配（幂等）：已有 session 刷新 lastSeen 返回旧串；否则用熵源分配新串并落盘。 */
  assign(session: string): { readonly canary: string; readonly created: boolean } {
    const now = this.now();
    const existing = this.entries.get(session);
    if (existing !== undefined) {
      existing.last_seen = now;
      if (now - this.lastPersistAt >= LAST_SEEN_PERSIST_INTERVAL_MS) this.persist();
      return { canary: existing.canary, created: false };
    }
    const canary = this.entropy();
    this.entries.set(session, { canary, last_seen: now });
    this.prune(now); // 惰性淘汰 ②：每次写入时
    this.persist();
    return { canary, created: true };
  }

  /**
   * 轮换（D-03/AC-V2a-08）：rotation_count 递增、last_rotated_at 更新并持久化；全部活跃 session
   * 的串整体替换为新熵——旧串即刻整体退出匹配域（在途请求持分配时刻快照不受影响，§4.3）。
   * lastSeen 不动：LRU 簿记属请求侧，轮换不复活 TTL。
   */
  rotate(): { readonly rotation_count: number; readonly last_rotated_at: string } {
    const now = this.now();
    const rotatedAt = new Date(now).toISOString();
    for (const entry of this.entries.values()) entry.canary = this.entropy();
    this.rotations += 1;
    this.rotatedAtMs = now;
    this.prune(now);
    this.persist();
    return { rotation_count: this.rotations, last_rotated_at: rotatedAt };
  }

  /**
   * 匹配域快照（D-05）：请求进入时活跃集合的只读快照，排除请求方自身的 canary（单请求内
   * 复述显式判不命中，AC-V2a-06 负样本）。返回值为拷贝 + 冻结：后续写入不改变已取快照，
   * 修改快照也不影响 store。
   */
  snapshot(selfSession: string): readonly string[] {
    const out: string[] = [];
    for (const [session, entry] of this.entries) {
      if (session !== selfSession) out.push(entry.canary);
    }
    return Object.freeze(out);
  }

  get rotationCount(): number {
    return this.rotations;
  }

  get lastRotatedAt(): string | null {
    return this.isoRotatedAt();
  }

  get size(): number {
    return this.entries.size;
  }

  private isoRotatedAt(): string | null {
    return this.rotatedAtMs === null ? null : new Date(this.rotatedAtMs).toISOString();
  }

  /** 惰性淘汰：按 lastSeen 降序，TTL 过期先剔、LRU 容量再截（两规则先到为准）。 */
  private prune(now: number): void {
    const cutoff = now - CANARY_TTL_MS;
    const sorted = [...this.entries.entries()].sort((a, b) => b[1].last_seen - a[1].last_seen);
    const kept = new Map<string, MutableEntry>();
    for (const [session, entry] of sorted) {
      if (entry.last_seen >= cutoff && kept.size < CANARY_LRU_CAPACITY) kept.set(session, entry);
    }
    this.entries.clear();
    for (const [session, entry] of kept) this.entries.set(session, entry);
  }

  /** 原子写（D-02）：先写 .tmp 再 renameSync；崩溃残留只可能是旧完整文件（无半行）。 */
  private persist(): void {
    const payload: RegistryFile = {
      version: REGISTRY_VERSION,
      rotation_count: this.rotations,
      last_rotated_at: this.isoRotatedAt(),
      entries: Object.fromEntries(this.entries),
    };
    const tmp = `${this.filePath}.tmp`;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      renameSync(tmp, this.filePath);
    } catch (err) {
      throw new Error(`canary registry persist failed: ${this.filePath} (${err instanceof Error ? err.message : String(err)})`);
    }
    this.lastPersistAt = this.now();
  }
}
