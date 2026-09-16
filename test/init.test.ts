import { describe, expect, test } from "bun:test";
import { type InitPrompter, promptConfig } from "../src/cli/init.ts";
import { defaultConfig } from "../src/config.ts";

/** Scripted prompter: answers text/yesNo from queues, falling back to defaults. */
function scripted(texts: Record<string, string>, yesNos: Record<string, boolean>): InitPrompter {
  return {
    text: (q, def) => texts[q] ?? def,
    yesNo: (q, def) => yesNos[q] ?? def,
  };
}

describe("promptConfig", () => {
  test("accepting defaults leaves config unchanged", () => {
    const base = { ...defaultConfig(), serverUrl: "http://host:1" };
    const out = promptConfig(base, scripted({}, {}));
    expect(out).toEqual(base);
  });

  test("edits serverUrl and sets a start command + autoStart", () => {
    const out = promptConfig(defaultConfig(), {
      text: (q, def) => {
        if (q.startsWith("BB server URL")) return "http://other:9";
        if (q.startsWith("Start command")) return "bb-app start";
        return def;
      },
      yesNo: () => true,
    });
    expect(out.serverUrl).toBe("http://other:9");
    expect(out.startCommand).toEqual(["bb-app", "start"]);
    expect(out.autoStart).toBe(true);
  });

  test("autoStart forced false when no start command is given", () => {
    const out = promptConfig(
      { ...defaultConfig(), autoStart: true },
      scripted({}, { "Auto-start BB with that command when it is unreachable?": true }),
    );
    expect(out.startCommand).toBeNull();
    expect(out.autoStart).toBe(false);
  });

  test("blank serverUrl answer keeps the default", () => {
    const base = { ...defaultConfig(), serverUrl: "http://keep:1" };
    const out = promptConfig(base, scripted({ "BB server URL": "" }, {}));
    expect(out.serverUrl).toBe("http://keep:1");
  });
});
