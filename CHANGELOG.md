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

## [0.3.0] - 2026-11-02

The v2a detection core: four new checkers (T1a canary return, T2a tool-call shape, T3a thinking
signature, T4a usage reconciliation), the canary engine with rotation, per-checker streaming
windows and execution budgets, and an evil-relay testkit. The evidence schema stays at **v1**
(`canary` remains `null`); the only additive field is an optional top-level `reason`.

### Added

- **Canary engine (T1a)** — per-session 27-character canary (`llmveto-canary-` + 12 hex) allocated
  on managed routes (`opencode/openai`, `opencode/anthropic`, `opencode/mock`, `delphi/default`),
  injected into the last user text part through the six-branch pure function (append-only; no
  user message or unparsable body → `inject_skipped`, body untouched), and scanned on responses
  for **another session's** canary. A hit is a safety-class `finding` → `block` (stream termination
  after delivery). Session key: `x-llmveto-session-id` (trimmed, non-empty) else
  `sha256(length-prefixed first-user text parts)` first 16 hex chars; empty → deterministic `"0:"`.
- **Canary registry** at `stateDir/canary-registry.json`: single-writer atomic `tmp`+`rename`,
  lazy eviction (TTL 24 h / LRU 64, whichever first), load validation degrading to
  `registry_unavailable` (no injection, no matching, top-level `reason`, counters — never silent).
  The CLI daemon now passes this path, so injection and rotation are reachable from
  `llmveto start`.
- **Canary control channel** `POST /_llmveto/canary/rotate` (intercepted before route resolution,
  no evidence record) and `llmveto canary rotate`: online via the loopback endpoint with
  confirmation, offline via a zero-byte `canary-rotate.request` sentinel consumed on next start.
  `GET /_llmveto/metrics` exposes live `inject_skipped` / `registry_unavailable` /
  `canary_injected` counters.
- **Tool-call-shape checker (T2a, safety class)** — response side, three rules: unknown tool name,
  missing required arguments (both only when `declared_tools` is present), and invalid JSON
  arguments (always). `finding` → `block`; streaming scans the accumulated tool-call arguments and
  emits `window_overflow` past the 256 KiB hard bound.
- **Thinking-signature-presence checker (T3a, observational)** — bidirectional consistency between
  the request `thinking_enabled` flag and a `<think>…</think>` block in the response
  (`thinking-missing-in-response` / `thinking-unexpected-in-response`); `finding` → `warn`, never
  blocks.
- **Usage-reconcile checker (T4a, observational)** — local token estimate (ASCII ÷ 4.1, CJK × 1.0)
  against upstream `usage.total_tokens`; over-reporting (`> 1.5×` **and** `> 64` above estimate) is
  a `finding` → `warn`; malformed usage degrades to `scanner_error` + `degraded_observational`.
- **Evidence additions (schema stays v1)** — optional top-level `reason` from a closed vocabulary
  (`registry_unavailable`, `inject_skipped`, `window_overflow`, `checker_timeout`, `scanner_error`,
  `input_malformed`; key absent when clean), `verdict: "error"` entries in `findings[]` with
  checker/threat preserved, and the `action_taken` priority order
  (`blocked_before_forward` > `blocked_before_deliver` > `terminated_after_delivery` >
  `degraded_observational` > `warned` > `allowed`). Canary plaintext never enters evidence.
- **Streaming correctness** — per-checker windows with a single cursor advance per chunk, tool-call
  argument deltas merged across SSE frames before scanning, and UTF-16 offsets preserved across
  chunk boundaries.
- **Per-checker execution budgets** — G3 tiers 8/32/512 KiB → 20/50/120 ms and a 5 ms per-chunk G1
  budget from a single constant source; an over-budget checker result is rewritten to
  `checker_timeout` after the fact (verdict surface, not preemption).
- **Evil-relay testkit** — `testkit/evil-relay.ts`, 13 opponent profiles (fpverify 9 + 4 T2-class),
  plus dual CI matrices: `test.yml` per PR and `relay-nightly.yml` (nightly, 4-way matrix, serial
  retry on port contention).
- **`doctor` closed enumeration 4 → 6** — `doctor.canary-registry` (missing = not configured,
  malformed/unreadable = `[DEGRADED]`) and `doctor.coverage-counters` (non-zero counters carry a
  `[DEGRADED]` prefix).

### Changed

- Response scan units now include `tool_calls[*].function.arguments` (and legacy
  `function_call`) on both request and response sides, closing the T2a scan-surface blind spot.
- CLI command set 5 → 6 (`canary rotate`); `report` remains explicitly forbidden.
- Evidence semantics: forwarded `request_bytes` / `request_body_sha256` describe the post-injection
  body (what the upstream actually received); request-side scanning still uses the client body.

### Fixed

- Streaming invisible-character false negatives when escape sequences / multi-byte characters span
  chunk boundaries (window ownership and offsets).
- Session-key ambiguity from naive concatenation (`["ab","c"]` vs `["a","bc"]`) via the
  `${len}:${text}` length prefix.
- Tool-call arguments split across SSE `delta` frames were scanned as fragments; they are now
  merged before judgment.

### Performance

- G1 TTFT delta PASS (p95 0.551 ms / p99 1.533 ms against 5/12 ms).
- G3 checker budget PASS for 7 checkers × 8/64/512 KiB (p99 ≤ 0.46 ms).
- G2 request gate PASS at 8 KiB / 512 KiB. The 64 KiB tier exceeds the 10 ms p95 limit on local
  Windows tail latency (p50 ≈ 1.2 ms); `ubuntu-latest` CI is the authoritative environment for that
  gate.

### Known limitations

- G-CANARY's recording-based replay (finish-reason distribution, provider refusal increment, manual
  review of 10 sessions) could not be re-run after the original recording artifact was overwritten;
  it is registered as an accepted residual. Canary injection is covered by integration tests across
  the six injection branches and managed-route end-to-end tests, but not by a fresh real-agent
  replay.
- Streaming bytes already forwarded cannot be recalled; a streaming hit terminates the stream, it
  does not swallow delivered bytes.

### Deferred to v2b

- Fingerprint patrol with provider trust score (periodic llm-fingerprint-detector integration)
- Billing reconciliation report CLI (`report` command comparing usage × official price vs relay invoices)
- Multi-client onboarding for Claude Code / Codex / promptfoo (MANAGED_CONFIG_IDS extension)
- Provider health monitoring dashboard (error rate / timeout trends visualization)

---

[0.3.0]: https://github.com/boyingliu01/llmveto/releases/tag/v0.3.0
[0.2.0]: https://github.com/boyingliu01/llmveto/releases/tag/v0.2.0
