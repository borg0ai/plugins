/** Plugin discovery: marketplace index, root plugin, or recursive scan. */
import { join } from "path";
import { readFile, readdir, stat } from "fs/promises";
import { existsSync } from "fs";
import type { Discovered, Marketplace, Plugin, SkillEntry } from "./types.ts";

/** Manifest directories the format recognises, in priority order. */
const MANIFEST_DIRS = [".plugin", ".claude-plugin", ".cursor-plugin", ".codex-plugin"];

const MARKETPLACE_PATHS = [
  "marketplace.json",
  ...MANIFEST_DIRS.map((dir) => join(dir, "marketplace.json")),
];

const MARKDOWN = /\.(md|mdc|markdown)$/;

export async function discover(repoPath: string): Promise<Discovered> {
  for (const relative of MARKETPLACE_PATHS) {
    const mp = join(repoPath, relative);
    if (await fileExists(mp)) {
      const data = await readJson(mp);
      if (data && typeof data === "object" && "plugins" in data && Array.isArray(data.plugins)) {
        return discoverFromMarketplace(repoPath, data as Marketplace);
      }
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

async function scanForPlugins(dirPath: string, results: Plugin[], depth: number): Promise<void> {
  if (depth <= 0) return;
  const entries = await readDirSafe(dirPath);
  for (const entry of entries) {
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

async function discoverFromMarketplace(repoPath: string, marketplace: Marketplace): Promise<Discovered> {
  const plugins: Plugin[] = [];
  const remotePlugins: Discovered["remotePlugins"] = [];
  const missingPaths: string[] = [];
  const root = marketplace.metadata?.pluginRoot ?? ".";

  for (const entry of marketplace.plugins) {
    if (typeof entry.source !== "string") {
      remotePlugins.push({
        name: entry.name ?? "",
        description: entry.description,
        source: entry.source,
      });
      continue;
    }
    const sourcePath = join(repoPath, root, entry.source.replace(/^\.\//, ""));
    if (!(await dirExists(sourcePath))) {
      missingPaths.push(entry.source);
      continue;
    }

    let skills: SkillEntry[];
    if (Array.isArray(entry.skills)) {
      skills = [];
      for (const skillPath of entry.skills) {
        const resolved = join(repoPath, root, skillPath.replace(/^\.\//, ""));
        const skillMd = join(resolved, "SKILL.md");
        if (await fileExists(skillMd)) {
          const fm = parseFrontmatter(await readFile(skillMd, "utf-8"));
          skills.push({ name: fm.name ?? dirName(resolved), description: fm.description ?? "" });
        }
      }
    } else {
      skills = await discoverSkills(sourcePath);
    }

    const manifest = await readManifest(sourcePath);
    const [commands, agents, rules, hasHooks, hasMcp, hasLsp] = await Promise.all([
      discoverCommands(sourcePath),
      discoverAgents(sourcePath),
      discoverRules(sourcePath),
      fileExists(join(sourcePath, "hooks", "hooks.json")),
      fileExists(join(sourcePath, ".mcp.json")),
      fileExists(join(sourcePath, ".lsp.json")),
    ]);

    plugins.push({
      name: entry.name || (typeof manifest?.name === "string" ? manifest.name : "") || dirName(sourcePath),
      version: entry.version || (typeof manifest?.version === "string" ? manifest.version : undefined),
      description:
        entry.description || (typeof manifest?.description === "string" ? manifest.description : undefined),
      path: sourcePath,
      marketplace: marketplace.name,
      skills,
      commands,
      agents,
      rules,
      hasHooks,
      hasMcp,
      hasLsp,
      manifest,
      explicitSkillPaths: entry.skills,
      marketplaceEntry: entry,
    });
  }
  return { plugins, remotePlugins, missingPaths };
}

async function isPluginDir(dirPath: string): Promise<boolean> {
  const checks = [
    ...MANIFEST_DIRS.map((dir) => join(dirPath, dir, "plugin.json")),
    join(dirPath, "skills"),
    join(dirPath, "commands"),
    join(dirPath, "agents"),
    join(dirPath, "SKILL.md"),
  ];
  for (const check of checks) {
    if (await pathExists(check)) return true;
  }
  return false;
}

async function inspectPlugin(pluginPath: string): Promise<Plugin | null> {
  const manifest = await readManifest(pluginPath);
  const name = typeof manifest?.name === "string" ? manifest.name : dirName(pluginPath);
  const [skills, commands, agents, rules, hasHooks, hasMcp, hasLsp] = await Promise.all([
    discoverSkills(pluginPath),
    discoverCommands(pluginPath),
    discoverAgents(pluginPath),
    discoverRules(pluginPath),
    fileExists(join(pluginPath, "hooks", "hooks.json")),
    fileExists(join(pluginPath, ".mcp.json")),
    fileExists(join(pluginPath, ".lsp.json")),
  ]);
  return {
    name,
    version: typeof manifest?.version === "string" ? manifest.version : undefined,
    description: typeof manifest?.description === "string" ? manifest.description : undefined,
    path: pluginPath,
    skills,
    commands,
    agents,
    rules,
    hasHooks,
    hasMcp,
    hasLsp,
    manifest,
  };
}

async function readManifest(pluginPath: string): Promise<Record<string, unknown> | null> {
  for (const dir of MANIFEST_DIRS) {
    const manifestPath = join(pluginPath, dir, "plugin.json");
    if (await fileExists(manifestPath)) {
      const parsed = await readJson(manifestPath);
      if (parsed) return parsed as Record<string, unknown>;
    }
  }
  return null;
}

async function discoverSkills(pluginPath: string): Promise<SkillEntry[]> {
  const skillsDir = join(pluginPath, "skills");
  const entries = await readDirSafe(skillsDir);
  const skills: SkillEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillMd = join(skillsDir, entry.name, "SKILL.md");
    if (await fileExists(skillMd)) {
      const fm = parseFrontmatter(await readFile(skillMd, "utf-8"));
      skills.push({ name: fm.name ?? entry.name, description: fm.description ?? "" });
    }
  }
  if (skills.length === 0) {
    const rootSkill = join(pluginPath, "SKILL.md");
    if (await fileExists(rootSkill)) {
      const fm = parseFrontmatter(await readFile(rootSkill, "utf-8"));
      skills.push({ name: fm.name ?? dirName(pluginPath), description: fm.description ?? "" });
    }
  }
  return skills;
}

async function discoverCommands(pluginPath: string): Promise<SkillEntry[]> {
  return discoverMarkdownDir(join(pluginPath, "commands"));
}

async function discoverAgents(pluginPath: string): Promise<SkillEntry[]> {
  const dir = join(pluginPath, "agents");
  const entries = await readDirSafe(dir);
  const agents: SkillEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.match(MARKDOWN)) continue;
    const fm = parseFrontmatter(await readFile(join(dir, entry.name), "utf-8"));
    if (fm.name && fm.description) agents.push({ name: fm.name, description: fm.description });
  }
  return agents;
}

async function discoverRules(pluginPath: string): Promise<SkillEntry[]> {
  return discoverMarkdownDir(join(pluginPath, "rules"));
}

async function discoverMarkdownDir(dir: string): Promise<SkillEntry[]> {
  const entries = await readDirSafe(dir);
  const found: SkillEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.match(MARKDOWN)) continue;
    const fm = parseFrontmatter(await readFile(join(dir, entry.name), "utf-8"));
    found.push({ name: entry.name.replace(MARKDOWN, ""), description: fm.description ?? "" });
  }
  return found;
}

/** Minimal YAML frontmatter reader: flat `key: value` pairs only. */
export function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match?.[1]) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w[\w-]*):\s*(.+)$/);
    if (!kv) continue;
    let val = kv[2]!.trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[kv[1]!] = val;
  }
  return result;
}

function dirName(p: string): string {
  const parts = p.replace(/\/$/, "").split("/");
  return parts[parts.length - 1] ?? "unknown";
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

function pathExists(p: string): boolean {
  return existsSync(p);
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return null;
  }
}

async function readDirSafe(dirPath: string) {
  try {
    return await readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}
