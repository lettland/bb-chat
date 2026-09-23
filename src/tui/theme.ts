/**
 * The single source of truth for bbchat's terminal palette, glyphs, and syntax
 * highlighting style. Everything visual resolves through here so colors are not
 * scattered as literals across views.
 *
 * Dependency note: the `LineTone`/`DiffTone` unions are imported *type-only* from
 * the pure render modules, so this module does not create a runtime import cycle
 * and those modules stay free of any `@opentui/core` dependency. Only the styling
 * and view layers (which already depend on `@opentui/core`) call the color
 * resolvers here.
 */

import { SyntaxStyle } from "@opentui/core";
import type { DiffTone } from "./diff-render.ts";
import type { LineTone } from "./timeline-render.ts";

export type ThemeMode = "dark" | "light";

/** A full set of semantic colors for one terminal background mode. */
export interface Palette {
  /** Transcript role/line tones (mirrors `LineTone`). */
  tone: Record<LineTone, string>;
  /** Unified-diff line tones (mirrors `DiffTone`). */
  diff: Record<DiffTone, string>;
  /** Filled-surface backgrounds. `base` omitted = inherit the terminal's own bg. */
  surface: {
    base?: string;
    userCard?: string;
    assistantCard?: string;
    code: string;
    selection: string;
    statusbar: string;
  };
  /** Border colors for cards and framed boxes. */
  border: {
    default: string;
    focus: string;
    user: string;
    assistant: string;
  };
  /** Primary accent (teal) and the attention/amber highlight. */
  accent: string;
  amber: string;
}

const DARK: Palette = {
  tone: {
    user: "#4EC9B0", // teal — you (the human)
    assistant: "#E6E6E6", // near-white — the assistant
    toolcall: "#569CD6", // blue — tool / command calls
    agent: "#C586C0", // purple — subagent / workflow invocations
    edit: "#89D185", // green — file edits
    output: "#808893", // gray — tool output (the response)
    attention: "#E5C07B", // amber — approvals / questions
    error: "#E06C75", // red — failed / denied work
    system: "#6A737D", // dim — system notes
    meta: "#4B5263", // dimmest — separators / meta
  },
  diff: {
    add: "#89D185", // green — added lines
    del: "#E06C75", // red — removed lines
    hunk: "#C586C0", // purple — @@ hunk headers
    file: "#4EC9B0", // teal — file headers
    context: "#808893", // gray — unchanged context
    meta: "#4B5263", // dim — diff/index/paths
  },
  surface: {
    userCard: "#12211F", // subtle teal-tinted panel
    assistantCard: undefined, // inherit terminal bg (keeps assistant prose clean)
    code: "#1B1F27", // fenced code-block background
    selection: "#2C323C", // selected work-row fill
    statusbar: "#21252B", // bottom status bar
  },
  border: {
    default: "#3A3F4B",
    focus: "#4EC9B0",
    user: "#4EC9B0",
    assistant: "#5A6373",
  },
  accent: "#4EC9B0",
  amber: "#E5C07B",
};

const LIGHT: Palette = {
  tone: {
    user: "#0E7C66",
    assistant: "#1B1F24",
    toolcall: "#1A66C2",
    agent: "#9C27B0",
    edit: "#2E7D32",
    output: "#5A626B",
    attention: "#9A6A00",
    error: "#C0392B",
    system: "#6A737D",
    meta: "#AEB4BE",
  },
  diff: {
    add: "#2E7D32",
    del: "#C0392B",
    hunk: "#9C27B0",
    file: "#0E7C66",
    context: "#5A626B",
    meta: "#AEB4BE",
  },
  surface: {
    userCard: "#E5F3EF",
    assistantCard: undefined,
    code: "#F0F1F4",
    selection: "#DCE3EC",
    statusbar: "#E8EAED",
  },
  border: {
    default: "#C7CCD4",
    focus: "#0E7C66",
    user: "#0E7C66",
    assistant: "#B3BAC5",
  },
  accent: "#0E7C66",
  amber: "#9A6A00",
};

const PALETTES: Record<ThemeMode, Palette> = { dark: DARK, light: LIGHT };

let activeMode: ThemeMode = "dark";

/** Switch the active palette (call once after the renderer reports its theme mode). */
export function setThemeMode(mode: ThemeMode): void {
  activeMode = mode;
}

export function getThemeMode(): ThemeMode {
  return activeMode;
}

/** How long to wait for the terminal to report its light/dark background. */
const THEME_DETECT_MS = 250;

/**
 * Decide the startup palette. An explicit `forced` value (`BBCHAT_THEME=light|dark`)
 * wins; otherwise ask the terminal, falling back to dark when it doesn't answer
 * in time or the query fails. Resolved once — views take their colors when built,
 * so switching later would not repaint what is already mounted.
 */
export async function resolveThemeMode(
  renderer: { waitForThemeMode(timeoutMs?: number): Promise<ThemeMode | null> },
  forced: string | undefined,
): Promise<ThemeMode> {
  if (forced === "light" || forced === "dark") return forced;
  try {
    return (await renderer.waitForThemeMode(THEME_DETECT_MS)) ?? "dark";
  } catch {
    return "dark";
  }
}

/** The palette for the active (or an explicitly requested) terminal mode. */
export function palette(mode: ThemeMode = activeMode): Palette {
  return PALETTES[mode];
}

/** Resolve a transcript tone to its color in the active palette. */
export function toneColor(tone: LineTone): string {
  return palette().tone[tone];
}

/** Resolve a diff tone to its color in the active palette. */
export function diffColor(tone: DiffTone): string {
  return palette().diff[tone];
}

/** The active palette's primary accent (teal). */
export function accentColor(): string {
  return palette().accent;
}

/** The active palette's attention/amber highlight. */
export function amberColor(): string {
  return palette().amber;
}

/**
 * Shared glyphs, gathered here so the transcript, lists, and chrome stay visually
 * consistent. Mode-independent.
 */
export const glyph = {
  gutter: "▌",
  cursor: "❯",
  listCursor: "›",
  collapsed: "▸",
  expanded: "▾",
  ok: "✓",
  fail: "✗",
  running: "…",
  bullet: "•",
  attention: "!",
  pluginOn: "●",
  pluginOff: "○",
  rule: "─",
} as const;

/**
 * Tree-sitter capture-name → style map for `MarkdownRenderable`/`CodeRenderable`.
 * Keys are common highlight captures; unmapped captures fall back to the
 * renderable's default foreground.
 */
function buildSyntaxStyle(mode: ThemeMode): SyntaxStyle {
  const p = PALETTES[mode];
  return SyntaxStyle.fromStyles({
    keyword: { fg: p.tone.agent },
    "keyword.control": { fg: p.tone.agent },
    string: { fg: p.tone.edit },
    "string.special": { fg: p.tone.edit },
    function: { fg: p.tone.toolcall },
    "function.method": { fg: p.tone.toolcall },
    type: { fg: p.accent },
    "type.builtin": { fg: p.accent },
    constant: { fg: p.tone.attention },
    "constant.builtin": { fg: p.tone.attention },
    number: { fg: p.tone.attention },
    boolean: { fg: p.tone.attention },
    comment: { fg: p.tone.system, italic: true },
    variable: { fg: p.tone.assistant },
    "variable.parameter": { fg: p.tone.assistant },
    property: { fg: p.tone.assistant },
    operator: { fg: p.tone.output },
    punctuation: { fg: p.tone.output },
    "punctuation.bracket": { fg: p.tone.output },
    tag: { fg: p.tone.toolcall },
    attribute: { fg: p.tone.attention },
  });
}

const SYNTAX_STYLES: Record<ThemeMode, SyntaxStyle> = {
  dark: buildSyntaxStyle("dark"),
  light: buildSyntaxStyle("light"),
};

/** The syntax style for the active (or an explicitly requested) mode. */
export function syntaxStyle(mode: ThemeMode = activeMode): SyntaxStyle {
  return SYNTAX_STYLES[mode];
}
