/**
 * Link-scheme safety for LLM-authored markdown before it reaches
 * `MarkdownRenderable`, which turns link destinations into clickable OSC-8
 * terminal hyperlinks with no scheme filter — and whose visible label need not
 * match the target. An injected `[docs](javascript:…)` or `[readme](file:///…)`
 * could therefore pass for a harmless link.
 *
 * Deliberately NOT a markdown parser. OpenTUI finds links via tree-sitter while
 * rendering, and any hand-written or second-parser rewrite can disagree with it
 * (nested parentheses, labels spanning lines, bracketed targets, …) and let a
 * link through. Instead this scans the raw text at every place a link target
 * can start — `](`, a reference definition's `]:`, an autolink's `<` — and flags
 * the message if what follows begins with any scheme other than http, https or
 * mailto. Labels are never inspected, so how they're written cannot matter. The
 * scan is fail-closed: an obfuscated scheme (entities, percent-encoding) counts
 * as unsafe. A flagged message is rendered as plain text — every character
 * visible, nothing clickable — so a false positive costs only formatting.
 */

const ALLOWED_SCHEMES = new Set(["http", "https", "mailto"]);
/** How far past an opener to look for the start of a target. */
const LOOKAHEAD = 256;
/** Where a link target can begin: after `](`, after `]:`, or inside `<` + letter. */
const OPENER = /\]\(|\]:|<(?=[a-z])/gi;
/** Whitespace, ASCII controls and angle brackets — stripped before reading a scheme. */
const NOISE = new RegExp(`[\\s<>${String.fromCharCode(0)}-${String.fromCharCode(0x1f)}]`, "g");

/**
 * True when `target` is safe to leave clickable: an allowed scheme, or no scheme
 * at all (a relative path, an anchor, or a leading `123:` that is not a scheme).
 */
export function isAllowedLinkTarget(target: string): boolean {
  const compact = target.replace(NOISE, "");
  const colon = compact.indexOf(":");
  const pathStart = compact.search(/[/?]/);
  // No colon before the path starts → relative path or anchor, no scheme.
  if (colon === -1 || (pathStart !== -1 && pathStart < colon)) return true;
  const scheme = compact.slice(0, colon).toLowerCase();
  if (/^\d*$/.test(scheme)) return true; // e.g. "10:30" — not a URI scheme
  // Anything that isn't a clean scheme (entities, %-escapes, …) fails closed.
  if (!/^[a-z][a-z0-9+.-]*$/.test(scheme)) return false;
  return ALLOWED_SCHEMES.has(scheme);
}

/** The text that could form a link target starting right after an opener. */
function targetAfter(text: string, opener: string, from: number): string {
  const rest = text.slice(from, from + LOOKAHEAD);
  if (opener === "<") {
    // Autolinks contain no whitespace and end at `>`.
    const stop = rest.search(/[\s>]/);
    return stop === -1 ? rest : rest.slice(0, stop);
  }
  // `](` / `]:` may be followed by whitespace (even a newline) before the target.
  const body = rest.replace(/^\s+/, "");
  if (body.startsWith("<")) {
    // A bracketed destination may contain spaces; it ends at `>`.
    const close = body.indexOf(">");
    return close === -1 ? body : body.slice(0, close);
  }
  const stop = body.search(/\s/);
  return stop === -1 ? body : body.slice(0, stop);
}

/**
 * True when `markdown` contains anything that could render as a link to a
 * non-http(s)/mailto target. Conservative by design — see the module comment.
 */
export function hasUnsafeLink(markdown: string): boolean {
  for (const match of markdown.matchAll(OPENER)) {
    const opener = match[0].startsWith("<") ? "<" : match[0];
    const start = (match.index ?? 0) + (opener === "<" ? 1 : match[0].length);
    if (!isAllowedLinkTarget(targetAfter(markdown, opener, start))) return true;
  }
  return false;
}
