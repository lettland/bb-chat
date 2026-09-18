import { describe, expect, test } from "bun:test";
import { matchModel, matchProvider, resolveOptions } from "../src/cli/shorthand.ts";
import type { Choice } from "../src/tui/spawn-wizard.ts";

const providers: Choice[] = [
  { id: "codex", label: "Codex" },
  { id: "claude-code", label: "Claude Code" },
  { id: "acp-opencode", label: "opencode" },
  { id: "acp-glm", label: "GLM" },
  { id: "acp-claude-work", label: "Claude Work" },
];

const codexModels: Choice[] = [
  { id: "gpt-6-astra", label: "GPT-6 Astra" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
];

const claudeModels: Choice[] = [
  { id: "claude-opus-5[1m]", label: "Opus 5" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
];

function value<T>(m: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!m.ok) throw new Error(`expected ok, got error: ${m.error}`);
  return m.value;
}

describe("matchProvider", () => {
  test("exact id", () => {
    expect(value(matchProvider(providers, "codex")).id).toBe("codex");
  });

  test("`claude` resolves to claude-code even with acp-claude-work present", () => {
    // Raw-id prefix is unique (acp-claude-work's raw id starts with `acp`), so this
    // is not ambiguous — the regression the reviewers caught.
    expect(value(matchProvider(providers, "claude")).id).toBe("claude-code");
  });

  test("acp providers resolve by their stripped name", () => {
    expect(value(matchProvider(providers, "opencode")).id).toBe("acp-opencode");
    expect(value(matchProvider(providers, "glm")).id).toBe("acp-glm");
    expect(value(matchProvider(providers, "claude-work")).id).toBe("acp-claude-work");
  });

  test("case-insensitive", () => {
    expect(value(matchProvider(providers, "CLAUDE")).id).toBe("claude-code");
    expect(value(matchProvider(providers, "Codex")).id).toBe("codex");
  });

  test("empty token is rejected", () => {
    const m = matchProvider(providers, "   ");
    expect(m.ok).toBe(false);
  });

  test("unknown token errors and lists options + hints", () => {
    const m = matchProvider(providers, "previders");
    expect(m.ok).toBe(false);
    if (!m.ok) {
      expect(m.error).toContain("unknown provider");
      expect(m.error).toContain("vch providers");
      expect(m.error).toContain("vch help");
    }
  });

  test("genuinely ambiguous token errors with candidates", () => {
    const two: Choice[] = [
      { id: "foobar", label: "Foo Bar" },
      { id: "foobaz", label: "Foo Baz" },
    ];
    const m = matchProvider(two, "foo");
    expect(m.ok).toBe(false);
    if (!m.ok) expect(m.error).toContain("ambiguous");
  });
});

describe("matchModel", () => {
  test("suffix match resolves 5.6-sol", () => {
    expect(value(matchModel(codexModels, "5.6-sol")).id).toBe("gpt-5.6-sol");
  });

  test("bracketed model resolves via suffix", () => {
    expect(value(matchModel(claudeModels, "opus-5[1m]")).id).toBe("claude-opus-5[1m]");
  });

  test("ambiguous substring lists candidates", () => {
    const m = matchModel(codexModels, "5.6");
    expect(m.ok).toBe(false);
    if (!m.ok) expect(m.error).toContain("ambiguous model");
  });

  test("unknown model lists the provider's models", () => {
    const m = matchModel(codexModels, "haiku");
    expect(m.ok).toBe(false);
    if (!m.ok) expect(m.error).toContain("gpt-5.6-sol");
  });

  test("empty token is rejected (not a spurious endsWith('') match)", () => {
    expect(matchModel(codexModels, "").ok).toBe(false);
  });
});

describe("resolveOptions", () => {
  test("order-independent: model + reasoning + mode in any order", () => {
    const a = value(resolveOptions(["5.6-sol", "high", "auto"], codexModels));
    const b = value(resolveOptions(["high", "auto", "5.6-sol"], codexModels));
    expect(a).toEqual({ model: "gpt-5.6-sol", reasoningLevel: "high", permissionMode: "auto" });
    expect(b).toEqual(a);
  });

  test("reasoning and mode are classified before model matching", () => {
    expect(value(resolveOptions(["high"], codexModels)).reasoningLevel).toBe("high");
    expect(value(resolveOptions(["auto"], codexModels)).permissionMode).toBe("auto");
  });

  test("case-insensitive reasoning/mode", () => {
    expect(value(resolveOptions(["HIGH"], codexModels)).reasoningLevel).toBe("high");
  });

  test("empty option set resolves to all-null", () => {
    expect(value(resolveOptions([], codexModels))).toEqual({
      model: null,
      reasoningLevel: null,
      permissionMode: null,
    });
  });

  test("a second model / reasoning / mode token errors", () => {
    expect(resolveOptions(["gpt-5.6-sol", "gpt-5.6-terra"], codexModels).ok).toBe(false);
    expect(resolveOptions(["high", "low"], codexModels).ok).toBe(false);
    expect(resolveOptions(["auto", "full"], codexModels).ok).toBe(false);
  });

  test("unmatched token error enumerates reasoning + modes", () => {
    const m = resolveOptions(["bogus"], codexModels);
    expect(m.ok).toBe(false);
    if (!m.ok) {
      expect(m.error).toContain("high");
      expect(m.error).toContain("auto");
    }
  });
});
