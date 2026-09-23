# Security Policy

## Supported versions

`bbchat` is pre-1.0. Only the latest release receives fixes; there are no
backports to earlier tags.

| Version | Supported |
| ------- | --------- |
| latest  | yes       |
| older   | no        |

## Reporting a vulnerability

Please **do not** open a public issue for a security problem.

Report it privately through GitHub Security Advisories:
<https://github.com/lettland/bb-chat/security/advisories/new>

Include what you need to make it reproducible — the input or server response
that triggers it, the terminal emulator and version if it is a rendering issue,
and what an attacker gains. You will get an acknowledgement, and a fix or an
explanation of why it isn't one. If a report is valid and you want credit, you
will get it in the advisory and the changelog.

## Threat model

`bbchat` is a terminal client that renders content it does not control:
model-authored prose, tool output, and repository diffs, all arriving from a BB
server over HTTP/WebSocket. That content is untrusted, and the terminal is a
powerful interpreter. The relevant properties:

- **Escape-sequence scrubbing** (`src/tui/sanitize.ts`). Everything from outside
  `bbchat` is stripped of ANSI CSI, OSC, and C1 escapes before it reaches a
  renderable. Unscrubbed, that content could spoof the window title, write the
  user's clipboard via OSC 52, or reposition the cursor to forge UI.
- **Link-scheme filtering** (`src/tui/markdown-safety.ts`). OpenTUI turns
  markdown link targets into clickable OSC-8 hyperlinks with no scheme filter,
  and a link's visible label need not match its destination. Only `http`,
  `https`, and `mailto` targets stay clickable; anything else — including
  obfuscated schemes — makes the whole message render as inert plain text. The
  scan is deliberately fail-closed: a false positive costs formatting, a false
  negative costs a `javascript:` or `file://` link that reads as harmless.
- **No shell.** Configured commands are argv arrays (`["bb-app", "start"]`),
  never shell strings, and are spawned without a shell. A crafted config cannot
  smuggle in shell metacharacters.
- **No implicit process launch.** `autoStart` defaults to `false`. `bbchat`
  never launches a BB server unless you explicitly opt in and supply the
  `startCommand` yourself.

Things that are **in scope**: a bypass of the escape-sequence scrubber or the
link-scheme filter, any path from server-supplied content to command execution,
credential or config disclosure, or a way to make `bbchat` spawn a process the
user did not configure.

Things that are **out of scope**: vulnerabilities in the BB server itself
(report those to [BB](https://github.com/get-bb/bb)), in the coding-agent
providers, or in `@opentui/core` — though a report explaining how `bbchat` uses
one of those unsafely is very much in scope. Likewise, a config file or server
URL you pointed at something malicious yourself is a trust decision, not a
vulnerability.
