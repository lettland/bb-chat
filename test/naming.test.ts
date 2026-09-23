/**
 * The tool's name is not one string — it is the binary, the npm package, the
 * config directory, and the environment prefix, and a rename that misses any one
 * of them produces a build that works on the author's machine and confuses
 * everyone else. These assertions pin all of them to a single constant, so
 * renaming the tool is a one-line edit here followed by a list of failures that
 * is exactly the work remaining.
 *
 * VERSION is read from package.json, which the release workflow stamps; these
 * assertions guard against that import being replaced by a hand-kept constant
 * again, which a release would silently leave stale.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { configDir, configPath, envOverrides } from "../src/config.ts";
import { VERSION } from "../src/version.ts";

/** The one name. Change this and the failures list the rest of the rename. */
const NAME = "bbchat";
/** Environment variables are prefixed with the uppercased name. */
const ENV_PREFIX = `${NAME.toUpperCase()}_`;

const repoRoot = join(import.meta.dir, "..");

/** Only the fields these assertions read; the manifest has many more. */
interface Manifest {
  name: string;
  version: string;
  bin: Record<string, string>;
  scripts: Record<string, string>;
  repository: { url: string };
}

const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as Manifest;

describe("package identity", () => {
  test("npm package is named for the tool", () => {
    expect(pkg.name).toBe(NAME);
  });

  test("exposes exactly one binary, named for the tool, and it exists", () => {
    expect(Object.keys(pkg.bin)).toEqual([NAME]);
    expect(pkg.bin[NAME]).toBe(`./bin/${NAME}.js`);
    // Reading it proves the file is actually there — a bin entry pointing at a
    // missing file installs fine and fails only when the user runs it.
    expect(readFileSync(join(repoRoot, `bin/${NAME}.js`), "utf8")).toContain("src/index.ts");
  });

  test("build:binary emits an artifact named for the tool", () => {
    // CI runs `./dist/<name> selfcheck` after this script; a mismatch breaks the
    // release, not the test suite, so assert the two agree here.
    expect(pkg.scripts["build:binary"]).toContain(`--outfile dist/${NAME}`);
  });

  test("repository points at the canonical remote", () => {
    expect(pkg.repository.url).toBe("git+https://github.com/lettland/bb-chat.git");
  });
});

describe("version sync", () => {
  test("src/version.ts matches package.json", () => {
    expect(VERSION).toBe(pkg.version);
  });

  test("version is valid semver", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
  });
});

describe("config location", () => {
  test("config directory is named for the tool", () => {
    expect(configDir({ XDG_CONFIG_HOME: "/tmp/cfg" })).toBe(`/tmp/cfg/${NAME}`);
  });

  test("config file sits inside that directory", () => {
    expect(configPath({ XDG_CONFIG_HOME: "/tmp/cfg" })).toBe(`/tmp/cfg/${NAME}/config.json`);
  });
});

describe("environment prefix", () => {
  test("every documented override reads from the tool's prefix", () => {
    const resolved = envOverrides({
      [`${ENV_PREFIX}SERVER_URL`]: "http://example.test",
      [`${ENV_PREFIX}START_COMMAND`]: "bb-app start",
      [`${ENV_PREFIX}BB_COMMAND`]: "bb-app",
      [`${ENV_PREFIX}AUTO_START`]: "true",
    });

    expect(resolved).toEqual({
      serverUrl: "http://example.test",
      startCommand: ["bb-app", "start"],
      bbCommand: ["bb-app"],
      autoStart: true,
    });
  });

  test("a stale prefix is ignored rather than silently honored", () => {
    // Guards the rename itself: if `VCH_*` were still read, the old and new
    // names would both work and the deprecation would never surface.
    expect(envOverrides({ VCH_SERVER_URL: "http://stale.test" })).toEqual({});
  });

  test("BB_SERVER_URL still works as the shared fallback", () => {
    // Not tool-prefixed on purpose — it is BB's own variable, so it must
    // survive a rename of this client.
    expect(envOverrides({ BB_SERVER_URL: "http://bb.test" })).toEqual({
      serverUrl: "http://bb.test",
    });
  });
});

describe("no stale name survives in shipped files", () => {
  // package.json `files` decides what npm publishes; a leftover old name there
  // is what users would actually read.
  const shipped = ["README.md", "package.json", `bin/${NAME}.js`, "src/index.ts", "src/config.ts"];

  for (const file of shipped) {
    test(`${file} has no leftover "vch"`, () => {
      const contents = readFileSync(join(repoRoot, file), "utf8");
      expect(contents.toLowerCase()).not.toContain("vch");
    });
  }
});
