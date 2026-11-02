# Known Issues & Limitations

> Transparent disclosure of v1/v2a limitations, residual risks, and known bugs for internal trial users.
> Last updated: 2026-11-02 (v0.3.0)

---

## Security Residual Risks

### T1a: Data Exfiltration Detection (Canaries)

- **Status**: Implemented in v0.3.0 on managed routes (`opencode/openai`, `opencode/anthropic`,
  `opencode/mock`, `delphi/default`)
- **What it does**: allocates a 27-character canary per session, appends it to the last user text
  before forwarding, and blocks (stream termination for streaming) when a response contains
  **another session's** canary
- **Residual risk (recording replay not re-run)**: the v2a gate recorded 10 real agent sessions
  and passed its form checks before the canary engine was built, but the raw recording was later
  overwritten by probe traffic. The injection replay (finish-reason distribution, provider refusal
  increment, manual review of 10 sessions) could not be re-established. Injection is covered by
  integration tests across the six injection branches and by end-to-end managed-route tests, but
  not by a fresh real-agent replay. Treat this as an accepted residual, not a proven zero-impact
  change.
- **Operational note**: injection only applies to the four managed routes above; traffic routed
  through other `client/provider` paths is scanned but never injected.

### T2a: Tool-Call Structure Judgment

- **Status**: Implemented in v0.3.0 (`tool-call-shape`, safety class)
- **What it does**: blocks unknown tool names, missing required arguments (both only when the
  request declares `tools`), and invalid JSON arguments (always)
- **Not covered**: dangerous-command allowlists, semantic intent judgment, or a request that
  declares no `tools` at all (registered as a known miss in the requirements)

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
| 2026-11-02 | v0.3.0: canary engine and four checkers shipped; corrected v2a status, budget semantics, and removed unverified bug claims |
| 2026-10-16 | Initial compilation for internal trial |
| 2026-09-27 | v2a sprint completed; canary/evil-relay merged but not yet released |
