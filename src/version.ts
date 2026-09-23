// The single source of truth is package.json: the release workflow stamps the
// next version there, and both the npm package (which ships package.json) and
// the compiled binary (which inlines this import) read it back.
import pkg from "../package.json" with { type: "json" };

export const VERSION: string = pkg.version;
