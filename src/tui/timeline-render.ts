/**
 * Shared, pure helpers for interpreting a BB thread timeline row: line tone, work
 * classification, titles, and output extraction. Deliberately structural/defensive
 * (D2) — tolerant of unknown work kinds and missing fields — and free of any
 * `@opentui/core` dependency. Consumed by `timeline-model.ts` (the block model)
 * and the styling layer.
 *
 * (The former flat `DisplayLine[]` renderer lived here; it was replaced by the
 * block model in `timeline-model.ts` and removed.)
 */

/**
 * Semantic role of a rendered line, mapped to a distinct color by `theme.toneColor`:
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

export function str(rec: Record<string, unknown>, key: string): string {
  const value = rec[key];
  return typeof value === "string" ? value : "";
}

export function firstNonEmpty(rec: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = str(rec, key);
    if (value.length > 0) return value;
  }
  return "";
}

export function statusGlyph(status: string): string {
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

export const ATTENTION_WORK_KINDS = new Set(["approval", "question"]);
export const ERROR_STATUS = new Set(["error", "failed", "denied", "cancelled"]);

/** Work kinds whose call line gets a non-default tone (else "toolcall"). */
export const WORK_TONE: Record<string, LineTone> = {
  "file-change": "edit",
  delegation: "agent",
  workflow: "agent",
  approval: "attention",
  question: "attention",
};

/** Max characters of a tool-output preview shown before a row is expanded. */
export const PREVIEW_CAP = 120;

/** Stable id for a work row (for expand tracking / selection). */
export function workId(rec: Record<string, unknown>): string {
  return str(rec, "id") || str(rec, "callId");
}

/** A work row's output split into lines, with surrounding blank lines trimmed. */
export function outputBody(rec: Record<string, unknown>): string[] {
  const lines = str(rec, "output")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""));
  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function workTitle(rec: Record<string, unknown>, workKind: string): string {
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
