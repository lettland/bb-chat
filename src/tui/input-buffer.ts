/**
 * A minimal single-line input buffer driven by key events. Pure and testable —
 * it holds no renderer state, just the edited text and how each key mutates it.
 * The composer renders `value`; `handle` reports whether to submit or redraw.
 */

export interface KeyLike {
  name?: string | undefined;
  sequence?: string | undefined;
  ctrl?: boolean | undefined;
  meta?: boolean | undefined;
}

export type InputAction =
  | { type: "submit"; value: string }
  | { type: "update"; value: string }
  | { type: "none" };

export class InputBuffer {
  private chars: string[] = [];

  get value(): string {
    return this.chars.join("");
  }

  clear(): void {
    this.chars = [];
  }

  /** Replace the text, e.g. to prefill an edit with the current value. */
  set(value: string): void {
    this.chars = [...value];
  }

  /** Apply a key: Enter submits (and clears), Backspace deletes, printable chars append. */
  handle(key: KeyLike): InputAction {
    const name = key.name ?? "";

    if (name === "return" || name === "enter") {
      const value = this.value;
      this.chars = [];
      return { type: "submit", value };
    }
    if (name === "backspace") {
      this.chars.pop();
      return { type: "update", value: this.value };
    }

    const seq = key.sequence ?? "";
    const isPrintable = seq.length === 1 && seq.charCodeAt(0) >= 0x20 && seq.charCodeAt(0) !== 0x7f;
    if (isPrintable && !key.ctrl && !key.meta) {
      this.chars.push(seq);
      return { type: "update", value: this.value };
    }

    return { type: "none" };
  }
}
