/**
 * Maps BB project entries into rows for the global home. Structural/defensive
 * (D2), sorted by name.
 *
 * Thread counts are intentionally omitted: a project response's embedded threads
 * are a capped preview, and `threads.count` applies different filters than the
 * `threads.list` the thread-list view shows — so any count here would disagree
 * with what the user sees on opening the project. Names only until a count that
 * matches the list's semantics is available.
 */

export interface ProjectRow {
  id: string;
  name: string;
}

function toRow(entry: unknown): ProjectRow | null {
  if (!entry || typeof entry !== "object") return null;
  const rec = entry as Record<string, unknown>;
  const id = typeof rec.id === "string" ? rec.id : null;
  if (!id) return null;
  return {
    id,
    name: typeof rec.name === "string" && rec.name.length > 0 ? rec.name : "(unnamed)",
  };
}

/** Normalize + sort project entries by name. */
export function toProjectRows(entries: readonly unknown[]): ProjectRow[] {
  const rows: ProjectRow[] = [];
  for (const entry of entries) {
    const row = toRow(entry);
    if (row) rows.push(row);
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}
