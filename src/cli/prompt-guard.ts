/**
 * A cheap heuristic to catch obviously low-value spawn prompts before they cost
 * provider tokens (`vch new "hi"`). This is NOT intent detection — real intent
 * analysis would itself burn tokens and be unreliable. It only flags empty
 * input, common greetings/filler, and prompts too short to be a task, so the CLI
 * can ask for confirmation. Anything that reads like an actual request passes.
 */

const FILLER = new Set([
  "hi",
  "hii",
  "hiya",
  "hello",
  "helo",
  "hey",
  "heya",
  "hey there",
  "yo",
  "sup",
  "wsup",
  "hola",
  "gm",
  "gn",
  "test",
  "testing",
  "ping",
  "ok",
  "okay",
  "k",
  "thanks",
  "thx",
  "ty",
  "lol",
  "hmm",
  "hm",
  "idk",
  "help",
]);

export interface PromptAssessment {
  lowValue: boolean;
  /** Why it was flagged (for the confirmation message), or null when it passes. */
  reason: string | null;
}

/** Assess whether a spawn prompt looks too trivial to be worth a provider turn. */
export function assessPrompt(prompt: string): PromptAssessment {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) {
    return { lowValue: true, reason: "is empty" };
  }
  // Normalize for the filler check: lowercase, collapse whitespace, drop trailing punctuation.
  const normalized = trimmed
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[!?.,]+$/g, "")
    .trim();
  if (FILLER.has(normalized)) {
    return { lowValue: true, reason: "looks like a greeting or filler" };
  }
  const words = trimmed.split(/\s+/).filter((w) => w.length > 0);
  if (words.length < 2 && trimmed.length < 12) {
    return { lowValue: true, reason: "is too short to be a task" };
  }
  return { lowValue: false, reason: null };
}
