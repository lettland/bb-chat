/** Human-readable message for any thrown value. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Clamp `n` into the inclusive range [min, max]. */
export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** A parsed `/name args` composer command, or null if the input isn't a command. */
export interface SlashCommand {
  name: string;
  args: string;
}

/** Parse a leading-slash composer command. Non-slash input returns null (a message). */
export function parseSlashCommand(input: string): SlashCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const rest = trimmed.slice(1);
  const space = rest.indexOf(" ");
  const name = (space === -1 ? rest : rest.slice(0, space)).toLowerCase();
  const args = space === -1 ? "" : rest.slice(space + 1).trim();
  return { name, args };
}

export interface ScrollWindow<T> {
  /** The items visible in the viewport. */
  shown: T[];
  /** True when the window sits at the bottom (following the latest). */
  atBottom: boolean;
  /** How many items are hidden above / below the viewport. */
  above: number;
  below: number;
  /** The offset clamped to a valid range (lines scrolled up from the bottom). */
  offset: number;
}

/**
 * Pick a `height`-tall window over `items`, `offset` lines up from the bottom
 * (0 = pinned to the latest). Clamps the offset to a valid range and reports how
 * much is hidden above/below so the caller can show a scroll indicator.
 */
export function scrollWindow<T>(
  items: readonly T[],
  height: number,
  offset: number,
): ScrollWindow<T> {
  const h = Math.max(1, height);
  const maxOffset = Math.max(0, items.length - h);
  const off = Math.max(0, Math.min(Math.trunc(offset), maxOffset));
  const end = items.length - off;
  const start = Math.max(0, end - h);
  return {
    shown: items.slice(start, end),
    atBottom: off === 0,
    above: start,
    below: items.length - end,
    offset: off,
  };
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
