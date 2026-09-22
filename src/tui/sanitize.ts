/**
 * Terminal-safety sanitizers for untrusted content (tool output, repo diffs, LLM
 * prose). Escape sequences in that content can spoof the title bar, write the
 * clipboard (OSC 52), or move the cursor — so anything from outside vch is
 * scrubbed before it reaches a renderable. Single source of truth so the diff,
 * markdown, and terminal paths all strip the same way.
 */

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

// Built from char codes (not literal control chars in source, so Biome leaves it
// alone and no ignore is needed). Alternations, in order:
//   1. CSI:  ESC [ params intermediates final
//   2. OSC:  ESC ] ... terminated by BEL or ST (ESC \)
//   3. C1 two-char escapes: ESC + one final byte in @-Z \ ^ _
//      (deliberately EXCLUDES [ and ], which start CSI/OSC — otherwise ESC]
//      would match here and the OSC handler would never run, leaking the OSC
//      payload into the output).
const ANSI_PATTERN = new RegExp(
  `${ESC}(?:\\[[0-?]*[ -/]*[@-~]|\\][^${BEL}]*(?:${BEL}|${ESC}\\\\)|[@-Z\\\\^_])`,
  "g",
);

// Residual C0/C1 control bytes to drop after ANSI removal. Keeps \t (0x09) and
// \n (0x0a); removes everything else in 0x00–0x1f, plus DEL (0x7f) and the C1
// range (0x80–0x9f). Range built from char codes to keep the source clean.
const CONTROL_PATTERN = new RegExp(
  `[${String.fromCharCode(0x00)}-${String.fromCharCode(0x08)}` +
    `${String.fromCharCode(0x0b)}${String.fromCharCode(0x0c)}` +
    `${String.fromCharCode(0x0e)}-${String.fromCharCode(0x1f)}` +
    `${String.fromCharCode(0x7f)}-${String.fromCharCode(0x9f)}]`,
  "g",
);

/** Strip ANSI escape sequences and carriage returns, leaving readable text. */
export function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, "").replace(/\r/g, "");
}

/**
 * Full sanitize for untrusted rendered content: strip ANSI escapes, then any
 * remaining control bytes (preserving tabs and newlines). Use on diff patches and
 * markdown prose before handing them to a renderable.
 */
export function sanitizeText(input: string): string {
  return stripAnsi(input).replace(CONTROL_PATTERN, "");
}
