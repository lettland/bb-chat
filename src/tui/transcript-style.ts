import { fg, StyledText } from "@opentui/core";
import { toneColor } from "./theme.ts";
import type { LineTone } from "./timeline-render.ts";

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
