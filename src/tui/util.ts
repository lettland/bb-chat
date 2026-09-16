/** Human-readable message for any thrown value. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Clamp `n` into the inclusive range [min, max]. */
export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** A parsed `/name args` composer command, or null if the input isn't a command. */
export interface SlashCommand {
  name: string;
  args: string;
}

/** Parse a leading-slash composer command. Non-slash input returns null (a message). */
export function parseSlashCommand(input: string): SlashCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const rest = trimmed.slice(1);
  const space = rest.indexOf(" ");
  const name = (space === -1 ? rest : rest.slice(0, space)).toLowerCase();
  const args = space === -1 ? "" : rest.slice(space + 1).trim();
  return { name, args };
}
