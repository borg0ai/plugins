/** Plugin discovery: marketplace index, root plugin, or recursive scan. */
import { join } from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import {
  MANIFEST_DIRS,
  dirName,
  isPluginDir,
  parsePluginDir,
  parseSkillDir,
} from "@borg0ai/open-plugins";
import type {
  DiscoverResult,
  Marketplace,
  MarketplaceEntry,
  NamedEntry,
  Plugin,
  RemotePlugin,
} from "./types.ts";

/** Where a `marketplace.json` may live, relative to the repo root. */
const MARKETPLACE_PATHS = [
  "marketplace.json",
  ...MANIFEST_DIRS.map((dir) => join(dir, "marketplace.json")),
];

/** Scans a repository for installable plugins. */
export async function discover(repoPath: string): Promise<DiscoverResult> {
  for (const relativePath of MARKETPLACE_PATHS) {
    const mp = join(repoPath, relativePath);
    if (await fileExists(mp)) {
      const data = await readJson(mp);
      if (isMarketplace(data)) return discoverFromMarketplace(repoPath, data);
    }
  }

  if (await isPluginDir(repoPath)) {
    const plugin = await inspectPlugin(repoPath);
    return { plugins: plugin ? [plugin] : [], remotePlugins: [], missingPaths: [] };
  }

  const plugins: Plugin[] = [];
  await scanForPlugins(repoPath, plugins, 2);
  return { plugins, remotePlugins: [], missingPaths: [] };
}

function isMarketplace(data: unknown): data is Marketplace {
  return !!data && typeof data === "object" && "plugins" in data && Array.isArray(data.plugins);
}

/** Walks up to `depth` levels looking for plugin directories. */
async function scanForPlugins(dirPath: string, results: Plugin[], depth: number): Promise<void> {
  if (depth <= 0) return;

  for (const entry of await readDirSafe(dirPath)) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const childPath = join(dirPath, entry.name);
    if (await isPluginDir(childPath)) {
      const plugin = await inspectPlugin(childPath);
      if (plugin) results.push(plugin);
    } else {
      await scanForPlugins(childPath, results, depth - 1);
    }
  }
}

/** Resolves every entry of a `marketplace.json` against the repo. */
async function discoverFromMarketplace(
  repoPath: string,
  marketplace: Marketplace,
): Promise<DiscoverResult> {
  const plugins: Plugin[] = [];
  const remotePlugins: RemotePlugin[] = [];
  const missingPaths: string[] = [];
  const root = marketplace.metadata?.pluginRoot ?? ".";

  for (const entry of marketplace.plugins) {
    if (typeof entry.source !== "string") {
      remotePlugins.push({
        name: entry.name ?? "",
        description: entry.description || undefined,
        source: entry.source,
      });
      continue;
    }

    const sourcePath = join(repoPath, root, entry.source.replace(/^\.\//, ""));
    if (!(await dirExists(sourcePath))) {
      missingPaths.push(entry.source);
      continue;
    }

    plugins.push(
      await buildMarketplacePlugin(
        repoPath,
        root,
        entry,
        entry.source,
        sourcePath,
        marketplace.name,
      ),
    );
  }

  return { plugins, remotePlugins, missingPaths };
}

/** Builds the plugin record for one local marketplace entry. */
async function buildMarketplacePlugin(
  repoPath: string,
  root: string,
  entry: MarketplaceEntry,
  source: string,
  sourcePath: string,
  marketplaceName: string | undefined,
): Promise<Plugin> {
  const parsed = await parsePluginDir(sourcePath);
  const skills =
    entry.skills && Array.isArray(entry.skills)
      ? await readExplicitSkills(repoPath, root, entry.skills)
      : parsed.skills;

  return {
    name: entry.name || parsed.manifest?.name || dirName(sourcePath),
    version: entry.version || parsed.manifest?.version || undefined,
    description: entry.description || parsed.manifest?.description || undefined,
    path: sourcePath,
    marketplace: marketplaceName,
    skills,
    commands: parsed.commands,
    agents: parsed.agents,
    rules: parsed.rules,
    hasHooks: parsed.hasHooks,
    hasMcp: parsed.hasMcp,
    hasLsp: parsed.hasLsp,
    manifest: parsed.manifest,
    explicitSkillPaths: entry.skills,
    marketplaceEntry: entry,
  };
}

/** Reads the SKILL.md of each explicitly listed skill path. */
async function readExplicitSkills(
  repoPath: string,
  root: string,
  skillPaths: string[],
): Promise<NamedEntry[]> {
  const skills: NamedEntry[] = [];
  for (const skillPath of skillPaths) {
    if (typeof skillPath !== "string") continue;
    const resolvedPath = join(repoPath, root, skillPath.replace(/^\.\//, ""));
    const entry = await parseSkillDir(resolvedPath);
    if (entry) skills.push(entry);
  }
  return skills;
}

/** Builds the normalized plugin record for one standalone plugin directory. */
async function inspectPlugin(pluginPath: string): Promise<Plugin | null> {
  const parsed = await parsePluginDir(pluginPath);

  return {
    name: parsed.manifest?.name ?? dirName(pluginPath),
    version: parsed.manifest?.version,
    description: parsed.manifest?.description,
    path: pluginPath,
    marketplace: undefined,
    skills: parsed.skills,
    commands: parsed.commands,
    agents: parsed.agents,
    rules: parsed.rules,
    hasHooks: parsed.hasHooks,
    hasMcp: parsed.hasMcp,
    hasLsp: parsed.hasLsp,
    manifest: parsed.manifest,
    explicitSkillPaths: undefined,
    marketplaceEntry: undefined,
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    return (await stat(dirPath)).isDirectory();
  } catch {
    return false;
  }
}

/** Reads and parses JSON, returning null for missing or invalid files. */
async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return null;
  }
}

/** Lists a directory, returning an empty list when it cannot be read. */
async function readDirSafe(dirPath: string) {
  try {
    return await readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}
