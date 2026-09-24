# bbchat

[![ci](https://github.com/lettland/bb-chat/actions/workflows/ci.yml/badge.svg)](https://github.com/lettland/bb-chat/actions/workflows/ci.yml)
[![Coverage Status](https://coveralls.io/repos/github/lettland/bb-chat/badge.svg?branch=master)](https://coveralls.io/github/lettland/bb-chat?branch=master)
[![npm](https://img.shields.io/npm/v/bbchat.svg)](https://www.npmjs.com/package/bbchat)
[![license](https://img.shields.io/badge/license-BSD--2--Clause-blue.svg)](LICENSE)

**BB in your terminal.** A full TUI client for the [BB](https://github.com/get-bb/bb) coding-agent server — the terminal equivalent of the BB desktop app. `cd` into a project, run `bbchat`, and you're in that project's threads: connect to (or start) BB, browse and open threads, pick providers, watch live agent activity, review diffs, attach terminals.

`bbchat` is **not** a provider and **not** an upstream BB feature. It's a third client alongside the desktop/web app, talking to BB over its published SDK (`bb-app`) via HTTP/WebSocket. Provider work (Claude Code / Codex / OpenCode) still runs inside BB.

> The repository is `bb-chat`; the command, the npm package, the config
> directory, and the `BBCHAT_*` environment prefix are all `bbchat`.

## Status

Working: config + `bbchat init` detection, server ensure/health, project resolution
(auto-create), the global home, live thread list, streaming chat + composer, the
spawn wizard (provider → model → mode → prompt), diff review, terminals, and
plugin/skill listings. The interactive views are typecheck-verified and their
data layers checked against a live BB; broaden coverage as you use it.

The thread view renders assistant replies as markdown with tree-sitter
syntax-highlighted code fences (TypeScript, JavaScript, Zig, and markdown are
bundled; other languages show as plain code), inline colored diffs for file
edits, and a status bar with the thread's provider and status. Every
screen shares one themed frame with dark and light palettes.

## Requirements

- [Bun](https://bun.sh) ≥ 1.3
- An installed BB server (official npm `bb-app`, or a local build — your choice, via config)

## Install

- **Build & install locally** — `bun run install:local` compiles a standalone
  binary to `~/.local/bin/bbchat`. Override the target with `PREFIX=/usr/local/bin
  bun run install:local`, or symlink the live source instead with
  `BBCHAT_INSTALL_MODE=link bun run install:local`.
- **Binary** — download the `bbchat-<os>-<arch>` build for your platform from the
  [releases](https://github.com/lettland/bb-chat/releases), verify it against the
  published `.sha256`, `chmod +x`, put it on your `PATH`.
- **npm** (requires Bun) — `bun install -g bbchat`, then `bbchat`.
- **From source** — `bun install && bun run dev`.

## Usage

```
bbchat                      Open the current directory's project (does not create one)
bbchat <provider> [model] [reasoning] [mode]
                            Open the thread list with those new-thread defaults
                            (opens the list, does not spawn; tokens are order-independent)
bbchat -g, --global         Global home: all projects
bbchat <thread-id>          Open a specific thread (thr_...)
bbchat threads              List this project's threads and their ids
bbchat new ["prompt"]       Start a thread (interactive picker if no prompt)
    [--provider <id>] [--model <id>] [--reasoning <level>] [--mode <mode>] [--force]
bbchat providers            List providers, models, reasoning levels, and modes
bbchat init [--yes] [--force] [--print]
                            Detect system-local BB, write an editable config
bbchat doctor               Diagnose config + BB reachability
bbchat selfcheck            Verify this build highlights markdown/code offline
bbchat help | version
```

**Shorthand.** `bbchat <provider>` opens the current project's thread list (exactly
like bare `bbchat`) but seeds the provider/model/reasoning/mode a *new* thread will
use — the thread list shows the active default, and pressing `n` opens the spawn
wizard pre-filled. Tokens after the provider are matched by what they are, in any
order, and fuzzy: provider and model aliases resolve against the server's live
lists (`codex`, `claude`, `opencode`; `5.6-sol`→`gpt-5.6-sol`), reasoning is one of
`none|low|medium|high|xhigh|ultracode|max|ultra`, mode is `accept-edits|auto|full`.

```
bbchat codex 5.6-sol high     # codex, gpt-5.6-sol, reasoning high
bbchat claude 'opus-5[1m]'    # claude-code, claude-opus-5[1m]  ← quote [brackets]
bbchat codex                  # just default the provider to codex
```

Quote models containing `[brackets]` so your shell doesn't treat them as a glob.
Run `bbchat providers` for the exact provider/model/reasoning/mode values.

In-app keys: `↑/↓` move · `enter` open/select · `n` new thread · `p` plugins
(global) / skills (project) · in a thread `ctrl+o` diff · `ctrl+t` terminals ·
`esc`/`q` back · `ctrl+c` quit.

**Project groups.** The global home gathers projects under the same named,
collapsible groups as the BB sidebar (e.g. *work*, or a set of linked repos).
They are stored in BB's thread-list plugin (`projectGroups`), so a group made in
bbchat shows up in the BB app and vice versa. On a project, `g` moves it into an
existing group, a new one, or out of its group; on a group header, `enter`
collapses/expands it, `e` renames it, and `u` ungroups its projects. Groups sort
by name among the ungrouped projects. A BB whose thread-list plugin has no
project groups just shows the flat list.

## Configuration

`bbchat` never assumes or auto-launches an official BB. What server it talks to — and how it's started if down — is entirely config-driven. `bbchat init` detects a system-local BB and writes an editable `~/.config/bbchat/config.json`:

```json
{
  "serverUrl": "http://127.0.0.1:38886",
  "bbCommand": ["/path/to/bb-app"],
  "startCommand": ["/path/to/bb-app", "start"],
  "autoStart": false
}
```

Environment overrides: `BBCHAT_SERVER_URL` / `BB_SERVER_URL`, `BBCHAT_START_COMMAND`, `BBCHAT_BB_COMMAND`, `BBCHAT_AUTO_START`.

Appearance: `bbchat` follows the terminal's light/dark background. Set
`BBCHAT_THEME=light` or `BBCHAT_THEME=dark` to force a palette when the terminal doesn't
report one.

- `autoStart` defaults to `false` — `bbchat` will not launch BB unless you opt in.
- Point `serverUrl` / `startCommand` at an official install or a local dev build; `bbchat` treats them identically.

## Development

```
bun install
bun run check           # typecheck + lint + test — the same gate CI runs
bun run typecheck       # tsc --noEmit (TypeScript 7, strict)
bun run lint            # biome check
bun run lint:fix        # biome check --write (formatting + import order)
bun test
bun run dev             # run from source
bun run build:binary    # standalone binary → dist/bbchat
bun run build:binaries  # platform-suffixed binary → dist/bbchat-<os>-<arch>
```

Bun is the only supported toolchain — no npm/pnpm/yarn lockfiles (they're
gitignored; a second lockfile resolves a different tree than CI's
`bun install --frozen-lockfile`).

Toolchain: Bun · TypeScript 7 · Biome · `@opentui/core` · `bb-app` SDK. CI runs
typecheck + lint + tests and shellcheck, then builds the standalone binary for
all four release platforms (Linux and macOS, x64 and arm64), runs
`bbchat selfcheck` on each (proving the embedded tree-sitter grammars highlight
with the network blocked — something `bun test` structurally cannot catch), and
uploads them with checksums as run artifacts. Every push to `master` that changes
shipped code is released automatically: version bump, changelog, tag, a GitHub
release carrying those binaries, and an npm publish with provenance — see
[Releasing](CONTRIBUTING.md#releasing).

See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions and the release process,
and [SECURITY.md](SECURITY.md) for the threat model — this client renders
untrusted, model-authored content into a terminal, and two modules
(`src/tui/sanitize.ts`, `src/tui/markdown-safety.ts`) exist entirely to make
that safe.

## License

[BSD 2-Clause](LICENSE) © Valksor
