#!/usr/bin/env bun
// npm entry point: run the TypeScript source directly under Bun (which strips
// types at runtime and resolves @opentui/core's native deps from node_modules —
// bundling can't, hence no build step for the npm package). Compiled standalone
// binaries are published separately on GitHub releases.
import "../src/index.ts";
