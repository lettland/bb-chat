import { describe, expect, test } from "bun:test";
import { InputBuffer } from "../src/tui/input-buffer.ts";

describe("InputBuffer", () => {
  test("appends printable characters", () => {
    const buf = new InputBuffer();
    expect(buf.handle({ name: "h", sequence: "h" })).toEqual({ type: "update", value: "h" });
    buf.handle({ name: "i", sequence: "i" });
    expect(buf.value).toBe("hi");
  });

  test("appends a space", () => {
    const buf = new InputBuffer();
    buf.handle({ name: "a", sequence: "a" });
    buf.handle({ name: "space", sequence: " " });
    buf.handle({ name: "b", sequence: "b" });
    expect(buf.value).toBe("a b");
  });

  test("backspace removes the last character", () => {
    const buf = new InputBuffer();
    buf.handle({ name: "a", sequence: "a" });
    buf.handle({ name: "b", sequence: "b" });
    expect(buf.handle({ name: "backspace" })).toEqual({ type: "update", value: "a" });
  });

  test("enter submits and clears", () => {
    const buf = new InputBuffer();
    buf.handle({ name: "h", sequence: "h" });
    buf.handle({ name: "i", sequence: "i" });
    expect(buf.handle({ name: "return" })).toEqual({ type: "submit", value: "hi" });
    expect(buf.value).toBe("");
  });

  test("ignores control/meta chords and non-printables", () => {
    const buf = new InputBuffer();
    expect(buf.handle({ name: "c", sequence: "c", ctrl: true })).toEqual({ type: "none" });
    expect(buf.handle({ name: "left" })).toEqual({ type: "none" });
    expect(buf.value).toBe("");
  });
});
