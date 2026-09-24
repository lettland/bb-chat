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

  test("set replaces the text, which then edits like typed input", () => {
    const buf = new InputBuffer();
    buf.set("work");
    buf.handle({ name: "backspace" });
    expect(buf.handle({ name: "s", sequence: "s" })).toEqual({ type: "update", value: "wors" });
  });

  test("backspace removes the last character", () => {
    const buf = new InputBuffer();
    buf.handle({ name: "a", sequence: "a" });
    buf.handle({ name: "b", sequence: "b" });
    expect(buf.handle({ name: "backspace" })).toEqual({ type: "update", value: "a" });
  });

  test("enter submits and retains the draft until delivery succeeds", () => {
    const buf = new InputBuffer();
    buf.handle({ name: "h", sequence: "h" });
    buf.handle({ name: "i", sequence: "i" });
    expect(buf.handle({ name: "return" })).toEqual({ type: "submit", value: "hi" });
    expect(buf.value).toBe("hi");
  });

  test("ignores control/meta chords", () => {
    const buf = new InputBuffer();
    expect(buf.handle({ name: "c", sequence: "c", ctrl: true })).toEqual({ type: "none" });
    expect(buf.value).toBe("");
  });

  test("edits across lines with a movable cursor", () => {
    const buf = new InputBuffer();
    buf.set("ab");
    buf.handle({ name: "left" });
    buf.handle({ name: "return", shift: true });
    expect(buf.value).toBe("a\nb");
    buf.handle({ name: "right" });
    buf.handle({ name: "backspace" });
    expect(buf.value).toBe("a\n");
    expect(buf.handle({ name: "return" })).toEqual({ type: "submit", value: "a\n" });
  });

  test("accepts pasted text without terminal control sequences", () => {
    const buf = new InputBuffer();
    buf.handle({ name: "paste", sequence: "first\nsecond" });
    expect(buf.value).toBe("first\nsecond");
    expect(buf.handle({ name: "up", sequence: "\u001b[A" })).toEqual({ type: "none" });
    expect(buf.handle({ name: "paste", sequence: "\u009b2J" })).toEqual({ type: "none" });
    expect(buf.value).toBe("first\nsecond");
  });

  test("clear empties the buffer", () => {
    const buf = new InputBuffer();
    buf.handle({ name: "x", sequence: "x" });
    buf.clear();
    expect(buf.value).toBe("");
  });
});
