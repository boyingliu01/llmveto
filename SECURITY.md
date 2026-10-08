# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.2.x | yes |
| < 0.2.0 | no |

## Reporting a vulnerability

Use **GitHub private vulnerability reporting** (Repository → Security → Report a vulnerability).
Do **not** open a public issue for anything you believe is a security defect — no public email
channel exists for this project.

Please include:

- the affected version (or commit SHA) and how you run llmveto;
- a minimal reproduction (config, command sequence, traffic capture if relevant);
- your assessment of impact.

## What is in scope

llmveto is a local LLM traffic security gateway; defects in the gateway itself are in scope:

- detection bypass (scan-surface evasion that the documented residual-risk register claims to cover);
- blocking failure (fail-closed violations: a request that should be blocked is forwarded);
- evidence-chain integrity (silent record corruption, chain-verification false negatives);
- daemon compromise or unavailability caused by attacker-controlled traffic (the fail-closed
  per-request convergence contract).

Out of scope: upstream (LLM provider) vulnerabilities, client-tool vulnerabilities that merely
coexist with the gateway, and anything already documented in the
[residual-risk register](docs/issues/1-req-threat-model.md) as an accepted, explicitly registered
limitation — those are contract, not vulnerability.

## Response commitments (deliberately conservative)

- Responses are **best-effort**; there is **no SLA** and no committed response time.
- Feature requests carry **no promise** of implementation through this channel.
- Accepted fixes ship as patch versions through the normal release gate chain
  (see [docs/release/publishing.md](docs/release/publishing.md)).
- Reporters who wish to be credited in the release notes may say so in the report.
