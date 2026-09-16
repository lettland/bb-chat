/**
 * Renders a BB thread timeline (`ThreadTimelineResponse.rows`) into flat display
 * lines for the terminal. Deliberately structural/defensive rather than typed to
 * the full timeline union: `vch` consumes the published SDK's normalized rows and
 * tolerates unknown work kinds gracefully (D2 — no dependency on @bb/thread-view).
 */

export type LineTone = "user" | "assistant" | "work" | "system" | "attention" | "meta";

export interface DisplayLine {
  text: string;
  tone: LineTone;
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
    case "work": {
      const workKind = str(rec, "workKind");
      const attention = ATTENTION_WORK_KINDS.has(workKind);
      const glyph = attention ? "!" : statusGlyph(str(rec, "status"));
      // Indent activity so it reads as nested under the assistant's message.
      out.push({
        text: `  ${glyph} ${workTitle(rec, workKind)}`,
        tone: attention ? "attention" : "work",
      });
      return;
    }
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

/** Flatten timeline rows (recursing into turns) into display lines. */
export function renderTimelineRows(
  rows: readonly unknown[],
  opts: { ruleWidth?: number } = {},
): DisplayLine[] {
  const ctx: RenderContext = {
    ruleWidth: Math.max(8, Math.min(opts.ruleWidth ?? DEFAULT_RULE_WIDTH, 200)),
  };
  const out: DisplayLine[] = [];
  for (const row of rows) renderRow(row, out, ctx);
  return out;
}

/** Convenience: the rendered timeline as plain text. */
export function renderTimelineText(rows: readonly unknown[]): string {
  return renderTimelineRows(rows)
    .map((line) => line.text)
    .join("\n");
}

/**
 * Terminal color (hex) per line tone, so the reader can tell apart their own
 * messages (user), the assistant, tool/command activity, and system notes.
 */
export function toneColor(tone: LineTone): string {
  switch (tone) {
    case "user":
      return "#4EC9B0"; // teal — you (the human)
    case "assistant":
      return "#E6E6E6"; // near-white — the assistant
    case "work":
      return "#7A8290"; // gray — tools / commands
    case "attention":
      return "#E5C07B"; // amber — approvals / questions
    case "system":
      return "#6A737D"; // dim — system notes
    case "meta":
      return "#4B5263"; // dimmest — separators / meta
  }
}
