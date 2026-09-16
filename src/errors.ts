/**
 * A user-facing error whose message is safe to print verbatim (no stack) as the
 * reason `vch` could not proceed. Anything thrown that is NOT a VchError is an
 * unexpected internal fault and should surface its stack in verbose mode.
 */
export class VchError extends Error {
  /** Optional actionable hint shown on a second line. */
  readonly hint: string | null;

  constructor(message: string, hint: string | null = null) {
    super(message);
    this.name = "VchError";
    this.hint = hint;
  }
}

export function isVchError(value: unknown): value is VchError {
  return value instanceof VchError;
}
