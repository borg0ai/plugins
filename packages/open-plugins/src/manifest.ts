/** Open Plugins 0.1 `plugin.json` manifest parsing. */
import { join } from "node:path";
import { readFile, stat } from "node:fs/promises";

/** Parsed `plugin.json`, as read from disk. */
export interface PluginManifest {
  name?: string;
  version?: string;
  description?: string;
  author?: { name?: string; [key: string]: unknown };
  license?: string;
  keywords?: string[];
  [key: string]: unknown;
}

/** Manifest directories the format recognises, in priority order. */
export const MANIFEST_DIRS = [
  ".plugin",
  ".claude-plugin",
  ".cursor-plugin",
  ".codex-plugin",
  ".opencode-plugin",
];

/** A `plugin.json` file that exists but cannot be parsed into a manifest. */
export class ManifestParseError extends Error {
  /** Path of the manifest that failed to parse. */
  readonly manifestPath: string;

  constructor(message: string, manifestPath: string) {
    super(message);
    this.name = "ManifestParseError";
    this.manifestPath = manifestPath;
  }
}

/**
 * Strictly parses the raw contents of a `plugin.json` file. Throws a
 * {@link ManifestParseError} naming the file when the content is not valid
 * JSON or is not a JSON object.
 */
export function parsePluginManifest(raw: string, manifestPath = "plugin.json"): PluginManifest {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ManifestParseError(`Invalid JSON in ${manifestPath}: ${detail}`, manifestPath);
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    const kind = Array.isArray(data) ? "an array" : data === null ? "null" : typeof data;
    throw new ManifestParseError(
      `${manifestPath} must contain a JSON object, got ${kind}`,
      manifestPath,
    );
  }

  return data as PluginManifest;
}

/**
 * Reads the first parseable manifest in a plugin directory, in
 * {@link MANIFEST_DIRS} priority order. Returns null when no manifest exists
 * or none of the candidate files parses.
 */
export async function readManifest(pluginPath: string): Promise<PluginManifest | null> {
  for (const dir of MANIFEST_DIRS) {
    const manifestPath = join(pluginPath, dir, "plugin.json");
    if (!(await fileExists(manifestPath))) continue;
    try {
      return parsePluginManifest(await readFile(manifestPath, "utf-8"), manifestPath);
    } catch {
      // Unparseable here; a lower-priority manifest directory may still win.
    }
  }
  return null;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
