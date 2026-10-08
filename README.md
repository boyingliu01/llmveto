English | [简体中文](README.zh-CN.md)

# llmveto

A local LLM traffic security gateway daemon — making traffic between agents and LLM APIs **rerouted through supported onboarding paths** verifiable, blockable, and auditable.

> Background: third-party LLM relays pose a systemic threat to coding agents (UCSB measured 9 out of 428 relays injecting malicious code into tool calls; CISPA measured 45.83% of endpoints failing model-fingerprint checks).
> Existing tools are polarized: observational proxies neither verify nor block, while agent execution firewalls cannot see LLM traffic.
> **The gap llmveto fills = deterministic verification at the LLM traffic layer + fail-closed blocking.**

## What v1 does and does not do (read this first)

| | v1 (current) |
|---|---|
| **Provides** | Outbound credential interception (T1b, `block`) · Invisible-character detection (T2c, response-level rejection for non-streaming / stream termination for streaming) · Model **field-consistency** warning (T3a subset) · Vetting of managed paths · Upstream-failure fail-closed (502 + evidence trail, daemon survives) · Full evidence trail + `llmveto verify` |
| **Does not provide** | Data-exfiltration detection (T1a, canaries are v2) · Tool-call **structure** judgment (T2a, RCE-grade, v2; note: tool-call **payloads** are already in the scan surface, see below) · Response-injection protection (T2b, v2) · Model **authenticity** proof (v2 fingerprint) · Usage reconciliation (T4x, v2) · Bypass discovery (v3) · TLS interception (v3) |
| **Blocking granularity** | Bytes of a streaming response already forwarded are **irrevocable**; v1's streaming block = stream termination, not swallowing bytes |

**Scan-surface statement (after the 2026-09-27 fixes)**: checkers see `messages[*].content` / `system` / `tools` / custom `extra_headers`,
plus **tool-call payloads** `tool_calls[*].function.arguments` (including legacy `function_call`, on both request and response sides).
Each scan unit produces two projections — "raw text" and "unescape-restored text" (`\uXXXX` / `\u{…}` / `\xXX`) — and both are scanned, so
**writing invisible characters with escape sequences no longer evades detection**; multiple backslashes (`\\uXXXX` etc.) collapse to the innermost `\uXXXX` pair during restoration and
fall into the restored projection as well, adding no evasion surface. Still **not** covered: URL encoding (`%E2%80%8B`), base64 and other second-layer encodings,
NFKC-normalized homoglyph variants, custom PUA encodings, and authentication headers (`Authorization` and 5 more are excluded from scan units by design, see REQ §T1b row).
**Tool-call "structure" judgment** (argument shape / dangerous commands / unauthorized tool names) belongs to v2; v1 does not judge "malicious commands written in ordinary characters".

For the full statement see [REQ §v1 residual-risk register](docs/issues/1-req-threat-model.md). **Installing the gateway ≠ being protected**: traffic from clients that are not onboarded is entirely unmanaged in v1.

## Documentation

| File | Contents |
|---|---|
| [docs/issues/1-req-threat-model.md](docs/issues/1-req-threat-model.md) | Original requirements and threat model (T1–T4 / P1–P2) + **§Verdict and action semantics** (verdict/action terminology, behavior matrix, evidence trust boundary) + **§v1 residual-risk register** |
| [docs/issues/2-design-v1.md](docs/issues/2-design-v1.md) | Architecture design v1 — reverse-proxy core + checker registry + fail-closed policy + scan units + three performance gates |
| [docs/issues/3-reuse-list.md](docs/issues/3-reuse-list.md) | Reuse and integration list (incl. license verification status and runtime dependencies) |
| [docs/issues/4-test-validation.md](docs/issues/4-test-validation.md) | Validation plan — testability contracts + the five-piece suite (item-by-item `@v1/@v2/@v3`) + evidence field table |
| [docs/issues/5-roadmap.md](docs/issues/5-roadmap.md) | v1/v2/v3 phasing roadmap; **the sole authoritative list of v1 acceptance items** |
| [docs/delphi-panel.md](docs/delphi-panel.md) | Review panel configuration (opencode + three example-provider models) |

## Architecture (v1)

```
OpenCode / Delphi(XP-Gate)          ── v1 onboarding (baseURL / .delphi-config override)
Claude Code / Codex / promptfoo     ── v2 onboarding
Tools that cannot override baseURL  ── v3 onboarding (HTTPS_PROXY + NODE_EXTRA_CA_CERTS TLS interception)
        │
        ▼  v1/v2 only: loopback baseURL reverse proxy (v1 does not implement TLS interception)
   [Proxy core] ──SSE tee, zero buffering──▶ client
        │        ▲
        │        └── streaming hit = inject error event + stream termination (forwarded bytes are not recalled)
        ▼
   [checker registry verdict] → [policy engine action: allow/warn/block (redact is v3)] → upstream (TLS)
        │                                                                              │
        │                                        upstream failure (ECONNRESET/timeout/DNS) ◀─────┘
        │                                        → 502 + evidence trail, daemon survives (fail-closed)
        ▼
   evidence store (append-only JSONL + SHA-256 chain; the chain defends against accidental corruption and cheap tampering,
   not against a same-privilege local adversary rewriting the whole chain; **tail truncation is also out of detection scope** —
   after deleting the last N records the remaining prefix is itself a self-consistent short chain; judging red requires external anchoring, unscheduled)  ← verified by llmveto verify
```

## Distribution and runtime promises (two different promises — do not conflate)

- **npm/CLI distribution (published since v0.2.0)**: `bun run build` uses `tsc` to produce a pure-ESM `dist/`, and `package.json` `bin.llmveto` points to `dist/cli/index.js`; `npm i -g llmveto` runs with **the bundled Node ≥ 18** (see [ADR-0001](docs/adr/0001-node-runtime-distribution.md)).
  Since v0.2.0 the `"private"` flag has been removed — the promotion path reserved by ADR-0001 is fulfilled: the release process = an explicit gate chain in the release workflow (`npm run release:gate`, including a pure-Node smoke test); see [docs/release/publishing.md](docs/release/publishing.md).
- **Running from source (development mode)**: `bun run src/cli/index.ts …` executes `.ts` directly (Bun-native). Runtime code **uses only Node standard-library APIs** (`node:http` / `node:crypto` / Web Streams) and **no Bun-only APIs**; CI runs on vitest (Node) precisely to machine-enforce this constraint.
- **Single-binary distribution (not delivered, outside v1 promises)**: `bun build --compile` into a runtime-free single file is a v2 roadmap candidate; v1 does not provide that artifact and makes no command-name promise.
- **Upstream fault-tolerance boundary (explicit in v1)**: **No retry and no failover upstream.** An upstream failure is answered fail-closed per request (502 + an `llmveto:upstream-error` evidence record) and the daemon survives; upstream resilience is a v2 operations concern. See the [threat-model T0 row](docs/issues/1-req-threat-model.md).

> ⚠️ `.ts` sources are not a Node-runnable distribution artifact (`.ts` specifiers / parameter properties / `import.meta.main` — three incompatibilities); distribution must go through `dist/`, see ADR-0001.

## Quick start (install · deploy · try)

```bash
# 0) Install: npm i -g llmveto (after release); from source: bun install && bun run build && npm link
#    Then `llmveto <cmd>` works directly; in development mode also `bun run llmveto <cmd>`

# 1) Configure the upstream + start the background daemon (loopback-only, default 127.0.0.1:8787)
export LLMVETO_UPSTREAM_BASE_URL=https://api.openai.com   # catch-all; or use LLMVETO_UPSTREAMS for a routing table
llmveto start                    # spawns a background daemon and returns immediately; pid/url/evidence live in the state dir

# 2) Route managed clients through the gateway (writes real config-file baseURLs → gateway routing paths)
llmveto doctor --write-managed-config   # points OpenCode/Delphi managed entries at http://127.0.0.1:8787/<client>/<provider>
llmveto status                          # running pid=… url=… (real liveness probe; stale pid files are reported as not running)

# 3) Audit the trail after trying it + stop
llmveto verify                          # verifies the integrity of the evidence SHA-256 chain
llmveto stop
```

**Path-routing convention**: the client sends `POST /<client>/<provider>/v1/chat/completions`; the gateway derives the `client`+`provider_id` identity from the path, then resolves the target upstream via `LLMVETO_UPSTREAMS` (a JSON table keyed by `"client/provider"` or `"client/*"`); on miss it falls back to `LLMVETO_UPSTREAM_BASE_URL` (catch-all); if neither exists it **fails closed with 502 `llmveto:no-upstream-route`** and does not forward.

**Environment variables**:

| Variable | Purpose |
|---|---|
| `LLMVETO_PORT` | Listen port, default `8787`; set `0` to grab an ephemeral port (the actual address is written to `gateway.url`) |
| `LLMVETO_STATE_DIR` | Directory for pid/url/evidence, default `~/.llmveto` |
| `LLMVETO_UPSTREAM_BASE_URL` | Catch-all upstream base URL |
| `LLMVETO_UPSTREAMS` | Path routing table (JSON object); parse failure → fail-fast at startup |
| `LLMVETO_MODELS_SNAPSHOT` | OpenCode model-catalog snapshot file; when set, `GET /opencode/models` is served locally (models URL locked, P1 mitigation) |
| `LLMVETO_GATEWAY_URL` | Base URL for `doctor` liveness/drift checks, default `http://127.0.0.1:8787` |
| `LLMVETO_OPENCODE_CONFIG` / `LLMVETO_DELPHI_CONFIG` | Override the managed config file locations (default: each client's real path) |

## Development environment

Requirements: **Bun ≥ 1.1** (package management + test/build driver) and **Node ≥ 18** (test runtime + running the distribution artifact).

| Command | Purpose |
|---|---|
| `bun install` | Install dependencies |
| `bun run test` | Full test suite (vitest on Node) |
| `bun run test:coverage` | Tests + coverage gate (threshold 80%; used by CI and the pre-commit hook) |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint` | oxlint |

> **Tests run vitest, not `bun test`**: the global xp-gate pre-commit hook always runs
> `npx vitest run --coverage <changed tests>` for TypeScript projects and requires `coverage/coverage-summary.json`.
> Standardizing on vitest avoids local-green/commit-red splits and additionally verifies Node compatibility of the runtime.

## CLI

v1 is frozen at 5 commands (no stubs for unimplemented commands). The distribution artifact is `dist/cli/index.js` (`llmveto`); in development mode use `bun run llmveto <cmd>` or `bun run src/cli/index.ts <cmd>`:

```bash
llmveto start      # start the gateway (loopback-only, background daemon; dev mode: bun run src/cli/index.ts start)
llmveto status     # status (real liveness probe; stale pid files are reported as not running)
llmveto stop       # stop the background daemon
llmveto doctor     # managed-config enumeration override/drift assertions + port reachability + evidence chain; --write-managed-config writes real configs
llmveto verify     # evidence chain integrity + schema assertions
```

`report` (billing reconciliation) and `canary rotate` (canary rotation) belong to v2. v1's `doctor` check items are a **closed enumeration** (managed-config override/drift assertions + port reachability + `--write-managed-config` + evidence-chain verification); the authoritative list is in DESIGN §component 5. TLS/CA trust checks arrive only with TLS interception (v3); **v1 does not register that check item** (no permanently-empty check items).

## Status

The v1 product shell is complete (M1–M3): real path routing, adapters that truly read/write configs + real doctor drift, portable dist distribution (ADR-0001), background daemon lifecycle, CLI black-box smoke + daemon lifecycle E2E. The security core (proxy core / checkers / fail-closed / evidence chain) has been real since v0.1. Version `0.2.0`. See the [ROADMAP](docs/issues/5-roadmap.md).

**Evidence trust statement (quoted verbatim from the [REQ](docs/issues/1-req-threat-model.md))**: the evidence chain's adversary is "accidental corruption and cheap tampering", not "a process that can read and write your disk". Claiming "tamper-proof" would be an over-promise.

### 2026-09-27 security fixes (found by the DeepSeek-harness takeover audit)

An adversarial audit of the security core confirmed and fixed 4 defects, each with a reproducible regression test:

| # | Defect | Impact | Regression test |
|---|---|---|---|
| 1 | Uncaught exception in `dispatch` | An upstream connection reset (ECONNRESET etc.) threw an unhandled rejection → **the entire daemon process died**: no client response, zero evidence trail for that interaction, and all subsequent traffic lost protection | `tests/e2e/upstream-failure-resilience.test.ts` |
| 2 | `verify` integrity boundary too loose | The original implementation reported `ok` when the chain was **emptied entirely**; renumbered records went undetected | `tests/unit/evidence/verify.test.ts` |
| 3 | Scan unit dropped tool-call payloads | `tool_calls[*].function.arguments` (when `content` is null) never entered the scan unit → response-side checkers all missed | `tests/unit/gateway/scan-unit.test.ts` |
| 4 | Escape-sequence detection bypass | Writing an invisible character with the `\u200b` **escape syntax** was judged `clean` (JSON is the sole transport encoding — the laziest injection route); multi-backslash variants collapse via the innermost pair and are likewise caught by the restored projection | `tests/unit/gateway/scan-unit.test.ts` |

**Unfixed, registered residual risk** (see REQ §evidence trust boundary): **tail truncation** of the evidence chain is undetectable in principle on a machine without external anchoring,
so it is not fixed — it is written as an explicit negative-contract test to prevent it from later being misread as covered.
