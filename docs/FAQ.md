# Frequently Asked Questions (FAQ)

> For internal trial users of llmveto v0.3.0. Last updated: 2026-11-02

---

## Installation & Setup

### Q: Do I need to install Bun to use llmveto?

**A**: No. The npm distribution (`npm i -g llmveto`) runs with Node.js ≥ 18 and does not require Bun. Bun is only needed if you want to build from source or run `.ts` files directly in development mode.

### Q: Can I run llmveto on Windows/WSL/Linux?

**A**: Yes. llmveto is cross-platform:
- **Windows**: Use Node.js native or WSL2
- **Linux/macOS**: Native support
- **Recommended for production**: Linux/WSL2 (better file locking, lower latency)

### Q: What ports does llmveto use?

**A**: Default loopback address `127.0.0.1:8787`. You can override with `LLMVETO_LISTEN_ADDR` environment variable. Ensure no other service occupies this port.

---

## Configuration

### Q: How do I configure which upstream LLM provider to use?

**A**: Set the `LLMVETO_UPSTREAM_BASE_URL` environment variable before starting the gateway:

```bash
export LLMVETO_UPSTREAM_BASE_URL=https://api.openai.com
llmveto start
```

For multiple providers, use `LLMVETO_UPSTREAMS` with a routing table (see [README](../README.md)).

### Q: My AI client (OpenCode/Delphi) doesn't automatically connect to the gateway. What should I check?

**A**: Run the diagnostic command:

```bash
llmveto doctor --write-managed-config
```

This will:
1. Check if your client's configuration points to the gateway
2. Auto-fix OpenCode's `baseURL` or Delphi's `.delphi-config.json` endpoint
3. Report any drift between expected and actual configuration

If auto-fix fails, manually configure:
- **OpenCode**: Set `provider.baseURL` to `http://127.0.0.1:8787/opencode/mock` in `~/.config/opencode/opencode.json`
- **Delphi**: Set the endpoint in `.delphi-config.json` to `http://127.0.0.1:8787`

### Q: Can I use llmveto with Claude Code / Codex / promptfoo?

**A**: In v1, only OpenCode and Delphi are supported via automatic config injection. Claude Code, Codex, and promptfoo onboarding is planned for v2b. If you need these clients now, you can manually point their baseURL to the gateway, but they won't be tracked in `MANAGED_CONFIG_IDS` and won't appear in evidence logs with proper client identification.

---

## Security Behavior

### Q: What does llmveto actually block vs. warn about?

**A**: v1 has three checkers with different verdicts:

| Checker | Verdict | Action | Trigger |
|---------|---------|--------|---------|
| `egress-secret-scan` | `block` | Request rejected, zero bytes sent upstream | API keys, tokens, PEM private keys detected in request body |
| `invisible-unicode-scan` | `block` (non-streaming) / `terminate` (streaming) | Response blocked or stream terminated | Zero-width spaces, homoglyphs, escape sequences like `\u200B` in response |
| `model-label-consistency` | `warn` | Evidence logged, request proceeds | Model label in response doesn't match requested model |

**Important**: Streaming responses that have already forwarded bytes **cannot be recalled**. v1's streaming block = stream termination + error event injection. See [DESIGN §fail-closed](issues/2-design-v1.md).

### Q: Does llmveto protect against all LLM relay attacks?

**A**: No. v1 covers T1b (credential exfiltration), T2c (invisible characters), and T3a subset (label consistency). It does **not** detect:
- Data exfiltration via canaries (T1a) — v2 feature
- Tool-call structure manipulation (T2a) — v2 feature
- Response injection by malicious relays (T2b) — v2 feature
- Model authenticity proof (fingerprinting) — v2 feature

See [v1 residual-risk register](issues/1-req-threat-model.md#v1-residual-risk-register) for full disclosure.

### Q: What happens if the gateway crashes or loses connection to upstream?

**A**: Fail-closed behavior:
- Gateway returns HTTP 502 to the client
- An `llmveto:upstream-error` evidence record is appended to the chain
- The daemon process survives and continues accepting new requests
- No retry or failover occurs in v1 (this is a v2 operations concern)

---

## Evidence & Privacy

### Q: Where is the evidence chain stored? Is it secure?

**A**: Evidence is stored as append-only JSONL files in the state directory (default: `.llmveto/evidence/`). Each record includes:
- SHA-256 hash chaining (previous record hash → current record hash)
- Timestamp, request/response metadata, checker verdicts, action taken

**Trust boundary**: The chain defends against accidental corruption and cheap tampering. A same-privilege local adversary could rewrite the entire chain. Tail truncation (deleting last N records) leaves a self-consistent short chain — detecting this requires external anchoring (unscheduled). Use `llmveto verify` to validate chain integrity.

### Q: Does llmveto store my API keys or secrets it detects?

**A**: No. When `egress-secret-scan` blocks a request, the evidence record contains:
- Redacted request metadata (no raw secrets)
- Checker verdict and matched pattern type (e.g., "OpenAI sk-...")
- Timestamp and client identifier

Secrets are never written to disk. The gateway scans for them but does not retain them.

### Q: Can I export evidence for audit purposes?

**A**: Yes. Evidence files are plain JSONL. You can:
1. Copy the `.llmveto/evidence/` directory
2. Run `llmveto verify` to generate a verification report
3. Share the JSONL files with auditors (they contain no secrets, only metadata)

For automated export, see the evidence schema in [TEST §4](issues/4-test-validation.md#evidence-field-table).

---

## Troubleshooting

### Q: `llmveto start` fails with "port already in use"

**A**: Another process is occupying port 8787. Fix:

```bash
# Find the process
lsof -i :8787        # macOS/Linux
netstat -ano | findstr :8787  # Windows

# Kill it (if safe)
kill <PID>           # macOS/Linux
taskkill /PID <PID>  # Windows

# Or change llmveto's port
export LLMVETO_LISTEN_ADDR=127.0.0.1:9090
llmveto start
```

### Q: My AI client connects but requests are being blocked unexpectedly

**A**: Check which checker triggered:

```bash
# View recent evidence
tail -n 20 .llmveto/evidence/*.jsonl

# Look for block verdicts
grep '"verdict":"block"' .llmveto/evidence/*.jsonl
```

Common causes:
- **False positive secret scan**: Your code contains string literals resembling API keys (e.g., `sk-xxxx` in test fixtures). Add explicit allowlist patterns or refactor test data.
- **Invisible characters in model responses**: Some providers inject zero-width spaces for formatting. This is expected behavior — the gateway is protecting you.

If you believe it's a false positive, file a GitHub Issue with the evidence record (redact any sensitive paths).

### Q: `llmveto doctor` reports configuration drift after I manually edited my client config

**A**: This is expected. `doctor --write-managed-config` enforces the gateway's managed configuration. If you need custom settings:
1. Edit the gateway's configuration template (advanced, not recommended for v1)
2. Or accept that manual edits will be overwritten on next `doctor` run

The drift detection is intentional — it ensures all traffic passes through the gateway.

### Q: Performance seems slower than direct upstream connection

**A**: Measure the overhead:

```bash
# Baseline: direct to upstream
curl -w '%{time_total}' https://api.openai.com/v1/chat/completions ...

# Through gateway
curl -w '%{time_total}' http://127.0.0.1:8787/opencode/mock/v1/chat/completions ...
```

Expected overhead (v1 performance gates):
- **G1 (TTFT delta)**: p95 < 5ms, p99 < 12ms
- **G2 (request gate delta)**: ≤8KB body: 3ms, ≤64KB: 10ms, ≤512KB: 40ms

If overhead exceeds these thresholds, check:
- System load (CPU/memory pressure)
- Network latency to upstream
- Evidence store I/O (slow disk?)

Report sustained violations via GitHub Issues with benchmark output.

---

## Feedback & Support

### Q: How do I report bugs or request features?

**A**: 
1. **GitHub Issues**: [https://github.com/boyingliu01/llmveto/issues](https://github.com/boyingliu01/llmveto/issues)
   - Include: llmveto version, OS, client type, evidence record (redacted), reproduction steps
2. **Internal feedback form**: [Link TBD — ask project maintainer]
3. **Direct contact**: Reach out to @boyingliu01 for urgent issues

### Q: Can I contribute code or documentation?

**A**: Yes! This is an open-source project. See:
- [CONTRIBUTING.md](../CONTRIBUTING.md) (if exists)
- [README](../README.md) for development setup
- Fork → branch → PR workflow

For major changes, open an issue first to discuss design.

---

## Version Differences

### Q: What's the difference between v1 and v2a?

**A**: 

| Feature | v1 | v2a |
|---------|----|-----|
| Credential scan (T1b) | ✅ block | ✅ block |
| Invisible unicode (T2c) | ✅ block/terminate | ✅ block/terminate |
| Model label consistency (T3a) | ✅ warn | ✅ warn |
| Thinking signature presence | ❌ | ✅ observational |
| Tool-call shape validation | ❌ | ✅ block |
| Usage reconciliation | ❌ | ✅ observational |
| Canary injection & return scan | ❌ | ✅ block |
| Evil-relay simulator | ❌ | ✅ CI integration |
| Fingerprint patrol | ❌ | Planned v2b |
| Multi-client onboarding (Claude/Codex) | ❌ | Planned v2b |
| Billing reconciliation CLI | ❌ | Planned v2b |

See [ROADMAP](issues/5-roadmap.md) for full timeline.

### Q: Should I use v0.3.0 or wait for v2b?

**A**: Use v0.3.0 now if:
- You need immediate protection against credential leaks and invisible character attacks
- You're using OpenCode or Delphi (canary injection applies to the four managed routes)
- You want tool-call shape blocking and observational usage/thinking checks
- You want to audit LLM traffic with evidence trails

Wait for v2b if:
- You need Claude Code / Codex / promptfoo support
- You want automated billing reconciliation
- You need fingerprint-based model authenticity proof

v0.3.0 is the v2a detection core release; it is stable for internal use but lacks the v2b features above.
