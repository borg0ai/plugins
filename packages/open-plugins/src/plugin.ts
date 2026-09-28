/**
 * Open Plugins 0.1 plugin-directory parsing: format recognition plus the
 * skills, commands, agents, rules and capability components.
 */
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter, frontmatterString } from "./frontmatter.ts";
import { MANIFEST_DIRS, readManifest } from "./manifest.ts";
import { dirName } from "./path.ts";
import type { PluginManifest } from "./manifest.ts";

/** A `SKILL.md`, command, agent or rule entry, reduced to name + description. */
export interface NamedEntry {
  name: string;
  description: string;
}

/** The parsed content of one Open Plugins 0.1 plugin directory. */
export interface ParsedPlugin {
  manifest: PluginManifest | null;
  skills: NamedEntry[];
  commands: NamedEntry[];
  agents: NamedEntry[];
  rules: NamedEntry[];
  hasHooks: boolean;
  hasMcp: boolean;
  hasLsp: boolean;
}

/** Markdown extensions treated as command, agent and rule files. */
const MARKDOWN = /\.(md|mdc|markdown)$/;

/**
 * True when a directory looks like a plugin rather than a container. Reads
 * only the directory itself; repository traversal is the caller's job.
 */
export async function isPluginDir(dirPath: string): Promise<boolean> {
  for (const dir of MANIFEST_DIRS) {
    if (pathExists(join(dirPath, dir, "plugin.json"))) return true;
  }
  for (const marker of ["skills", "commands", "agents", "rules", "SKILL.md", ".opencode-plugin"]) {
    if (pathExists(join(dirPath, marker))) return true;
  }
  return false;
}

/**
 * Parses one plugin directory: manifest, component entries and the
 * hooks/mcp/lsp capability flags. Reads only this directory and writes
 * nothing.
 */
export async function parsePluginDir(pluginPath: string): Promise<ParsedPlugin> {
  const manifest = await readManifest(pluginPath);
  const [skills, commands, agents, rules, hasHooks, hasMcp, hasLsp] = await Promise.all([
    discoverSkills(pluginPath),
    discoverMarkdownDir(pluginPath, "commands", "name"),
    discoverMarkdownDir(pluginPath, "agents", "frontmatter"),
    discoverMarkdownDir(pluginPath, "rules", "name"),
    fileExists(join(pluginPath, "hooks", "hooks.json")),
    fileExists(join(pluginPath, ".mcp.json")),
    fileExists(join(pluginPath, ".lsp.json")),
  ]);

  return { manifest, skills, commands, agents, rules, hasHooks, hasMcp, hasLsp };
}

/** Reads one `SKILL.md`; returns null when the file is missing. */
export async function parseSkillDir(dir: string): Promise<NamedEntry | null> {
  const skillMd = join(dir, "SKILL.md");
  if (!(await fileExists(skillMd))) return null;
  const fm = parseFrontmatter(await readFile(skillMd, "utf-8"));
  return {
    name: frontmatterString(fm, "name") ?? dirName(dir),
    description: frontmatterString(fm, "description") ?? "",
  };
}

/** Reads every `skills/<name>/SKILL.md`, falling back to a root SKILL.md. */
async function discoverSkills(pluginPath: string): Promise<NamedEntry[]> {
  const skillsDir = join(pluginPath, "skills");
  const skills: NamedEntry[] = [];

  for (const entry of await readDirSafe(skillsDir)) {
    if (!entry.isDirectory()) continue;
    const skill = await parseSkillDir(join(skillsDir, entry.name));
    if (skill) skills.push(skill);
  }

  if (skills.length === 0) {
    const rootSkill = await parseSkillDir(pluginPath);
    if (rootSkill) skills.push(rootSkill);
  }

  return skills;
}

/**
 * Reads a directory of markdown documents. `commands` and `rules` are named
 * after the file; `agents` must declare a name and description up front.
 */
async function discoverMarkdownDir(
  pluginPath: string,
  dir: "commands" | "agents" | "rules",
  mode: "name" | "frontmatter",
): Promise<NamedEntry[]> {
  const target = join(pluginPath, dir);
  const entries: NamedEntry[] = [];

  for (const entry of await readDirSafe(target)) {
    if (!entry.isFile() || !MARKDOWN.test(entry.name)) continue;
    const fm = parseFrontmatter(await readFile(join(target, entry.name), "utf-8"));
    if (mode === "frontmatter") {
      const name = frontmatterString(fm, "name");
      const description = frontmatterString(fm, "description");
      if (name && description) entries.push({ name, description });
      continue;
    }
    entries.push({
      name: entry.name.replace(MARKDOWN, ""),
      description: frontmatterString(fm, "description") ?? "",
    });
  }

  return entries;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function pathExists(p: string): boolean {
  return existsSync(p);
}

/** Lists a directory, returning an empty list when it cannot be read. */
async function readDirSafe(dirPath: string) {
  try {
    return await readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}
