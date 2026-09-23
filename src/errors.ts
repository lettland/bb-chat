/**
 * A user-facing error whose message is safe to print verbatim (no stack) as the
 * reason `bbchat` could not proceed. Anything thrown that is NOT a BbchatError is an
 * unexpected internal fault and should surface its stack in verbose mode.
 */
export class BbchatError extends Error {
  /** Optional actionable hint shown on a second line. */
  readonly hint: string | null;

  constructor(message: string, hint: string | null = null) {
    super(message);
    this.name = "BbchatError";
    this.hint = hint;
  }
}

export function isBbchatError(value: unknown): value is BbchatError {
  return value instanceof BbchatError;
}
