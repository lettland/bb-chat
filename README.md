# vch

**BB in your terminal.** A full TUI client for the [BB](https://github.com/get-bb/bb) coding-agent server — the terminal equivalent of the BB desktop app. `cd` into a project, run `vch`, and you're in that project's threads: connect to (or start) BB, browse and open threads, pick providers, watch live agent activity, review diffs, attach terminals.

`vch` is **not** a provider and **not** an upstream BB feature. It's a third client alongside the desktop/web app, talking to BB over its published SDK (`bb-app`) via HTTP/WebSocket. Provider work (Claude Code / Codex / OpenCode) still runs inside BB.

## Status

Working: config + `vch init` detection, server ensure/health, project resolution
(auto-create), the global home, live thread list, streaming chat + composer, the
spawn wizard (provider → model → mode → prompt), diff review, terminals, and
plugin/skill listings. The interactive views are typecheck-verified and their
data layers checked against a live BB; broaden coverage as you use it.

## Requirements

- [Bun](https://bun.sh) ≥ 1.3
- An installed BB server (official npm `bb-app`, or a local build — your choice, via config)

## Install

- **Binary** — download the `vch-<os>-<arch>` build for your platform from the
  [releases](https://github.com/valksor/vch/releases), `chmod +x`, put it on your `PATH`.
- **npm** (requires Bun) — `bun install -g vch`, then `vch`.
- **From source** — `bun install && bun run dev`.

## Usage

```
vch                      Open the current directory's project (creates it if new)
vch -g, --global         Global home: all projects
vch <thread-id>          Open a specific thread (thr_...)
vch new [flags] [prompt] Start a new thread (opens the spawn wizard)
vch init [--print]       Detect system-local BB, write an editable config
vch doctor               Diagnose config + BB reachability
vch help | version
```

In-app keys: `↑/↓` move · `enter` open/select · `n` new thread · `p` plugins
(global) / skills (project) · in a thread `ctrl+o` diff · `ctrl+t` terminals ·
`esc`/`q` back · `ctrl+c` quit.

## Configuration

`vch` never assumes or auto-launches an official BB. What server it talks to — and how it's started if down — is entirely config-driven. `vch init` detects a system-local BB and writes an editable `~/.config/vch/config.json`:

```json
{
  "serverUrl": "http://127.0.0.1:38886",
  "bbCommand": ["/path/to/bb-app"],
  "startCommand": ["/path/to/bb-app", "start"],
  "autoStart": false
}
```

Environment overrides: `VCH_SERVER_URL` / `BB_SERVER_URL`, `VCH_START_COMMAND`, `VCH_BB_COMMAND`, `VCH_AUTO_START`.

- `autoStart` defaults to `false` — `vch` will not launch BB unless you opt in.
- Point `serverUrl` / `startCommand` at an official install or a local dev build; `vch` treats them identically.

## Development

```
bun install
bun run typecheck       # tsc --noEmit (TypeScript 7)
bun run lint            # biome check
bun test
bun run dev             # run from source
bun run build:binaries  # standalone binary for the current platform → dist/
```

Toolchain: Bun · TypeScript 7 · Biome · `@opentui/core` · `bb-app` SDK. CI runs
typecheck + lint + tests; tagged releases build per-platform binaries and publish
to npm.
