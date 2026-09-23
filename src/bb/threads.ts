import type { BBSdk } from "./sdk.ts";

/** Unsubscribe handle returned by the realtime watchers. */
export type Unsubscribe = () => void;

/**
 * List a project's active threads (caller normalizes/sorts for display). Archived
 * threads are excluded server-side, matching the BB app's thread list; the
 * display mapper also drops archived/deleted/hidden rows as a safety net.
 */
export function listThreads(
  sdk: BBSdk,
  projectId: string,
  signal?: AbortSignal,
): Promise<unknown[]> {
  return sdk.threads.list({ projectId, archived: false, signal }) as Promise<unknown[]>;
}

/** Turns fetched per timeline page (the server-side maximum). */
const PAGE_SEGMENT_LIMIT = "100";
/** Safety cap on backward pagination so an enormous thread can't loop unbounded. */
const MAX_PAGES = 100;

interface TimelinePage {
  hasOlderRows?: boolean;
  olderCursor?: { anchorSeq: number; anchorId: string } | null;
}

function pageRows(response: unknown): unknown[] {
  const rows = (response as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows : [];
}

function pageMeta(response: unknown): TimelinePage {
  return ((response as { timelinePage?: TimelinePage }).timelinePage ?? {}) as TimelinePage;
}

function rowId(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const id = (row as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

/**
 * Fetch a thread's FULL rendered timeline by paginating backward through segments
 * (`timelinePage.olderCursor`), newest fetched first then older pages prepended —
 * the same "whole thread" traversal as `bb thread log --all`. De-duplicates rows
 * by id at segment boundaries and stops at MAX_PAGES or when a page adds nothing.
 */
export async function getTimelineRows(
  sdk: BBSdk,
  threadId: string,
  signal?: AbortSignal,
): Promise<unknown[]> {
  const first = await sdk.threads.timeline({ threadId, segmentLimit: PAGE_SEGMENT_LIMIT, signal });
  let rows = pageRows(first);
  const seen = new Set<string>();
  for (const row of rows) {
    const id = rowId(row);
    if (id) seen.add(id);
  }

  let page = pageMeta(first);
  for (let i = 0; i < MAX_PAGES && page.hasOlderRows && page.olderCursor; i++) {
    const cursor = page.olderCursor;
    const older = await sdk.threads.timeline({
      threadId,
      segmentLimit: PAGE_SEGMENT_LIMIT,
      beforeAnchorSeq: String(cursor.anchorSeq),
      beforeAnchorId: cursor.anchorId,
      signal,
    });
    const olderRows = pageRows(older).filter((row) => {
      const id = rowId(row);
      return id === null || !seen.has(id);
    });
    if (olderRows.length === 0) break;
    for (const row of olderRows) {
      const id = rowId(row);
      if (id) seen.add(id);
    }
    rows = [...olderRows, ...rows];
    page = pageMeta(older);
  }
  return rows;
}

/**
 * Send a plain-text message to a thread. `mode: "auto"` dispatches now when the
 * thread is idle and steers/queues appropriately when it is mid-turn — the same
 * default as `bb thread tell --mode auto`.
 */
export function sendText(sdk: BBSdk, threadId: string, text: string): Promise<unknown> {
  return sdk.threads.send({
    threadId,
    mode: "auto",
    input: [{ type: "text", text, mentions: [] }],
  });
}

/** Fetch a thread's environment id (for opening its diff), or null if it has none. */
export async function getThreadEnvironmentId(
  sdk: BBSdk,
  threadId: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const thread = await sdk.threads.get({ threadId, signal });
  const environmentId = (thread as { environmentId?: unknown }).environmentId;
  return typeof environmentId === "string" ? environmentId : null;
}

/** Watch a single thread for changes; `onChange` fires on each update. */
export function watchThread(sdk: BBSdk, threadId: string, onChange: () => void): Unsubscribe {
  return sdk.subscribe({ event: "thread:changed", threadId, callback: () => onChange() });
}

/** Watch a project's thread list for changes. */
export function watchProject(sdk: BBSdk, projectId: string, onChange: () => void): Unsubscribe {
  return sdk.subscribe({ event: "project:changed", projectId, callback: () => onChange() });
}

/** The bits of a thread record the thread view shows in its header and status bar. */
export interface ThreadMeta {
  title: string | null;
  providerId: string | null;
  model: string | null;
  /** Runtime display status (e.g. "active", "idle"), falling back to the stored status. */
  status: string | null;
  branch: string | null;
  /** True while the thread is working a turn — used to keep streaming markdown unstable. */
  busy: boolean;
}

const BUSY_STATUSES = new Set(["active", "starting", "provisioning"]);

function optStr(rec: Record<string, unknown>, key: string): string | null {
  const value = rec[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Map a `threads.get` record into `ThreadMeta`. Structural/defensive (D2). */
export function toThreadMeta(raw: unknown): ThreadMeta {
  const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const runtime =
    rec.runtime && typeof rec.runtime === "object" ? (rec.runtime as Record<string, unknown>) : {};
  const status = optStr(runtime, "displayStatus") ?? optStr(rec, "status");
  return {
    title: optStr(rec, "title") ?? optStr(rec, "titleFallback"),
    providerId: optStr(rec, "providerId"),
    model: optStr(rec, "model"),
    status,
    branch: optStr(rec, "environmentBranchName"),
    busy: status !== null && BUSY_STATUSES.has(status),
  };
}

/** Fetch a thread's header/status-bar metadata. */
export async function getThreadMeta(
  sdk: BBSdk,
  threadId: string,
  signal?: AbortSignal,
): Promise<ThreadMeta> {
  return toThreadMeta(await sdk.threads.get({ threadId, signal }));
}
