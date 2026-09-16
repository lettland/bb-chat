import { describe, expect, test } from "bun:test";
import { decodeTerminalOutput, stripAnsi, toTerminalRows } from "../src/tui/terminal-render.ts";

// Build escapes from char codes so the test source carries no literal control
// characters (which Biome would otherwise normalize).
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64");

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
  test("removes SGR color codes and carriage returns", () => {
    expect(stripAnsi(`${ESC}[31mred${ESC}[0m\r\ndone`)).toBe("red\ndone");
  });

  test("preserves UPPERCASE visible text through escapes (regression guard)", () => {
    // The C1 two-char class must not swallow the letters of visible text.
    expect(stripAnsi(`${ESC}[32mBUILD PASSED${ESC}[0m`)).toBe("BUILD PASSED");
    expect(stripAnsi(`${ESC}[2J${ESC}[HTOP${ESC}[Kline`)).toBe("TOPline");
  });

  test("strips OSC sequences terminated by BEL, keeping following text", () => {
    // Regression: ESC ] must be handled by the OSC alternation, not swallowed as
    // a C1 two-char escape (which left the OSC payload + BEL in the output).
    expect(stripAnsi(`${ESC}]0;window title${BEL}VISIBLE TEXT`)).toBe("VISIBLE TEXT");
  });

  test("strips OSC terminated by ST (ESC backslash)", () => {
    expect(stripAnsi(`${ESC}]8;;https://x${ESC}\\link`)).toBe("link");
  });

  test("leaves a bare ] in normal text untouched", () => {
    expect(stripAnsi("array[0] = VALUE; list]done")).toBe("array[0] = VALUE; list]done");
  });
});

describe("decodeTerminalOutput", () => {
  test("decodes base64 chunks, strips ansi, preserves case", () => {
    const out = decodeTerminalOutput({
      chunks: [
        { seq: 0, dataBase64: b64(`${ESC}[32mHELLO${ESC}[0m `) },
        { seq: 1, dataBase64: b64(`World${ESC}]0;t${BEL}\r\n`) },
      ],
    });
    expect(out).toBe("HELLO World\n");
  });

  test("non-object input yields empty string", () => {
    expect(decodeTerminalOutput(null)).toBe("");
    expect(decodeTerminalOutput({ chunks: "nope" })).toBe("");
  });
});
