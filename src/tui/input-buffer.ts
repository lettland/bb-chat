/**
 * An editable input buffer driven by key events. Pure and testable —
 * it holds no renderer state, just the edited text and how each key mutates it.
 * The composer renders `value`; `handle` reports whether to submit or redraw.
 */

export interface KeyLike {
  name?: string | undefined;
  sequence?: string | undefined;
  ctrl?: boolean | undefined;
  meta?: boolean | undefined;
  shift?: boolean | undefined;
}

export type InputAction =
  | { type: "submit"; value: string }
  | { type: "update"; value: string }
  | { type: "none" };

export class InputBuffer {
  private chars: string[] = [];
  private cursor = 0;

  get value(): string {
    return this.chars.join("");
  }

  clear(): void {
    this.chars = [];
    this.cursor = 0;
  }

  /** Replace the text, e.g. to prefill an edit with the current value. */
  set(value: string): void {
    this.chars = [...value];
    this.cursor = this.chars.length;
  }

  /** Enter submits, Shift+Enter adds a line; the caller clears after delivery. */
  handle(key: KeyLike): InputAction {
    const name = key.name ?? "";

    if (name === "return" || name === "enter") {
      if (key.shift) {
        this.chars.splice(this.cursor, 0, "\n");
        this.cursor++;
        return { type: "update", value: this.value };
      }
      return { type: "submit", value: this.value };
    }
    if (name === "backspace") {
      if (this.cursor > 0) this.chars.splice(--this.cursor, 1);
      return { type: "update", value: this.value };
    }
    if (name === "delete") {
      this.chars.splice(this.cursor, 1);
      return { type: "update", value: this.value };
    }
    if (name === "left") {
      this.cursor = Math.max(0, this.cursor - 1);
      return { type: "update", value: this.value };
    }
    if (name === "right") {
      this.cursor = Math.min(this.chars.length, this.cursor + 1);
      return { type: "update", value: this.value };
    }

    const seq = key.sequence ?? "";
    const chars = [...seq];
    const isText =
      chars.length > 0 &&
      chars.every(
        (char) => char === "\n" || (char.charCodeAt(0) >= 0x20 && char.charCodeAt(0) !== 0x7f),
      );
    if (isText && !key.ctrl && !key.meta) {
      this.chars.splice(this.cursor, 0, ...chars);
      this.cursor += chars.length;
      return { type: "update", value: this.value };
    }

    return { type: "none" };
  }
}
