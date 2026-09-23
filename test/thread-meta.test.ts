import { describe, expect, test } from "bun:test";
import type { BBSdk } from "../src/bb/sdk.ts";
import { listThreads, toThreadMeta } from "../src/bb/threads.ts";

describe("toThreadMeta", () => {
  test("maps title, provider, runtime status and branch", () => {
    const meta = toThreadMeta({
      title: "Fix the flaky test",
      titleFallback: "fallback",
      providerId: "claude-code",
      status: "idle",
      runtime: { displayStatus: "active" },
      environmentBranchName: "fix/flaky",
    });
    expect(meta).toEqual({
      title: "Fix the flaky test",
      providerId: "claude-code",
      model: null,
      status: "active",
      branch: "fix/flaky",
      busy: true,
    });
  });

  test("falls back to titleFallback and the stored status", () => {
    const meta = toThreadMeta({ title: null, titleFallback: "untitled chat", status: "idle" });
    expect(meta.title).toBe("untitled chat");
    expect(meta.status).toBe("idle");
    expect(meta.busy).toBe(false);
  });

  test("tolerates garbage input", () => {
    expect(toThreadMeta(null)).toEqual({
      title: null,
      providerId: null,
      model: null,
      status: null,
      branch: null,
      busy: false,
    });
    expect(toThreadMeta({ runtime: "nope", title: 42 }).title).toBeNull();
  });
});

describe("listThreads", () => {
  test("asks the server for non-archived threads only", async () => {
    let query: Record<string, unknown> = {};
    const sdk = {
      threads: {
        list: async (q: Record<string, unknown>) => {
          query = q;
          return [];
        },
      },
    } as unknown as BBSdk;
    await listThreads(sdk, "prj_1");
    expect(query.projectId).toBe("prj_1");
    expect(query.archived).toBe(false);
  });
});
