import type { BBSdk } from "./sdk.ts";

/** List the terminal sessions for a thread. */
export function listThreadTerminals(
  sdk: BBSdk,
  threadId: string,
  signal?: AbortSignal,
): Promise<unknown> {
  return sdk.terminals.list({ scope: { kind: "thread", threadId }, signal });
}

/** Fetch a terminal's recent output (tail-bounded). */
export function getTerminalOutput(
  sdk: BBSdk,
  terminalId: string,
  tailBytes = 65_536,
  signal?: AbortSignal,
): Promise<unknown> {
  return sdk.terminals.output({ terminalId, tailBytes, signal });
}
