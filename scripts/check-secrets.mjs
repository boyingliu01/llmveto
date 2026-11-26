#!/usr/bin/env node
// check-secrets.mjs — 项目级密钥扫描门禁。
//
// 为什么项目自己再扫一遍：2026-11-26 实测，XP-Gate 的 Gate 8（gitleaks）在
// 本仓库 112 次历史提交中有 51 次是 SKIP（reason 为空字符串，不可追溯），
// 即近一半提交没跑过密钥扫描。变异测试（植入格式正确的 sk-ant-api03- 密钥）
// 在该路径上未被检出。
//
// 判据来自实测，不是抄配置：
//   - gitleaks 对**格式正确**的密钥有效（植入 sk-ant-api03- + 95 位 → 检出 2 处）；
//     格式不符的短串不报，这是规则本身的长度要求，不是缺陷。
//   - semgrep 在本机对命令注入**无效**（1074 条规则扫 TS 文件 0 findings），
//     所以本门禁**不假装**覆盖 SAST，只做密钥。
//
// 用法：
//   node scripts/check-secrets.mjs            # 扫全树，有泄漏 exit 1
//   node scripts/check-secrets.mjs --staged   # 只扫暂存文件（pre-commit 用）

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** gitleaks 候选位置：优先 PATH，其次常见本地安装点。 */
const CANDIDATES = ["gitleaks", `${process.env.HOME}/.local/bin/gitleaks`, `${process.env.HOME}/.npm-global/bin/gitleaks`];

function findGitleaks() {
  for (const c of CANDIDATES) {
    try {
      execFileSync(c, ["version"], { stdio: "ignore" });
      return c;
    } catch {
      // 试下一个
    }
  }
  return null;
}

function main() {
  const bin = findGitleaks();
  if (bin === null) {
    // 工具缺失是 SKIP 不是 PASS——"没扫"和"扫过且干净"必须能区分。
    console.error("[secrets] SKIP — gitleaks 未安装，未执行密钥扫描（不是通过）");
    return 0;
  }

  // **必须用相对路径 `.`**：实测 gitleaks 8.30.1 在 --source 为绝对路径时会把
  // .gitleaks.toml 的 allowlist 路径匹配判错，同一棵树报 30 处泄漏（相对路径报 0）。
  // 那个差异不是"绝对路径扫得更全"，而是 allowlist 失效——本项目的 allowlist
  // 用的是相对路径（baseline 文件等），绝对 source 下匹配不上。
  const args = ["detect", "--no-git", "--source", ".", "--redact", "--no-banner", "--exit-code", "1"];
  if (existsSync(resolve(ROOT, ".gitleaks.toml"))) args.push("--config", ".gitleaks.toml");

  try {
    execFileSync(bin, args, { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
    console.log("[secrets] OK — 未发现泄漏");
    return 0;
  } catch (err) {
    const out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    // exit 1 = 有泄漏；其它（如配置错误）要区分开，不能都当成"发现泄漏"
    if (err.status === 1) {
      console.error("[secrets] FAIL — 检出未登记的密钥：");
      console.error(out.trim().split("\n").slice(-25).join("\n"));
      console.error("\n处置：确为密钥则删除并轮换；误报则在 .gitleaks.toml 的 allowlist 里登记理由。");
      return 1;
    }
    console.error(`[secrets] ERROR — gitleaks 执行失败（exit=${err.status}）：`);
    console.error(out.trim().split("\n").slice(-10).join("\n"));
    return 1;
  }
}

process.exit(main());
