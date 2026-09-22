import { describe, expect, test } from "bun:test";
import { sanitizeText, stripAnsi } from "../src/tui/sanitize.ts";

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

describe("stripAnsi", () => {
  test("removes CSI color codes and carriage returns", () => {
    expect(stripAnsi(`${ESC}[31mred${ESC}[0m\r\ndone`)).toBe("red\ndone");
  });
  test("removes OSC sequences (title / hyperlink)", () => {
    expect(stripAnsi(`${ESC}]0;evil title${BEL}VISIBLE`)).toBe("VISIBLE");
    expect(stripAnsi(`${ESC}]8;;https://x${ESC}\\link`)).toBe("link");
  });
  test("leaves bracket text that is not an escape", () => {
    expect(stripAnsi("array[0] = x; list]done")).toBe("array[0] = x; list]done");
  });
});

describe("sanitizeText", () => {
  test("strips ANSI and residual control bytes but keeps tabs and newlines", () => {
    const input = `a${ESC}[31mb${String.fromCharCode(0x07)}c\td\ne`;
    expect(sanitizeText(input)).toBe("abc\td\ne");
  });
  test("removes an OSC-52 clipboard-write attempt", () => {
    const osc52 = `${ESC}]52;c;ZXZpbA==${BEL}safe`;
    expect(sanitizeText(osc52)).toBe("safe");
  });
  test("removes lone DEL and C1 bytes", () => {
    expect(sanitizeText(`x${String.fromCharCode(0x7f)}y${String.fromCharCode(0x9b)}z`)).toBe("xyz");
  });
  test("passes clean text through unchanged", () => {
    expect(sanitizeText("const x = 1;\n// ok\n")).toBe("const x = 1;\n// ok\n");
  });
});
