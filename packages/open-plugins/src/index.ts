/**
 * Open Plugins 0.1 format recognition and parsing.
 *
 * The package accepts a plugin directory and returns a format-specific parsed
 * record. It does not clone repositories, enumerate marketplaces, read agent
 * configuration, or write files.
 */
export type { Frontmatter } from "./frontmatter.ts";
export { parseFrontmatter, frontmatterString } from "./frontmatter.ts";
export type { PluginManifest } from "./manifest.ts";
export {
  MANIFEST_DIRS,
  ManifestParseError,
  parsePluginManifest,
  readManifest,
} from "./manifest.ts";
export type { NamedEntry, ParsedPlugin } from "./plugin.ts";
export { isPluginDir, parsePluginDir, parseSkillDir } from "./plugin.ts";
export { dirName } from "./path.ts";
