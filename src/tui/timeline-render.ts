/**
 * Renders a BB thread timeline (`ThreadTimelineResponse.rows`) into flat display
 * lines for the terminal. Deliberately structural/defensive rather than typed to
 * the full timeline union: `vch` consumes the published SDK's normalized rows and
 * tolerates unknown work kinds gracefully (D2 — no dependency on @bb/thread-view).
 */

/**
 * Semantic role of a rendered line, mapped to a distinct color by `toneColor`:
 * your input, the assistant's prose, a tool/command call, a subagent ("agent")
 * invocation, a file edit, tool output (the response), something needing your
 * attention (question/approval), an error, a system note, or dim meta/separators.
 */
export type LineTone =
  | "user"
  | "assistant"
  | "toolcall"
  | "agent"
  | "edit"
  | "output"
  | "attention"
  | "error"
  | "system"
  | "meta";

export interface DisplayLine {
  text: string;
  tone: LineTone;
}

/** A selectable/expandable tool row and the line index of its call in the transcript. */
export interface ToolAnchor {
  id: string;
  line: number;
}

/** The rendered transcript: display lines plus the expandable tool anchors within. */
export interface Transcript {
  lines: DisplayLine[];
  anchors: ToolAnchor[];
}

export interface RenderOptions {
  /** Width of the exchange-separating rule (columns). */
  ruleWidth?: number;
  /** Ids of tool rows whose full output should be shown instead of a preview. */
  expanded?: ReadonlySet<string>;
  /** Id of the tool row under the selection cursor (marked with "❯"). */
  selectedId?: string | null;
  /** Cap on output lines shown when a tool is expanded. */
  maxOutputLines?: number;
}

function str(rec: Record<string, unknown>, key: string): string {
  const value = rec[key];
  return typeof value === "string" ? value : "";
}

function firstNonEmpty(rec: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = str(rec, key);
    if (value.length > 0) return value;
  }
  return "";
}

/** Left gutter marker on a message's role header, e.g. "▌ you". */
const GUTTER = "▌";

/** Push each physical line of `text`, optionally indented, under one tone. */
function pushLines(out: DisplayLine[], text: string, tone: LineTone, indent = ""): void {
  for (const line of text.split("\n")) out.push({ text: `${indent}${line}`.trimEnd(), tone });
}

function statusGlyph(status: string): string {
  switch (status) {
    case "running":
    case "in_progress":
    case "pending":
      return "…";
    case "error":
    case "failed":
    case "denied":
      return "✗";
    case "success":
    case "done":
    case "completed":
    case "approved":
      return "✓";
    default:
      return "•";
  }
}

const ATTENTION_WORK_KINDS = new Set(["approval", "question"]);
const ERROR_STATUS = new Set(["error", "failed", "denied", "cancelled"]);

/** Work kinds whose call line gets a non-default tone (else "toolcall"). */
const WORK_TONE: Record<string, LineTone> = {
  "file-change": "edit",
  delegation: "agent",
  workflow: "agent",
  approval: "attention",
  question: "attention",
};

const PREVIEW_CAP = 120;
const DEFAULT_MAX_OUTPUT = 200;
const EMPTY_SET: ReadonlySet<string> = new Set();

/** Stable id for a work row (for expand tracking / selection). */
function workId(rec: Record<string, unknown>): string {
  return str(rec, "id") || str(rec, "callId");
}

/** A work row's output split into lines, with surrounding blank lines trimmed. */
function outputBody(rec: Record<string, unknown>): string[] {
  const lines = str(rec, "output")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""));
  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function workTitle(rec: Record<string, unknown>, workKind: string): string {
  switch (workKind) {
    case "command":
      return `$ ${firstNonEmpty(rec, ["command", "commandLine", "displayCommand"]) || "command"}`;
    case "tool":
      return `tool ${firstNonEmpty(rec, ["toolName", "name"]) || "call"}`;
    case "file-change":
      return `edit ${firstNonEmpty(rec, ["path", "movePath"]) || "file"}`;
    case "file-read":
      return `read ${firstNonEmpty(rec, ["path"]) || "file"}`;
    case "search":
      return `search ${firstNonEmpty(rec, ["query", "pattern"])}`.trimEnd();
    case "web-search":
      return `web search ${firstNonEmpty(rec, ["query"])}`.trimEnd();
    case "web-fetch":
      return `web fetch ${firstNonEmpty(rec, ["url"])}`.trimEnd();
    case "approval":
      return `approval needed: ${firstNonEmpty(rec, ["title", "description", "toolName"])}`.trimEnd();
    case "question":
      return `question: ${firstNonEmpty(rec, ["question", "prompt", "text"])}`.trimEnd();
    case "delegation":
      return `delegate ${firstNonEmpty(rec, ["description", "name"])}`.trimEnd();
    case "workflow":
      return `workflow ${firstNonEmpty(rec, ["workflowName", "description"])}`.trimEnd();
    case "plan-steps":
      return "plan updated";
    default:
      return `${workKind || "work"} ${firstNonEmpty(rec, ["name", "description", "title"])}`.trimEnd();
  }
}

interface RenderContext {
  /** Width (columns) of the horizontal rule drawn between exchanges. */
  ruleWidth: number;
  expanded: ReadonlySet<string>;
  selectedId: string | null;
  maxOutputLines: number;
  anchors: ToolAnchor[];
}

/**
 * A tool/command/edit row: an indented call line (glyph + title), then its output
 * as either a one-line preview with a "▸ +N lines" affordance (collapsed) or the
 * full body (expanded). The call carries the selection cursor ("❯") and its tone
 * encodes the category (call/edit/agent/attention) or "error" when it failed.
 */
function renderWork(rec: Record<string, unknown>, out: DisplayLine[], ctx: RenderContext): void {
  const workKind = str(rec, "workKind");
  const status = str(rec, "status");
  const errored = ERROR_STATUS.has(status);
  const attention = ATTENTION_WORK_KINDS.has(workKind);
  const glyph = attention ? "!" : statusGlyph(status);
  const tone: LineTone = errored ? "error" : (WORK_TONE[workKind] ?? "toolcall");

  const id = workId(rec);
  const body = outputBody(rec);
  const expandable = body.length > 0 && (body.length > 1 || (body[0]?.length ?? 0) > PREVIEW_CAP);
  const expanded = id.length > 0 && ctx.expanded.has(id);
  const selected = ctx.selectedId != null && id === ctx.selectedId;

  if (id.length > 0 && expandable) ctx.anchors.push({ id, line: out.length });

  const marker = selected ? "❯" : " ";
  const affordance = expandable ? (expanded ? "  ▾" : `  ▸ +${body.length} lines`) : "";
  out.push({ text: `${marker} ${glyph} ${workTitle(rec, workKind)}${affordance}`.trimEnd(), tone });

  if (body.length > 0) renderWorkOutput(body, expanded, errored, ctx.maxOutputLines, out);
}

/** Output under a work call: the full body when expanded, else a one-line preview. */
function renderWorkOutput(
  body: string[],
  expanded: boolean,
  errored: boolean,
  maxOutputLines: number,
  out: DisplayLine[],
): void {
  const tone: LineTone = errored ? "error" : "output";
  if (!expanded) {
    const first = body.find((l) => l.trim().length > 0) ?? "";
    const preview = first.length > PREVIEW_CAP ? `${first.slice(0, PREVIEW_CAP - 1)}…` : first;
    if (preview.length > 0) out.push({ text: `      ${preview}`, tone });
    return;
  }
  const shown = body.slice(0, maxOutputLines);
  for (const line of shown) out.push({ text: `      ${line}`.replace(/\s+$/, ""), tone });
  if (body.length > shown.length) {
    out.push({ text: `      … +${body.length - shown.length} more lines`, tone: "meta" });
  }
}

/**
 * A conversation message: a role header ("▌ you" / "▌ assistant") over the body.
 * Successive exchanges are separated by a horizontal rule before each user
 * message; within an exchange, a blank line precedes the assistant reply.
 */
function renderConversation(
  rec: Record<string, unknown>,
  out: DisplayLine[],
  ctx: RenderContext,
): void {
  const isAssistant = rec.role === "assistant";
  if (out.length > 0) {
    if (!isAssistant)
      out.push({ text: "", tone: "meta" }, { text: "─".repeat(ctx.ruleWidth), tone: "meta" });
    out.push({ text: "", tone: "meta" });
  }
  const tone: LineTone = isAssistant ? "assistant" : "user";
  out.push({ text: `${GUTTER} ${isAssistant ? "assistant" : "you"}`, tone });
  pushLines(out, str(rec, "text"), tone);
}

function renderRow(row: unknown, out: DisplayLine[], ctx: RenderContext): void {
  if (!row || typeof row !== "object") return;
  const rec = row as Record<string, unknown>;
  switch (str(rec, "kind")) {
    case "conversation":
      renderConversation(rec, out, ctx);
      return;
    case "work":
      renderWork(rec, out, ctx);
      return;
    case "system": {
      const text = firstNonEmpty(rec, ["text", "message"]);
      if (text) pushLines(out, text, "system", "  ");
      return;
    }
    case "turn": {
      const children = rec.children;
      if (Array.isArray(children)) for (const child of children) renderRow(child, out, ctx);
      return;
    }
    default:
      return;
  }
}

/** How wide to draw exchange-separating rules when the caller gives no width. */
const DEFAULT_RULE_WIDTH = 48;

/**
 * Flatten timeline rows (recursing into turns) into a transcript: display lines
 * plus the expandable tool anchors, honoring the expand/selection options.
 */
export function renderTranscript(rows: readonly unknown[], opts: RenderOptions = {}): Transcript {
  const ctx: RenderContext = {
    ruleWidth: Math.max(8, Math.min(opts.ruleWidth ?? DEFAULT_RULE_WIDTH, 200)),
    expanded: opts.expanded ?? EMPTY_SET,
    selectedId: opts.selectedId ?? null,
    maxOutputLines: Math.max(1, opts.maxOutputLines ?? DEFAULT_MAX_OUTPUT),
    anchors: [],
  };
  const out: DisplayLine[] = [];
  for (const row of rows) renderRow(row, out, ctx);
  return { lines: out, anchors: ctx.anchors };
}

/** Flatten timeline rows into display lines (convenience over `renderTranscript`). */
export function renderTimelineRows(
  rows: readonly unknown[],
  opts: RenderOptions = {},
): DisplayLine[] {
  return renderTranscript(rows, opts).lines;
}

/** Convenience: the rendered timeline as plain text. */
export function renderTimelineText(rows: readonly unknown[]): string {
  return renderTimelineRows(rows)
    .map((line) => line.text)
    .join("\n");
}

/**
 * Terminal color (hex) per line tone, so the reader can tell apart, at a glance,
 * their own input, the assistant, tool calls, subagents, edits, tool output,
 * things needing attention, and errors.
 */
const TONE_COLOR: Record<LineTone, string> = {
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
};

export function toneColor(tone: LineTone): string {
  return TONE_COLOR[tone];
}
