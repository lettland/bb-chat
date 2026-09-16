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

/** Push each physical line of `text`, prefixing the first with `label`. */
function pushText(out: DisplayLine[], label: string, text: string, tone: LineTone): void {
  const lines = text.split("\n");
  const [head = "", ...tail] = lines;
  out.push({ text: label ? `${label} ${head}`.trimEnd() : head, tone });
  const indent = label ? " ".repeat(label.length + 1) : "";
  for (const line of tail) out.push({ text: `${indent}${line}`.trimEnd(), tone });
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

function renderRow(row: unknown, out: DisplayLine[]): void {
  if (!row || typeof row !== "object") return;
  const rec = row as Record<string, unknown>;
  switch (str(rec, "kind")) {
    case "conversation": {
      const isAssistant = rec.role === "assistant";
      pushText(
        out,
        isAssistant ? "assistant:" : "you:",
        str(rec, "text"),
        isAssistant ? "assistant" : "user",
      );
      return;
    }
    case "work": {
      const workKind = str(rec, "workKind");
      const attention = ATTENTION_WORK_KINDS.has(workKind);
      const glyph = attention ? "!" : statusGlyph(str(rec, "status"));
      out.push({
        text: `${glyph} ${workTitle(rec, workKind)}`,
        tone: attention ? "attention" : "work",
      });
      return;
    }
    case "system": {
      const text = firstNonEmpty(rec, ["text", "message"]);
      if (text) pushText(out, "", text, "system");
      return;
    }
    case "turn": {
      const children = rec.children;
      if (Array.isArray(children)) for (const child of children) renderRow(child, out);
      return;
    }
    default:
      return;
  }
}

/** Flatten timeline rows (recursing into turns) into display lines. */
export function renderTimelineRows(rows: readonly unknown[]): DisplayLine[] {
  const out: DisplayLine[] = [];
  for (const row of rows) renderRow(row, out);
  return out;
}

/** Convenience: the rendered timeline as plain text. */
export function renderTimelineText(rows: readonly unknown[]): string {
  return renderTimelineRows(rows)
    .map((line) => line.text)
    .join("\n");
}
