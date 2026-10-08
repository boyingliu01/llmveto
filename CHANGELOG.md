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

[0.2.0]: https://github.com/boyingliu01/llmveto/releases/tag/v0.2.0
