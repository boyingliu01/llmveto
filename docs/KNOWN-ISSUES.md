# Known Issues & Limitations

> Transparent disclosure of v1/v2a limitations, residual risks, and known bugs for internal trial users.
> Last updated: 2026-11-02 (v0.3.0)

---

## v2b-A（多客户端接入）能力边界

### T1a: canary injection is chat-only

- **What changed**: Claude Code (Anthropic Messages) and Codex (OpenAI Responses) are now onboarded
  and fully scanned, but canary injection is deliberately not implemented for either wire format.
- **Consequence**: on those two routes there is no positive evidence of retention and reuse
  (T1a's cross-session spill detection). `request_body_sha256` still proves what was sent; it cannot
  prove what the upstream kept.
- **Observability**: every non-injection writes `reason = "inject_skipped"` to the evidence record and
  increments the `inject_skipped` metric. Seeing that counter grow on these routes is expected, not a fault.
- **Why not do it now**: injection points differ per format (Anthropic has `system` block arrays and
  `tool_result`; Responses has typed `input[]` elements). Three injection point sets is a second canary
  redesign, not an extension. The full capability matrix is in
  [docs/protocol-capability-matrix.md](protocol-capability-matrix.md).

### Unknown wire shapes fail closed on managed routes only

- **What it does**: on a managed route (`claude/*`, `codex/*`, `promptfoo/*`, plus the existing
  managed routes) a body the gateway cannot classify is blocked with `reason = "shape_unrecognized"`.
- **Boundary**: on an **unmanaged** path the same shape is only recorded and degraded, never blocked.
  A user-created prefix is therefore not protected against this failure mode.
- **Legal empty requests still pass**: `messages: []`, a body with only `model`, and requests whose
  elements carry no known payload field are treated as legal empty requests, because canary injection's
  own branch 4 has exactly that shape and the shape check must not be stricter than injection.
- **The cost of that exemption**: a body whose container is present but whose field *names* are all
  unknown does not raise a distinct code. The `shape_partial_coverage` guard covers the other half —
  known fields that were not projected — and must stay at zero.

### Real HTTP headers are outside the scan surface (v1 boundary, not new)

- **What the design says**: the scan unit is the *body* projection — `messages`, `tools`, `system`,
  and a body-carried `extra_headers` field. Transport-level request headers are not scanned.
- **Measured**: a credential in a custom header (`X-Trace-Note: sk-...`) is forwarded to the upstream
  and the request returns 200. This behaviour predates v2b-A; it is the v1 boundary, not a regression.
- **Why it was not changed in v2b-A**: scanning every header would fire on ordinary clients that send
  trace ids and session tokens in headers, and the blocking class requires FP=0. The head of the
  trade-off is that a credential placed only in a header leaves the machine unvetoed.
- **Closing it properly**: a per-header scan with an explicit allow-list, or a header allow-list
  enforced fail-closed on managed routes. Registered here so it is not mistaken for coverage.

### Shape verdict runs on managed routes only

- **Decision** (2026-11-24): the two-axis shape verdict runs on managed routes. On an unmanaged
  path it is skipped entirely.
- **Why**: on unmanaged routes its only product is a recorded reason with no block, while its cost
  grows linearly with the body — measured in CI, G2's 512 KB tier went from 1.8 ms to 4.5 ms p50,
  past the relative gate. Managed routes — every route an adapter actually writes — keep the full
  fail-closed behaviour.
- **Cost**: an unmanaged path no longer records `shape_*` degradation reasons. Traffic there is still
  scanned by every checker; only the coverage-degradation signal is absent.
- **Scope note**: REQ-V2bA-15 asked for the reason on unmanaged routes too. This is a deliberate,
  recorded departure from that wording, chosen by the user in the trade-off between coverage
  telemetry and the latency budget.

### Transport-compressed bodies are rejected, not decompressed

- **What changed in v2b-A**: on managed routes a `Content-Encoding` other than `identity` (or absent)
  is refused with `unsupported_content_encoding`. Measured before the guard, a gzipped body carrying a
  credential returned 200 and reached the upstream.
- **Consequence**: a client that compresses requests will be refused on managed routes until a
  decompression path exists. Decompressing needs four decoders plus a zip-bomb budget, which is its
  own piece of work; refusing unreadable bytes beats claiming to have scanned them.

### Clients are onboarded from documentation, not from a live install

- **Measured precondition**: none of Claude Code, Codex or promptfoo is installed on the development
  machine (`~/.claude/`, `~/.codex/`, and promptfoo configs are all absent).
- **What that means**: adapter fields come from each vendor's published documentation, cited per field in
  [docs/protocol-field-provenance.md](protocol-field-provenance.md). End-to-end tests drive the gateway with
  real *adapter artifacts* plus a mock upstream, not with a real client binary.
- **Residual**: a client release that changes its config shape would not be caught by CI. `doctor`
  reports drift rather than silence, so the failure mode is visible on the next run.

## Security Residual Risks

### T1a: Data Exfiltration Detection (Canaries)

- **Status**: Implemented on managed routes (`opencode/openai`, `opencode/anthropic`,
  `opencode/mock`, `delphi/default`, and — since the dsh onboarding — `dsh/cliproxy`)
- **What it does**: allocates a 27-character canary per session, appends it to the last user text
  before forwarding, and blocks (stream termination for streaming) when a response contains
  **another session's** canary
- **Recording replay re-established 2026-11-24 (P1-1)**: the v2a recording was overwritten by
  probe traffic, so this item sat as an accepted residual. It is now re-run against real traffic:
  `scripts/canary-replay.mjs` rebuilds the corpus from this machine's 11 DSH session recordings
  (`var/canary-replay/`, gitignored — 66 exchanges, 0 synthetic text) and replays three criteria.
  Measured: **① finish_reason no migration 66/66** (injected-arm user text equals the baseline
  arm once the trailing canary is removed, so both arms feed the upstream identical effective
  input) · **② provider-reject delta 0** (all 66 injected bodies remain valid JSON with an
  unchanged `messages` length) · **③ append-only 66/66** (every injection adds exactly one canary
  and mutates no existing byte). Verdict PASS, written to `var/canary-replay/replay-report.json`.
  Reverse probe: a patched `inject` that rewrites existing bytes turns ① and ③ red and the
  overall verdict FAIL, so the harness is not a rubber stamp.
- **What the replay does NOT prove**: it drives a loopback mock upstream, not the real provider, so
  it cannot measure the *provider's* refusal rate — criterion ② is measured as "the forwarded body
  stays well-formed", which is the part the gateway controls. A provider that rejects inflected
  input for its own reasons is out of this measurement's reach.
- **Operational note**: injection only applies to the managed routes listed above; traffic routed
  through other `client/provider` paths is scanned but never injected. For dsh, this means every
  OpenAI-compatible provider that shares the `/dsh/cliproxy` base URL is covered, but a provider
  pointed at its own path (for example `/dsh/whalecloud`) is not — such a route must be added to
  `MANUAL_CANARY_MANAGED_ROUTES` first.
- **Admin boundary**: `POST /_llmveto/canary/rotate` and `GET /_llmveto/metrics` are protected only
  by the daemon binding to loopback. Do not expose `/_llmveto/*` through a reverse proxy; v0.3.0
  has no Host/Origin/token check on the admin surface.
- **Shared empty anchor**: requests whose first user message has no text part (empty string, missing
  content, or only image/file parts), requests with no user message, and unparsable bodies all derive
  the same fallback anchor (`"0:"`). Their handling differs: no-user/unparsable requests skip
  injection, while empty-string or non-text user content is injected through branches 3/4 and **is**
  forwarded with that shared canary. Normal sessions can therefore see the empty-anchor canary as a
  snapshot candidate; it can only be returned by an upstream that echoed a degenerate request.
- **Single-writer assumption**: the registry is designed for one gateway process per `stateDir`.
  Running two daemons against the same state directory is not detected or locked; the last writer
  wins and the other process's session state can be silently dropped.

#### Canary session-key collisions (fallback key)

- **Fixed for DSH clients in 0.5.0; remains for clients that send no session header.**
- **Mechanism**: without an `x-llmveto-session-id` header the key is
  `sha256(first role="user" text)`. Clients that inject system notices as `role: "user"`
  (approval-policy changes, runtime context, model-selection notices, `<system-reminder>` blocks)
  produce **identical** first messages across sessions, so those sessions share one canary.
- **Measured 2026-11-23** on 13 real DSH sessions: six distinct sessions shared the single key
  `54442a56dc3a791e` because each started with the same approval-policy notice. Consequence: a leak
  between those sessions could not be detected, violating the intent of `AC-V2a-17`
  ("distinct sessions get distinct keys").
- **Mitigation**: a DSH host plugin (`llmveto-session-header`) now sends the DSH session id as
  `x-llmveto-session-id`, which takes the header path and makes every session's key unique.
  Verified against real traffic: distinct sessions got distinct keys, and one session stayed constant.
- **Residual**: a client that neither sends the header nor has distinct first user text still
  collides. Registering such a client requires either an equivalent header hook or accepting the
  shared canary.

#### Canary capacity: LRU eviction blinds cross-session detection

- **Capacity** (spec §4.2/§4.3): TTL 24 h, LRU 64 — fixed constants, not runtime-configurable.
- **Measured behaviour**: allocating 100 sessions leaves exactly 64 in the active set. A session
  pushed out by the LRU no longer contributes its canary to `snapshot()`, so a response echoing
  that session's canary is judged `clean`. Verified 2026-11-23 with a direct probe: session A's
  canary disappears after 70 later sessions are assigned, and the leak check then returns `clean`.
- **Real-world headroom**: 7 active sessions on this machine's daily use, i.e. ~9x headroom under
  64. Eviction needs 65+ distinct sessions inside a 24 h TTL window, which one human developer
  does not reach — but many parallel agents or a shared gateway host could.
- **If it ever binds**: raising `CANARY_LRU_CAPACITY` requires updating the spec constant and the
  tests that pin the value; bucketing by client would need a registry format change. Do not raise
  it silently — the capacity is a documented §4.2 value.
- **Note**: eviction only weakens detection for *evicted* sessions. Detection between the 64 most
  recently active sessions is unaffected.

#### Canary attribution: session-level, not provider-level

- **What is recorded**: since 0.5.0 a cross-session canary hit carries `origin`, the key of the
  session whose canary appeared in another session's response. That answers *who leaked into
  whom*.
- **What is not**: for dsh, every OpenAI-compatible provider shares one route key
  (`dsh/cliproxy`), so the evidence can say a leak came from dsh but not which upstream provider
  served it. The same route key is also what makes canary injection apply there at all —
  splitting routes per provider would require adding each split to
  `MANUAL_CANARY_MANAGED_ROUTES`, and a provider pointed at its own path is currently **not**
  injected.
- **Why it is registered rather than changed**: splitting is an operational choice (each split
  needs a `LLMVETO_UPSTREAMS` entry and a managed-route entry), not a defect. Session-level
  attribution already closes the harder question for the threat this project models.
- **Workaround**: point a provider at its own path (`/dsh/<provider>`) *and* add that route to
  `MANUAL_CANARY_MANAGED_ROUTES` to get per-provider evidence; without the second half the route
  is scanned but never injected.

### T2a: Tool-Call Structure Judgment

- **Status**: Implemented in v0.3.0 (`tool-call-shape`, safety class)
- **What it does**: blocks unknown tool names, missing required arguments (both only when the
  request declares `tools`), and invalid JSON arguments (always)
- **Not covered**: dangerous-command allowlists, semantic intent judgment, or a request that
  declares no `tools` at all (registered as a known miss in the requirements)

#### `dangerous-command-scan` now covers the request side, with rule-level action grading (0.6.0)

- **What changed**: the checker was declared `side: "response"` only. Measured on this machine's
  real DSL sessions (2026-11-24), **every credential-read went through the request side**: an
  upstream instructed the agent in a *response* to call a `read` tool whose `path` was
  `~/.ssh/id_ed25519`, and the file content came back in a tool result. The checker never saw any of
  it — a whole class of credential egress had zero coverage. The spec now declares
  `sides: ["request", "response"]` (new optional field; `side` remains the primary side).
- **Action grading is per rule, not per checker.** The checker carries both
  "semantically closed" rules (reading `~/.ssh/*`, `.env`, `~/.aws/credentials`, `.npmrc` — a hit
  *is* egress) and rules where benign text matches are legitimate (`curl … | bash` appears verbatim
  in install docs, and in this repository's own README and tests). Giving them one action was the
  root cause of the 2026-11-24 incident below. Now `credential-file-read` is marked `blocking` and
  every other rule stays observational (`warn`). The authoritative set is
  `BLOCKING_RULE_IDS`, derived from the rule table in `src/checkers/dangerous-command-scan.ts`.
- **Residual**: the blocking rule matches credential *paths*, not credential *values*. Reading an
  unlisted store (custom secrets dir, keychain export, `.config/gh/hosts.yml`) is not blocked by
  this rule; it is still caught by `egress-secret-scan` if the value itself enters the request.
- **Noise bound**: at most `MAX_FINDINGS_PER_RULE` (5) findings per rule per exchange. A long DSL
  session resends its entire tool-result history, so one rule could otherwise emit 40+ findings and
  drown the one that matters.

#### Incident 2026-11-24: the request-side checker blocked normal sessions

- **What happened**: right after the request-side dispatch was enabled, this session's own traffic
  was refused six times (`blocked_before_forward`, HTTP 502, 645372-byte request). The cause is
  instructive: the conversation *was about security*, so its history contained `curl … | bash`,
  `eval $(curl …)`, `IEX`, and this repository's own test fixtures. Forty findings were recorded,
  all from a checker that was declared observational and should never have blocked anything.
- **Why the tests did not catch it**: the integration suite only ever fed the checker *benign*
  traffic from the response side. There was no case of "a request whose history legitimately quotes
  dangerous-looking commands", which is the normal shape of a security project's own sessions.
- **Fix** (all three parts are load-bearing): rule-level grading (only `credential-file-read`
  blocks), the per-rule noise bound, and regression tests that pin both directions — a tutorial
  command must pass through to the upstream (`warned`, upstream receives the request), and a
  credential read must not (`blocked_before_forward`, upstream receives nothing).
- **Lesson**: enabling a checker on a new side changes its blast radius. An observational checker
  that starts gating the request path is no longer observational.

#### `pem-private-key` only flagged the header (fixed 0.6.1)

- **What happened**: the rule matched `-----BEGIN … PRIVATE KEY-----` and nothing else, so any
  *discussion* of PEM format was judged as credential egress and blocked the whole request. The
  repository's own fixture — `tests/fixtures/threats/T1b/secrets.yaml`, present since 2026-09-15 —
  is exactly such a shell, which means working on this project could refuse its own sessions.
  Measured 2026-11-24: a request containing only that fixture line returned 502.
- **Why the 0.5.2 example allowlist did not cover it**: that allowlist handles `AKIA…` and
  `ghp_…` only; PEM was never added, and the problem is structural rather than a specific value.
- **Fix**: a PEM hit now requires a block shape — the header and the `END` line on **different
  lines**. Real PEM bodies are laid out line by line; fixtures and format discussions write them
  inline. Three other criteria were tried and rejected with measurements: body length (the
  truncated test sample `MIIEow...` has 6 legal characters, indistinguishable from the fixture),
  "has any content" (the fixture's `payload` placeholder counts as content), and multi-line block
  (it would flip the frozen `AC-VETO-003-01` sample to clean).
- **Residual**: a truncated real key written on one line is not flagged; a discussion quoting a
  genuine multi-line block is. Both are accepted — the former needs a body to leak, the latter is
  already a leak in the text.

### T2b: Response Injection Protection

- **Status**: Unmitigated
- **Impact**: Cannot detect a relay substituting a completely different but well-formed response
  (e.g. benign answer replaced with malicious instructions)
- **Workaround**: Cross-check critical responses against multiple providers
- **Planned fix**: fingerprint patrol + provider trust scoring (v2b)

### T3b/T3c: Advanced Model Impersonation

- **Status**: Unmitigated
- **Impact**: v1/v2a check model **label consistency** (warning when the response label differs
  from the requested label) and v2a adds thinking-signature presence. Neither proves model
  **authenticity**
- **Workaround**: Trust upstream provider; monitor for anomalous response patterns
- **Planned fix**: fingerprint-probe checker (v2b)

### T4x: Usage Reconciliation

- **Status**: Observational in v0.3.0
- **What it does**: compares a local token estimate against upstream `usage.total_tokens` and warns
  on over-reporting (`> 1.5×` and `> 64` above the estimate). Malformed usage degrades to
  `scanner_error` + `degraded_observational`
- **Not covered**: billing reconciliation against official prices; upstream-reported usage is
  deliberately **not** copied into the evidence chain
- **Planned fix**: billing reconciliation CLI (v2b)

---

## Architectural Limitations

### Streaming warn is recorded but not reflected in `action_taken`

- **Observed**: on the streaming path, an observational (non-blocking) checker hit such as
  `dangerous-command-scan` appears in `findings[]`, but `action_taken` stays `allowed`
  (`src/gateway/core.ts`, D-11). On the non-streaming path the same hit yields `warned`.
- **Why it is registered rather than fixed**: the streaming value is resolved from the delivery
  outcome (allowed / terminated / degraded) because bytes already forwarded cannot be recalled;
  folding an observational finding into it would change a v1 semantic that the policy mapping and
  several evidence assertions depend on. Unifying the two needs its own review.
- **Practical impact**: consumers filtering on `action_taken == "warned"` see streaming
  observational hits only if they also read `findings[]`. Integration coverage:
  `tests/integration/dangerous-command-scan.test.ts`.

### Streaming Byte Irrevocability

**Issue**: Once bytes of a streaming response are forwarded to the client, they **cannot be recalled**.

**Behavior**:
- Non-streaming responses: full block (zero bytes sent) when the verdict maps to `block`
- Streaming responses: the stream is terminated after detection (`terminated_after_delivery`), but
  already-forwarded chunks remain delivered

**Mitigation**: Terminate as early as possible. Chunk-level buffering would trade latency for
coverage and is not implemented.

**Reference**: [DESIGN §fail-closed](issues/2-design-v1.md#fail-closed-policy)

---

### Evidence Chain Trust Boundary

**Issue**: The evidence chain defends against accidental corruption and cheap tampering, but **not**
against a same-privilege local adversary.

**Details**:
- SHA-256 chaining prevents casual editing of individual records
- Tail truncation (deleting last N records) leaves a self-consistent short chain — undetectable
  without external anchoring
- A user with write access to the state directory could rewrite the entire chain

**Mitigation**:
- Store evidence on read-only media for audit purposes
- Periodically export and sign evidence hashes externally
- Use centralized logging (future integration point)

**Reference**: [TEST §4](issues/4-test-validation.md#evidence-field-table)

---

### Evidence Schema

The evidence schema remains **v1**. v0.3.0 only adds an optional top-level `reason`
(`registry_unavailable`, `inject_skipped`, `window_overflow`, `checker_timeout`, `scanner_error`,
`input_malformed`); the key is absent for clean exchanges. The `canary` field stays `null` and
canary plaintext never enters the chain.

---

### Bypass Discovery Gap

**Issue**: There is **no mechanism to detect unmanaged traffic** (clients that bypass the gateway).

**Uncovered paths**:
- AI clients not configured to use the gateway baseURL
- SDKs with hardcoded endpoints
- Browser extensions making direct fetch calls
- Telemetry/metrics endpoints

**Mitigation**:
- Run `llmveto doctor` periodically to verify managed-config coverage
- Monitor network traffic for unexpected LLM API calls
- Audit-gap detection is a v3 concern

**Reference**: [ROADMAP §v3](issues/5-roadmap.md#v3--策略闭环)

---

## Performance Constraints

### G1/G2/G3 Thresholds May Vary by Environment

**Expected overhead**:
- **G1 (TTFT delta)**: p95 < 5 ms, p99 < 12 ms (per streaming chunk)
- **G2 (request gate delta)**: ≤8 KB: 3 ms, ≤64 KB: 10 ms, ≤512 KB: 40 ms
- **G3 (checker execution budget)**: 8 KB: 20 ms, 32 KB: 50 ms, 512 KB: 120 ms

**Known slow environments**:
- Windows native (tail latency worse than WSL2/Linux)
- Network-mounted state directories (NFS/SMB)
- Heavily loaded systems (CPU > 80%)

On local Windows the 64 KB G2 tier has been observed above its 10 ms p95 limit while p50 stays
around 1.2 ms; `ubuntu-latest` CI is the authoritative environment for that gate.

**Mitigation**:
- Run benchmarks on your environment: `npm run bench`
- If thresholds are exceeded consistently, file an issue with benchmark output
- Consider running the gateway on a dedicated machine for production use

---

### Budget Overrun Behavior

**Issue**: An over-budget checker result is rewritten to `checker_timeout` **after** the checker
returns (JavaScript cannot preempt a synchronous pure function). This is a verdict surface, not a
kill switch.

**Consequences**:
- Safety-class checkers (`block` on error) fail closed on `checker_timeout`
- Observational checkers degrade to `degraded_observational`
- Large payloads (> 512 KB) can exceed the top G3 tier

**Mitigation**: Split large requests at the application layer; inspect `reason` and
`findings[]` entries in evidence.

---

## Client Compatibility

### Unsupported Clients

The following clients are **not officially onboarded** in v0.3.0:
- Claude Code
- Codex
- promptfoo
- Custom agents using SDK direct connections

**Workaround**: Manually point their baseURL at the gateway. They will not appear in
`MANAGED_CONFIG_IDS`, `doctor` will not verify them, and canary injection will not apply
(only the four managed routes are injected).

**Planned fix**: multi-client onboarding (v2b)

---

### Discussing credential formats conflicts with blocking-class secret scanning

- **Observed 2026-11-23/24**: while fixing `egress-secret-scan`, the agent created
  format-valid probe keys to verify gitleaks and detect-secrets, and printed an API key from the
  shell environment while surveying the toolchain. All of that entered the session transcript.
  Because the gateway forwards the whole conversation on every request, and the checker is
  blocking-class, **every subsequent request was refused** — 17 distinct strings, one of them a
  real (balance-exhausted)SiliconFlow key, the other 16 self-made test values.
- **The scanner was right in each case.** The real key should be blocked; the probe values are
  indistinguishable from keys by construction. This is not a defect to patch away by widening the
  allowlist — an allowlist that grows every time it interrupts its own author has stopped being an
  allowlist.
- **Operational consequence**: a session that quotes credential samples (writing fixture keys,
  debugging this checker, reviewing a leak) cannot send traffic through the gateway afterwards.
  Start a fresh session instead: it carries no earlier transcript, so nothing matches.
- **Working practice that avoids it**: refer to credentials indirectly (`the SiliconFlow key`,
  `sk-xxxx`) instead of pasting them; when a value must be printed for debugging, print a
  length/count rather than the value (`grep -c`, `${#VAR}`), which is what the tooling surveys
  should have done from the start.
- **Verified**: with the documented-example allowlist (0.5.2) the two vendor examples no longer
  trigger blocking; the remaining matches in a polluted transcript are genuine-looking values and
  blocking on them is the intended behaviour.

### Providers pointing straight at the upstream are unprotected

- **Measured 2026-11-24**: the dsh profile lists `ailb` with
  `baseURL: https://lab.iwhalecloud.com/gpt-proxy/v1`, i.e. **straight at the vendor**, while
  `whalecloud` points at `http://127.0.0.1:8787/dsh/cliproxy`. Traffic from `ailb` never reaches
  the gateway: no canary, no command scan, no evidence record.
- **How to tell which side a request took**: `curl -s http://127.0.0.1:8787/_llmveto/metrics`
  should increase, and `~/.llmveto/evidence.jsonl` should gain a record whose `client` is `dsh`.
  During the 2026-11-24 session the gateway logged **zero** records over 15 minutes of `ailb`
  traffic while those were happening — the counter is a reliable check.
- **Why it is left as is**: a direct-upstream provider is the deliberate escape hatch when the
  gateway itself is the problem (see the documented-example false positive fixed in 0.5.2 —
  before that fix, any conversation containing `AKIAIOSFODNN7EXAMPLE` was blocked, so a working
  bypass was needed to keep developing).
- **Consequence to state plainly**: while working through a direct-upstream provider, the
  protections described in the README do not apply. Switch the provider to the gateway route to
  get them; the trade is that a checker false positive then interrupts the session.

### ACP CLI clients (trae, codebuddy) bypass the gateway by design

- **What they are**: `traecli acp serve` and the codebuddy link are **first-party vendor CLIs**
  launched by DSH as ACP subprocesses. DSH talks to them over a pipe, not HTTP, and their provider
  configuration carries no `baseURL` — there is nothing for the gateway to rewrite.
- **Consequence**: canary injection, the command scan and the evidence trail do **not** cover
  traffic from these two clients. This is the same boundary the README states for any non-onboarded
  client ("installing the gateway ≠ being protected").
- **Why it is accepted rather than fixed riding v1**: covering a process that dials the vendor
  itself needs TLS interception (`HTTPS_PROXY` + a trusted CA), which is a v3 item and conflicts
  with the current "no CA installation" property.
- **Threat-model note**: their model backends are first-party vendor services (ByteDance Seed via
  trae, Tencent for codebuddy), not third-party relay stations. The relay-poisoning risk this
  project targets does not apply to them, which is why model-authenticity probing of their model
  lists is explicitly **not** planned (see `docs/TODO-PLAN-2026-11-23.md` P1-6).
- **If this changes**: a future CLI that accepts a configurable base URL should be onboarded like
  any other provider (managed config id + route + doctor assertion).

### OpenCode v2 Integration Quirks

**Known symptom**: `doctor --write-managed-config` succeeds but OpenCode still connects directly
to the upstream, and evidence shows `client="unknown"`.

**Workaround**:
1. Verify `~/.config/opencode/opencode.json` has the correct `provider.baseURL`
2. Restart the OpenCode session after the config change
3. If it persists, configure manually (see [QUICKSTART](QUICKSTART.md))

---

## Documentation Gaps

The following are planned but not yet written:
- Advanced configuration reference (all environment variables)
- Evidence schema deep-dive (field-by-field)
- Integration guide for custom AI clients
- Troubleshooting decision tree

**Workaround**: Check [FAQ](FAQ.md) or file a GitHub Issue.

---

## Deprecation Warnings

### Node.js < 18 Support

**Status**: Deprecated since v0.2.0. The npm distribution requires Node.js ≥ 18.

### Bun Build Artifacts

**Status**: Not part of the official distribution. `bun build --compile` output is experimental and
not tested in CI. Use the npm distribution for production.

---

## Reporting New Issues

1. **Check existing issues**: [GitHub Issues](https://github.com/boyingliu01/llmveto/issues)
2. **File a new issue**: use the bug report template in [FEEDBACK.md](FEEDBACK.md)
3. **Include evidence**: attach redacted evidence records and reproduction steps

For security vulnerabilities, contact @boyingliu01 directly (do not post publicly).

---

## Version History of Known Issues

| Date | Change |
|------|--------|
| 2026-11-24 | 0.6.1: canary recording replay re-established (P1-1); PEM false positive fixed; request-side grading incident registered |
| 2026-11-24 | 0.6.0: `dangerous-command-scan` extended to the request side with rule-level grading; incident and residual coverage registered |
| 2026-11-02 | v0.3.0: canary engine and four checkers shipped; corrected v2a status, budget semantics, and removed unverified bug claims |
| 2026-10-16 | Initial compilation for internal trial |
| 2026-09-27 | v2a sprint completed; canary/evil-relay merged but not yet released |
