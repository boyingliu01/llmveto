# Contributing

Thanks for considering a contribution. This is a single-maintainer security tool, so the
process is deliberately lightweight and conservative.

## Issues first

Open an issue before building anything non-trivial. Include what you expected, what happened,
and (for behavior of the gateway itself) the version or commit SHA.

## Pull requests

PRs are accepted, but every PR must pass, at minimum:

1. the full test suite with the **80% coverage gate** (CI-enforced by the `test` workflow);
2. the local pre-commit quality gates (version consistency, tests, lint, typecheck, gitleaks, …);
3. a maintainer-side code walkthrough with review evidence bound to the pushed HEAD before merge.

Security-relevant changes (scan surface, verdict/action mapping, fail-closed behavior, evidence
chain) additionally require a reproduction test that fails before the fix and passes after.

## Development environment

- **Bun ≥ 1.1** (package management + test/build driver)
- **Node ≥ 18** (test runtime + running the distribution artifact)

## Common commands

| Command | Purpose |
| --- | --- |
| `bun install` | Install dependencies |
| `bun run test` | Full test suite (vitest on Node) |
| `bun run test:coverage` | Tests + coverage gate (threshold 80%) |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint` | oxlint |
| `bun run build` | Produce the pure-ESM `dist/` distribution artifact |

Commit messages follow conventional-commit style with a scope, e.g. `feat(gateway): …`,
`fix(evidence): …`, `docs(release): …`.

## Design and terminology

- The authoritative requirement/design/test documents live in [docs/issues/](docs/issues/)
  (in Chinese; frozen artifacts — propose changes as issues rather than drive-by edits).
- The ubiquitous language is frozen in [CONTEXT.md](CONTEXT.md); the English README and all
  public-facing documents must use the fixed translations from its Glossary section
  (e.g. *vetting* for 过闸, *stream termination* for 终止流, *evidence* stays as-is).

## README bilingual rule

`README.md` (English) and `README.zh-CN.md` (Chinese) are full mirrors. Changes to either must
change both in the same PR and must pass `node scripts/check-readme-parity.mjs`.
