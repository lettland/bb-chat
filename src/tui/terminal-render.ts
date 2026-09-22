/**
 * Renders BB terminal data for the terminal view: the session list and decoded
 * output. Terminal output arrives as base64 chunks with ANSI escapes; we decode
 * and strip escapes to plain text (a full ANSI-aware pane is a later pass).
 * Structural/defensive (D2).
 */

import { sanitizeText, stripAnsi } from "./sanitize.ts";

export { stripAnsi };

export interface TerminalRow {
  id: string;
  title: string;
  status: string;
}

function str(rec: Record<string, unknown>, key: string): string {
  const value = rec[key];
  return typeof value === "string" ? value : "";
}

/** Extract selectable terminal rows from a `terminals.list` response. */
export function toTerminalRows(response: unknown): TerminalRow[] {
  if (!response || typeof response !== "object") return [];
  const sessions = (response as { sessions?: unknown }).sessions;
  if (!Array.isArray(sessions)) return [];
  const rows: TerminalRow[] = [];
  for (const session of sessions) {
    if (!session || typeof session !== "object") continue;
    const rec = session as Record<string, unknown>;
    const id = str(rec, "id");
    if (!id) continue;
    rows.push({
      id,
      title: str(rec, "title") || id,
      status: str(rec, "status") || "unknown",
    });
  }
  return rows;
}

/** Decode a `terminals.output` response (base64 chunks) into stripped plain text. */
export function decodeTerminalOutput(response: unknown): string {
  if (!response || typeof response !== "object") return "";
  const chunks = (response as { chunks?: unknown }).chunks;
  if (!Array.isArray(chunks)) return "";
  const parts: string[] = [];
  for (const chunk of chunks) {
    if (!chunk || typeof chunk !== "object") continue;
    const b64 = (chunk as { dataBase64?: unknown }).dataBase64;
    if (typeof b64 === "string") parts.push(Buffer.from(b64, "base64").toString("utf8"));
  }
  // Full sanitize (not just stripAnsi): terminal output can contain unterminated
  // OSC and residual control bytes that the ANSI pass alone would leave behind.
  return sanitizeText(parts.join(""));
}
