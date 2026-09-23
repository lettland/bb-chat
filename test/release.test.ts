/**
 * The release workflow runs these functions unattended on every push to master
 * and its output is irreversible — a pushed tag and a published npm version
 * cannot be taken back. So the versioning rules are pinned here, not discovered
 * on the next release.
 */

import { describe, expect, test } from "bun:test";
import {
  bumpVersion,
  compareSemver,
  cutChangelog,
  inferBump,
  latestTag,
  plan,
  releaseNotes,
  repoWebUrl,
  setManifestVersion,
} from "../scripts/release.ts";

describe("bumpVersion", () => {
  test("stable versions bump the named level and reset the lower ones", () => {
    expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
  });

  test("prerelease on a stable version previews the next patch", () => {
    expect(bumpVersion("1.2.3", "prerelease")).toBe("1.2.4-beta.0");
  });

  test("prerelease on a prerelease increments its counter", () => {
    expect(bumpVersion("1.2.4-beta.0", "prerelease")).toBe("1.2.4-beta.1");
    expect(bumpVersion("1.2.4-beta.9", "prerelease")).toBe("1.2.4-beta.10");
  });

  test("bumping a prerelease to the level it previews just stabilises it", () => {
    expect(bumpVersion("1.2.4-beta.1", "patch")).toBe("1.2.4");
    expect(bumpVersion("1.3.0-beta.1", "minor")).toBe("1.3.0");
    expect(bumpVersion("2.0.0-beta.1", "major")).toBe("2.0.0");
  });

  test("bumping a prerelease past the level it previews moves on", () => {
    expect(bumpVersion("1.2.4-beta.1", "minor")).toBe("1.3.0");
    expect(bumpVersion("1.3.0-beta.1", "major")).toBe("2.0.0");
  });

  test("rejects a non-semver input rather than inventing a version", () => {
    expect(() => bumpVersion("1.2", "patch")).toThrow("not a semver");
  });
});

describe("inferBump", () => {
  test("an unmarked commit cuts a patch", () => {
    expect(inferBump(["Fix the thread list"])).toBe("patch");
    expect(inferBump([])).toBe("patch");
  });

  test("the highest marker across the range wins", () => {
    expect(inferBump(["Fix x", "Add y [minor]", "Fix z"])).toBe("minor");
    expect(inferBump(["Add y [minor]", "Drop the v1 config [MAJOR]"])).toBe("major");
  });

  test("[patch] is accepted but never raises the bump", () => {
    expect(inferBump(["Fix x [patch]"])).toBe("patch");
  });
});

describe("latestTag", () => {
  test("orders by semver precedence, not by string", () => {
    expect(latestTag(["v0.9.0", "v0.10.0", "v0.2.0"])).toBe("v0.10.0");
  });

  test("a stable release outranks its own prereleases", () => {
    expect(latestTag(["v1.0.0-beta.2", "v1.0.0", "v1.0.0-beta.10"])).toBe("v1.0.0");
  });

  test("ignores tags that are not release versions", () => {
    expect(latestTag(["", "nightly", "vnext", "v1.2.3"])).toBe("v1.2.3");
    expect(latestTag([""])).toBeNull();
  });

  test("compareSemver orders numeric prerelease identifiers numerically", () => {
    expect(compareSemver("1.0.0-beta.2", "1.0.0-beta.10")).toBeLessThan(0);
  });

  test("compareSemver follows the semver prerelease precedence rules", () => {
    expect(compareSemver("1.0.0-beta.1", "1.0.0-beta.1")).toBe(0);
    // A shorter identifier list ranks lower when the shared prefix is equal.
    expect(compareSemver("1.0.0-beta", "1.0.0-beta.1")).toBeLessThan(0);
    expect(compareSemver("1.0.0-beta.1", "1.0.0-beta")).toBeGreaterThan(0);
    // Numeric identifiers rank below alphanumeric ones; alphanumerics sort lexically.
    expect(compareSemver("1.0.0-1", "1.0.0-alpha")).toBeLessThan(0);
    expect(compareSemver("1.0.0-alpha", "1.0.0-1")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0-alpha", "1.0.0-beta")).toBeLessThan(0);
    expect(compareSemver("1.0.0-beta", "1.0.0-alpha")).toBeGreaterThan(0);
  });
});

describe("plan", () => {
  const base = { packageVersion: "0.1.0", subjects: [], forcedBump: null, alreadyReleased: false };

  test("the first release ships package.json's version unbumped", () => {
    expect(plan({ ...base, previousTag: null, changed: true })).toEqual({
      release: true,
      version: "0.1.0",
      bump: "initial",
      previousTag: null,
    });
  });

  test("nothing shipped changed: no release", () => {
    expect(plan({ ...base, previousTag: "v0.1.0", changed: false }).release).toBe(false);
  });

  test("a change bumps from the last tag, not from package.json", () => {
    const result = plan({
      ...base,
      packageVersion: "9.9.9",
      previousTag: "v0.1.0",
      changed: true,
      subjects: ["Add the diff pager [minor]"],
    });
    expect(result).toMatchObject({ release: true, version: "0.2.0", bump: "minor" });
  });

  test("re-running a run that already pushed its tag releases nothing", () => {
    // The re-run's checkout predates the version commit, so the diff says changed.
    const result = plan({ ...base, previousTag: "v0.2.0", changed: true, alreadyReleased: true });
    expect(result.release).toBe(false);
  });

  test("a forced bump releases even with nothing changed", () => {
    const result = plan({
      ...base,
      previousTag: "v0.1.0",
      changed: false,
      forcedBump: "prerelease",
    });
    expect(result).toMatchObject({ release: true, version: "0.1.1-beta.0" });
  });

  test("a forced bump on the first release bumps package.json's version", () => {
    expect(plan({ ...base, previousTag: null, changed: true, forcedBump: "minor" })).toEqual({
      release: true,
      version: "0.2.0",
      bump: "minor",
      previousTag: null,
    });
  });
});

describe("setManifestVersion", () => {
  test("changes only the version field and keeps the formatting", () => {
    const manifest = '{\n  "name": "bbchat",\n  "version": "0.1.0",\n  "files": ["src"]\n}\n';
    expect(setManifestVersion(manifest, "0.2.0")).toBe(manifest.replace("0.1.0", "0.2.0"));
  });

  test("refuses a manifest without a version field", () => {
    expect(() => setManifestVersion('{ "name": "x" }', "1.0.0")).toThrow("version");
  });
});

describe("changelog", () => {
  const repoUrl = "https://github.com/lettland/bb-chat";
  const changelog = [
    "# Changelog",
    "",
    "Intro.",
    "",
    "## [Unreleased]",
    "",
    "### Added",
    "",
    "- The diff pager.",
    "",
    "## [0.1.0] - 2026-09-01",
    "",
    "### Added",
    "",
    "- Everything.",
    "",
    `[Unreleased]: ${repoUrl}/compare/v0.1.0...HEAD`,
    `[0.1.0]: ${repoUrl}/releases/tag/v0.1.0`,
    "",
  ].join("\n");

  const cut = cutChangelog(changelog, {
    version: "0.2.0",
    date: "2026-09-23",
    previousTag: "v0.1.0",
    repoUrl,
    subjects: ["ignored while Unreleased has entries"],
  });

  test("moves the Unreleased entries under a dated heading and leaves Unreleased empty", () => {
    expect(cut).toContain(
      "## [Unreleased]\n\n## [0.2.0] - 2026-09-23\n\n### Added\n\n- The diff pager.",
    );
    expect(cut).toContain("## [0.1.0] - 2026-09-01");
    expect(cut).not.toContain("ignored while");
  });

  test("repoints the link references", () => {
    expect(cut).toContain(`[Unreleased]: ${repoUrl}/compare/v0.2.0...HEAD`);
    expect(cut).toContain(`[0.2.0]: ${repoUrl}/compare/v0.1.0...v0.2.0`);
    expect(cut).toContain(`[0.1.0]: ${repoUrl}/releases/tag/v0.1.0`);
  });

  test("release notes are exactly that version's section", () => {
    expect(releaseNotes(cut, "0.2.0")).toBe("### Added\n\n- The diff pager.");
    expect(releaseNotes(cut, "0.1.0")).toBe("### Added\n\n- Everything.");
  });

  test("an empty Unreleased section is filled from the commit subjects", () => {
    const empty = cutChangelog(cut, {
      version: "0.2.1",
      date: "2026-09-24",
      previousTag: "v0.2.0",
      repoUrl,
      subjects: ["Fix the pager scroll [patch]"],
    });
    expect(releaseNotes(empty, "0.2.1")).toBe("### Changed\n\n- Fix the pager scroll");
  });

  test("the first release links to its tag, having nothing to compare against", () => {
    const first = cutChangelog("# Changelog\n\n## [Unreleased]\n\n- Initial.\n", {
      version: "0.1.0",
      date: "2026-09-23",
      previousTag: null,
      repoUrl,
      subjects: [],
    });
    expect(first).toContain(`[0.1.0]: ${repoUrl}/releases/tag/v0.1.0`);
    expect(releaseNotes(first, "0.1.0")).toBe("- Initial.");
  });

  test("refuses a changelog with no Unreleased heading", () => {
    expect(() =>
      cutChangelog("# Changelog\n", {
        version: "1.0.0",
        date: "x",
        previousTag: null,
        repoUrl,
        subjects: [],
      }),
    ).toThrow("Unreleased");
  });

  test("repoWebUrl strips the npm git+ prefix and .git suffix", () => {
    expect(repoWebUrl("git+https://github.com/lettland/bb-chat.git")).toBe(repoUrl);
  });
});
