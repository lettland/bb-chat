/**
 * Width-aware fitting for the one-line status bar at the bottom of each screen.
 * Pure (no renderer dependency) so the truncation rules are unit-tested.
 *
 * The bar is `left … right`: `left` is context segments joined by " · " (most
 * important first), `right` is key hints joined the same way (most important
 * first). When the terminal is too narrow the bar sheds detail one item at a
 * time — hints from their least important end first, then context segments from
 * theirs — and finally truncates the single remaining segment with an ellipsis,
 * so it never wraps onto a second line.
 */

export interface FittedStatus {
  left: string;
  right: string;
  /** Spaces between `left` and `right` so the line spans exactly `width`. */
  gap: number;
}

const SEPARATOR = " · ";
/** Minimum spaces kept between the context and the hints. */
const MIN_GAP = 2;

function truncate(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  if (max === 1) return "…";
  return `${text.slice(0, max - 1)}…`;
}

/**
 * Fit `segments` and `hints` (each most important first) into `width` columns.
 * Empty entries are ignored.
 */
export function fitStatusLine(segments: string[], hints: string[], width: number): FittedStatus {
  const avail = Math.max(0, Math.floor(width));
  const parts = segments.filter((s) => s.length > 0);
  const keys = hints.filter((h) => h.length > 0);

  const fits = (l: string, r: string) =>
    r.length === 0 ? l.length <= avail : l.length + MIN_GAP + r.length <= avail;

  // Shed hints one at a time, keeping the full context.
  let left = parts.join(SEPARATOR);
  while (keys.length > 0 && !fits(left, keys.join(SEPARATOR))) keys.pop();
  if (keys.length > 0) {
    const right = keys.join(SEPARATOR);
    return { left, right, gap: avail - left.length - right.length };
  }

  // No hint fits: shed context segments, then truncate the last one.
  while (parts.length > 1 && parts.join(SEPARATOR).length > avail) parts.pop();
  left = truncate(parts.join(SEPARATOR), avail);
  return { left, right: "", gap: Math.max(0, avail - left.length) };
}
