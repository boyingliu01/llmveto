// @no-test-required: 测试在 tests/unit/policy/config.test.ts（Gate 5a 仅识别同目录/根 tests/ 六种路径）
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * 策略可配置化的边界（设计：docs/plans/2026-11-27-v3-policy-config.md）。
 *
 * 本模块存在的理由：`credential-file-read` 是全系统唯一有阻断权的规则。
 * 开放配置后，它可以被一行 JSON 降级成 `warn`——改配置的人多半刚被误报折磨过，
 * 降级在他看来是"修复问题"，实际是拆防线。
 *
 * ## 命名修正（delphi 评审 R5 可行席指出）
 *
 * 早期版本把这里叫"禁止降级"，但实现是"登记后允许"——**名字与行为不符**。
 * 一个自称禁止、实际可放行的机制比没有机制更糟：它给人"这个开关关不上"的错觉。
 *
 * 现在如实命名：阻断规则的降级是**风险接受**（risk acceptance），不是禁止。
 * 网关不阻止你，但它会让你每一次都看见自己在做什么：
 *   - 必须写明理由
 *   - 必须带 ≤90 天有效期
 *   - 每次启动进 evidence、doctor 显示 DEGRADED（不是 FAIL——网关仍在跑）
 *
 * 三类配置：
 *   A 偏好        — 完全可配，不影响防护
 *   B 观测类降级  — 可配，记入 degraded
 *   C 阻断类降级  — 允许，但**必须声明为风险接受**（reason + expires_at）
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
  /**
   * 其中属于"阻断规则的风险接受"的部分（C 类）。
   *
   * 与 `degraded` 分开是因为语义不同：观测类降级是调低灵敏度，
   * 阻断类降级是**接受一次凭据出境的风险**。医生报告要能区分这两件事。
   */
  readonly acceptedRisks: readonly string[];
  /** 加载失败时检查项应以默认策略继续运行（AC-8）。 */
  readonly fallback: boolean;
  readonly error?: string;
}

const OK: PolicyConfig = Object.freeze({ status: "ok", degraded: [], acceptedRisks: [], fallback: false });

function rejected(error: string): PolicyConfig {
  // AC-8：配置错误 → 回退默认，degraded 为空（没有降级生效）。
  // 最初的版本是 fail-fast（拒绝启动），自审时推翻了：安全网关的核心价值是"它在拦"，
  // 而不是"它的配置正确"。一个起不来的网关会让用户干脆放弃使用。
  return { status: "rejected", degraded: [], acceptedRisks: [], fallback: true, error };
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

/** 理由最小长度（技术席 R5：防止 "x" 这类占位符绕过）。 */
export const ACK_MIN_REASON_LENGTH = 10;

/** ISO-8601 UTC 严格形态：不接受 Date.parse 的各种宽松变体。 */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** 豁免登记是否合法（AC-2/AC-3）。返回错误串或 null。 */
function validateAck(ack: AcknowledgedRisk, nowMs: number): string | null {
  if (typeof ack.reason !== "string" || ack.reason.trim().length < ACK_MIN_REASON_LENGTH) {
    return `acknowledged_risks[${ack.rule_id}]: reason 至少 ${ACK_MIN_REASON_LENGTH} 个字符（说明为什么承担这个风险）`;
  }
  if (typeof ack.expires_at !== "string") {
    return `acknowledged_risks[${ack.rule_id}]: expires_at is required`;
  }
  if (!ISO_UTC.test(ack.expires_at)) {
    return `acknowledged_risks[${ack.rule_id}]: expires_at 必须是 ISO-8601 UTC（如 2026-12-31T00:00:00Z）`;
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
function collectDegraded(config: PolicyConfigFile, nowMs: number): { degraded: string[]; acceptedRisks: string[] } | { error: string } {
  const degraded: string[] = [];
  const acceptedRisks: string[] = [];
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
    acceptedRisks.push(o.rule_id!);
  }
  return { degraded, acceptedRisks };
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
  return { status: "ok", degraded: result.degraded, acceptedRisks: result.acceptedRisks, fallback: false };
}

/** 续期结果。 */
export interface RenewResult {
  readonly status: "ok" | "rejected";
  readonly error?: string;
  /** 续期后的到期时刻（ISO-8601）。 */
  readonly expiresAt?: string;
}

/**
 * 续期一条已声明的风险接受。
 *
 * 为什么需要这个命令（delphi 可行席指出的闭环缺口）：90 天上限逼用户重新面对决定，
 * 但如果重新面对的唯一方式是手改 JSON，那"摩擦"就退化成了"复制粘贴同一个理由"。
 * 一个显式命令至少留下"我在某天主动续了期"的痕迹。
 *
 * **续期仍受 90 天上限约束**：它不是"永久化"的后门，只是把重新评估的动作变得明确。
 */
/** 续期参数校验：天数合法且不超过上限。 */
function validateRenewDays(days: number): string | null {
  if (!Number.isFinite(days) || days <= 0) return `days 必须是正整数，收到 ${days}`;
  if (days > ACK_MAX_DAYS) return `续期天数不能超过 ${ACK_MAX_DAYS} 天`;
  return null;
}

/** 读配置；失败返回错误串而不是抛。 */
function readConfigForRenew(path: string): { readonly config: PolicyConfigFile } | { readonly error: string } {
  if (!existsSync(path)) return { error: `配置文件不存在：${path}` };
  try {
    return { config: JSON.parse(readFileSync(path, "utf8")) as PolicyConfigFile };
  } catch (err) {
    return { error: `配置无法解析：${err instanceof Error ? err.message : String(err)}` };
  }
}

/** 推出新配置并校验；失败返回错误串。 */
function applyRenewal(
  config: PolicyConfigFile,
  ruleId: string,
  expiresAt: string,
  nowMs: number,
): { readonly next: PolicyConfigFile } | { readonly error: string } {
  const risks = config.acknowledged_risks ?? [];
  if (!risks.some((r) => r.rule_id === ruleId)) return { error: `没有找到 rule_id=${ruleId} 的风险接受登记` };

  const updated = risks.map((r) => (r.rule_id === ruleId ? { ...r, expires_at: expiresAt } : r));
  const next: PolicyConfigFile = { ...config, acknowledged_risks: updated };
  // 续期后必须仍是合法配置，否则拒绝写盘——不制造一份加载不了的文件
  const problem = validateShape(next) ?? validateAck(updated.find((r) => r.rule_id === ruleId)!, nowMs);
  return problem === null ? { next } : { error: problem };
}

/** 写回续期后的配置；写失败要报错（用户以为续期成功最危险）。 */
function writeRenewal(path: string, next: PolicyConfigFile, expiresAt: string): RenewResult {
  try {
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  } catch (err) {
    return { status: "rejected", error: `写入失败：${err instanceof Error ? err.message : String(err)}` };
  }
  return { status: "ok", expiresAt };
}

/**
 * 续期一条已声明的风险接受。
 *
 * 为什么需要这个命令（delphi 可行席指出的闭环缺口）：90 天上限逼用户重新面对决定，
 * 但如果重新面对的唯一方式是手改 JSON，那"摩擦"就退化成了"复制粘贴同一个理由"。
 * 一个显式命令至少留下"我在某天主动续了期"的痕迹。
 *
 * **续期仍受 90 天上限约束**：它不是"永久化"的后门，只是把重新评估的动作变得明确。
 */
export function renewPolicyRisk(
  path: string,
  ruleId: string,
  days: number,
  opts: { readonly now?: () => number } = {},
): RenewResult {
  const dayProblem = validateRenewDays(days);
  if (dayProblem !== null) return { status: "rejected", error: dayProblem };

  const read = readConfigForRenew(path);
  if ("error" in read) return { status: "rejected", error: read.error };

  const nowMs = (opts.now ?? Date.now)();
  const expiresAt = new Date(nowMs + days * DAY_MS).toISOString();
  const applied = applyRenewal(read.config, ruleId, expiresAt, nowMs);
  if ("error" in applied) return { status: "rejected", error: applied.error };

  return writeRenewal(path, applied.next, expiresAt);
}
