/**
 * Maps BB thread-list entries (`ThreadListResponse`) into compact rows for the
 * terminal thread list. Structural/defensive (D2): tolerant of missing fields,
 * newest first, with a title fallback. Archived, deleted and hidden threads are
 * dropped — the BB app doesn't show them in its thread list either.
 */

export interface ThreadRow {
  id: string;
  title: string;
  status: string;
  /** A pending approval/question the user must act on. */
  attention: boolean;
  updatedAt: number;
}

function toRow(entry: unknown): ThreadRow | null {
  if (!entry || typeof entry !== "object") return null;
  const rec = entry as Record<string, unknown>;
  const id = typeof rec.id === "string" ? rec.id : null;
  if (!id) return null;
  if (typeof rec.archivedAt === "number" || typeof rec.deletedAt === "number") return null;
  if (rec.visibility === "hidden") return null;
  const title =
    (typeof rec.title === "string" && rec.title.length > 0 && rec.title) ||
    (typeof rec.titleFallback === "string" && rec.titleFallback.length > 0 && rec.titleFallback) ||
    "(untitled)";
  return {
    id,
    title,
    status: typeof rec.status === "string" ? rec.status : "unknown",
    attention: rec.hasPendingInteraction === true,
    updatedAt: typeof rec.updatedAt === "number" ? rec.updatedAt : 0,
  };
}

/** Normalize + sort thread entries newest-first. */
export function renderThreadList(entries: readonly unknown[]): ThreadRow[] {
  const rows: ThreadRow[] = [];
  for (const entry of entries) {
    const row = toRow(entry);
    if (row) rows.push(row);
  }
  rows.sort((a, b) => b.updatedAt - a.updatedAt);
  return rows;
}

/** One-line display string for a thread row (e.g. `! running   Fix the flaky test`). */
export function formatThreadRow(row: ThreadRow): string {
  const marker = row.attention ? "!" : " ";
  return `${marker} ${row.status.padEnd(10).slice(0, 10)}  ${row.title}`;
}
