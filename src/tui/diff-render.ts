/**
 * Renders an environment diff (`environments.diffFiles` response) into toned
 * lines: a file summary (change kind, path, +/-) followed by the eagerly-loaded
 * unified patches. Structural/defensive (D2) — tolerant of the outcome union and
 * missing fields.
 */

export type DiffTone = "meta" | "add" | "del" | "hunk" | "file" | "context";

export interface DiffLine {
  text: string;
  tone: DiffTone;
}

function str(rec: Record<string, unknown>, key: string): string {
  const value = rec[key];
  return typeof value === "string" ? value : "";
}

function num(rec: Record<string, unknown>, key: string): number {
  const value = rec[key];
  return typeof value === "number" ? value : 0;
}

function changeGlyph(changeKind: string): string {
  switch (changeKind) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "modified":
      return "M";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "type_changed":
      return "T";
    default:
      return changeKind ? (changeKind[0]?.toUpperCase() ?? "?") : "?";
  }
}

function patchLineTone(line: string): DiffTone {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+++") || line.startsWith("---")) return "meta";
  if (line.startsWith("diff ") || line.startsWith("index ")) return "meta";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "context";
}

function fileSummary(entry: unknown): DiffLine | null {
  if (!entry || typeof entry !== "object") return null;
  const rec = entry as Record<string, unknown>;
  const path = str(rec, "path");
  if (!path) return null;
  const glyph = changeGlyph(str(rec, "changeKind"));
  const stats =
    rec.binary === true ? "binary" : `+${num(rec, "additions")} -${num(rec, "deletions")}`;
  return { text: `${glyph} ${path}  ${stats}`, tone: "file" };
}

/** Render a diffFiles response into display lines. */
export function renderDiffFiles(response: unknown): DiffLine[] {
  if (!response || typeof response !== "object") {
    return [{ text: "no diff available", tone: "meta" }];
  }
  const rec = response as Record<string, unknown>;
  if (rec.outcome !== "available") {
    const reason = str(rec, "reason") || str(rec, "message");
    return [{ text: reason ? `diff unavailable: ${reason}` : "diff unavailable", tone: "meta" }];
  }

  const out: DiffLine[] = [];
  const shortstat = str(rec, "shortstat");
  if (shortstat) out.push({ text: shortstat, tone: "meta" });

  const files = Array.isArray(rec.files) ? rec.files : [];
  if (files.length === 0) {
    out.push({ text: "no changes", tone: "meta" });
    return out;
  }
  for (const file of files) {
    const line = fileSummary(file);
    if (line) out.push(line);
  }

  const patches = Array.isArray(rec.initialPatches) ? rec.initialPatches : [];
  for (const patch of patches) {
    if (!patch || typeof patch !== "object") continue;
    const prec = patch as Record<string, unknown>;
    const text = str(prec, "patch");
    if (!text) continue;
    out.push({ text: "", tone: "context" });
    out.push({ text: `── ${str(prec, "path")} ──`, tone: "meta" });
    for (const line of text.split("\n")) out.push({ text: line, tone: patchLineTone(line) });
    if (prec.truncated === true) out.push({ text: "… (patch truncated)", tone: "meta" });
  }
  return out;
}
