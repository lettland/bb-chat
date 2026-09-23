/**
 * Shared screen chrome so every view looks like one app: a themed header bar
 * (optionally under a small "bbchat" wordmark), a content area, a transient status
 * line, and a bottom status bar that fits itself to the terminal width. Plus
 * `ListPanel`, the selectable list used by every list screen.
 *
 * `ListPanel` wraps OpenTUI's `SelectRenderable` for its highlight bar and
 * scrolling, but deliberately never focuses it: the owning view keeps routing
 * keys itself and drives the selection with `select(index)`. That keeps each
 * view's single-letter shortcuts (n/p/r/q) and vim keys (j/k) working instead of
 * being swallowed by a focused widget.
 *
 * Colors are resolved when a screen is built (after startup picked the theme
 * mode), never at import time.
 */

import {
  ASCIIFontRenderable,
  BoxRenderable,
  bold,
  fg,
  SelectRenderable,
  StyledText,
  TextRenderable,
} from "@opentui/core";
import { sanitizeText } from "../sanitize.ts";
import { fitStatusLine } from "../statusline.ts";
import { accentColor, amberColor, palette, toneColor } from "../theme.ts";
import type { LineTone } from "../timeline-render.ts";
import { clamp } from "../util.ts";

export type Renderer = ConstructorParameters<typeof BoxRenderable>[0];

function splitHints(hints: string): string[] {
  return hints
    .split(" · ")
    .map((h) => h.trim())
    .filter((h) => h.length > 0);
}

export interface ScreenOptions {
  title: string;
  subtitle?: string;
  /**
   * Key hints for the right of the status bar, " · "-separated and most important
   * first — the least important are dropped first on narrow terminals.
   */
  hints: string;
  /** Show the small "bbchat" wordmark above the header (home/list screens only). */
  wordmark?: boolean;
}

/** One screen's frame: header, content area, transient status line, status bar. */
export class Screen {
  readonly outer: BoxRenderable;
  /** Views add their body renderables here (a flex column that fills the space). */
  readonly content: BoxRenderable;
  private readonly titleText: TextRenderable;
  private readonly statusText: TextRenderable;
  private readonly footer: BoxRenderable;
  private readonly footerText: TextRenderable;
  private segments: string[] = [];
  private hints: string[];
  private readonly statusRow: BoxRenderable;

  constructor(renderer: Renderer, opts: ScreenOptions) {
    const p = palette();
    this.hints = splitHints(opts.hints);
    this.outer = new BoxRenderable(renderer, { flexDirection: "column", height: "100%" });

    if (opts.wordmark) {
      const mark = new BoxRenderable(renderer, { paddingLeft: 1, paddingTop: 1, flexShrink: 0 });
      mark.add(
        new ASCIIFontRenderable(renderer, { text: "bbchat", font: "tiny", color: p.accent }),
      );
      this.outer.add(mark);
    }

    const header = new BoxRenderable(renderer, {
      flexDirection: "row",
      flexShrink: 0,
      height: 1,
      paddingLeft: 1,
      paddingRight: 1,
      backgroundColor: p.surface.statusbar,
    });
    // One row, never wrapped: a long title/branch is truncated instead.
    this.titleText = new TextRenderable(renderer, {
      content: "",
      wrapMode: "none",
      truncate: true,
    });
    header.add(this.titleText);
    this.outer.add(header);

    this.content = new BoxRenderable(renderer, {
      flexDirection: "column",
      flexGrow: 1,
      paddingLeft: 1,
      paddingRight: 1,
      paddingTop: 1,
    });
    this.outer.add(this.content);

    // The transient status row only takes space while it has something to say.
    this.statusText = new TextRenderable(renderer, { content: "", fg: amberColor() });
    this.statusRow = new BoxRenderable(renderer, { flexShrink: 0, paddingLeft: 1, visible: false });
    this.statusRow.add(this.statusText);
    this.outer.add(this.statusRow);

    // The status bar re-fits itself whenever its measured width changes (resize).
    const footer = new BoxRenderable(renderer, {
      flexShrink: 0,
      height: 1,
      paddingLeft: 1,
      paddingRight: 1,
      backgroundColor: p.surface.statusbar,
      onSizeChange: () => this.renderFooter(),
    });
    this.footer = footer;
    this.footerText = new TextRenderable(renderer, { content: "" });
    footer.add(this.footerText);
    this.outer.add(footer);

    this.setTitle(opts.title, opts.subtitle);
    this.renderFooter();
  }

  /** Header title (and a dimmer subtitle). Both are sanitized — titles can be user/agent text. */
  setTitle(title: string, subtitle?: string): void {
    const chunks = [bold(fg(accentColor())(sanitizeText(title)))];
    if (subtitle) chunks.push(fg(toneColor("system"))(`   ${sanitizeText(subtitle)}`));
    this.titleText.content = new StyledText(chunks);
  }

  /** Status-bar context segments, most important first (dropped from the end when narrow). */
  setContext(segments: string[]): void {
    this.segments = segments.map((s) => sanitizeText(s));
    this.renderFooter();
  }

  setHints(hints: string): void {
    this.hints = splitHints(hints);
    this.renderFooter();
  }

  /** A transient line above the status bar ("sending…", errors). Empty clears it. */
  setStatus(text: string | StyledText, tone: "info" | "error" = "info"): void {
    if (typeof text === "string") {
      this.statusText.fg = tone === "error" ? toneColor("error") : amberColor();
      this.statusText.content = sanitizeText(text);
      this.statusRow.visible = text.length > 0;
    } else {
      // Styled callers get the same escape scrubbing as plain strings.
      this.statusText.content = new StyledText(
        text.chunks.map((chunk) => ({ ...chunk, text: sanitizeText(chunk.text) })),
      );
      this.statusRow.visible = true;
    }
  }

  private renderFooter(): void {
    // Inner width = measured box width minus its horizontal padding. Before the
    // first layout pass the box has no width yet, so fall back to the terminal.
    const measured = this.footer?.width ?? 0;
    const inner = (measured > 0 ? measured : (process.stdout.columns ?? 80)) - 2;
    const fit = fitStatusLine(this.segments, this.hints, inner);
    this.footerText.content = new StyledText([
      fg(accentColor())(fit.left),
      fg(toneColor("meta"))(`${" ".repeat(fit.gap)}${fit.right}`),
    ]);
  }
}

/**
 * A selectable list with built-in highlight and scrolling, plus a message slot
 * for the loading / empty / error states. The owning view owns the selected
 * index and pushes it in with `select`.
 */
export class ListPanel {
  readonly root: BoxRenderable;
  private readonly list: SelectRenderable;
  private readonly message: TextRenderable;
  private count = 0;

  constructor(renderer: Renderer, opts: { flexGrow?: number; height?: number } = {}) {
    const p = palette();
    this.root = new BoxRenderable(renderer, {
      flexDirection: "column",
      flexGrow: opts.flexGrow ?? 1,
      ...(opts.height !== undefined ? { height: opts.height } : {}),
    });
    this.list = new SelectRenderable(renderer, {
      flexGrow: 1,
      options: [],
      showDescription: false,
      showScrollIndicator: true,
      wrapSelection: false,
      itemSpacing: 0,
      backgroundColor: "transparent",
      focusedBackgroundColor: "transparent",
      textColor: p.tone.assistant,
      focusedTextColor: p.tone.assistant,
      selectedBackgroundColor: p.surface.selection,
      selectedTextColor: p.accent,
      visible: false,
    });
    this.message = new TextRenderable(renderer, { content: "loading…", fg: toneColor("meta") });
    this.root.add(this.list);
    this.root.add(this.message);
  }

  /** Number of items currently listed. */
  get size(): number {
    return this.count;
  }

  /**
   * Replace the items (sanitized: they carry repo/agent text). An empty list shows
   * `emptyText` instead. `selected` is clamped into range; returns the index
   * actually selected.
   */
  setItems(names: string[], emptyText: string, selected = 0): number {
    this.count = names.length;
    if (names.length === 0) {
      this.showMessage(emptyText);
      return 0;
    }
    this.list.options = names.map((name) => ({ name: sanitizeText(name), description: "" }));
    this.list.visible = true;
    this.message.visible = false;
    return this.select(selected);
  }

  /** Show a loading/empty/error message in place of the list. */
  showMessage(text: string, tone: LineTone = "meta"): void {
    this.list.visible = false;
    this.message.visible = true;
    this.message.fg = toneColor(tone);
    this.message.content = sanitizeText(text);
  }

  /** Move the highlight to `index` (clamped); returns the index actually selected. */
  select(index: number): number {
    if (this.count === 0) return 0;
    const next = clamp(index, 0, this.count - 1);
    this.list.setSelectedIndex(next);
    return next;
  }
}
