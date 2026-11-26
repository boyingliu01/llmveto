// @no-test-required: 测试在 tests/unit/policy/config.test.ts（Gate 5a 仅识别同目录/根 tests/ 六种路径）
import { existsSync, readFileSync } from "node:fs";

/**
 * 策略可配置化的**边界**（设计：docs/plans/2026-11-27-v3-policy-config.md）。
 *
 * 本模块存在的唯一理由：`credential-file-read` 是全系统唯一有阻断权的规则。
 * 开放配置后，它可以被一行 JSON 降级成 `warn`——等于拆掉唯一防线，而且
 * 改配置的人多半刚刚被误报折磨过，降级在他看来是"修复问题"。
 *
 * 三类配置：
 *   A 偏好  — 完全可配（不影响防护）
 *   B 降级  — 观测类可降级，记入 degraded
 *   C 关闭  — 阻断类不可降级，除非走 acknowledged_risks（带理由 + ≤90 天有效期）
 */

/** 允许的 finding 动作。 */
export type FindingAction = "allow" | "warn" | "block";

const ALLOWED_ACTIONS: ReadonlySet<string> = new Set(["allow", "warn", "block"]);

/** 阻断规则白名单（与 checkers 层同源，此处复制以避免 policy → checkers 的额外耦合）。 */
const PROTECTED_RULES: ReadonlySet<string> = new Set(["credential-file-read"]);

/** 豁免有效期上限（设计文档：没有上限的话写 2099 就等于永久关闭）。 */
export const ACK_MAX_DAYS = 90;

const DAY_MS = 24 * 3600 * 1000;

export interface PolicyOverride {
  readonly checker: string;
  readonly rule_id?: string;
  readonly finding_action: FindingAction;
}

export interface AcknowledgedRisk {
  readonly rule_id: string;
  readonly action: FindingAction;
  readonly reason: string;
  readonly expires_at: string;
}

export interface PolicyConfigFile {
  readonly schema_version: number;
  readonly overrides?: readonly PolicyOverride[];
  readonly acknowledged_risks?: readonly AcknowledgedRisk[];
}

export interface PolicyConfig {
  readonly status: "ok" | "rejected";
  /** 被降级的 checker/rule 列表；空表示**没有任何降级生效**。 */
  readonly degraded: readonly string[];
  /** 加载失败时检查项应以默认策略继续运行（AC-8）。 */
  readonly fallback: boolean;
  readonly error?: string;
}

const OK: PolicyConfig = Object.freeze({ status: "ok", degraded: [], fallback: false });

function rejected(error: string): PolicyConfig {
  // AC-8：配置错误 → 回退默认，degraded 为空（没有降级生效）。
  // 最初的版本是 fail-fast（拒绝启动），自审时推翻了：安全网关的核心价值是"它在拦"，
  // 而不是"它的配置正确"。一个起不来的网关会让用户干脆放弃使用。
  return { status: "rejected", degraded: [], fallback: true, error };
}

/** 该 override 是否试图降级一条受保护的阻断规则。 */
function isProtectedDowngrade(o: PolicyOverride): boolean {
  if (o.rule_id === undefined) return false;
  if (!PROTECTED_RULES.has(o.rule_id)) return false;
  return o.finding_action !== "block";
}

/** 找到覆盖该 rule 的豁免登记（没有则 undefined）。 */
function ackFor(config: PolicyConfigFile, ruleId: string): AcknowledgedRisk | undefined {
  return (config.acknowledged_risks ?? []).find((a) => a.rule_id === ruleId);
}

/** 豁免登记是否合法（AC-2/AC-3）。返回错误串或 null。 */
function validateAck(ack: AcknowledgedRisk, nowMs: number): string | null {
  if (typeof ack.reason !== "string" || ack.reason.trim() === "") {
    return `acknowledged_risks[${ack.rule_id}]: reason must be a non-empty string`;
  }
  if (typeof ack.expires_at !== "string") {
    return `acknowledged_risks[${ack.rule_id}]: expires_at is required`;
  }
  const expiry = Date.parse(ack.expires_at);
  if (Number.isNaN(expiry)) return `acknowledged_risks[${ack.rule_id}]: expires_at 不是合法时间`;
  if (expiry <= nowMs) return `acknowledged_risks[${ack.rule_id}]: expired at ${ack.expires_at}`;
  if (expiry - nowMs > ACK_MAX_DAYS * DAY_MS) {
    return `acknowledged_risks[${ack.rule_id}]: expires_at 超过 ${ACK_MAX_DAYS} 天上限`;
  }
  return null;
}

/** 校验整份配置的形状（schema_version / finding_action 合法性）。 */
function validateShape(config: PolicyConfigFile): string | null {
  if (config.schema_version !== 1) return `unsupported schema_version: ${String(config.schema_version)}`;
  for (const o of config.overrides ?? []) {
    if (!ALLOWED_ACTIONS.has(o.finding_action)) {
      return `overrides[${o.checker}]: invalid finding_action ${String(o.finding_action)}`;
    }
  }
  return null;
}

/** 逐条校验 override 与豁免，产出降级清单。 */
function collectDegraded(config: PolicyConfigFile, nowMs: number): { degraded: string[] } | { error: string } {
  const degraded: string[] = [];
  for (const o of config.overrides ?? []) {
    if (!isProtectedDowngrade(o)) {
      // B 类：观测类降级，无需登记，但要记入降级清单
      if (o.finding_action !== "block") degraded.push(o.checker);
      continue;
    }
    const ack = ackFor(config, o.rule_id!);
    if (ack === undefined) {
      return {
        error: `overrides: 尝试降级受保护规则 ${o.rule_id}（block → ${o.finding_action}）但缺少 acknowledged_risks 登记`,
      };
    }
    const problem = validateAck(ack, nowMs);
    if (problem !== null) return { error: problem };
    degraded.push(o.rule_id!);
  }
  return { degraded };
}

/**
 * 加载策略配置。
 *
 * @param now 时钟注入——有效期判定不该依赖不可测的真实时间。
 */
export function loadPolicyConfig(path: string, opts: { readonly now?: () => number } = {}): PolicyConfig {
  if (!existsSync(path)) return OK; // 没有配置 = 默认策略，不是错误

  let parsed: PolicyConfigFile;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as PolicyConfigFile;
  } catch (err) {
    return rejected(`配置无法解析：${err instanceof Error ? err.message : String(err)}`);
  }

  const shapeError = validateShape(parsed);
  if (shapeError !== null) return rejected(shapeError);

  const result = collectDegraded(parsed, (opts.now ?? Date.now)());
  if ("error" in result) return rejected(result.error);
  return { status: "ok", degraded: result.degraded, fallback: false };
}
