import { describe, expect, test } from "bun:test";
import { hasUnsafeLink, isAllowedLinkTarget } from "../src/tui/markdown-safety.ts";

describe("isAllowedLinkTarget", () => {
  test("allows http(s), mailto and scheme-less targets", () => {
    expect(isAllowedLinkTarget("https://example.com")).toBe(true);
    expect(isAllowedLinkTarget("HTTP://example.com")).toBe(true);
    expect(isAllowedLinkTarget("mailto:a@b.c")).toBe(true);
    expect(isAllowedLinkTarget("src/tui/theme.ts")).toBe(true);
    expect(isAllowedLinkTarget("#section")).toBe(true);
    expect(isAllowedLinkTarget("10:30")).toBe(true);
  });

  test("rejects every other scheme, including obfuscated ones", () => {
    expect(isAllowedLinkTarget("javascript:alert(1)")).toBe(false);
    expect(isAllowedLinkTarget("JaVaScRiPt:alert(1)")).toBe(false);
    expect(isAllowedLinkTarget("file:///etc/passwd")).toBe(false);
    expect(isAllowedLinkTarget("vscode://open")).toBe(false);
    expect(isAllowedLinkTarget("java\tscript:x")).toBe(false);
    expect(isAllowedLinkTarget("java&#115;cript:x")).toBe(false);
    expect(isAllowedLinkTarget("%6aavascript:x")).toBe(false);
  });
});

describe("hasUnsafeLink", () => {
  test("ordinary safe markdown is not flagged", () => {
    expect(hasUnsafeLink("See [docs](https://example.com) and [a file](src/a.ts).")).toBe(false);
    expect(hasUnsafeLink("mail <mailto:a@b.c> or <https://x.dev>, a < b: c")).toBe(false);
    expect(hasUnsafeLink('[ref][d]\n\n[d]: https://example.com "Title: x"')).toBe(false);
    expect(hasUnsafeLink('[t](foo "title: with colon")')).toBe(false);
    expect(hasUnsafeLink("plain prose with a time 10:30 and a list:\n- item")).toBe(false);
  });

  test("flags inline links, images, autolinks and reference definitions", () => {
    expect(hasUnsafeLink("click [here](javascript:alert(1))")).toBe(true);
    expect(hasUnsafeLink("![logo](data:image/png;base64,xx)")).toBe(true);
    expect(hasUnsafeLink("go to <file:///tmp/x>")).toBe(true);
    expect(hasUnsafeLink("[docs][d]\n\n[d]: javascript:evil()")).toBe(true);
  });

  test("reviewer bypasses: nested parens, multi-line labels, bracketed targets", () => {
    expect(hasUnsafeLink("[click here](javascript:eval(atob(1)))")).toBe(true);
    expect(hasUnsafeLink("[x](a(b(c)))then [y](file:///z)")).toBe(true);
    expect(hasUnsafeLink("click\nhere](javascript:evil())")).toBe(true);
    expect(hasUnsafeLink("[a [b] c](javascript:x)")).toBe(true);
    expect(hasUnsafeLink("[click](<java\tscript:evil()>)")).toBe(true);
    expect(hasUnsafeLink("[click](\njavascript:evil())")).toBe(true);
    expect(hasUnsafeLink("[e](java&#115;cript:x)")).toBe(true);
    expect(hasUnsafeLink("[p](%6aavascript:x)")).toBe(true);
  });

  test("fails closed inside code too (costs only formatting)", () => {
    expect(hasUnsafeLink("```md\n[x](javascript:alert(1))\n```")).toBe(true);
  });
});
