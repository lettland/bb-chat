# Contributing to bbchat

Thanks for helping out. This is a small, focused codebase — a TUI client for the
BB coding-agent server — and the bar for a change is that it keeps the whole
`bun run check` gate green and doesn't grow the surface area without reason.

## Setup

```sh
git clone git@github.com:lettland/bb-chat.git
cd bb-chat
bun install
```

Requirements: [Bun](https://bun.sh) ≥ 1.3. Bun is the **only** supported
toolchain — it runs the TypeScript directly, resolves `@opentui/core`'s native
deps, and compiles the standalone binary. Do not add an npm/pnpm/yarn lockfile;
they are gitignored on purpose, because a second lockfile resolves a different
dependency tree than the `bun install --frozen-lockfile` that CI runs.

You also need a reachable BB server to exercise anything beyond the pure
rendering units. `bbchat init` detects a system-local install and writes
`~/.config/bbchat/config.json`; `bbchat doctor` tells you whether it is
reachable.

## The gate

One command reproduces CI locally:

```sh
bun run check      # typecheck + lint + test
```

Individually:

```sh
bun run typecheck  # tsc --noEmit (TypeScript 7, strict)
bun run lint       # biome check
bun run lint:fix   # biome check --write  (import order + formatting)
bun test
bun run dev        # run the TUI from source
```

CI additionally compiles the real binary and runs `./dist/bbchat selfcheck` on
it. That step is not ceremony: the transcript's markdown and code highlighting
depends on tree-sitter grammars that only `bun build --compile` embeds, so a
broken embed is invisible to `bun test` and would otherwise ship. If you touch
anything under `src/tui/` that renders markdown, diffs, or code fences, run it
yourself:

```sh
bun run build:binary && ./dist/bbchat selfcheck
```

## Conventions

- **TypeScript**: strict mode with `noUncheckedIndexedAccess`. Prefer explicit
  types at module boundaries; let inference do the rest.
- **Formatting and imports** are not a matter of taste — Biome decides. Run
  `bun run lint:fix` rather than hand-aligning anything.
- **Errors**: throw `BbchatError` (`src/errors.ts`) for anything the user caused
  or can fix; its message is printed verbatim with no stack, and it takes an
  optional second-line hint. Anything else that escapes is treated as an
  internal fault and shows its stack.
- **Commands are argv arrays, never shell strings.** Config holds
  `["bb-app", "start"]`, not `"bb-app start"`, and is spawned without a shell.
  Keep it that way.
- **Naming.** The binary, the npm package, the config directory
  (`~/.config/bbchat/`), and the `BBCHAT_*` environment prefix all share one
  name. `test/naming.test.ts` enforces that; if you ever rename the tool, that
  test is the checklist.
- **Comments** explain *why*, not *what*. Match the density of the file you're
  editing.

## Commits and pull requests

- Write the subject in the imperative mood, under ~72 characters:
  "Hide archived threads from the thread list", not "hid" or "hiding".
- Explain the reasoning in the body when the change isn't self-evident.
- One logical change per PR. If you find an unrelated bug, that's a separate PR.
- Fill in the PR template — especially *how you verified it*. "Tests pass" is
  the floor; say what you actually exercised in the TUI.
- Note user-visible changes in `CHANGELOG.md` under `## [Unreleased]`.
- Put `[minor]` or `[major]` in the subject when the change warrants that
  version bump; merging to `master` releases it (see [Releasing](#releasing)).

## Testing

Tests live in `test/` and run under `bun test`. The rendering and parsing layers
(`src/tui/*-render.ts`, `src/cli/args.ts`, `src/cli/shorthand.ts`,
`src/config.ts`) are pure and should be covered by unit tests. The interactive
views are typecheck-verified and validated against a live BB — if you extend
them, pull any logic worth asserting into a pure function and test that rather
than mocking a terminal.

## Releasing

There is no manual release step. Every push to `master` that changes shipped
code (`src/`, `bin/`, `package.json`, `bun.lock`) cuts a release through
[`.github/workflows/release.yml`](.github/workflows/release.yml):

1. **plan** — `scripts/release.ts plan` picks the version. The bump comes from
   commit subjects since the last `v*` tag: a `[major]` or `[minor]` marker opts
   into that bump (the highest across the range wins); anything else cuts a
   patch. Docs- or CI-only pushes release nothing.
2. **check** and **build** — the full `bun run check` gate, and all four
   platform binaries built with the new version stamped in, each passing
   `selfcheck` and a `version` check, with `.sha256` checksums.
3. **tag and GitHub release** — moves the `## [Unreleased]` entries under the new
   version in `CHANGELOG.md` (or lists the commit subjects if there were none),
   commits `release: vX.Y.Z` as `github-actions[bot]`, tags it, and creates the
   GitHub release with the binaries and that changelog section as notes.
4. **npm** — publishes with provenance. Without the `NPM_TOKEN` secret this step
   is skipped and the release notes say so; add the secret and re-run the `npm`
   job of that release to publish it.

So: note user-visible changes under `## [Unreleased]`, and put `[minor]` or
`[major]` in the subject of a commit that warrants one. The version lives only in
`package.json` — never edit it by hand, the workflow owns it.

A manual run (**Actions → release → Run workflow**) can force `patch`, `minor`,
`major`, or `prerelease` (`X.Y.Z-beta.N`, published to npm's `next` dist-tag),
and releases even when nothing shipped changed.
