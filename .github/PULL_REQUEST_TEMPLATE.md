## What and why

<!-- What changes, and what problem it solves. Link the issue: Fixes #123 -->

## How I verified it

<!--
"Tests pass" is the floor, not the answer. Say what you actually exercised.
If this touches the transcript, diffs, or code fences, note that you ran:
  bun run build:binary && ./dist/bbchat selfcheck
-->

- [ ] `bun run check` passes (typecheck + lint + tests)
- [ ] Exercised against a live BB server
- [ ] Ran `selfcheck` on a compiled binary (required for `src/tui/` render changes)

## Checklist

- [ ] One logical change — unrelated fixes went to a separate PR
- [ ] User-visible changes noted in `CHANGELOG.md` under `## [Unreleased]`
- [ ] New pure logic has unit tests in `test/`
- [ ] No new lockfile (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`) — Bun only
- [ ] Breaking changes to config keys, `BBCHAT_*` env vars, or CLI flags are called out below

## Breaking changes

<!-- None, or describe the migration a user has to perform. -->
