# Changelog

All notable changes to this project are documented in this file. The format is a lightweight
take on [Keep a Changelog](https://keepachangelog.com/), and the project aims at
[Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-10-09

First public release (npm registry + GitHub Release). A local LLM traffic security gateway
daemon that makes traffic between coding agents and LLM APIs — rerouted through supported
onboarding paths — verifiable, blockable, and auditable: deterministic verification,
fail-closed blocking, and a tamper-evident audit trail.

### Added

- **Scan surface**: `messages[*].content` / `system` / `tools` / custom `extra_headers`, plus
  tool-call payloads (`tool_calls[*].function.arguments`, legacy `function_call` included) on
  both request and response sides. Each scan unit produces raw-text and unescape-restored
  projections (`\uXXXX` / `\u{…}` / `\xXX`), both scanned — escape-sequence evasion is closed.
- **Outbound credential interception** (T1b): matched credentials block the request before it
  reaches the upstream.
- **Invisible-character detection** (T2c): response-level rejection for non-streaming
  responses; stream termination (error event + connection close) for streaming, where already
  forwarded bytes are irrevocable by physics.
- **Model field-consistency warning** (T3a subset): bidirectional self-consistency between
  request and response model fields.
- **Managed-path vetting**: OpenCode and Delphi adapters with real config read/write, drift
  detection over a closed managed-config enumeration, and `doctor --write-managed-config`.
- **Path routing**: `POST /<client>/<provider>/…` identity routing with a JSON routing table
  and catch-all fallback; unrouted requests fail closed (502 `llmveto:no-upstream-route`,
  evidence trailed, nothing forwarded).
- **Evidence store**: append-only JSONL with a SHA-256 hash chain; `llmveto verify` checks
  chain integrity and schema conformance. The chain defends against accidental corruption and
  cheap tampering — the trust boundary is stated, not oversold.
- **Upstream-failure resilience** (T0): upstream connection failures converge to a per-request
  fail-closed answer (502 + evidence record) while the daemon survives; no retry and no
  failover upstream in v1 (a v2 operations concern).
- **CLI (frozen at 5 commands)**: `start` (loopback-only background daemon) / `status` (real
  liveness probe) / `stop` / `doctor` (closed check enumeration) / `verify`.
- **Distribution**: pure-ESM `dist/` built with `tsc`, published to npm with an explicit
  release gate chain (`npm run release:gate`: clean build → tests → typechecks → pack →
  global tarball install → pure-Node smoke with Bun stripped from PATH → publish dry-run).
  Node ≥ 18 runtime, Bun only required for development.

### Security

- Four security-core defects found by an adversarial audit were fixed on 2026-09-27, each with
  a regression test: an uncaught dispatch exception that killed the whole daemon on upstream
  resets; `verify` reporting `ok` on an emptied chain; scan units dropping tool-call payloads;
  and escape-sequence-based detection bypass. See the README security-fixes section.

### Known limitations

- Documented, deliberately unimplemented capabilities live in the
  [v1 residual-risk register](docs/issues/1-req-threat-model.md) (canary-based exfiltration
  detection, tool-call structure judgment, response-injection protection, model authenticity
  proof — all v2; TLS interception — v3). Evidence-chain tail truncation is undetectable
  without external anchoring and is registered as a negative-contract test, not silently
  claimed as coverage.

## [Unreleased] — v2a detection core (in development)

### Added

- **Thinking-signature-presence checker** (T3a observational, SL-10): detects absence of expected reasoning/thinking markers in model responses; logs warning when signature missing but does not block.
- **Tool-call-shape checker** (T2a security class, SL-09): validates tool-call argument structure, blocks dangerous commands (e.g., `rm -rf /`, shell injection patterns), and rejects unauthorized tool names. Verdict: `block`.
- **Usage-reconcile checker** (T4a observational, SL-11): compares reported token usage against response length heuristics; flags significant mismatches as potential billing fraud or relay manipulation. Verdict: `warn`.
- **Canary engine** (T1a security class, SL-08): injects unique canary tokens into outbound requests and scans upstream responses for their return; detects data exfiltration attempts. Includes `canary rotate` CLI command for token rotation. Verdict: `block`.
- **Evil-relay simulator** (SL-13): pure TypeScript malicious upstream emulator with 13 attack opponents (credential theft, response substitution, model impersonation, usage inflation, etc.). Integrated into CI via dual-matrix workflow (`test.yml` + `relay-nightly.yml`).
- **Evidence schema versioning**: bumped `evidence_schema_version` from 1 to 2; added `canary_token_id` and `scan_unit_offsets` fields for canary tracking and precise error localization. Backward-compatible with v1 readers.
- **Error double-layer logging** (SL-03): top-level `reason` field (optional bitflags) + `degraded` mechanism for partial failures; preserves full error context while enabling graceful degradation.
- **Session key derivation** (SL-06): deterministic session binding via six-branch pure function (client + provider + model + timestamp + nonce + config hash); enables per-session evidence grouping.
- **Streaming window offsets fix** (SL-02): corrected chunk boundary calculation for invisible-unicode cross-chunk detection; eliminated false negatives on multi-byte escape sequences split across chunks.
- **Budget gates wiring** (SL-04): REQ-V2a-12 performance budget enforcement integrated into CI; G1/G2/G3 thresholds now gate merges.

### Changed

- **Response scan unit enhancement** (SL-01): expanded to include `tool_calls[*].function.arguments` on both request and response sides, closing T2a blind spot in v1.
- **Delphi-review integration**: upgraded to opencode v2.0.26 agent dispatch with three distinct example-provider models (`local-deepseek-v4-flash`, `g-qwen3.8-flash`, `local-qwen3.8-27b`) for architecture/technical/feasibility expert roles. Resolved Qoder Custom Agent model-binding limitation.
- **xp-gate quality gates**: updated to v0.20.1 with 12-gate chain including SAST, secret scanning, complexity limits, and architecture conformance checks. Removed duplicate unscoped v0.12.10 installation.

### Fixed

- **Canary split JSONL reading**: switched to line-by-line streaming read with prefix-comparison stringify cache; eliminated memory spike on large evidence files.
- **Doctor AC-02/AC-03 decoupling**: separated development machine real-environment checks from test assertions; prevented false positives in CI.
- **Git worktree cleanup**: added `.worktrees/` to `.gitignore`; automated scratch probe exclusion (`var/probe-*.ts`, `var/negctl-*.sh`).

### Documentation

- **Internal trial package**: created comprehensive documentation suite for colleague testing:
  - `docs/QUICKSTART.md`: installation, configuration, verification, troubleshooting guide
  - `docs/FAQ.md`: frequently asked questions covering setup, security behavior, evidence privacy, performance
  - `docs/FEEBACK.md`: structured feedback collection templates (bug reports, feature requests, evidence export procedure)
  - `docs/KNOWN-ISSUES.md`: transparent disclosure of v1 residual risks, architectural limitations, known v2a bugs
- **Sprint closure report**: documented v2a sprint completion metrics (15 slices, 666 tests passing, coverage ≥80%, phase 4 VERIFY via opencode v2).

### Deferred to v2b

- Fingerprint patrol with provider trust score (periodic llm-fingerprint-detector integration)
- Billing reconciliation report CLI (`report` command comparing usage × official price vs relay invoices)
- Multi-client onboarding for Claude Code / Codex / promptfoo (MANAGED_CONFIG_IDS extension)
- Provider health monitoring dashboard (error rate / timeout trends visualization)

---

[Unreleased]: https://github.com/boyingliu01/llmveto/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/boyingliu01/llmveto/releases/tag/v0.2.0
