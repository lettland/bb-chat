#!/usr/bin/env bun
/**
 * Release plumbing for .github/workflows/release.yml. Every push to master that
 * touches shipped code cuts a release; this script decides whether and at which
 * version, stamps it, and cuts the changelog. The pure functions are exported so
 * test/release.test.ts can pin the versioning rules without a git repo.
 *
 *   bun scripts/release.ts plan                   decide; writes GITHUB_OUTPUT
 *   bun scripts/release.ts set-version <v>        stamp package.json only
 *   bun scripts/release.ts cut <v> <prev-tag|->   stamp package.json + CHANGELOG.md
 *   bun scripts/release.ts notes <v>              print that version's changelog section
 *
 * Bump rules, scanned over every commit since the last `v*` tag: a `[major]` or
 * `[minor]` marker in a subject opts into that bump (highest wins), anything
 * else cuts a patch. A manual dispatch may force `patch`, `minor`, `major`, or
 * `prerelease` (`-beta.N`). With no tag yet, package.json's version is released
 * as-is — it has never been published.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

export type Bump = "patch" | "minor" | "major" | "prerelease";

const BUMPS: readonly Bump[] = ["patch", "minor", "major", "prerelease"];
const PREID = "beta";

/** Paths whose change warrants a release. Docs and CI config alone do not. */
export const SHIPPED_PATHS = ["src", "bin", "package.json", "bun.lock"] as const;

interface Semver {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated prerelease identifiers; empty for a stable version. */
  pre: string[];
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseSemver(version: string): Semver {
  const m = SEMVER.exec(version);
  if (!m) throw new Error(`not a semver version: ${version}`);
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ? m[4].split(".") : [],
  };
}

function format(v: Semver): string {
  const core = `${v.major}.${v.minor}.${v.patch}`;
  return v.pre.length ? `${core}-${v.pre.join(".")}` : core;
}

/** Semver precedence: negative when a < b. */
export function compareSemver(a: string, b: string): number {
  const x = parseSemver(a);
  const y = parseSemver(b);
  const core = x.major - y.major || x.minor - y.minor || x.patch - y.patch;
  if (core) return core;
  // A stable version outranks any prerelease of the same core.
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

/**
 * The next version, with npm's `npm version <bump>` semantics: bumping a
 * prerelease to the level it already previews just drops the suffix
 * (1.2.0-beta.3 --minor--> 1.2.0), and `prerelease` on a stable version previews
 * the next patch (1.2.3 --> 1.2.4-beta.0).
 */
export function bumpVersion(current: string, bump: Bump): string {
  const v = parseSemver(current);
  const pre = v.pre.length > 0;
  switch (bump) {
    case "major":
      return pre && v.minor === 0 && v.patch === 0
        ? format({ ...v, pre: [] })
        : format({ major: v.major + 1, minor: 0, patch: 0, pre: [] });
    case "minor":
      return pre && v.patch === 0
        ? format({ ...v, pre: [] })
        : format({ ...v, minor: v.minor + 1, patch: 0, pre: [] });
    case "patch":
      return pre ? format({ ...v, pre: [] }) : format({ ...v, patch: v.patch + 1, pre: [] });
    case "prerelease": {
      if (!pre) return format({ ...v, patch: v.patch + 1, pre: [PREID, "0"] });
      const last = v.pre.at(-1) ?? "";
      const next = /^\d+$/.test(last)
        ? [...v.pre.slice(0, -1), String(Number(last) + 1)]
        : [...v.pre, "0"];
      return format({ ...v, pre: next });
    }
  }
}

/** Highest bump requested by `[major]` / `[minor]` / `[patch]` markers; patch by default. */
export function inferBump(subjects: readonly string[]): Exclude<Bump, "prerelease"> {
  let best: Exclude<Bump, "prerelease"> = "patch";
  for (const s of subjects) {
    const m = /\[(major|minor|patch)\]/i.exec(s);
    const marker = m?.[1]?.toLowerCase();
    if (marker === "major") return "major";
    if (marker === "minor") best = "minor";
  }
  return best;
}

/** The highest `vX.Y.Z[-pre]` tag, or null when nothing has been released. */
export function latestTag(tags: readonly string[]): string | null {
  const versions = tags
    .map((t) => t.trim())
    .filter((t) => t.startsWith("v") && SEMVER.test(t.slice(1)))
    .sort((a, b) => compareSemver(b.slice(1), a.slice(1)));
  return versions[0] ?? null;
}

export interface Plan {
  release: boolean;
  version: string;
  bump: Bump | "initial" | "none";
  previousTag: string | null;
}

export interface PlanInput {
  packageVersion: string;
  previousTag: string | null;
  /** Shipped paths differ from the previous tag. */
  changed: boolean;
  /**
   * HEAD is already contained in the previous tag — a "Re-run all jobs" of the
   * run that pushed it. Its checkout predates the version commit, so `changed`
   * reads true; releasing again would bump twice.
   */
  alreadyReleased: boolean;
  /** Subjects of the commits since the previous tag. */
  subjects: readonly string[];
  forcedBump: Bump | null;
}

export function plan(input: PlanInput): Plan {
  const { packageVersion, previousTag, changed, alreadyReleased, subjects, forcedBump } = input;
  if (previousTag && alreadyReleased) {
    return { release: false, version: previousTag.slice(1), bump: "none", previousTag };
  }
  if (!previousTag) {
    return forcedBump
      ? {
          release: true,
          version: bumpVersion(packageVersion, forcedBump),
          bump: forcedBump,
          previousTag,
        }
      : { release: true, version: packageVersion, bump: "initial", previousTag };
  }
  if (!changed && !forcedBump) {
    return { release: false, version: previousTag.slice(1), bump: "none", previousTag };
  }
  const bump = forcedBump ?? inferBump(subjects);
  return { release: true, version: bumpVersion(previousTag.slice(1), bump), bump, previousTag };
}

/** Replace the top-level `"version"` field without reformatting the manifest. */
export function setManifestVersion(manifest: string, version: string): string {
  parseSemver(version);
  const field = /^(\s*"version":\s*)"[^"]*"/m;
  if (!field.test(manifest)) throw new Error('package.json has no "version" field');
  return manifest.replace(field, `$1"${version}"`);
}

const LINK_REF = /^\[[^\]]+\]:\s/;
const UNRELEASED = "## [Unreleased]";

interface ChangelogParts {
  /** Everything before `## [Unreleased]`, heading excluded. */
  head: string;
  /** The Unreleased body, trimmed. */
  unreleased: string;
  /** Released sections, from the first `## [x.y.z]` heading on. */
  released: string;
  /** Trailing `[label]: url` link references. */
  links: string[];
}

function splitChangelog(text: string): ChangelogParts {
  const lines = text.replace(/\s+$/, "").split("\n");
  let linkStart = lines.length;
  while (
    linkStart > 0 &&
    (LINK_REF.test(lines[linkStart - 1] ?? "") || lines[linkStart - 1] === "")
  ) {
    linkStart--;
  }
  const links = lines.slice(linkStart).filter((l) => LINK_REF.test(l));
  const body = lines.slice(0, linkStart);

  const start = body.indexOf(UNRELEASED);
  if (start < 0) throw new Error(`CHANGELOG.md has no "${UNRELEASED}" heading`);
  let end = body.findIndex((l, i) => i > start && l.startsWith("## ["));
  if (end < 0) end = body.length;
  return {
    head: body.slice(0, start).join("\n").replace(/\s+$/, ""),
    unreleased: body
      .slice(start + 1, end)
      .join("\n")
      .trim(),
    released: body.slice(end).join("\n").trim(),
    links,
  };
}

/** Owner/repo web URL from package.json's `repository.url`. */
export function repoWebUrl(repositoryUrl: string): string {
  return repositoryUrl.replace(/^git\+/, "").replace(/\.git$/, "");
}

/**
 * Move the Unreleased entries under a dated `## [version]` heading and repoint
 * the link references. An empty Unreleased section is filled from the commit
 * subjects, so a release never goes out with no notes at all.
 */
export function cutChangelog(
  text: string,
  opts: {
    version: string;
    date: string;
    previousTag: string | null;
    repoUrl: string;
    subjects: readonly string[];
  },
): string {
  const { version, date, previousTag, repoUrl, subjects } = opts;
  const parts = splitChangelog(text);
  const fallback = subjects
    .map((s) => s.replace(/\s*\[(major|minor|patch)\]\s*/gi, " ").trim())
    .filter(Boolean)
    .map((s) => `- ${s}`);
  const entries =
    parts.unreleased ||
    (fallback.length ? `### Changed\n\n${fallback.join("\n")}` : "No changes recorded.");

  const tag = `v${version}`;
  const links = [
    `[Unreleased]: ${repoUrl}/compare/${tag}...HEAD`,
    previousTag
      ? `[${version}]: ${repoUrl}/compare/${previousTag}...${tag}`
      : `[${version}]: ${repoUrl}/releases/tag/${tag}`,
    ...parts.links.filter((l) => !l.startsWith("[Unreleased]:") && !l.startsWith(`[${version}]:`)),
  ];

  const sections = [parts.head, UNRELEASED, `## [${version}] - ${date}\n\n${entries}`];
  if (parts.released) sections.push(parts.released);
  return `${sections.join("\n\n")}\n\n${links.join("\n")}\n`;
}

/** The body of one released version's section — the GitHub release notes. */
export function releaseNotes(text: string, version: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start < 0) throw new Error(`CHANGELOG.md has no section for ${version}`);
  const end = lines.findIndex((l, i) => i > start && (l.startsWith("## [") || LINK_REF.test(l)));
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join("\n")
    .trim();
}

// ---------------------------------------------------------------------------
// CLI — the impure shell around the functions above.

const git = (...args: string[]): string => execFileSync("git", args, { encoding: "utf8" }).trim();

function subjectsSince(tag: string | null): string[] {
  const range = tag ? [`${tag}..HEAD`] : ["HEAD"];
  return git("log", ...range, "--no-merges", "--format=%s", "--", ...SHIPPED_PATHS)
    .split("\n")
    .filter((s) => s && !s.startsWith("release: v"));
}

function shippedChangedSince(tag: string): boolean {
  try {
    execFileSync("git", ["diff", "--quiet", tag, "HEAD", "--", ...SHIPPED_PATHS]);
    return false;
  } catch {
    return true;
  }
}

function isAncestor(commit: string, of: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", commit, of]);
    return true;
  } catch {
    return false;
  }
}

function readManifest(): { text: string; version: string; repository: { url: string } } {
  const text = readFileSync("package.json", "utf8");
  const json = JSON.parse(text) as { version: string; repository: { url: string } };
  return { text, version: json.version, repository: json.repository };
}

function parseBump(raw: string | undefined): Bump | null {
  const value = (raw ?? "").trim();
  // "auto" is the workflow_dispatch default; a push event leaves it empty.
  if (!value || value === "auto") return null;
  if (!(BUMPS as readonly string[]).includes(value)) {
    throw new Error(`invalid release_type "${value}" (expected auto, ${BUMPS.join(", ")})`);
  }
  return value as Bump;
}

function main(argv: string[]): void {
  const [command, ...args] = argv;
  switch (command) {
    case "plan": {
      const previousTag = latestTag(git("tag", "--list", "v*").split("\n"));
      const result = plan({
        packageVersion: readManifest().version,
        previousTag,
        changed: previousTag ? shippedChangedSince(previousTag) : true,
        alreadyReleased: previousTag ? isAncestor("HEAD", previousTag) : false,
        subjects: subjectsSince(previousTag),
        forcedBump: parseBump(process.env.FORCED_BUMP),
      });
      console.log(
        result.release
          ? `release v${result.version} (${result.bump}; previous ${previousTag ?? "none"})`
          : `no release: nothing under ${SHIPPED_PATHS.join(", ")} changed since ${previousTag}, or HEAD is already in it`,
      );
      const out = process.env.GITHUB_OUTPUT;
      if (out) {
        appendFileSync(
          out,
          [
            `release=${result.release}`,
            `version=${result.version}`,
            `bump=${result.bump}`,
            `previous_tag=${previousTag ?? ""}`,
            `prerelease=${parseSemver(result.version).pre.length > 0}`,
            "",
          ].join("\n"),
        );
      }
      return;
    }
    case "set-version": {
      const [version] = args;
      if (!version) throw new Error("usage: release.ts set-version <version>");
      writeFileSync("package.json", setManifestVersion(readManifest().text, version));
      return;
    }
    case "cut": {
      const [version, prev] = args;
      if (!version || !prev) throw new Error("usage: release.ts cut <version> <previous-tag|->");
      const previousTag = prev === "-" ? null : prev;
      const manifest = readManifest();
      writeFileSync("package.json", setManifestVersion(manifest.text, version));
      const changelog = cutChangelog(readFileSync("CHANGELOG.md", "utf8"), {
        version,
        date: new Date().toISOString().slice(0, 10),
        previousTag,
        repoUrl: repoWebUrl(manifest.repository.url),
        subjects: subjectsSince(previousTag),
      });
      writeFileSync("CHANGELOG.md", changelog);
      return;
    }
    case "notes": {
      const [version] = args;
      if (!version) throw new Error("usage: release.ts notes <version>");
      process.stdout.write(`${releaseNotes(readFileSync("CHANGELOG.md", "utf8"), version)}\n`);
      return;
    }
    default:
      throw new Error(
        "usage: release.ts plan | set-version <v> | cut <v> <prev-tag|-> | notes <v>",
      );
  }
}

if (import.meta.main) {
  try {
    main(Bun.argv.slice(2));
  } catch (err) {
    console.error(`release: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
