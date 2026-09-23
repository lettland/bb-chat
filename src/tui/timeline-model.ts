/**
 * The structured, pure model of a BB thread timeline: `buildBlocks` turns the
 * SDK's normalized rows into a flat list of typed `Block`s that the view mounts as
 * individual renderables (message cards, work rows, diffs). This replaces the old
 * flat `DisplayLine[]` model for the thread view — a highlighter/markdown renderer
 * cannot live inside a single text span, so each message becomes its own block.
 *
 * Deliberately structural/defensive (D2): tolerant of unknown work kinds and
 * missing fields, and free of any `@opentui/core` dependency so it stays cheap to
 * unit-test. All untrusted text (assistant prose, tool output, repo diffs) is run
 * through `sanitizeText` here so no escape sequence reaches a renderable.
 */

import { hasUnsafeLink } from "./markdown-safety.ts";
import { sanitizeText } from "./sanitize.ts";
import {
  ATTENTION_WORK_KINDS,
  ERROR_STATUS,
  firstNonEmpty,
  type LineTone,
  outputBody,
  PREVIEW_CAP,
  statusGlyph,
  str,
  WORK_TONE,
  workId,
  workTitle,
} from "./timeline-render.ts";

/** A conversation message: rendered as a card with markdown-styled body. */
export interface MessageBlock {
  kind: "message";
  id: string;
  role: "user" | "assistant";
  text: string;
  /** True when this message opens a new exchange (a user turn after prior content). */
  newExchange: boolean;
  /** True while this (trailing assistant) message is still being generated. */
  streaming: boolean;
  /** True when `text` was capped for size; the body carries a truncation notice. */
  truncated: boolean;
  /**
   * Render as plain text instead of markdown: an assistant message containing a
   * link to a non-http(s)/mailto target is shown verbatim so nothing is clickable
   * (see `markdown-safety.ts`). Always false for user messages (never markdown).
   */
  plain: boolean;
}

/** A tool/command call with its output (collapsible). */
export interface WorkBlock {
  kind: "work";
  id: string;
  tone: LineTone;
  glyph: string;
  title: string;
  output: string[];
  expandable: boolean;
  errored: boolean;
}

/** A single file edit, rendered as a colored per-file diff or a stat chip. */
export interface DiffBlock {
  kind: "diff";
  id: string;
  path: string;
  changeKind: string | null;
  movePath: string | null;
  /** The unified patch, sanitized; null when unavailable (binary/rename/uncomputed). */
  patch: string | null;
  added: number;
  removed: number;
  expandable: boolean;
}

export interface SystemBlock {
  kind: "system";
  id: string;
  text: string;
}

/** A transcript-load failure surfaced in place (preserves the old red error line). */
export interface ErrorBlock {
  kind: "error";
  id: string;
  text: string;
}

/** The "no messages yet" placeholder for an empty transcript. */
export interface EmptyBlock {
  kind: "empty";
  id: string;
}

export type Block = MessageBlock | WorkBlock | DiffBlock | SystemBlock | ErrorBlock | EmptyBlock;

export interface BuildOptions {
  /** Mark the trailing assistant message as streaming (thread is mid-turn). */
  streaming?: boolean;
  /** Hard cap on a single message's characters before truncation (render-loop guard). */
  maxMessageChars?: number;
}

/** Default per-message character cap: generous, but bounds pathological huge blocks. */
const DEFAULT_MAX_MESSAGE_CHARS = 200_000;

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Ensure every block id is unique and stable given a stable row order. Rows
 * without a stable SDK id fall back to a positional `kind:ordinal` id, which
 * assumes the timeline is append-only (the normal case); a non-append reorder
 * could carry a previous row's selection/expansion state to a different row.
 */
function makeId(base: string, kind: string, ordinal: number, seen: Set<string>): string {
  const candidate = base.length > 0 ? base : `${kind}:${ordinal}`;
  if (!seen.has(candidate)) {
    seen.add(candidate);
    return candidate;
  }
  const disambiguated = `${candidate}#${ordinal}`;
  seen.add(disambiguated);
  return disambiguated;
}

/** Cap `text` at `max` characters, appending a notice when it overflows. */
function capText(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: `${text.slice(0, max)}\n\n… (message truncated)`, truncated: true };
}

interface BuildState {
  out: Block[];
  seen: Set<string>;
  ordinal: number;
  maxMessageChars: number;
}

function buildConversation(rec: Record<string, unknown>, state: BuildState): void {
  const role: "user" | "assistant" = rec.role === "assistant" ? "assistant" : "user";
  const newExchange = role === "user" && state.out.length > 0;
  const { text, truncated } = capText(sanitizeText(str(rec, "text")), state.maxMessageChars);
  // Assistant prose renders as markdown with clickable links; any link to a
  // non-http(s)/mailto target downgrades the whole message to plain text.
  const plain = role === "assistant" && hasUnsafeLink(text);
  const id = makeId(str(rec, "id"), "message", state.ordinal, state.seen);
  state.out.push({
    kind: "message",
    id,
    role,
    text,
    newExchange,
    streaming: false,
    truncated,
    plain,
  });
}

function buildDiff(
  rec: Record<string, unknown>,
  change: Record<string, unknown>,
  state: BuildState,
): void {
  const rawPatch = str(change, "diff");
  const patch = rawPatch.length > 0 ? sanitizeText(rawPatch) : null;
  const stats =
    change.diffStats && typeof change.diffStats === "object"
      ? (change.diffStats as Record<string, unknown>)
      : {};
  const id = makeId(workId(rec), "diff", state.ordinal, state.seen);
  // path/movePath are untrusted (a repo can hold ANSI-laden filenames), so they
  // are sanitized before ever reaching the terminal.
  state.out.push({
    kind: "diff",
    id,
    path: sanitizeText(str(change, "path")),
    changeKind: typeof change.kind === "string" ? change.kind : null,
    movePath: typeof change.movePath === "string" ? sanitizeText(change.movePath) : null,
    patch,
    added: num(stats.added),
    removed: num(stats.removed),
    expandable: patch != null,
  });
}

function buildWork(rec: Record<string, unknown>, state: BuildState): void {
  const workKind = str(rec, "workKind");

  // A file-change row with a structured `change` becomes a diff block.
  if (workKind === "file-change" && rec.change && typeof rec.change === "object") {
    buildDiff(rec, rec.change as Record<string, unknown>, state);
    return;
  }

  const status = str(rec, "status");
  const errored = ERROR_STATUS.has(status);
  const attention = ATTENTION_WORK_KINDS.has(workKind);
  const glyph = attention ? "!" : statusGlyph(status);
  const tone: LineTone = errored ? "error" : (WORK_TONE[workKind] ?? "toolcall");
  const output = outputBody(rec).map(sanitizeText);
  const expandable =
    output.length > 0 && (output.length > 1 || (output[0]?.length ?? 0) > PREVIEW_CAP);
  const id = makeId(workId(rec), "work", state.ordinal, state.seen);
  // The title interpolates untrusted row fields (command, tool name, url, …), so
  // it is sanitized like the output before it reaches the terminal.
  state.out.push({
    kind: "work",
    id,
    tone,
    glyph,
    title: sanitizeText(workTitle(rec, workKind)),
    output,
    expandable,
    errored,
  });
}

function buildRow(row: unknown, state: BuildState): void {
  if (!row || typeof row !== "object") return;
  const rec = row as Record<string, unknown>;
  state.ordinal += 1;
  switch (str(rec, "kind")) {
    case "conversation":
      buildConversation(rec, state);
      return;
    case "work":
      buildWork(rec, state);
      return;
    case "system": {
      const text = sanitizeText(firstNonEmpty(rec, ["text", "message"]));
      if (text.length > 0) {
        state.out.push({
          kind: "system",
          id: makeId(str(rec, "id"), "system", state.ordinal, state.seen),
          text,
        });
      }
      return;
    }
    case "turn": {
      const children = rec.children;
      if (Array.isArray(children)) for (const child of children) buildRow(child, state);
      return;
    }
    default:
      return;
  }
}

/**
 * Turn timeline rows (recursing into turns) into typed blocks. Returns a single
 * `empty` block when there is nothing to show. When `opts.streaming` is set, the
 * trailing assistant message (if any) is marked streaming.
 */
export function buildBlocks(rows: readonly unknown[], opts: BuildOptions = {}): Block[] {
  const state: BuildState = {
    out: [],
    seen: new Set<string>(),
    ordinal: 0,
    maxMessageChars: Math.max(1, opts.maxMessageChars ?? DEFAULT_MAX_MESSAGE_CHARS),
  };
  for (const row of rows) buildRow(row, state);

  if (opts.streaming) {
    const last = state.out[state.out.length - 1];
    if (last && last.kind === "message" && last.role === "assistant") last.streaming = true;
  }

  if (state.out.length === 0) return [{ kind: "empty", id: "empty" }];
  return state.out;
}

/** The ids of blocks that participate in Tab selection / Ctrl+E expansion. */
export function selectableIds(blocks: readonly Block[]): string[] {
  const ids: string[] = [];
  for (const block of blocks) {
    if (block.kind === "work" && block.expandable) ids.push(block.id);
    else if (block.kind === "diff" && block.expandable) ids.push(block.id);
  }
  return ids;
}

/**
 * The collapse/expand affordance shown after a work/diff header: nothing when not
 * expandable, "▾" when expanded, or "▸ N lines" when collapsed — where N is the
 * number of lines revealed on expand (not "additional" lines, to match reality).
 * Pure so the exact label stays covered by tests.
 */
export function affordanceLabel(expandable: boolean, expanded: boolean, count: number): string {
  if (!expandable) return "";
  return expanded ? "  ▾" : `  ▸ ${count} lines`;
}

/** Human-readable label for an SDK file-change kind (e.g. "type_changed" → "type changed"). */
export function changeKindLabel(changeKind: string | null): string {
  if (!changeKind) return "changed";
  return changeKind.replace(/_/g, " ");
}

const ACTIVE_STATUS = new Set(["running", "in_progress", "pending"]);

function rowActive(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  const rec = row as Record<string, unknown>;
  const kind = str(rec, "kind");
  if (kind === "work") return ACTIVE_STATUS.has(str(rec, "status"));
  if (kind === "turn" && Array.isArray(rec.children)) return rec.children.some(rowActive);
  return false;
}

/**
 * Whether the thread is mid-turn — any work row is still running/pending. Used to
 * mark a trailing assistant message as streaming so its markdown stays unstable
 * until the turn completes.
 */
export function isTimelineActive(rows: readonly unknown[]): boolean {
  return rows.some(rowActive);
}
