/**
 * @test REQ-VETO-009
 * @intent 适配器契约 + MANAGED_CONFIG_IDS 类型 —— 用封闭枚举替换
 *         "全部流量过闸"的不可证伪命题（DD-VETO-003）。
 *
 * 每个适配器 export 一个 `MANAGED_CONFIG_IDS: readonly ConfigId[]`，
 * doctor 与 E2E 只在枚举内做漂移断言。
 */

import type { Env } from "./config-io.ts";

export type { Env };

export interface ConfigId {
  /** 稳定 id，用于 doctor / evidence 记录；跨版本不变。 */
  readonly id: string;
  /** 人类可读描述。 */
  readonly description: string;
}

export interface Adapter {
  readonly name: "opencode" | "delphi";
  readonly MANAGED_CONFIG_IDS: readonly ConfigId[];
  /** 生成注入 managed config 所需的字段补丁（doctor --write-managed-config 使用）。 */
  buildPatch(gatewayBaseUrl: string): Record<string, unknown>;
  /** 从当前用户配置读取，判断是否被漂移（改走它处）；返回漂移的 ConfigId 数组。 */
  detectDrift(currentConfig: Record<string, unknown>, gatewayBaseUrl: string): readonly ConfigId[];
  /** 受管配置文件路径：env 覆写优先，否则回落到该客户端的真实默认位置。 */
  defaultConfigPath(env: Env): string;
  /** 读取磁盘上的真实配置（缺失 / 不可解析 → {}，即全漂移）。 */
  readCurrentConfig(env: Env): Record<string, unknown>;
  /** 把 buildPatch 深合并进现有配置并落盘；返回写入路径。写失败抛出，由 doctor 降级为告警。 */
  applyManagedConfig(env: Env, gatewayBaseUrl: string): string;
}
