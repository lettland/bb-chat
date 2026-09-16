import { describe, expect, test } from "bun:test";
import {
  type HostLike,
  matchProjectByPath,
  normalizePath,
  type ProjectLike,
  pickLocalHost,
} from "../src/bb/project.ts";

const project = (id: string, path: string): ProjectLike => ({
  id,
  name: id,
  sources: [{ type: "local_path", path }],
});

describe("normalizePath", () => {
  test("strips a trailing slash", () => {
    expect(normalizePath("/a/b/")).toBe("/a/b");
    expect(normalizePath("/")).toBe("/");
  });
});

describe("matchProjectByPath", () => {
  test("matches an exact local-path source", () => {
    const projects = [project("p1", "/work/a"), project("p2", "/work/b")];
    expect(matchProjectByPath(projects, "/work/b")?.id).toBe("p2");
    expect(matchProjectByPath(projects, "/work/b/")?.id).toBe("p2");
  });

  test("returns null when nothing matches", () => {
    expect(matchProjectByPath([project("p1", "/work/a")], "/work/c")).toBeNull();
  });

  test("ignores non-local sources", () => {
    const projects: ProjectLike[] = [
      { id: "p", name: "p", sources: [{ type: "clone", path: "/work/a" }] },
    ];
    expect(matchProjectByPath(projects, "/work/a")).toBeNull();
  });
});

describe("pickLocalHost", () => {
  const host = (id: string, type: string, status: string): HostLike => ({ id, type, status });

  test("prefers connected persistent", () => {
    const hosts = [
      host("h1", "persistent", "disconnected"),
      host("h2", "persistent", "connected"),
      host("h3", "ephemeral", "connected"),
    ];
    expect(pickLocalHost(hosts)?.id).toBe("h2");
  });

  test("falls back to any persistent, then first", () => {
    expect(pickLocalHost([host("h1", "persistent", "disconnected")])?.id).toBe("h1");
    expect(pickLocalHost([host("h1", "ephemeral", "connected")])?.id).toBe("h1");
    expect(pickLocalHost([])).toBeNull();
  });
});
