import { fg, StyledText } from "@opentui/core";
import { type DisplayLine, type LineTone, toneColor } from "./timeline-render.ts";

/** Render transcript display lines into a colored StyledText (one line per row). */
export function styledTranscript(lines: DisplayLine[]): StyledText {
  const rows: DisplayLine[] =
    lines.length > 0 ? lines : [{ text: "(no messages yet)", tone: "meta" }];
  return new StyledText(
    rows.map((line) => fg(toneColor(line.tone))(`${line.text.length > 0 ? line.text : " "}\n`)),
  );
}

/** A colored legend of the transcript's tones plus the expand keys, for the status line. */
export function helpLegend(): StyledText {
  const swatch = (tone: LineTone, label: string) => fg(toneColor(tone))(`${label}  `);
  return new StyledText([
    swatch("user", "you"),
    swatch("assistant", "assistant"),
    swatch("toolcall", "tool"),
    swatch("output", "output"),
    swatch("edit", "edit"),
    swatch("agent", "agent"),
    swatch("attention", "question"),
    swatch("error", "error"),
    fg(toneColor("meta"))("· Tab select tool · Ctrl+E expand · /diff /terminals · esc back"),
  ]);
}
