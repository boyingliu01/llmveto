# Sprint Close Report — v2a Detection Core (sprint-20260927-46)

**Sprint ID**: sprint-20260927-46
**Specification**: SPEC-V2A-001 (15 REQ / 27 AC)
**Status**: CLOSED
**Final release**: v0.3.1 (supersedes v0.3.0)
**Final main**: d4e1632
**Date**: 2026-11-02

> This report replaces the 2026-10-15 draft, which recorded SHIP as skipped and CLOSE as done
> while UAT was still pending. The sprint was actually landed through PR #13 (v2a → v0.3.0)
> and PR #14 (Linux CLI fix → v0.3.1), and UAT was performed on v0.3.1 on 2026-11-02.

---

## Phase Summary

| Phase | Status | Key Outputs |
|-------|--------|-------------|
| 1/6 PREP | ✅ | isolated worktree, auto-estimate: complex |
| 2/6 DESIGN | ✅ | R1 requirements Round 5 (100% consensus), R2 design Round 3 (100% consensus), 15 slices frozen |
| 3/6 BUILD | ✅ | 15/15 slices via ralph-loop TDD, 666 tests, coverage ≥80%, xp-gate 12/12 per slice |
| 4/6 VERIFY | ✅ | code-walkthrough 5 rounds → 3/3 APPROVED; alignment 96 (15/15 REQ, 25/25 AC); xp-gate 10/10 |
| 5/6 SHIP | ✅ | PR #13 → main → v0.3.0; PR #14 (0.3.1 CLI fix) → v0.3.1 release |
| 6/6 CLOSE | ✅ | human UAT passed (0 emergent issues), state backed up, worktree removed, metrics recorded |

---

## Deliverables

- **Four v2a checkers**: canary-return-scan (T1a, block), tool-call-shape (T2a, block),
  thinking-signature-presence (T3a, warn), usage-reconcile (T4a, warn).
- **Canary engine**: managed-route injection, single-writer registry (TTL 24 h / LRU 64),
  `canary rotate` online/offline channel, metrics counters.
- **Streaming correctness and budgets**: per-checker windows, 256 KiB hard bound, G1/G3 budgets.
- **Evil-relay testkit + dual CI matrices** (`test.yml`, `relay-nightly.yml`).
- **Releases**: v0.3.0 (v2a core), v0.3.1 (POSIX bin symlink fix).

---

## Verification

| Evidence | Result |
|---|---|
| Tests | 642 passed / 51 conditional skipped, 59 files |
| Coverage | statements 91.11 · branches 88.13 · functions 91.74 · lines 92.94 |
| Alignment | PASS, score 96 (15/15 REQ, 25/25 AC) |
| Gate MW (v2a body) | 5 rounds → 3/3 APPROVED |
| Gate MW (0.3.1) | 3/3 APPROVED at 60c3733 (deepseek-v4.1-flash / qwen3.8-flash / glm-5.3-flashx) |
| release gate | 10/10 locally and on Linux CI (v0.3.1 tag) |
| CI | PR #14 Tests + bench green; main Tests green, bench green after one rerun |

---

## Release-surface residuals

1. **npm publish pending**: no `NPM_TOKEN` secret in the repository, so the tag workflow
   fail-closes at publish. Release gate and version consistency pass; GitHub Release v0.3.1
   was created manually. Add the secret and re-run the tag workflow (or publish manually).
2. **v0.3.0 tag run failed** on the Linux bin symlink smoke — that is the defect fixed by 0.3.1.
   The v0.3.0 release page remains; v0.3.1 is the recommended version.
3. **G-CANARY replay criteria** remain an accepted residual (original recordings overwritten),
   recorded in `docs/KNOWN-ISSUES.md`.

---

## Metrics

| Metric | Value |
|---|---|
| Sprint commits (merge-base d5b9be8 → d4e1632) | 83 |
| Slices | 15/15 |
| Reopen/emergent issues | 0 |
| Worktree | `.worktrees/v2a-build` removed (clean); branch `sprint/v2a-build` kept |
| Backup | `.sprint-history/sprint-20260927-46/` |
| UAT | 2026-11-02, passed |

---

**Closed by**: sprint-flow Phase 6 CLOSE
**UAT**: performed by the user on v0.3.1 — passed, no emergent issues.
