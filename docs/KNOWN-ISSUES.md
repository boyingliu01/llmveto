# Known Issues & Limitations

> Transparent disclosure of v1/v2a limitations, residual risks, and known bugs for internal trial users.  
> Last updated: 2026-10-16

---

## Security Residual Risks (v1)

The following threat categories are **not mitigated** in v1. They are tracked in the [v1 residual-risk register](issues/1-req-threat-model.md#v1-residual-risk-register).

### T1a: Data Exfiltration Detection (Canaries)
- **Status**: Unmitigated in v1
- **Impact**: Cannot detect if a malicious relay leaks your data to external endpoints
- **Workaround**: Monitor outbound network traffic manually; use firewall rules to restrict egress
- **Planned fix**: v2 canary engine (SL-08 completed in v2a sprint, but not yet integrated into production deployment)

### T2a: Tool-Call Structure Judgment
- **Status**: Partially mitigated in v2a
- **Impact**: v1 scans tool-call **payloads** (`tool_calls[*].function.arguments`) for secrets/invisible chars, but does not judge argument **shape** or dangerous commands (e.g., `rm -rf /`, unauthorized API calls)
- **Workaround**: Review tool-call logs manually; implement allowlists at the application layer
- **Planned fix**: v2a `tool-call-shape` checker (SL-09 completed, available in v2a branch but not yet in npm release)

### T2b: Response Injection Protection
- **Status**: Unmitigated in v1
- **Impact**: Cannot detect if a relay substitutes a completely different response (e.g., benign answer replaced with malicious instructions)
- **Workaround**: Cross-check critical responses against multiple providers; use model fingerprinting (v2 feature)
- **Planned fix**: v2 fingerprint patrol + evil-relay simulator testing (SL-13 completed in v2a)

### T3b/T3c: Advanced Model Impersonation
- **Status**: Unmitigated in v1
- **Impact**: v1 only checks model **label consistency** (warns if response label ≠ requested label). Does not verify model **authenticity** via fingerprinting
- **Workaround**: Trust upstream provider; monitor for anomalous response patterns
- **Planned fix**: v2 fingerprint-probe checker (planned v2b)

### T4x: Usage Reconciliation
- **Status**: Observational in v2a
- **Impact**: Cannot automatically reconcile relay invoices against actual usage
- **Workaround**: Manually compare usage logs with billing statements
- **Planned fix**: v2b billing reconciliation CLI (deferred from v2a)

---

## Architectural Limitations

### Streaming Byte Irrevocability

**Issue**: Once bytes of a streaming response are forwarded to the client, they **cannot be recalled**.

**Behavior**:
- Non-streaming responses: Full block (zero bytes sent) if checker verdict = `block`
- Streaming responses: v1 terminates the stream after detecting violation, but already-forwarded chunks remain delivered

**Example**:
```
Client receives: Chunk 1 ✅ → Chunk 2 ✅ → [checker detects invisible char] → Stream terminated ❌
```

**Mitigation**: This is a fundamental limitation of HTTP streaming. v1's approach = minimize damage by terminating early. Future versions may add chunk-level buffering (with latency tradeoff).

**Reference**: [DESIGN §fail-closed](issues/2-design-v1.md#fail-closed-policy)

---

### Evidence Chain Trust Boundary

**Issue**: The evidence chain defends against accidental corruption and cheap tampering, but **not** against a same-privilege local adversary.

**Details**:
- SHA-256 chaining prevents casual editing of individual records
- Tail truncation (deleting last N records) leaves a self-consistent short chain — undetectable without external anchoring
- A user with write access to `.llmveto/evidence/` could rewrite the entire chain

**Mitigation**:
- Store evidence on read-only media for audit purposes
- Periodically export and sign evidence hashes externally
- Use centralized logging (future integration point)

**Reference**: [TEST §4](issues/4-test-validation.md#evidence-field-table)

---

### Bypass Discovery Gap

**Issue**: v1 has **no mechanism to detect unmanaged traffic** (clients that bypass the gateway).

**Uncovered paths in v1**:
- AI clients not configured to use gateway baseURL
- SDKs with hardcoded endpoints
- Browser extensions making direct fetch calls
- Telemetry/metrics endpoints

**Mitigation**:
- Run `llmveto doctor` periodically to verify managed config coverage
- Monitor network traffic for unexpected LLM API calls
- Plan for v3 audit gap detection

**Reference**: [ROADMAP §v3](issues/5-roadmap.md#v3--策略闭环)

---

## Performance Constraints

### G1/G2 Thresholds May Vary by Environment

**Expected overhead** (v1 performance gates):
- **G1 (TTFT delta)**: p95 < 5ms, p99 < 12ms
- **G2 (request gate delta)**: ≤8KB: 3ms, ≤64KB: 10ms, ≤512KB: 40ms

**Known slow environments**:
- Windows native (file I/O slower than WSL2/Linux)
- Network-mounted state directories (NFS/SMB)
- Heavily loaded systems (CPU > 80%)

**Mitigation**:
- Run benchmarks on your environment: `npm run bench`
- If thresholds exceeded consistently, file a performance issue with benchmark output
- Consider running gateway on dedicated machine for production use

---

### G3 Scan Timeout Behavior

**Issue**: If scanning a large request exceeds timeout, the request is **blocked** (fail-closed).

**Default timeout**: 5 seconds per scan unit

**Trigger conditions**:
- Very large payloads (>1MB)
- Complex escape sequence restoration
- System under heavy load

**Mitigation**:
- Split large requests into smaller chunks at application layer
- Increase timeout via configuration (advanced, not exposed in v1 CLI)
- Monitor for timeout events in evidence logs: `grep "scan-timeout" .llmveto/evidence/*.jsonl`

---

## Client Compatibility

### Unsupported Clients (v1)

The following AI clients are **not officially supported** in v1:
- Claude Code
- Codex (OpenAI's code completion daemon)
- promptfoo
- Custom agents using SDK direct connections

**Workaround**: Manually configure their baseURL to point to the gateway, but:
- They won't appear in `MANAGED_CONFIG_IDS`
- `doctor` won't verify their configuration
- Evidence logs won't have proper `client` field identification

**Planned fix**: v2b multi-client onboarding (deferred from v2a)

---

### OpenCode v2 Integration Quirks

**Issue**: OpenCode v2.0.26 uses a new agent dispatch mechanism that may conflict with v1's config injection.

**Symptoms**:
- `doctor --write-managed-config` succeeds but OpenCode still connects directly to upstream
- Evidence logs show `client="unknown"` instead of `client="opencode"`

**Workaround**:
1. Verify `~/.config/opencode/opencode.json` has correct `provider.baseURL`
2. Restart OpenCode session after config change
3. If issue persists, use manual config (documented in [QUICKSTART](QUICKSTART.md))

**Note**: This was resolved in v2a sprint via opencode v2 upgrade, but edge cases may remain.

---

## Known Bugs (v2a Branch)

The following issues exist in the v2a development branch (not yet in npm release):

### 1. Canary Rotation Counter Off-by-One

**Issue**: `canary rotate` command reports one fewer rotation than actual.

**Impact**: Cosmetic only; canary injection works correctly.

**Fix status**: Identified, patch pending.

---

### 2. Evil-Relay Simulator CI Flakiness

**Issue**: Dual-matrix CI workflow occasionally fails on GitHub Actions due to timing issues in stream termination detection.

**Impact**: False negatives in CI; local runs are stable.

**Workaround**: Re-run failed jobs; monitor for pattern.

**Fix status**: Under investigation (issue #TBD).

---

### 3. Usage-Reconcile Checker False Positives

**Issue**: When upstream provider returns non-standard usage format, `usage-reconcile` flags it as mismatch.

**Impact**: Observational only (verdict = `warn`), no blocking.

**Workaround**: Ignore warnings for known non-standard providers; filter by provider ID in evidence logs.

**Fix status**: Planned v2b refinement.

---

## Documentation Gaps

### Missing Guides

The following documentation is planned but not yet written:
- Advanced configuration reference (all environment variables)
- Evidence schema deep-dive (field-by-field explanation)
- Integration guide for custom AI clients
- Troubleshooting decision tree (interactive flowchart)

**Workaround**: Check [FAQ](FAQ.md) for common questions; file GitHub Issues for missing topics.

---

## Deprecation Warnings

### Node.js < 18 Support

**Status**: Deprecated since v0.2.0

**Impact**: npm distribution requires Node.js ≥ 18. Running on older versions may work but is unsupported.

**Action required**: Upgrade Node.js if you're on v16 or earlier.

---

### Bun Build Artifacts

**Status**: Not part of official distribution

**Impact**: `bun build --compile` single-binary output is experimental and not tested in CI.

**Recommendation**: Use npm distribution (`npm i -g llmveto`) for production. Bun builds are for development/testing only.

---

## Reporting New Issues

If you encounter an issue not listed here:

1. **Check existing issues**: [GitHub Issues](https://github.com/boyingliu01/llmveto/issues)
2. **File a new issue**: Use the bug report template in [FEEDBACK.md](FEEDBACK.md)
3. **Include evidence**: Attach redacted evidence records and reproduction steps

For security vulnerabilities, contact @boyingliu01 directly (do not post publicly).

---

## Version History of Known Issues

| Date | Change |
|------|--------|
| 2026-10-16 | Initial compilation for internal trial; added v2a known bugs section |
| 2026-09-27 | v2a sprint completed; canary/evil-relay features merged but not yet in npm release |
| 2026-09-14 | R1 design review clarified v1 residual risks; added to threat model document |

This document will be updated as issues are resolved or new ones are discovered during the trial period.
