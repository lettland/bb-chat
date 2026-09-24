# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Add entries under `## [Unreleased]`; the release workflow moves them under the
version it cuts on the next push to `master`.

## [Unreleased]

### Added

- Project groups in the global home (`bbchat -g`): projects are listed under
  the named, collapsible groups shared with the BB sidebar. `g` moves a project
  into a group (existing or new) or out of one; on a group header `enter`
  collapses it, `e` renames it, and `u` ungroups it. Groups are read from and
  saved to BB's thread-list plugin, so both clients stay in sync.

## [0.1.2] - 2026-09-23

### Changed

- Raise test coverage from 86% to 98.6% of lines

## [0.1.1] - 2026-09-23

### Changed

- Upload test coverage to Coveralls from CI

## [0.1.0] - 2026-09-23

### Changed

- **Renamed the tool from `vch` to `bbchat`.** This is a breaking rename of every
  user-facing name, done before the first published release:
  - binary and npm package: `vch` → `bbchat`
  - config directory: `~/.config/vch/` → `~/.config/bbchat/`
  - environment prefix: `VCH_*` → `BBCHAT_*` (`BBCHAT_SERVER_URL`,
    `BBCHAT_START_COMMAND`, `BBCHAT_BB_COMMAND`, `BBCHAT_AUTO_START`,
    `BBCHAT_THEME`, `BBCHAT_INSTALL_MODE`)
  - release artifacts: `vch-<os>-<arch>` → `bbchat-<os>-<arch>`

  There is no compatibility shim. Re-run `bbchat init`, or move your existing
  config with `mv ~/.config/vch ~/.config/bbchat`.

### Added

- Automatic releases: every push to `master` that changes shipped code bumps the
  version (`[minor]` / `[major]` commit markers, patch otherwise), cuts this
  changelog, tags, attaches Linux and macOS (x64 + arm64) binaries with
  checksums to a GitHub release, and publishes to npm when `NPM_TOKEN` is set.
- CI builds and self-checks all four platform binaries on every push and pull
  request and uploads them as run artifacts.
- Project scaffold: `LICENSE` (BSD 2-Clause), `CONTRIBUTING.md`, `SECURITY.md`,
  `CODE_OF_CONDUCT.md`, `.editorconfig`, `.gitattributes`, issue and pull
  request templates, `CODEOWNERS`, and Dependabot updates for GitHub Actions.
- `bun run check` — one command running typecheck, lint, and tests, matching the
  CI gate.
- `test/naming.test.ts` — asserts the binary name, npm package name, config
  directory, and `BBCHAT_*` environment prefix stay consistent, and that
  `bbchat version` reports the `package.json` version.

### Fixed

- Migrated `biome.json` off the deprecated `linter.rules.recommended` key, so
  `bun run lint` is clean rather than merely passing.

### Baseline

The client this scaffold wraps: config and `init` detection, server
ensure/health, project resolution, the global home, live thread list, streaming
chat and composer, the spawn wizard, diff review, terminals, and plugin/skill
listings.

[Unreleased]: https://github.com/lettland/bb-chat/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/lettland/bb-chat/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/lettland/bb-chat/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/lettland/bb-chat/releases/tag/v0.1.0
