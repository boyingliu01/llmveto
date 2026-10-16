# Feedback Guide for Internal Trial Users

> Help us improve llmveto by reporting issues, sharing experiences, and suggesting improvements.  
> Last updated: 2026-10-16

---

## How to Provide Feedback

We welcome all forms of feedback during the internal trial period. Choose the channel that best fits your situation:

### 1. GitHub Issues (Preferred for Bugs & Feature Requests)

**When to use**: 
- Reproducible bugs or unexpected behavior
- Performance regressions
- Missing features or enhancement ideas
- Documentation gaps

**How to file**:
1. Visit [https://github.com/boyingliu01/llmveto/issues](https://github.com/boyingliu01/llmveto/issues)
2. Click "New Issue"
3. Select the appropriate template (Bug Report / Feature Request / Question)
4. Fill in the details (see templates below)
5. Submit — we'll respond within 48 hours

### 2. Internal Feedback Form

**When to use**:
- Sensitive security concerns (don't want public disclosure)
- Organizational adoption blockers
- Confidential performance data

**Access**: Contact @boyingliu01 for the form link

### 3. Direct Contact

**When to use**:
- Urgent production blockers
- Architecture discussions
- Partnership or integration questions

**Contact**: @boyingliu01 via internal chat or email

---

## Bug Report Template

When filing a bug on GitHub, please include:

```markdown
## Environment
- **llmveto version**: (e.g., v0.2.0, commit hash if running from source)
- **OS**: (Windows 11 / WSL2 Ubuntu 22.04 / macOS Sonoma / etc.)
- **Node.js version**: `node --version`
- **AI client**: (OpenCode v2.0.26 / XP-Gate Delphi / other)
- **Upstream provider**: (OpenAI / Anthropic / custom)

## What happened?
Clear description of the issue. Include error messages, stack traces, or screenshots.

## What did you expect?
Describe the expected behavior.

## Steps to reproduce
1. Start gateway: `llmveto start`
2. Configure client: `llmveto doctor --write-managed-config`
3. Send request: (provide exact command or code snippet)
4. Observe: (what went wrong?)

## Evidence records
Attach relevant evidence JSONL lines (redact sensitive paths):
```bash
tail -n 10 .llmveto/evidence/*.jsonl | grep -C 3 "error\|block"
```

## Additional context
- Gateway logs: `.llmveto/gateway.log` (if exists)
- Client logs: (if available)
- Network capture: (optional, for complex issues)
```

---

## Feature Request Template

```markdown
## Use case
Describe the problem you're trying to solve. Example: "I need to detect when a relay substitutes a weaker model than requested."

## Proposed solution
What would you like llmveto to do? Be specific about:
- Trigger conditions
- Expected behavior (block/warn/allow)
- Evidence to capture

## Alternatives considered
Did you try workarounds? Why didn't they work?

## Priority
- [ ] Critical (blocks my workflow)
- [ ] High (significant improvement)
- [ ] Medium (nice to have)
- [ ] Low (minor convenience)

## References
Link to related issues, academic papers, or industry standards if applicable.
```

---

## Exporting Evidence for Analysis

When reporting issues, you may need to share evidence records. Follow these steps:

### 1. Locate evidence files

```bash
# Default location
ls -lh .llmveto/evidence/

# Custom state directory (if set)
echo $LLMVETO_STATE_DIR
```

### 2. Filter relevant records

```bash
# Find blocked requests
grep '"verdict":"block"' .llmveto/evidence/*.jsonl > blocked-evidence.jsonl

# Find warnings
grep '"verdict":"warn"' .llmveto/evidence/*.jsonl > warning-evidence.jsonl

# Find errors
grep '"type":"llmveto:upstream-error"' .llmveto/evidence/*.jsonl > upstream-errors.jsonl
```

### 3. Redact sensitive information

```bash
# Remove file paths, usernames, internal URLs
sed -E 's|/home/[a-zA-Z0-9]+/|/home/[REDACTED]/|g' blocked-evidence.jsonl > blocked-evidence-redacted.jsonl
sed -E 's|"path":"[^"]*"|"path":"[REDACTED]"|g' blocked-evidence-redacted.jsonl > final-export.jsonl
```

### 4. Verify chain integrity (optional but recommended)

```bash
llmveto verify --evidence-dir .llmveto/evidence/
```

Include the verification output in your bug report.

### 5. Attach to issue

Upload the redacted JSONL file to your GitHub issue. Do **not** paste raw evidence in comments (it's hard to read and may contain accidental leaks).

---

## Performance Benchmark Submission

If you notice performance issues, help us by running the benchmark suite:

```bash
# Run standard benchmarks (G1/G2/G3 gates)
npm run bench

# Compare against baseline
diff bench/baseline.local.json bench/latest-results.json

# Submit results
# Attach both files to your GitHub issue with label "performance"
```

Include:
- System specs (CPU, RAM, disk type)
- Concurrent load (how many simultaneous requests?)
- Upstream latency (measure direct vs. gateway)

---

## Security Concerns

If you discover a security vulnerability:

### DO NOT:
- Post publicly on GitHub Issues
- Share exploit details in public channels
- Include raw secrets in evidence exports

### DO:
1. Contact @boyingliu01 directly via encrypted channel
2. Provide minimal reproduction (redacted)
3. Allow 72 hours for triage before public disclosure

We take security seriously and will acknowledge your responsible disclosure in release notes (with your permission).

---

## Improvement Suggestions

We track improvement ideas in three categories:

### 1. Documentation Gaps
- Unclear setup steps
- Missing troubleshooting guides
- Ambiguous error messages

**Action**: File a "Documentation" issue on GitHub or submit a PR with proposed changes.

### 2. UX Friction Points
- Confusing CLI output
- Hard-to-find configuration options
- Poor error messages

**Action**: Describe the friction point and suggest a better experience. Example: "When the gateway fails to start, the error message should include the port number and a hint to check for conflicts."

### 3. Integration Opportunities
- New AI clients to support (Claude Code, Codex, etc.)
- CI/CD pipeline integrations
- Monitoring/alerting hooks

**Action**: File a "Feature Request" with use case details. See [ROADMAP](issues/5-roadmap.md) for planned integrations.

---

## Feedback Response Timeline

| Channel | Acknowledgment | Resolution Target |
|---------|---------------|-------------------|
| GitHub Issues (Bug) | Within 48 hours | 7 days for critical, 30 days for minor |
| GitHub Issues (Feature) | Within 72 hours | Added to backlog, prioritized in next sprint planning |
| Internal Form | Within 24 hours | Depends on sensitivity; urgent items escalated immediately |
| Direct Contact | Within 4 hours (business hours) | Ad-hoc discussion, may result in GitHub issue for tracking |

---

## Recognition

Contributors who provide valuable feedback will be acknowledged in:
- Release notes (with permission)
- CONTRIBUTORS.md file
- Special thanks in README

We appreciate your help in making llmveto better!

---

## Frequently Asked Questions About Feedback

### Q: Can I remain anonymous when reporting issues?

**A**: For GitHub Issues, your username is visible. For sensitive reports, use the internal feedback form or contact @boyingliu01 directly.

### Q: Will my feedback lead to breaking changes?

**A**: We follow semantic versioning. Bug fixes and security patches won't break existing workflows. Major features (v2, v3) may introduce new configuration options but maintain backward compatibility where possible.

### Q: How do I track the status of my feedback?

**A**: GitHub Issues have labels (`triage`, `in-progress`, `resolved`) and milestones. You'll receive notifications on updates. For internal form submissions, we'll reply with a tracking ID.

### Q: Can I contribute fixes myself?

**A**: Absolutely! Fork the repo, create a branch, implement the fix, and submit a PR. See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines. All PRs undergo delphi-review before merging.
