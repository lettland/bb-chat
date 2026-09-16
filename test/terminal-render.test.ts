import { describe, expect, test } from "bun:test";
import { decodeTerminalOutput, stripAnsi, toTerminalRows } from "../src/tui/terminal-render.ts";

describe("toTerminalRows", () => {
  test("maps sessions with title/status fallbacks", () => {
    const rows = toTerminalRows({
      sessions: [{ id: "t1", title: "build", status: "running" }, { id: "t2" }, { title: "no id" }],
    });
    expect(rows).toEqual([
      { id: "t1", title: "build", status: "running" },
      { id: "t2", title: "t2", status: "unknown" },
    ]);
  });

  test("non-list input yields empty", () => {
    expect(toTerminalRows(null)).toEqual([]);
    expect(toTerminalRows({})).toEqual([]);
  });
});

describe("stripAnsi", () => {
  test("removes color codes and carriage returns", () => {
    expect(stripAnsi("[31mred[0m\r\ndone")).toBe("red\ndone");
  });
});

describe("decodeTerminalOutput", () => {
  test("decodes base64 chunks and strips ansi", () => {
    const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64");
    const out = decodeTerminalOutput({
      chunks: [
        { seq: 0, dataBase64: b64("[32mhello[0m ") },
        { seq: 1, dataBase64: b64("world\r\n") },
      ],
    });
    expect(out).toBe("hello world\n");
  });

  test("non-object input yields empty string", () => {
    expect(decodeTerminalOutput(null)).toBe("");
    expect(decodeTerminalOutput({ chunks: "nope" })).toBe("");
  });
});
