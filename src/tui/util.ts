/** Human-readable message for any thrown value. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Clamp `n` into the inclusive range [min, max]. */
export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Word-wrap a single logical line to `width` columns, hard-splitting words longer
 * than the width. Returns at least one row (possibly empty). Wrapping is done up
 * front so the transcript renders as one text block with correct line counts —
 * the renderer never re-wraps, which would otherwise overlap adjacent rows.
 */
export function wrapText(text: string, width: number): string[] {
  if (width <= 0 || text.length <= width) return [text];
  const out: string[] = [];
  let cur = "";
  for (const word of text.split(" ")) {
    let w = word;
    while (w.length > width) {
      if (cur.length > 0) {
        out.push(cur);
        cur = "";
      }
      out.push(w.slice(0, width));
      w = w.slice(width);
    }
    if (cur.length === 0) cur = w;
    else if (cur.length + 1 + w.length <= width) cur += ` ${w}`;
    else {
      out.push(cur);
      cur = w;
    }
  }
  out.push(cur);
  return out;
}
