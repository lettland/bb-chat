/**
 * Drives the release CLI (`scripts/release.ts main`) against a throwaway git repo,
 * pinning the impure shell the workflow runs: tag discovery, the shipped-path
 * diff, GITHUB_OUTPUT, and the files it stamps.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { main } from "../scripts/release.ts";

const CHANGELOG = [
  "# Changelog",
  "",
  "## [Unreleased]",
  "",
  "### Added",
  "",
  "- The diff pager.",
  "",
].join("\n");

const ENV_KEYS = ["GITHUB_OUTPUT", "FORCED_BUMP"] as const;
const savedEnv = new Map(ENV_KEYS.map((key) => [key, Bun.env[key]]));
const originalCwd = process.cwd();
let repo = "";
let outDir = "";
let logSpy: ReturnType<typeof spyOn>;

/** Git with an isolated identity and no hooks/signing leaking in from the machine. */
function git(...args: string[]): string {
  const isolated = [
    "-c",
    "user.name=release-test",
    "-c",
    "user.email=release-test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "tag.gpgsign=false",
    "-c",
    "core.hooksPath=/dev/null",
  ];
  return execFileSync("git", [...isolated, ...args], { cwd: repo, encoding: "utf8" }).trim();
}

function commit(path: string, content: string, subject: string): void {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), content);
  git("add", "-A");
  git("commit", "-q", "-m", subject);
}

let outputs = 0;
/** Run `plan` and return the GITHUB_OUTPUT key/values it wrote. */
function runPlan(forcedBump = ""): Record<string, string> {
  const out = join(outDir, `output-${outputs++}`);
  Bun.env.GITHUB_OUTPUT = out;
  Bun.env.FORCED_BUMP = forcedBump;
  main(["plan"]);
  const lines = readFileSync(out, "utf8").trim().split("\n");
  return Object.fromEntries(lines.map((line) => line.split("=") as [string, string]));
}

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), "bbchat-release-out-"));
  logSpy = spyOn(console, "log").mockImplementation(() => {});
});

afterAll(() => {
  logSpy.mockRestore();
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete Bun.env[key];
    else Bun.env[key] = value;
  }
  rmSync(outDir, { recursive: true, force: true });
});

/** Each test gets its own repo at package.json 0.1.0 with one shipped commit, untagged. */
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "bbchat-release-"));
  git("init", "-q", "-b", "master");
  writeFileSync(
    join(repo, "package.json"),
    '{\n  "name": "x",\n  "version": "0.1.0",\n  "repository": { "url": "git+https://github.com/o/x.git" }\n}\n',
  );
  writeFileSync(join(repo, "CHANGELOG.md"), CHANGELOG);
  commit("src/index.ts", "export {};\n", "Initial commit");
  // main() acts on the current directory, like the workflow step that runs it.
  process.chdir(repo);
});

afterEach(() => {
  logSpy.mockClear();
  process.chdir(originalCwd);
  rmSync(repo, { recursive: true, force: true });
});

const logged = (): string => String(logSpy.mock.calls[0]?.[0]);

describe("release CLI", () => {
  test("plan with no tag releases package.json's version as the initial release", () => {
    expect(runPlan()).toEqual({
      release: "true",
      version: "0.1.0",
      bump: "initial",
      previous_tag: "",
      prerelease: "false",
    });
    expect(logged()).toContain("release v0.1.0 (initial; previous none)");
  });

  test("plan releases nothing when HEAD is already tagged", () => {
    git("tag", "v0.1.0");
    expect(runPlan()).toMatchObject({ release: "false", version: "0.1.0", bump: "none" });
    expect(logged()).toContain("no release");
  });

  test("docs-only changes do not release; a forced bump still does", () => {
    git("tag", "v0.1.0");
    commit("README.md", "docs\n", "Document things [major]");
    expect(runPlan()).toMatchObject({ release: "false" });
    expect(runPlan("prerelease")).toMatchObject({
      release: "true",
      version: "0.1.1-beta.0",
      prerelease: "true",
    });
    expect(runPlan("auto")).toMatchObject({ release: "false" });
    expect(() => runPlan("huge")).toThrow('invalid release_type "huge"');
  });

  test("a shipped change bumps by the markers on shipped commits only", () => {
    git("tag", "v0.1.0");
    // The README commit's [major] is ignored: it touched no shipped path.
    commit("README.md", "docs\n", "Document things [major]");
    commit("src/feature.ts", "export const f = 1;\n", "Add a feature [minor]");
    expect(runPlan()).toMatchObject({
      release: "true",
      version: "0.2.0",
      bump: "minor",
      previous_tag: "v0.1.0",
    });
  });

  test("cut stamps package.json and moves Unreleased under the version; notes prints it", () => {
    git("tag", "v0.1.0");
    commit("src/feature.ts", "export const f = 1;\n", "Add a feature [minor]");
    main(["cut", "0.2.0", "v0.1.0"]);
    expect(readFileSync("package.json", "utf8")).toContain('"version": "0.2.0"');
    const changelog = readFileSync("CHANGELOG.md", "utf8");
    expect(changelog).toMatch(/## \[0\.2\.0\] - \d{4}-\d{2}-\d{2}/);
    expect(changelog).toContain("https://github.com/o/x/compare/v0.1.0...v0.2.0");

    let printed = "";
    const writeSpy = spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      printed += String(chunk);
      return true;
    });
    try {
      main(["notes", "0.2.0"]);
    } finally {
      writeSpy.mockRestore();
    }
    expect(printed).toContain("- The diff pager.");
  });

  test("set-version stamps only package.json", () => {
    const changelog = readFileSync("CHANGELOG.md", "utf8");
    main(["set-version", "0.3.0-beta.1"]);
    expect(readFileSync("package.json", "utf8")).toContain('"version": "0.3.0-beta.1"');
    expect(readFileSync("CHANGELOG.md", "utf8")).toBe(changelog);
  });

  test("missing arguments and unknown commands fail with usage", () => {
    expect(() => main(["set-version"])).toThrow("usage");
    expect(() => main(["cut", "1.0.0"])).toThrow("usage");
    expect(() => main(["notes"])).toThrow("usage");
    expect(() => main(["publish"])).toThrow("usage");
  });
});
