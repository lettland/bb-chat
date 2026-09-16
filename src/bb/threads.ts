import type { BBSdk } from "./sdk.ts";

/** Unsubscribe handle returned by the realtime watchers. */
export type Unsubscribe = () => void;

/** List a project's threads (newest data; caller normalizes/sorts for display). */
export function listThreads(
  sdk: BBSdk,
  projectId: string,
  signal?: AbortSignal,
): Promise<unknown[]> {
  return sdk.threads.list({ projectId, signal }) as Promise<unknown[]>;
}

/** Fetch a thread's rendered timeline. */
export async function getTimelineRows(
  sdk: BBSdk,
  threadId: string,
  signal?: AbortSignal,
): Promise<unknown[]> {
  const timeline = await sdk.threads.timeline({ threadId, signal });
  const rows = (timeline as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows : [];
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

/** Watch a single thread for changes; `onChange` fires on each update. */
export function watchThread(sdk: BBSdk, threadId: string, onChange: () => void): Unsubscribe {
  return sdk.subscribe({ event: "thread:changed", threadId, callback: () => onChange() });
}

/** Watch a project's thread list for changes. */
export function watchProject(sdk: BBSdk, projectId: string, onChange: () => void): Unsubscribe {
  return sdk.subscribe({ event: "project:changed", projectId, callback: () => onChange() });
}
