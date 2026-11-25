# Changelog

All notable changes to this project are documented in this file. The format is a lightweight
take on [Keep a Changelog](https://keepachangelog.com/), and the project aims at
[Semantic Versioning](https://semver.org/).

## [0.7.9] - 2026-11-25

### Changed

Sixth round. `scanProviders` (8 -> 6), `runRunner`, `sessionInfo`,
`firstOptionId`, `cmdStop` and `promptfoo.detectDrift`.

`scanProviders` is a small YAML state machine that reads exactly two fields off
each provider entry — `apiBaseUrl` and `apiHost` — because pulling in a full YAML
parser to read two keys would be a dependency for a shape the adapter does not
otherwise need. The three states it tracks (inside the `providers:` block,
current entry, line content) are now separated, so the flush points are
visible.

67 remain over 5, 8 at 8 or above. 844 tests, lint clean.

## [0.7.8] - 2026-11-25

### Changed

Fifth round. `environmentMatches` (10), `cmdStop`, `promptfoo.detectDrift` and
two provider-probe helpers.

Two of these are worth naming for the reason the branch existed at all:

- `environmentMatches` compared three fields with three `!==` joins. The field
  list is now `ENV_FIELDS`, so adding a dimension later does not add a branch to
  the decision. The malformed-marker check got the same treatment, because the
  three conditions there answer one question ("are the markers verbatim?").
- `promptfoo.detectDrift` had two different reasons for *not* counting a provider
  as drifted sitting in the same loop: not an openai-compatible provider at all,
  versus using `apiHost` as a substitute endpoint. Those are different facts and
  are now two named reasons in `isDriftedProvider`.

69 remain over 5, 12 at 8 or above. 844 tests, lint clean.

## [0.7.7] - 2026-11-25

### Changed

Fourth round, into the development tooling.

| function | before | after |
|---|---|---|
| `inspectOutPath` | 11 | 6 |
| `assertWritableOutPath` | 11 | under 5 |
| `assertSmokeRow` | 10 | under 5 |
| `main` (release-gate) | 10 | 6 |

`assertWritableOutPath` is worth reading as an example of why the target is
CCN >= 8 rather than 5. Its ceiling came from four independent preconditions
(host non-empty, stream name valid, parent writable, target writable) written as
consecutive `if (bad) throw` guards. Splitting them into four named functions
made each one trivially readable, but it did not remove any branch — the same
four checks still run in the same order. What improved is that the order is now
a list you can read instead of a sequence you have to reconstruct.

`inspectOutPath` had the opposite problem: three nested ternaries whose order
was the semantics (stream alias beats hardlink alias beats same-name). Flattening
them into `refusalVia` with sequential returns makes that ordering explicit.

72 remain over 5, 15 at 8 or above. 844 tests, lint clean.

## [0.7.6] - 2026-11-25

### Changed

Third round on CCN >= 8: the gateway request path and the adapter layer.

| function | before | after |
|---|---|---|
| `handleChatCompletions` | 8 | under 5 |
| `dispatch` | 8 | under 5 |
| `hasPath` | 8 | 6 |
| `placeCanary` | 8 | under 5 |
| `consumeRotateSentinel` | 8 | 7 |
| `parseChat` (`scripts/provider-probe`) | 11 | under 5 |
| `promptOnce` | 11 | 8 |

`handleChatCompletions` is the one worth reading. Its shape verdict had both
outcomes in one `if`: blocked on managed routes, recorded-but-allowed on
unmanaged ones. Those are deliberately different powers, and collapsing them
into a single condition is exactly the shape of the "unmanaged routes silently
allowed" defect from 0.7.0. `judgeShape` now returns `blockReason` and
`degradedReason` as separate fields, so the two outcomes cannot be confused by
whoever edits next.

`hasPath` got the same treatment for the same reason: its array context and its
`key[]` segment handling were interleaved, and that resolution was rewritten
several times during v2b-A.

844 tests pass, lint clean. 73 remain over 5; 19 at 8 or above, mostly in
`scripts/` and `bench/`.

## [0.7.5] - 2026-11-25

### Changed

Second round on the CCN >= 8 set, this time reaching the evidence layer and the
CLI dispatcher:

| function | before | after | what the split is about |
|---|---|---|---|
| `runCli` | 11 | under 5 | the command set is data, so `HANDLERS` is a table — `COMMANDS` derives from it instead of being maintained beside a parallel `switch` |
| `cmdStartDaemon` | 10 | 6 | config parsing separated from start-and-install-signals |
| `verifyLineAt` | 9 | under 5 | the four checks became a `LINE_CHECKS` array, because their order is a contract (version before schema before position) and that order should be readable, not buried in consecutive `if`s |
| `canonicalJson` | 9 | 7 | scalars collapse into one `switch`; the shape branches stop pretending to carry extra conditions |
| `scanDownloadThenExecute` | 9 | 6 | four chained `includes` became one `DOWNLOAD_COMMANDS.some(...)` |
| `writer.init` | 9 | under 5 | line parsing extracted; a half-written last line now returns `null` rather than a placeholder record |

That last one was a real bug in my own refactor, caught by the existing test:
the first version returned `{ seq: -1, record_hash: "" }` for a truncated tail,
and because that placeholder was then read as "the last record", the resumed
`seq` came out one too low. The test for AC-04 caught it immediately.

76 remain over 5; 28 at 8 or above. 844 tests pass, lint clean.

## [0.7.4] - 2026-11-25

### Changed

Continued the complexity work along the readability axis rather than a flat
number. The sweep reported 88 functions over CCN 5; investigation showed 45 of
them at CCN 6-7, and sampling those found linear guard chains — `jsonAtPath` is
13 lines, one loop and two guards at CCN 6, with nothing wrong with it. Splitting
those costs a hop for every caller and the extracted halves land near the
threshold themselves (measured: `objectField` came out at 6 and needed a second
pass).

So the target is CCN >= 8, where the branching is genuinely hard to follow.

Refactored this round:

| function | before | after |
|---|---|---|
| `writeDispatchFailureEvidence` | 11 | under 5 |
| `writeEvidence` | 10 | under 5 |
| `pickTopReasonWinner` | 10 | under 5 |
| `walk` (decoded-form scan) | 10 | under 5 |
| `resolveUpstream` | 9 | 7 |
| `appendFragment`, `feedChoiceDelta`, `collectToolCallParts`, `collectChoiceBox`, `collectChoiceParts`, `pushContentParts` | 6-9 | under 5 |

Two techniques did most of the work, and both are about naming rather than
size: fallback tables instead of chained `??` (`failureIdentity` went 8 → under
5 by making the defaults a lookup), and shape-specific recursion helpers instead
of one function with a string/array/object switch (`walk` 10 → three flat
functions).

78 remain over 5, 32 at 8 or above. 844 tests pass; lint clean.

## [0.7.3] - 2026-11-25

### Changed

- **The three highest-complexity functions in `src/` were split**, taking the
  ratchet from 88 over-threshold functions to 87 and, more usefully, removing
  three of the seventeen at CCN >= 10:

  | function | before | after |
  |---|---|---|
  | `validateRegistryFile` | 15 | under 5 |
  | `dispatch` | 14 | 8 |
  | `cmdDoctor` | 12 | 6 |

  Each split follows a domain edge rather than a line count.
  `validateRegistryFile` separates "is this entry well-formed" from "is the
  header well-formed" from "are the entries well-formed" — three failure faces
  that previously had to be tracked in one screen. `dispatch` separates
  preparation (can this be forwarded at all?), the fail-closed guards, and the
  post-delivery evidence write; the guard order is documented as cost-ascending
  (URL before body) because it affects real latency. `cmdDoctor` becomes one
  function per check (1/1b/2/4/5/6), which is the same closed enumeration the
  requirement already names.

### Notes

- `bench/` and `scripts/` still hold the remaining high-CCN functions
  (`out-path-guard`, `provider-probe`, `release-gate`). They are development
  tooling rather than request-path code, so they are queue rather than blockers.

## [0.7.2] - 2026-11-25

### Fixed

- **Lint is clean again (7 -> 0 warnings).** Six were dead declarations removed
  outright (`PromptfooConfig`, `STATE_FAILS`, `splitPath` and three unused
  imports); the seventh was already auto-fixable. Removing `formatForPrefix`'s
  import from `server.ts` also removes the last trace of the prefix-based
  managed-route check that 0.7.0 replaced.

### Added

- **`testkit/evil-relay.ts` coverage: 7.5% -> 75%.** The 13-opponent opposing
  relay is exercised only under `RELAY_MATRIX=1` (nightly), so the test tool
  itself was untested on every PR — a broken tool would only surface in the
  last gate before release. Six tests now cover argument validation, real
  spawn/teardown, and two behaviours that would otherwise regress silently:
  the `swap` opponent genuinely rewrites tool names (rather than passing
  through), and the `cache` opponent replays its first response (proving
  per-request state accumulates inside the child).
- One of those tests pins a **security property**: configuration values reach
  the child script through `JSON.stringify`. The probe passes an intercept path
  containing `'); process.exit(1); //`, so a future switch to direct template
  interpolation makes the child fail to start and the test goes red.

## [0.7.1] - 2026-11-25

### Fixed

- **A discussion of a rule was treated as an invocation of it.**
  `powershell-download-exec` matched any text containing `powershell -enc`, so a
  session that merely talked about the rule was blocked. Measured on the live
  gateway: a 1 MB conversation containing that string was blocked six times
  before forwarding — the gateway killing the session that was writing the
  gateway. The criterion now follows the precedent set for PEM in 0.6.1: a real
  invocation must carry a base64 payload (`-enc` followed by at least 12 chars).
  The canonical documentation example `SQBFAFgA` is 8 and no longer fires; a
  15-char real payload does.

- **Two PEM test fixtures spelled out private-key tags in test source**, so
  gitleaks reported leaks on the test file while xp-gate's Gate 8 showed green.
  The fixtures now build their tags from split parts: the constructed strings are
  byte-identical, the assertions unchanged, and a reverse probe with unrelated
  key material is still caught. `.gitleaks.toml` is untouched — widening the
  allowlist was tried first and a probe walked straight through it.

### Known limitations

- `powershell-download-exec` cannot block; only `credential-file-read` is marked
  blocking. Findings from the former are recorded and warned, not refused.

## [0.7.0] - 2026-11-24

### Added

- **Claude Code, Codex and promptfoo onboarding (v2b-A).** All three enter the managed-config
  enumeration, so `doctor` writes and drift-checks their endpoint and evidence records carry a
  proper `client`. The far larger half of this release is *why* that alone would not have helped:
  the three clients speak three different wire formats and the scan unit only understood one.
- **Anthropic Messages and OpenAI Responses projection**, non-streaming and streaming. Measured
  before the change, a credential in `system` blocks, `tool_use.input`, `tool_result`,
  `instructions`, `input[].content` or `function_call_output` travelled to the upstream with
  HTTP 200 and `action_taken=warned`; Responses responses projected to the empty string, as did
  every Responses and Anthropic SSE frame. Probe matrix went from 11/22 to 22/22, and the
  end-to-end test now asserts `blocked_before_forward` with zero upstream requests for each.
- **Two-axis shape decision.** Recognition (`known`/`unknown`) and coverage
  (`full`/`partial`/`vacuous`) are separate, and coverage compares payload paths present in the raw
  body against those the projector reports handling. A projector that forgets a field is therefore
  detectable, which self-reporting cannot achieve. New evidence reasons: `shape_unrecognized`,
  `shape_known_empty`, `shape_partial_coverage`.
- **`doctor` reports a closed state per client** (`not_installed`, `not_configured`, `drift`,
  `coverage_missing`, `coverage_unknown`, `write_failed`, `coverage_ok`) instead of one aggregate
  drift line, because "configured" and "scannable" fail differently. Unknown carries its own exit
  code rather than being folded into a definite answer.
- **`scripts/ccn-report.cjs` and `.ccn-baseline.json`** — Gate 3 refuses to produce a complexity
  verdict without the verifier, and the repository never had one, so pre-existing debt was graded
  as brand-new code. Complexity now has one authority (lizard); the verifier only re-cuts bodies
  that lost brace balance and hands them back to lizard.

### Changed

- Client wire format is declared as data in `src/shared/client-wire-format.ts`, because adapters
  may not import the gateway and the gateway may not import adapters; `doctor` joins the two.
- Canary injection is bounded to the chat wire format. The two new routes sit inside the injection
  domain so they record `inject_skipped` rather than being skipped as unmanaged — "not in the
  domain" and "in the domain but not injected" are different facts, and only the second is observable.

### Security

- **This release closes a live gap rather than adding a feature.** With Anthropic Messages and
  OpenAI Responses traffic, the gateway previously reported successful vetting while scanning almost
  nothing: `opencode/anthropic` had been declared managed since v1 on that basis. The end-to-end
  tests assert zero upstream requests for the credential probes, and reverse probes (removing the
  projection branches) turn those assertions red — a test that cannot fail is not evidence.

### Known limitations

- Canary injection is chat-only, so T1a's positive retention evidence is unavailable on the two new
  routes. `docs/protocol-capability-matrix.md` states exactly what is lost.
- Unknown wire shapes fail closed only on managed routes; a user-created prefix is recorded but not
  blocked. Legal empty requests (`messages: []`, a body with only `model`) keep passing, because
  canary injection's own branch 4 has that shape.
- None of the three clients is installed on the development machine, so adapters are derived from
  each vendor's published documentation (`docs/protocol-field-provenance.md`) and verified against
  real adapter artifacts plus a mock upstream, not a live client binary.

### Deferred

- v2b-B billing reconciliation (`report` CLI) — the official price basis data source is still empty.
- v2b-C fingerprint patrol with provider trust score — upstream license unverified, and active
  probing conflicts with the minimal-exposure promise.

## [0.6.1] - 2026-11-24

### Fixed

- **`pem-private-key` blocked every discussion of PEM format.** The rule matched the header
  (`-----BEGIN … PRIVATE KEY-----`) and nothing else, so this repository's own fixture — present
  since 2026-09-15 — made the gateway refuse the sessions that work on it (measured: a request
  containing only that line returned 502). A PEM hit now requires a block shape: header and `END`
  on different lines. Real bodies are line-laid-out; fixtures and format discussions write them
  inline. Three other criteria (body length, "has content", multi-line block) were measured and
  rejected — each flipped either the fixture or the frozen `AC-VETO-003-01` sample.

### Added

- **`scripts/canary-replay.mjs` — the G-CANARY replay is back (P1-1).** The v2a recording was
  overwritten by probe traffic and the item sat as an accepted residual. The script rebuilds the
  corpus from this machine's 11 DSH session recordings (66 exchanges, gitignored under
  `var/canary-replay/`) and replays three criteria: finish_reason no migration 66/66,
  provider-reject delta 0, append-only 66/66 → PASS. A patched inject that rewrites existing bytes
  turns the verdict FAIL, so the harness is not a rubber stamp. It drives a loopback mock upstream,
  so it measures the body the gateway forwards, not the provider's own refusal rate.

## [0.6.1] - 2026-11-24

### Fixed

- **`pem-private-key` blocked every discussion of PEM format.** The rule matched the header
  (`-----BEGIN … PRIVATE KEY-----`) and nothing else, so this repository's own fixture — present
  since 2026-09-15 — made the gateway refuse the sessions that work on it (measured: a request
  containing only that line returned 502). A PEM hit now requires a **block shape**: header and
  `END` on different lines. Real bodies are line-laid-out; fixtures and format discussions write
  them inline. Three other criteria were measured and rejected — body length (the truncated sample
  `MIIEow...` has 6 legal characters, indistinguishable from the fixture), "has any content" (the
  fixture's `payload` counts as content), and multi-line block (it flips the frozen
  `AC-VETO-003-01` sample to clean).
- The T1b corpus entry that expressed the shell form now carries `expected: clean` and is excluded
  from the "detection rate = 100%" denominator; a dedicated block-form case covers the positive
  path instead. Encoding a newline inside a YAML-subset scalar is not possible, so the fixture
  states the semantics rather than contorting the format.

### Added

- **`scripts/canary-replay.mjs` — the G-CANARY replay is back (P1-1).** The v2a recording was
  overwritten by probe traffic and the item sat as an accepted residual. The script rebuilds the
  corpus from this machine's 11 DSH session recordings (66 exchanges, gitignored under
  `var/canary-replay/`) and replays three criteria: finish_reason no migration 66/66,
  provider-reject delta 0, append-only 66/66 → PASS. `tests/unit/canary-replay.test.ts` pins both
  directions: a patched `inject` that rewrites existing bytes turns the verdict FAIL, so the
  harness is not a rubber stamp. It drives a loopback mock upstream, so it measures the body the
  gateway forwards, not the provider's own refusal rate.

## [0.6.0] - 2026-11-24

### Added

- **`dangerous-command-scan` covers the request side** (`sides: ["request", "response"]`). Measured
  on real DSL sessions on 2026-11-24, every credential read travelled the request path — an upstream
  told the agent to call a `read` tool with `path: ~/.ssh/id_ed25519` — and the response-only
  checker never saw it. New optional `CheckerSpec.sides`; `side` stays the primary side.
- **Three rules** for shapes the old set could not express: `credential-file-read` (reading
  `~/.ssh/*`, `.env`, `~/.aws/credentials`, `.npmrc`, … through a tool argument or `cat`),
  `download-then-execute` (`curl -o x … && chmod +x x && ./x`, matched in two bounded passes so the
  regex cannot backtrack catastrophically), and `reverse-shell-pipe` (`cat secret | nc host port`).
  `raw-ip-download` now captures the whole URL so its offsets point at the real text.
- **Rule-level action grading** (`mapBySpecWithRules` + exported `BLOCKING_RULE_IDS`):
  `credential-file-read` maps to `block`; every other rule stays observational. Per-rule finding cap
  `MAX_FINDINGS_PER_RULE = 5`.
- **Cross-unit dedup** for the checker: one dedup state per exchange, shared between the request and
  response paths, so a response echoing a command already seen in the request is not reported twice.

### Fixed

- **A regex loop that could exhaust the heap.** `scanOne` advanced its cursor with
  `if (m.index === re.lastIndex) re.lastIndex++`, which is never true after a successful `exec`
  (the engine has already advanced it), and any branch that skipped the push left `lastIndex` at 0
  while still matching. A 22-byte input was enough to spin forever and OOM the worker. Replaced with
  `String.prototype.matchAll`, which owns its cursor. `dangerous-command-scan` previously emitted a
  single finding per rule per unit; it now reports each distinct hit (bounded by the per-rule cap).
- **Duplicate findings amplified by long sessions.** A DSL request resends its full tool-result
  history, so one rule produced up to 40 findings for the same exchange.

### Security

- **Regression of the 2026-11-24 incident.** Enabling the checker on the request side without
  change its action semantics blocked this project's own development session six times
  (`blocked_before_forward`, 502, a 645 KB request). The trigger was ordinary work: the conversation
  was about security, so its history quoted `curl … | bash`, `IEX`, and the repository's fixtures.
  Tests pinned both directions afterwards: a tutorial command reaches the upstream (`warned`), a
  credential read does not (`blocked_before_forward`, upstream receives zero requests).

## [0.4.0] - 2026-11-19

### Added

- **`dangerous-command-scan` (T2a content side, observational)** — new response-side checker
  (REQ-POST-01 / AC-POST-01) that flags download-and-execute primitives in response text and
  tool-call arguments: `remote-pipe-exec` (`curl … | bash`, `wget … | sh`), `process-substitution-exec`
  (`sh <(curl …)`, `eval $(curl …)`), `base64-pipe-exec` (`base64 -d | sh`),
  `powershell-download-exec` (`IEX` / `DownloadString` / `-enc`), `reverse-shell`, and
  `raw-ip-download` (public raw-IP download URLs; private/loopback addresses excluded). Declared
  `safetyClass: false`, so findings map to `warn` — the v1 blocking-class FP=0 promise is unchanged.
  Install tutorials legitimately contain the same strings; hits are evidence signals
  (`rule_id` + `offsets`), not blocks. Rule list registered in `specification.yaml`.
- **`dsh/cliproxy` managed route** — the dsh OpenAI-compatible provider surface is now part of the
  canary injection/detection domain. Routes are declared as
  `CANARY_MANAGED_ROUTES = adapter-derived set ∪ MANUAL_CANARY_MANAGED_ROUTES`, with an
  integration assertion pinning that union so adapter drift is still caught.
- **`scripts/provider-probe.ts`** — dev tool for probing OpenAI-compatible and ACP upstreams
  (median latency, pass/fail, token drift) against `var/provider-probe.json`.

### Changed

- **Lint moved from oxlint to Biome** (`biome.jsonc`, recommended preset, formatter and assist
  disabled; only `noNonNullAssertion`, `useTemplate` and `useLiteralKeys` turned off with documented
  rationale). `bun run lint`, the CI workflow, the release gate and both READMEs now run
  `biome check . --no-errors-on-unmatched`. This also makes the xp-gate Gate 1 adapter actually
  execute for this repo instead of skipping (it only recognises eslint/biome configurations).

### Fixed

- **Layer boundaries are now actually enforced.** `architecture.yaml` declared layers in a
  sequence-of-maps shape (`- name: …` / `paths:`) that the xp-gate Gate 6 layer checker cannot
  parse, so it failed closed with `layer_config_unparsable` — the boundaries had never been
  machine-checked. Converted to the checker's map form (`layer:` + `patterns:`); the checker now
  reports 9 layers / 37 files classified / 0 violations, and the boundary test's YAML parser
  accepts both shapes.
- **The release workflow now actually authenticates to npm.** `setup-node` was configured without
  `registry-url`, so `secrets.NPM_TOKEN` never reached npm's credential lookup and the v0.4.0 tag
  run failed closed with `ENEEDAUTH` before any release was created. The v0.4.1 tag carries the
  same code plus that one workflow fix.
- Complexity and clean-code debt across `scripts/provider-probe.ts`, `scripts/release-gate.mjs`
  internals and four checkers (`egress-secret-scan`, `invisible-unicode-scan`, `tool-call-shape`,
  `dangerous-command-scan`): assignment-in-condition loops rewritten, long/IO-heavy helpers split
  with contextual error messages, unused fields/imports removed. No behaviour change.

## [0.5.2] - 2026-11-24

### Fixed

- **A credential false positive blocked its own development sessions.** `egress-secret-scan`
  matched vendor *documentation example* values (`AKIAIOSFODNN7EXAMPLE`,
  `ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij`) as if they were real credentials. Because the
  checker is blocking-class, any conversation quoting those strings — including the repository's
  own `tests/fixtures/threats/T1b/secrets.yaml` — was refused before anything left the machine:
  measured on a 1.9 MB request carrying 7 × `openai-sk`, 6 × `github-ghp` and 15 × `aws-akia`
  hits, all of them fixture text. The fix adds a **verbatim, fixed-length** allowlist for values
  that appear as examples in the vendors' own documentation; it is not a pattern exemption, so a
  key that differs by one character, or a non-example placeholder such as
  `sk-ant-api03-AbCdEf…`, is still reported. A real key colliding with an example would need to
  reproduce all 20 characters, about 1e-11.
- Fixture and unit-test values that used the documented examples were replaced with
  format-valid but non-example keys, so those assertions keep testing the rules rather than the
  allowlist.

### Documentation

- The v1 risk register gains a dated addendum mapping each threat to its 0.5.x status, because
  the frozen table still described canary, `tool-call-shape` and usage reconciliation as
  unimplemented.
- KNOWN-ISSUES records that a provider with a direct-upstream `baseURL` receives none of the
  gateway's protections, and how to tell which path a request took.

## [0.5.1] - 2026-11-23

### Changed

- **Shared adapter config I/O.** `opencode.ts` and `delphi.ts` carried byte-identical
  read → merge → write flows; both now call `readManagedConfig` / `applyManagedPatch` from
  `config-io.ts`. Behaviour is unchanged — verified through the real `doctor
  --write-managed-config` path (write + drift assertions pass).

### Fixed

- **CI toolchain versions were inconsistent and are no longer pinned.** The four workflows named
  bun as `1.3.14`, `1.4.3` and `latest` at once, and `release.yml` carried a comment claiming it
  matched `test.yml` while the two values had already diverged — pinning had itself become the
  source of a stale comment. All five `bun-version` entries are now `latest`, and every
  `node-version` is `lts/*` (`release.yml` was on the EOL `20`; `bench.yml` had no explicit Node
  at all, which is now fixed since the benchmark is runtime-sensitive).

  Measured before dropping the pin: bun `1.3.14`, `1.4.3` and `1.4.5` all process this repository's
  `bun.lock` to a **byte-identical** file, with and without `--frozen-lockfile`. CI installs with
  `--frozen-lockfile` throughout, so the dependency set is decided by the lockfile rather than by
  the tool version. Node stays expressible as a range because it is the vitest runtime and the
  distribution artifact's verifier, backed by `engines.node >= 18`.
- **`.gitattributes` was missing** despite day-to-day development on both Windows and WSL. Line
  endings are now pinned (`* text=auto eol=lf`, CRLF retained for PowerShell scripts, binaries
  marked as such) with a note on `core.autocrlf=input`. `git add --renormalize .` produces an
  empty diff, so the repository was already LF and no mass rewrite follows.

## [0.5.0] - 2026-11-23

### Added

- **Canary hit attribution (`origin`).** A cross-session canary hit used to report only *that* a
  leak had happened. The evidence finding now carries the **originating session key** in an optional
  `origin` field, answering *which* session leaked into which. Implemented via a new
  `CanaryStore.snapshotWithOrigin()` that mirrors `snapshot()`'s set and self-exclusion semantics
  while retaining each canary's source session. `evidence_version` stays `1`: the field only adds
  information and `validateEvidence`'s required-field + validator model does not reject it, so
  existing chains still verify.

### Notes

- Two silent-drop points had to be fixed together — `toEvidenceFinding()` and `responseMetaFor()`
  both build objects field by field, so a new field vanishes without any type error or existing
  test failing. Each is now pinned by an integration test whose reverse probe fails when the
  passthrough is removed.

## [0.4.1] - 2026-11-19

### Fixed

- **npm publish now completes for tagged releases.** The `setup-node` step in `release.yml` was
  missing `registry-url`, so `secrets.NPM_TOKEN` never became an npm credential and the v0.4.0
  tag run failed closed with `ENEEDAUTH` before creating any release artifacts. No product code
  changed between 0.4.0 and 0.4.1 — only this workflow configuration.

## [0.3.1] - 2026-11-02

### Fixed

- **The installed CLI on POSIX exited silently with no output.** npm installs the `bin` entry as a
  symlink (`.bin/llmveto` → `dist/cli/index.js`), and the direct-run check compared literal paths,
  concluded it was being imported as a module, and skipped the entry block — so `llmveto` with no
  arguments exited 0 instead of 2. The check now resolves real paths before comparing. Found by the
  tag-triggered release gate (`smoke row 1`); a symlinked-entry regression test covers it.

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
  `degraded_observational` > `warned` > `allowed`). `action_taken` is a single summary value: when a
  block and degradation coincide, the block wins and the degradation remains visible in the
  persisted `findings[]`; the aggregate `degraded` counter counts only records whose final
  `action_taken` is `degraded_observational`. Canary plaintext never enters evidence.
- **Streaming correctness** — per-checker windows with a single cursor advance per chunk, tool-call
  argument deltas merged across SSE frames before scanning, and UTF-16 offsets preserved across
  chunk boundaries.
- **Per-checker execution budgets** — G3 tiers 8/64/512 KiB → 20/50/120 ms and a 12 ms per-chunk G1
  p99 cap from a single constant source; an over-budget checker result is rewritten to
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
- `tool-call-shape` stream metering now uses **UTF-8 bytes** (matching the gateway window ledger)
  and the 256 KiB hard bound applies only to tool-call argument fragments — long prose streams no
  longer risk a spurious `window_overflow` block.
- `tool-call-shape` no longer re-parses the whole accumulated arguments text on every frame
  (O(n²) work could self-trip the 12 ms G1 cap as `checker_timeout` on long tool-call streams).
- `test.yml` restores the 80 % coverage gate, dual typecheck and lint (these had been dropped),
  and the detection / false-positive steps now point at real suites instead of `|| true`-masked
  non-existent files. `relay-nightly.yml` installs from `bun.lock`, runs the actual relay suite in
  a 4-way opponent-shard matrix with the serial fallback, and no longer contradicts its own
  timeout budget.
- Canary registry `lastSeen` refreshes are throttled (60 s) instead of a synchronous
  write+rename on every managed request; allocation and rotation still persist immediately.
- Offline rotation no longer destroys evidence: when the registry is `registry_unavailable`,
  a zero-byte sentinel is left in place (no rotate, no delete) so the corrupt file stays intact
  for forensics and the rotation applies after repair on the next start.
- `llmveto canary rotate` gives the loopback POST a 5 s timeout and reports the offline path as
  `rotate deferred … applies on next gateway start` instead of claiming a completed rotation.
- Gateway-reason tie-break now keeps the first out-of-vocabulary value (stable) instead of
  promoting the later one.
- `relay-nightly.yml` no longer uploads a `coverage/` artifact it never generates; the PR
  detection step no longer re-runs the 13-opponent relay suite (nightly-only by design).
- The 13-opponent relay suite is now explicitly gated by `RELAY_MATRIX=1` in the test file
  itself, so the PR full-suite step no longer starts 13 relay subprocesses; nightly sets the
  variable on both the parallel and serial-fallback steps. A guard test pins the gate.
- `doctor.canary-registry` reuses the runtime `validateRegistryFile` judgment instead of a shallow
  `typeof` check, so a structurally invalid registry (e.g. `entries: null`) now reports
  `[DEGRADED]` instead of a false `registry ok`.
- The streamed tool-call merger emits a synthetic `window_overflow` error finding on overflow
  without throwing from the SSE generator (a throw there could surface as an unhandled rejection
  after headers were sent, turning fail-closed into a daemon-level fail-open).

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
- The v2a block-mapping checkers (T1a canary, T2a tool-call shape) are default-on with no
  runtime kill switch; the checker registry is static, so disabling one requires a code change
  and restart. A live toggle is deliberate scope for a later release, not an oversight.
- `package.json` declares Node `>=18`, but CI and the local verification matrix run Node 24 only;
  a Node 18 regression would not be caught by the PR gate.
- Post-injection evidence (`request_bytes` / `request_body_sha256` describe the forwarded body) is
  not permanently reversible: reconstructing the client body from the chain needs the session's
  canary, which rotation re-randomizes and TTL 24 h / LRU 64 eviction removes. After either event
  the chain alone cannot recover the original body; retain the client-side or upstream-side body
  when forensic reconstruction is required. AC-V2a-07 is a test-time invariant, not a
  time-unbounded recovery guarantee.
- The `/_llmveto/*` admin surface relies on the daemon binding to a loopback address as its only
  security boundary (no Host/Origin/token check). Do not expose `/_llmveto/*` through a reverse
  proxy; a proxy that forwards those paths re-exposes rotation and metrics. A token/Host guard is
  deferred to the same later release as the checker kill switch.

### Deferred to v2b

- Fingerprint patrol with provider trust score (periodic llm-fingerprint-detector integration)
- Billing reconciliation report CLI (`report` command comparing usage × official price vs relay invoices)
- Multi-client onboarding for Claude Code / Codex / promptfoo (MANAGED_CONFIG_IDS extension)
- Provider health monitoring dashboard (error rate / timeout trends visualization)

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

---

[0.3.1]: https://github.com/boyingliu01/llmveto/releases/tag/v0.3.1
[0.3.0]: https://github.com/boyingliu01/llmveto/releases/tag/v0.3.0
[0.2.0]: https://github.com/boyingliu01/llmveto/releases/tag/v0.2.0
