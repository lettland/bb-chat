import { describe, expect, test } from "bun:test";
import {
  buildSpawnParams,
  type Choice,
  chooseMode,
  chooseModel,
  chooseProvider,
  highlighted,
  initWizard,
  isComplete,
  moveCursor,
  setModels,
  setPrompt,
  toModelChoices,
  toProviderChoices,
} from "../src/tui/spawn-wizard.ts";

describe("toProviderChoices", () => {
  test("maps id/name and skips unavailable + id-less", () => {
    const choices = toProviderChoices([
      { id: "claude-code", name: "Claude Code" },
      { providerId: "codex", displayName: "Codex" },
      { id: "x", name: "X", available: false },
      { name: "no id" },
      null,
    ]);
    expect(choices).toEqual([
      { id: "claude-code", label: "Claude Code" },
      { id: "codex", label: "Codex" },
    ]);
  });
});

describe("toModelChoices", () => {
  test("prefers id then model, labels by displayName", () => {
    expect(
      toModelChoices([
        { id: "claude-sonnet-5", displayName: "Sonnet 5", model: "sonnet" },
        { model: "gpt-6", displayName: "GPT-6" },
      ]),
    ).toEqual([
      { id: "claude-sonnet-5", label: "Sonnet 5" },
      { id: "gpt-6", label: "GPT-6" },
    ]);
  });
});

const providers: Choice[] = [
  { id: "claude-code", label: "Claude Code" },
  { id: "codex", label: "Codex" },
];

describe("wizard flow", () => {
  test("moveCursor clamps within the current step choices", () => {
    let s = initWizard(providers);
    expect(s.cursor).toBe(0);
    s = moveCursor(s, -1);
    expect(s.cursor).toBe(0);
    s = moveCursor(s, 1);
    expect(s.cursor).toBe(1);
    s = moveCursor(s, 5);
    expect(s.cursor).toBe(1);
    expect(highlighted(s)?.id).toBe("codex");
  });

  test("full path provider → model → mode → prompt → params", () => {
    let s = initWizard(providers);
    s = chooseProvider(s, providers[1] as Choice);
    expect(s.step).toBe("model");
    expect(s.provider?.id).toBe("codex");

    const models: Choice[] = [{ id: "gpt-6", label: "GPT-6" }];
    s = setModels(s, models);
    s = chooseModel(s, models[0] as Choice);
    expect(s.step).toBe("mode");

    s = chooseMode(s, "auto");
    expect(s.step).toBe("prompt");
    expect(isComplete(s)).toBe(false);

    s = setPrompt(s, "  build it  ");
    expect(isComplete(s)).toBe(true);

    expect(buildSpawnParams(s, "proj_1")).toEqual({
      projectId: "proj_1",
      providerId: "codex",
      model: "gpt-6",
      permissionMode: "auto",
      prompt: "build it",
    });
  });

  test("params tolerate skipped provider/model (nulls)", () => {
    const s = setPrompt({ ...initWizard(providers), step: "prompt" }, "hello");
    expect(buildSpawnParams(s, "proj_1")).toEqual({
      projectId: "proj_1",
      providerId: null,
      model: null,
      permissionMode: null,
      prompt: "hello",
    });
  });
});
