/** Per-target installation: staging, vendor manifests, and agent config files. */
import { dirname, join, relative } from "node:path";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { barDebug, barEmpty, barLine, c, step, stepDone, warn } from "./ui.ts";
import { getVsCodeSettingsPath } from "./targets.ts";
import { installToOpenCode } from "./opencode.ts";
import type { InstallResult, KimiHook, Plugin, Scope, StagedWorkspace, Target } from "./types.ts";

/** Targets whose native plugin systems only support per-user installs. */
const PER_USER_ONLY = ["grok", "kimi", "github-copilot", "vscode", "opencode"];

/** True once the Claude plugin cache has been populated this process. */
let cachePopulated = false;

/** Installs plugins into one target, converting any failure into a result. */
export async function installPlugins(
  plugins: Plugin[],
  target: Target,
  scope: Scope,
  repoPath: string,
  source: string,
): Promise<InstallResult> {
  try {
    await installPluginsUnsafe(plugins, target, scope, repoPath, source);
    return { succeeded: true };
  } catch (err) {
    return { succeeded: false, message: err instanceof Error ? err.message : String(err) };
  }
}

async function installPluginsUnsafe(
  plugins: Plugin[],
  target: Target,
  scope: Scope,
  repoPath: string,
  source: string,
): Promise<void> {
  if (scope !== "user" && PER_USER_ONLY.includes(target.id)) {
    warn(`${target.name} installs plugins per-user; ignoring the requested ${scope} scope.`);
  }

  switch (target.id) {
    case "claude-code": {
      const officialRef = getOfficialPluginRef(source);
      if (officialRef) {
        const ok = await installViaClaudeCli(officialRef, scope);
        if (ok) {
          cachePopulated = true;
          return;
        }
        barDebug(c.dim("Falling back to direct file-based install"));
      }
      const workspace = await stageInstallWorkspace(plugins, repoPath, target.id);
      await installToClaudeCode(workspace.plugins, scope, workspace.repoPath, source);
      return;
    }
    case "cursor": {
      if (cachePopulated) return;
      const workspace = await stageInstallWorkspace(plugins, repoPath, target.id);
      await installToCursor(workspace.plugins, scope, workspace.repoPath, source);
      return;
    }
    case "codex": {
      const officialRef = getOfficialCodexPluginRef(source);
      if (officialRef) {
        installViaCodexCli(officialRef);
        return;
      }
      const workspace = await stageInstallWorkspace(plugins, repoPath, target.id);
      await installToCodex(workspace.plugins, scope, workspace.repoPath, source);
      return;
    }
    case "grok": {
      const nativeSource = getGrokNativeSource(source, plugins, repoPath);
      if (nativeSource) {
        await installToGrok(plugins, nativeSource);
        return;
      }
      const workspace = await stageInstallWorkspace(plugins, repoPath, target.id);
      await installToGrok(workspace.plugins);
      return;
    }
    case "kimi": {
      const workspace = await stageInstallWorkspace(plugins, repoPath, target.id);
      await installToKimi(workspace.plugins);
      return;
    }
    case "github-copilot":
      await installToGitHubCopilot(plugins, repoPath, source);
      return;
    case "vscode": {
      const workspace = await stageInstallWorkspace(plugins, repoPath, target.id);
      await installToVsCode(workspace.plugins);
      return;
    }
    case "opencode": {
      const workspace = await stageInstallWorkspace(plugins, repoPath, target.id);
      await installToOpenCode(workspace.plugins, workspace.repoPath);
      return;
    }
    default:
      throw new Error(`Unsupported target: ${target.id}`);
  }
}

/**
 * Copies the repo into a cache directory so installs survive the user moving or
 * deleting their checkout, and rewrites each plugin path to its staged copy.
 */
export async function stageInstallWorkspace(
  plugins: Plugin[],
  repoPath: string,
  targetId: string,
  stagingBaseDir: string = join(homedir(), ".cache", "plugins", ".install-staging"),
): Promise<StagedWorkspace> {
  const stageKey = createHash("sha1").update(repoPath).digest("hex");
  const stageRoot = join(stagingBaseDir, stageKey, targetId);
  const stagedRepoPath = join(stageRoot, "repo");

  await mkdir(stageRoot, { recursive: true });
  await rm(stagedRepoPath, { recursive: true, force: true });
  await cp(repoPath, stagedRepoPath, { recursive: true });

  return {
    repoPath: stagedRepoPath,
    plugins: plugins.map((plugin) => {
      const relPath = relative(repoPath, plugin.path);
      return { ...plugin, path: relPath === "" ? stagedRepoPath : join(stagedRepoPath, relPath) };
    }),
  };
}

const OFFICIAL_MARKETPLACE_SOURCE = "anthropics/claude-plugins-official";

/** Reduces shorthand, https and ssh GitHub sources to `owner/repo`. */
export function getGitHubSourceRepo(source: string): string | null {
  const shorthand = source.match(/^([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
  if (shorthand?.[1]) return shorthand[1].toLowerCase();

  const https = source.match(/^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
  if (https?.[1]) return https[1].toLowerCase();

  const ssh = source.match(/^git@github\.com:([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
  if (ssh?.[1]) return ssh[1].toLowerCase();

  return null;
}

/** Plugins published in Anthropic's official Claude marketplace. */
export function getOfficialPluginRef(source: string): string | null {
  return getGitHubSourceRepo(source) === "vercel/vercel-plugin"
    ? "vercel@claude-plugins-official"
    : null;
}

/** Plugins published in OpenAI's curated Codex marketplace. */
export function getOfficialCodexPluginRef(source: string): string | null {
  return getGitHubSourceRepo(source) === "vercel/vercel-plugin" ? "vercel@openai-curated" : null;
}

async function installViaClaudeCli(pluginRef: string, scope: Scope): Promise<boolean> {
  const claude = findClaudeOrNull();
  if (!claude) return false;

  try {
    step("Registering official Claude marketplace");
    execSync(`${claude} plugin marketplace add ${OFFICIAL_MARKETPLACE_SOURCE}`, {
      stdio: "pipe",
      timeout: 120_000,
    });
    stepDone("Official marketplace registered");

    step(`Installing ${c.cyan(pluginRef)} via Claude CLI`);
    execSync(`${claude} plugin install "${pluginRef}" --scope ${scope}`, {
      stdio: "pipe",
      timeout: 120_000,
    });
    stepDone(`Installed ${c.cyan(pluginRef)} via Claude CLI`);
    return true;
  } catch (err) {
    barDebug(
      c.dim(`Claude CLI install failed: ${err instanceof Error ? err.message : String(err)}`),
    );
    return false;
  }
}

function installViaCodexCli(pluginRef: string): void {
  step(`Installing ${c.cyan(pluginRef)} via Codex marketplace`);
  runNativeCommand("Codex", "codex", ["plugin", "add", pluginRef]);
  stepDone(`Installed ${c.cyan(pluginRef)} via Codex marketplace`);
}

async function installToClaudeCode(
  plugins: Plugin[],
  scope: Scope,
  repoPath: string,
  source: string,
): Promise<void> {
  await installToPluginCache(plugins, scope, repoPath, source);
}

async function installToCursor(
  plugins: Plugin[],
  scope: Scope,
  repoPath: string,
  source: string,
): Promise<void> {
  if (cachePopulated) return;
  // Windows Cursor keeps plugins as extensions rather than in the plugin cache.
  if (process.platform === "win32") {
    await installToCursorExtensions(plugins, scope, repoPath, source);
    return;
  }
  await installToPluginCache(plugins, scope, repoPath, source);
}

/** The shared Claude Code / Cursor install: marketplace copy plus plugin cache. */
async function installToPluginCache(
  plugins: Plugin[],
  scope: Scope,
  repoPath: string,
  source: string,
): Promise<void> {
  const marketplaceName = plugins[0]?.marketplace ?? deriveMarketplaceName(source);
  const home = homedir();
  const pluginsDir = join(home, ".claude", "plugins");
  const cacheDir = join(pluginsDir, "cache");

  step("Preparing plugins for Cursor...");
  barEmpty();
  await prepareForClaudeCode(plugins, repoPath, marketplaceName);

  step("Registering marketplace");
  await mkdir(pluginsDir, { recursive: true });
  const knownPath = join(pluginsDir, "known_marketplaces.json");
  let knownMarketplaces: Record<string, KnownMarketplace> = {};
  if (existsSync(knownPath)) {
    knownMarketplaces =
      ((await readJsonObject(knownPath)) as Record<string, KnownMarketplace> | null) ?? {};
  }

  const githubRepo = extractGitHubRepo(source);
  const marketplacesDir = join(pluginsDir, "marketplaces");
  const marketplaceInstallLocation = join(marketplacesDir, marketplaceName);
  await mkdir(marketplacesDir, { recursive: true });
  await rm(marketplaceInstallLocation, { recursive: true, force: true });
  await cp(repoPath, marketplaceInstallLocation, { recursive: true });
  barDebug(c.dim(`Marketplace copied to ${marketplaceInstallLocation}`));

  if (knownMarketplaces[marketplaceName]) {
    stepDone(`Marketplace ${c.dim(`'${marketplaceName}'`)} already registered`);
  } else {
    const marketplaceSource = githubRepo
      ? { source: "github", repo: githubRepo }
      : isRemoteSource(source)
        ? { source: "git", url: withGitSuffix(normalizeGitUrl(source)) }
        : { source: "directory", path: repoPath };
    knownMarketplaces[marketplaceName] = {
      source: marketplaceSource,
      installLocation: marketplaceInstallLocation,
      lastUpdated: new Date().toISOString(),
    };
    await writeFile(knownPath, JSON.stringify(knownMarketplaces, null, 2));
    stepDone("Marketplace registered");
  }
  barEmpty();

  const installedPath = join(pluginsDir, "installed_plugins.json");
  let installedData: InstalledPluginsFile = { version: 2, plugins: {} };
  if (existsSync(installedPath)) {
    const parsed = (await readJsonObject(installedPath)) as Partial<InstalledPluginsFile> | null;
    installedData = {
      version: parsed?.version ?? 2,
      plugins: parsed?.plugins ?? {},
    };
  }

  const gitSha = tryGitSha(repoPath);
  for (const plugin of plugins) {
    const pluginRef = `${plugin.name}@${marketplaceName}`;
    const version = plugin.version ?? "0.0.0";
    const versionKey = gitSha ? gitSha.slice(0, 12) : version;

    step(`Installing ${c.bold(pluginRef)}...`);
    const cacheDest = join(cacheDir, marketplaceName, plugin.name, versionKey);
    await mkdir(cacheDest, { recursive: true });
    await cp(plugin.path, cacheDest, { recursive: true });
    barDebug(c.dim(`Cached to ${cacheDest}`));

    const now = new Date().toISOString();
    installedData.plugins[`${plugin.name}@${marketplaceName}`] = [
      {
        scope,
        installPath: cacheDest,
        version,
        installedAt: now,
        lastUpdated: now,
        ...(gitSha ? { gitCommitSha: gitSha } : {}),
      },
    ];
    stepDone(`Installed ${c.cyan(pluginRef)}`);
  }

  await writeFile(installedPath, JSON.stringify(installedData, null, 2));
  barDebug(c.dim("Updated installed_plugins.json"));

  const settingsPath = join(home, ".claude", "settings.json");
  const existingSettings = existsSync(settingsPath) ? await readJsonObject(settingsPath) : {};
  if (existingSettings === null && existsSync(settingsPath)) {
    // Unparseable settings must not be overwritten with a fresh object.
    warn(
      "Could not parse ~/.claude/settings.json — skipping enabledPlugins update to avoid overwriting existing settings.",
    );
    barLine(c.dim("You may need to manually enable the plugins in Claude Code settings."));
  } else {
    const settings = (existingSettings ?? {}) as Record<string, unknown>;
    const enabled = (settings.enabledPlugins ?? {}) as Record<string, boolean>;
    for (const plugin of plugins) enabled[`${plugin.name}@${marketplaceName}`] = true;
    settings.enabledPlugins = enabled;
    await writeFile(settingsPath, JSON.stringify(settings, null, 2));
    barDebug(c.dim("Updated settings.json enabledPlugins"));
  }

  cachePopulated = true;
}

/** One record in Claude Code's `known_marketplaces.json`. */
interface KnownMarketplace {
  source: unknown;
  installLocation: string;
  lastUpdated: string;
  autoUpdate?: boolean;
}

/** One record in Claude Code's `installed_plugins.json`. */
interface InstalledPlugin {
  scope: string;
  installPath: string;
  version: string;
  installedAt: string;
  lastUpdated: string;
  gitCommitSha?: string;
}

interface InstalledPluginsFile {
  version: number;
  plugins: Record<string, InstalledPlugin[]>;
}

function withGitSuffix(url: string): string {
  return url.endsWith(".git") ? url : `${url}.git`;
}

/** Reads the current commit of a repo, or null outside a checkout. */
function tryGitSha(repoPath: string): string | null {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
  } catch {
    return null;
  }
}

/** Windows Cursor install: plugins become entries in `extensions.json`. */
async function installToCursorExtensions(
  plugins: Plugin[],
  scope: Scope,
  repoPath: string,
  source: string,
): Promise<void> {
  const marketplaceName = plugins[0]?.marketplace ?? deriveMarketplaceName(source);
  const home = homedir();
  const extensionsDir = join(home, ".cursor", "extensions");

  step("Preparing plugins for Cursor...");
  barEmpty();
  await prepareForClaudeCode(plugins, repoPath, marketplaceName);

  await mkdir(extensionsDir, { recursive: true });
  const extensionsJsonPath = join(extensionsDir, "extensions.json");
  let extensions: CursorExtension[] = [];
  if (existsSync(extensionsJsonPath)) {
    const parsed = await readJsonObject(extensionsJsonPath);
    if (Array.isArray(parsed)) extensions = parsed as CursorExtension[];
  }

  const gitSha = tryGitSha(repoPath);
  for (const plugin of plugins) {
    const pluginRef = `${plugin.name}@${marketplaceName}`;
    const version = plugin.version ?? "0.0.0";
    const versionKey = gitSha ? gitSha.slice(0, 12) : version;
    const folderName = `${marketplaceName}.${plugin.name}-${versionKey}`;
    const destDir = join(extensionsDir, folderName);

    step(`Installing ${c.bold(pluginRef)}...`);
    await mkdir(destDir, { recursive: true });
    await cp(plugin.path, destDir, { recursive: true });
    barDebug(c.dim(`Copied to ${destDir}`));

    const identifier = `${marketplaceName}.${plugin.name}`;
    extensions = extensions.filter((e) => e?.identifier?.id !== identifier);
    extensions.push({
      identifier: { id: identifier },
      version,
      location: { $mid: 1, path: `/${destDir.replace(/\\/g, "/")}`, scheme: "file" },
      relativeLocation: folderName,
      metadata: {
        installedTimestamp: Date.now(),
        ...(gitSha ? { gitCommitSha: gitSha } : {}),
      },
    });
    stepDone(`Installed ${c.cyan(pluginRef)}`);
  }

  await writeFile(extensionsJsonPath, JSON.stringify(extensions, null, 2));
  barDebug(c.dim("Updated extensions.json"));
  cachePopulated = true;
}

interface CursorExtension {
  identifier: { id: string };
  version: string;
  location: { $mid: number; path: string; scheme: string };
  relativeLocation: string;
  metadata: { installedTimestamp: number; gitCommitSha?: string };
}

async function installToCodex(
  plugins: Plugin[],
  scope: Scope,
  repoPath: string,
  source: string,
): Promise<void> {
  const marketplaceName = plugins[0]?.marketplace ?? deriveMarketplaceName(source);
  const home = homedir();
  const cacheDir = join(home, ".codex", "plugins", "cache");
  const configPath = join(home, ".codex", "config.toml");
  const marketplaceDir = join(home, ".agents", "plugins");
  const marketplacePath = join(marketplaceDir, "marketplace.json");
  const marketplaceRoot = home;

  step("Preparing plugins for Codex...");
  barEmpty();
  for (const plugin of plugins) {
    await preparePluginDirForVendor(plugin, ".codex-plugin", "CODEX_PLUGIN_ROOT");
    await enrichForCodex(plugin);
  }

  const versionKey = tryGitSha(repoPath) ?? "local";
  const pluginPaths: Record<string, string> = {};
  for (const plugin of plugins) {
    const pluginRef = `${plugin.name}@${marketplaceName}`;
    step(`Installing ${c.bold(pluginRef)}...`);
    const cacheDest = join(cacheDir, marketplaceName, plugin.name, versionKey);
    await mkdir(cacheDest, { recursive: true });
    await cp(plugin.path, cacheDest, { recursive: true });
    pluginPaths[plugin.name] = cacheDest;
    barDebug(c.dim(`Cached to ${cacheDest}`));
    stepDone(`Installed ${c.cyan(pluginRef)}`);
  }

  step("Updating marketplace...");
  await mkdir(marketplaceDir, { recursive: true });
  let marketplace: {
    name: string;
    interface: { displayName: string };
    plugins: CodexMarketplaceEntry[];
  } = {
    name: "plugins-cli",
    interface: { displayName: "Plugins CLI" },
    plugins: [],
  };
  const existing = await readJsonObject(marketplacePath);
  if (existing && Array.isArray(existing.plugins)) {
    marketplace = existing as typeof marketplace;
  }
  for (const plugin of plugins) {
    const relPath = relative(marketplaceRoot, pluginPaths[plugin.name]!);
    marketplace.plugins = marketplace.plugins.filter((e) => e.name !== plugin.name);
    marketplace.plugins.push({
      name: plugin.name,
      source: { source: "local", path: `./${relPath}` },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Coding",
    });
  }
  await writeFile(marketplacePath, JSON.stringify(marketplace, null, 2));
  stepDone("Marketplace updated");

  step("Updating config.toml...");
  await mkdir(join(home, ".codex"), { recursive: true });
  let configContent = existsSync(configPath) ? await readFile(configPath, "utf-8") : "";
  let configChanged = false;
  for (const plugin of plugins) {
    const pluginKey = `${plugin.name}@plugins-cli`;
    const tomlSection = `[plugins."${pluginKey}"]`;
    if (configContent.includes(tomlSection)) {
      barDebug(c.dim(`${pluginKey} already in config.toml`));
      continue;
    }
    configContent += `\n${tomlSection}\nenabled = true\n`;
    configChanged = true;
    barDebug(c.dim(`Added ${pluginKey} to config.toml`));
  }
  if (configChanged) await writeFile(configPath, configContent);
  stepDone("Config updated");
}

interface CodexMarketplaceEntry {
  name: string;
  source: { source: string; path: string };
  policy: { installation: string; authentication: string };
  category: string;
}

/** Codex requires richer manifest metadata than the open-plugin format carries. */
export async function enrichForCodex(plugin: Plugin): Promise<void> {
  const codexManifestPath = join(plugin.path, ".codex-plugin", "plugin.json");
  if (!existsSync(codexManifestPath)) return;

  const manifest = (await readJsonObject(codexManifestPath)) as Record<string, unknown> | null;
  if (!manifest) return;
  if (manifest.interface) return;

  let changed = false;
  if (!manifest.skills && existsSync(join(plugin.path, "skills"))) {
    manifest.skills = "./skills/";
    changed = true;
  }
  if (!manifest.mcpServers && existsSync(join(plugin.path, ".mcp.json"))) {
    manifest.mcpServers = "./.mcp.json";
    changed = true;
  }
  if (!manifest.apps && existsSync(join(plugin.path, ".app.json"))) {
    manifest.apps = "./.app.json";
    changed = true;
  }

  const name = (manifest.name as string | undefined) ?? plugin.name;
  const description = (manifest.description as string | undefined) ?? plugin.description ?? "";
  const author = manifest.author as { name?: string } | undefined;
  const iface: Record<string, unknown> = {
    displayName: name.charAt(0).toUpperCase() + name.slice(1),
    shortDescription: description,
    developerName: author?.name ?? "Unknown",
    category: "Coding",
    capabilities: ["Interactive", "Write"],
  };
  if (typeof manifest.homepage === "string") iface.websiteURL = manifest.homepage;
  else if (typeof manifest.repository === "string") iface.websiteURL = manifest.repository;

  for (const candidate of [
    "assets/app-icon.png",
    "assets/icon.png",
    "assets/logo.png",
    "assets/logo.svg",
  ]) {
    if (existsSync(join(plugin.path, candidate))) {
      iface.logo = `./${candidate}`;
      iface.composerIcon = `./${candidate}`;
      break;
    }
  }

  manifest.interface = iface;
  changed = true;
  if (changed) {
    await writeFile(codexManifestPath, JSON.stringify(manifest, null, 2));
    barDebug(c.dim(`${plugin.name}: enriched .codex-plugin/plugin.json for Codex`));
  }
}

async function installToGrok(plugins: Plugin[], source?: string): Promise<void> {
  step("Preparing plugins for Grok Build...");
  barEmpty();

  if (source) {
    for (const plugin of plugins) {
      step(`Installing ${c.bold(plugin.name)} from source...`);
      installGrokPlugin(plugin.name, source);
    }
    return;
  }

  for (const plugin of plugins) {
    await preparePluginDirForVendor(plugin, ".claude-plugin", "CLAUDE_PLUGIN_ROOT");
  }
  for (const plugin of plugins) {
    step(`Installing ${c.bold(plugin.name)}...`);
    installGrokPlugin(plugin.name, plugin.path);
  }
}

function installGrokPlugin(pluginName: string, source: string): void {
  try {
    runNativeCommand("Grok Build", "grok", ["plugin", "install", source, "--trust"]);
    stepDone(`Installed ${c.cyan(pluginName)}`);
  } catch (err) {
    if (!isAlreadyInstalledError(err)) throw err;
    stepDone(`${c.cyan(pluginName)} is already installed`);
  }
}

function isAlreadyInstalledError(err: unknown): boolean {
  return /\balready installed\b/i.test(err instanceof Error ? err.message : String(err));
}

/** Grok can install a single plugin straight from a git source. */
function getGrokNativeSource(source: string, plugins: Plugin[], repoPath: string): string | null {
  if (plugins.length !== 1 || plugins[0]?.path !== repoPath) return null;
  if (!existsSync(join(repoPath, ".claude-plugin", "plugin.json"))) return null;
  const isGitSource =
    /^https?:\/\//.test(source) ||
    /^git@/.test(source) ||
    /^[\w.-]+\/[\w.-]+(?:\.git)?$/.test(source);
  return isGitSource ? source : null;
}

async function installToKimi(plugins: Plugin[]): Promise<void> {
  step("Preparing plugins for Kimi Code...");
  barEmpty();
  for (const plugin of plugins) {
    await preparePluginDirForVendor(plugin, ".kimi-plugin", "KIMI_PLUGIN_ROOT");
    await enrichForKimi(plugin);
  }
  await installToKimiNativeStore(plugins);
}

async function installToKimiNativeStore(plugins: Plugin[]): Promise<void> {
  const kimiHome = process.env.KIMI_CODE_HOME ?? join(homedir(), ".kimi-code");
  const pluginsDir = join(kimiHome, "plugins");
  const installedPath = join(pluginsDir, "installed.json");
  const installed = await readKimiInstalledFile(installedPath);

  for (const plugin of plugins) {
    const managedRoot = await copyToKimiManagedRoot(kimiHome, plugin.name, plugin.path);
    const existing = installed.plugins.find((entry) => entry.id === plugin.name);
    const now = new Date().toISOString();
    const record: KimiInstalledPlugin = {
      id: plugin.name,
      root: managedRoot,
      source: "local-path",
      enabled: existing?.enabled ?? true,
      installedAt: existing?.installedAt ?? now,
      updatedAt: now,
      originalSource: plugin.path,
      ...(existing?.capabilities ? { capabilities: existing.capabilities } : {}),
      ...(existing?.github ? { github: existing.github } : {}),
    };
    installed.plugins = installed.plugins.filter((entry) => entry.id !== plugin.name);
    installed.plugins.push(record);
    stepDone(`Installed ${c.cyan(plugin.name)}`);

    if (plugin.agents.length > 0 || plugin.hasLsp) {
      warn(`${plugin.name}: Kimi plugins do not currently support agents or LSP servers.`);
    }
  }

  await mkdir(pluginsDir, { recursive: true });
  const temporaryInstalledPath = `${installedPath}.tmp`;
  await writeFile(temporaryInstalledPath, JSON.stringify(installed, null, 2));
  await rename(temporaryInstalledPath, installedPath);
  await removeKimiCompatibilityLayer(plugins, kimiHome);
  barDebug(c.dim(`Updated ${installedPath}`));
}

interface KimiInstalledPlugin {
  id: string;
  root: string;
  source: string;
  enabled: boolean;
  installedAt: string;
  updatedAt: string;
  originalSource: string;
  capabilities?: unknown;
  github?: unknown;
}

/** Copies a plugin into Kimi's managed root, staging first for atomicity. */
async function copyToKimiManagedRoot(
  kimiHome: string,
  pluginId: string,
  sourceRoot: string,
): Promise<string> {
  const managedRoot = join(kimiHome, "plugins", "managed", pluginId);
  const managedDir = dirname(managedRoot);
  await mkdir(managedDir, { recursive: true });
  const stagingRoot = join(managedDir, `${pluginId}-${Date.now()}-${process.pid}`);
  await rm(stagingRoot, { recursive: true, force: true });
  await cp(sourceRoot, stagingRoot, { recursive: true });
  await rm(managedRoot, { recursive: true, force: true });
  await rename(stagingRoot, managedRoot);
  return managedRoot;
}

async function readKimiInstalledFile(path: string): Promise<{
  version: number;
  plugins: KimiInstalledPlugin[];
}> {
  if (!existsSync(path)) return { version: 1, plugins: [] };
  const parsed = await readJsonObject(path);
  if (!parsed || !Array.isArray(parsed.plugins)) {
    throw new Error(`Could not parse ${path}; Kimi plugin records were left unchanged.`);
  }
  return { version: 1, plugins: parsed.plugins as KimiInstalledPlugin[] };
}

/** Removes the flat skill and MCP entries older Kimi versions created. */
async function removeKimiCompatibilityLayer(plugins: Plugin[], kimiHome: string): Promise<void> {
  const prefixes = plugins.map((plugin) => `${plugin.name}-`);

  const skillsDir = join(kimiHome, "skills");
  try {
    for (const entry of await readdir(skillsDir, { withFileTypes: true })) {
      if (prefixes.some((prefix) => entry.name.startsWith(prefix))) {
        await rm(join(skillsDir, entry.name), { recursive: true, force: true });
      }
    }
  } catch {
    /* no compatibility layer to clean up */
  }

  const mcpPath = join(kimiHome, "mcp.json");
  const mcpConfig = await readJsonObject(mcpPath);
  if (!mcpConfig || typeof mcpConfig.mcpServers !== "object" || mcpConfig.mcpServers === null)
    return;
  const servers = mcpConfig.mcpServers as Record<string, unknown>;
  const retained = Object.fromEntries(
    Object.entries(servers).filter(([name]) => !prefixes.some((prefix) => name.startsWith(prefix))),
  );
  if (Object.keys(retained).length === Object.keys(servers).length) return;
  mcpConfig.mcpServers = retained;
  await writeFile(mcpPath, JSON.stringify(mcpConfig, null, 2));
}

/** Fills in the Kimi manifest's skills, commands, MCP servers and hooks. */
export async function enrichForKimi(plugin: Plugin): Promise<void> {
  const manifestPath = join(plugin.path, ".kimi-plugin", "plugin.json");
  const manifest = (await readJsonObject(manifestPath)) as Record<string, unknown> | null;
  if (!manifest) return;

  let changed = false;
  if (!manifest.skills && existsSync(join(plugin.path, "skills"))) {
    manifest.skills = "./skills/";
    changed = true;
  }
  if (!manifest.commands && existsSync(join(plugin.path, "commands"))) {
    manifest.commands = "./commands/";
    changed = true;
  }

  const mcpConfig = await readJsonObject(join(plugin.path, ".mcp.json"));
  if (mcpConfig?.mcpServers && typeof mcpConfig.mcpServers === "object") {
    if (manifest.mcpServers !== mcpConfig.mcpServers) {
      manifest.mcpServers = mcpConfig.mcpServers;
      changed = true;
    }
  }

  const kimiHooks = await readKimiHooks(plugin.path, manifest.hooks);
  if (kimiHooks.length > 0) {
    manifest.hooks = kimiHooks;
    changed = true;
  }

  if (changed) {
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    barDebug(c.dim(`${plugin.name}: enriched .kimi-plugin/plugin.json for Kimi Code`));
  }
}

/** Flattens Claude-style hook groups into Kimi's flat hook records. */
export async function readKimiHooks(
  pluginPath: string,
  declaredHooks: unknown,
): Promise<KimiHook[]> {
  let source = declaredHooks;
  if (typeof declaredHooks === "string") {
    source = await readJsonObject(join(pluginPath, declaredHooks.replace(/^\.\//, "")));
  }
  if (!source) source = await readJsonObject(join(pluginPath, "hooks", "hooks.json"));
  if (!source || typeof source !== "object" || Array.isArray(source)) return [];

  const hookMap = (source as { hooks?: unknown }).hooks;
  if (!hookMap || typeof hookMap !== "object" || Array.isArray(hookMap)) return [];

  const result: KimiHook[] = [];
  for (const [event, groups] of Object.entries(hookMap as Record<string, unknown>)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!group || typeof group !== "object" || Array.isArray(group)) continue;
      const groupRecord = group as { matcher?: unknown; hooks?: unknown };
      const hooks = Array.isArray(groupRecord.hooks) ? groupRecord.hooks : [groupRecord];
      for (const hook of hooks) {
        if (!hook || typeof hook !== "object" || Array.isArray(hook)) continue;
        const hookRecord = hook as { type?: unknown; command?: unknown; timeout?: unknown };
        if (hookRecord.type !== "command" || typeof hookRecord.command !== "string") continue;
        const kimiHook: KimiHook = { event, command: hookRecord.command };
        if (typeof groupRecord.matcher === "string") kimiHook.matcher = groupRecord.matcher;
        if (typeof hookRecord.timeout === "number") kimiHook.timeout = hookRecord.timeout;
        result.push(kimiHook);
      }
    }
  }
  return result;
}

async function installToGitHubCopilot(
  plugins: Plugin[],
  repoPath: string,
  source: string,
): Promise<void> {
  step("Preparing plugins for GitHub Copilot CLI...");
  barEmpty();

  const marketplaceName = plugins[0]?.marketplace ?? deriveMarketplaceName(source);
  let marketplaceSource = source;
  let marketplacePlugins = plugins;
  if (!hasCopilotMarketplaceManifest(repoPath)) {
    const workspace = await stageGitHubCopilotMarketplace(plugins, repoPath, marketplaceName);
    marketplaceSource = workspace.repoPath;
    marketplacePlugins = workspace.plugins;
  }

  step("Registering plugin marketplace in GitHub Copilot CLI...");
  try {
    runNativeCommand("GitHub Copilot CLI", "copilot", [
      "plugin",
      "marketplace",
      "add",
      marketplaceSource,
    ]);
  } catch (err) {
    barDebug(c.dim(`Copilot marketplace registration returned: ${String(err)}`));
  }
  stepDone("Plugin marketplace registered in GitHub Copilot CLI");

  for (const plugin of marketplacePlugins) {
    const pluginRef = `${plugin.name}@${marketplaceName}`;
    step(`Installing ${c.cyan(pluginRef)}...`);
    runNativeCommand("GitHub Copilot CLI", "copilot", ["plugin", "install", pluginRef]);
    stepDone(`Installed ${c.cyan(pluginRef)}`);
  }
}

function hasCopilotMarketplaceManifest(repoPath: string): boolean {
  return [
    join(repoPath, "marketplace.json"),
    join(repoPath, ".github", "plugin", "marketplace.json"),
    join(repoPath, ".claude-plugin", "marketplace.json"),
  ].some(existsSync);
}

/** Writes a durable Copilot marketplace into a staged copy of the repo. */
async function stageGitHubCopilotMarketplace(
  plugins: Plugin[],
  repoPath: string,
  marketplaceName: string,
  stagingBaseDir: string = join(homedir(), ".cache", "plugins", "copilot-marketplaces"),
): Promise<StagedWorkspace> {
  const workspace = await stageInstallWorkspace(
    plugins,
    repoPath,
    "github-copilot",
    stagingBaseDir,
  );

  for (const plugin of workspace.plugins) {
    await preparePluginDirForVendor(plugin, ".plugin", "PLUGIN_ROOT");
  }

  const marketplace = {
    name: marketplaceName,
    owner: { name: "plugins" },
    plugins: workspace.plugins.map((plugin) => {
      const relativePath = relative(workspace.repoPath, plugin.path);
      return {
        name: plugin.name,
        source: relativePath === "" ? "./" : `./${relativePath}`,
        description: plugin.description ?? "",
        ...(plugin.version ? { version: plugin.version } : {}),
      };
    }),
  };
  const marketplaceDir = join(workspace.repoPath, ".claude-plugin");
  await mkdir(marketplaceDir, { recursive: true });
  await writeFile(join(marketplaceDir, "marketplace.json"), JSON.stringify(marketplace, null, 2));
  barDebug(c.dim(`Generated durable Copilot marketplace at ${workspace.repoPath}`));
  return workspace;
}

async function installToVsCode(plugins: Plugin[]): Promise<void> {
  step("Preparing plugins for Visual Studio Code...");
  barEmpty();
  for (const plugin of plugins) {
    await preparePluginDirForVendor(plugin, ".plugin", "PLUGIN_ROOT");
  }
  step("Registering agent plugins in VS Code...");
  await addVsCodePluginLocations(plugins.map((plugin) => plugin.path));
  stepDone("Agent plugins registered in VS Code");
}

/** Adds plugin directories to `chat.pluginLocations` in VS Code settings. */
async function addVsCodePluginLocations(
  pluginPaths: string[],
  settingsPath: string = getVsCodeSettingsPath(),
): Promise<void> {
  const settingsContent = existsSync(settingsPath) ? await readFile(settingsPath, "utf-8") : "{}\n";
  const settings = parseJsoncObject(settingsContent, settingsPath);
  const existing = settings["chat.pluginLocations"];
  if (
    existing !== undefined &&
    (!existing || typeof existing !== "object" || Array.isArray(existing))
  ) {
    throw new Error(`${settingsPath}: chat.pluginLocations must be an object.`);
  }

  const locations: Record<string, boolean> = {};
  if (existing) {
    for (const [path, enabled] of Object.entries(existing as Record<string, unknown>)) {
      if (typeof enabled === "boolean") locations[path] = enabled;
    }
  }
  for (const pluginPath of pluginPaths) locations[pluginPath] = true;

  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(
    settingsPath,
    updateJsoncRootProperty(settingsContent, "chat.pluginLocations", locations),
  );
  barDebug(c.dim(`Updated ${settingsPath} chat.pluginLocations`));
}

/** Runs an agent's own installer, reporting its stderr on failure. */
function runNativeCommand(label: string, command: string, args: string[]): string {
  try {
    return execFileSync(command, args, { encoding: "utf-8", stdio: "pipe", timeout: 120_000 });
  } catch (err) {
    const failure = err as { stderr?: Buffer | string; message?: string };
    const stderr = failure.stderr?.toString().trim();
    throw new Error(
      `${label} installation failed.${stderr ? ` ${stderr}` : ` ${failure.message ?? ""}`}`,
    );
  }
}

/** Reads a JSON object, returning null for missing, invalid or non-object files. */
async function readJsonObject(path: string): Promise<Record<string, unknown> | null> {
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf-8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* unreadable or invalid JSON */
  }
  return null;
}

/** Parses a JSONC object, reporting the file path in any failure. */
export function parseJsoncObject(content: string, filePath: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(removeTrailingJsoncCommas(stripJsoncComments(content)));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("root value is not an object");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not parse ${filePath}; VS Code settings were left unchanged. ${message}`,
    );
  }
}

/** Blanks out `//` and block comments while preserving offsets and strings. */
export function stripJsoncComments(content: string): string {
  let result = "";
  let inString = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i]!;

    if (inString) {
      result += char;
      if (char === "\\") result += content[++i] ?? "";
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }

    if (char === "/" && content[i + 1] === "/") {
      result += "  ";
      i += 2;
      while (i < content.length && content[i] !== "\n") {
        result += " ";
        i++;
      }
      if (i < content.length) result += content[i];
      continue;
    }
    if (char === "/" && content[i + 1] === "*") {
      result += "  ";
      i += 2;
      while (i < content.length && !(content[i] === "*" && content[i + 1] === "/")) {
        result += content[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < content.length) {
        result += "  ";
        i++;
      }
      continue;
    }

    result += char;
  }
  return result;
}

/** Drops commas that directly precede a closing brace or bracket. */
export function removeTrailingJsoncCommas(content: string): string {
  let result = "";
  let inString = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i]!;

    if (inString) {
      result += char;
      if (char === "\\") result += content[++i] ?? "";
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }
    if (char === ",") {
      let next = i + 1;
      while (/\s/.test(content[next] ?? "")) next++;
      if (content[next] === "}" || content[next] === "]") continue;
    }

    result += char;
  }
  return result;
}

/** Replaces a root property in place, or appends it, keeping the rest verbatim. */
export function updateJsoncRootProperty(content: string, key: string, value: unknown): string {
  const sanitized = stripJsoncComments(content);
  const property = findJsoncRootProperty(sanitized, key);
  const formattedValue = JSON.stringify(value, null, 2).replaceAll("\n", "\n  ");

  if (property.valueStart !== undefined && property.valueEnd !== undefined) {
    return `${content.slice(0, property.valueStart)}${formattedValue}${content.slice(property.valueEnd)}`;
  }

  const closingBrace = property.objectEnd - 1;
  let last = closingBrace - 1;
  while (last > property.objectStart && /\s/.test(sanitized[last] ?? "")) last--;
  const separator = last <= property.objectStart || sanitized[last] === "," ? "" : ",";
  return `${content.slice(0, closingBrace)}${separator}
  ${JSON.stringify(key)}: ${formattedValue}
${content.slice(closingBrace)}`;
}

interface JsoncRootProperty {
  objectStart: number;
  objectEnd: number;
  valueStart?: number;
  valueEnd?: number;
}

function findJsoncRootProperty(content: string, wantedKey: string): JsoncRootProperty {
  let index = skipWhitespace(content, 0);
  if (content[index] !== "{") throw new Error("VS Code settings must be a JSON object.");
  const objectStart = index;
  index++;

  for (;;) {
    index = skipWhitespace(content, index);
    if (content[index] === "}") return { objectStart, objectEnd: index + 1 };
    if (content[index] !== '"') throw new Error("Could not locate a VS Code settings property.");

    const keyStart = index;
    const keyEnd = findJsonStringEnd(content, keyStart);
    const key: string = JSON.parse(content.slice(keyStart, keyEnd));
    index = skipWhitespace(content, keyEnd);
    if (content[index] !== ":") throw new Error("Could not locate a VS Code settings property.");

    const valueStart = skipWhitespace(content, index + 1);
    const valueEnd = findJsonValueEnd(content, valueStart);
    if (key === wantedKey) {
      return {
        objectStart,
        objectEnd: findJsonValueEnd(content, objectStart),
        valueStart,
        valueEnd,
      };
    }

    index = skipWhitespace(content, valueEnd);
    if (content[index] === ",") {
      index++;
      continue;
    }
    if (content[index] === "}") return { objectStart, objectEnd: index + 1 };
    throw new Error("Could not locate a VS Code settings property.");
  }
}

function skipWhitespace(content: string, index: number): number {
  let i = index;
  while (/\s/.test(content[i] ?? "")) i++;
  return i;
}

function findJsonStringEnd(content: string, start: number): number {
  for (let index = start + 1; index < content.length; index++) {
    if (content[index] === "\\") index++;
    else if (content[index] === '"') return index + 1;
  }
  throw new Error("Unterminated JSON string.");
}

function findJsonValueEnd(content: string, start: number): number {
  const first = content[start];
  if (first === '"') return findJsonStringEnd(content, start);

  if (first !== "{" && first !== "[") {
    let index = start;
    while (index < content.length && !/[\s,}\]]/.test(content[index]!)) index++;
    return index;
  }

  const closers = [first === "{" ? "}" : "]"];
  for (let index = start + 1; index < content.length; index++) {
    const char = content[index]!;
    if (char === '"') index = findJsonStringEnd(content, index) - 1;
    else if (char === "{") closers.push("}");
    else if (char === "[") closers.push("]");
    else if (char === closers[closers.length - 1]) {
      closers.pop();
      if (closers.length === 0) return index + 1;
    }
  }
  throw new Error("Unterminated JSON value.");
}

/** Writes a `marketplace.json` and per-plugin vendor manifests for Claude Code. */
async function prepareForClaudeCode(
  plugins: Plugin[],
  repoPath: string,
  marketplaceName: string,
): Promise<void> {
  const claudePluginDir = join(repoPath, ".claude-plugin");
  await mkdir(claudePluginDir, { recursive: true });

  const marketplaceJson = {
    name: marketplaceName,
    owner: { name: "plugins" },
    plugins: plugins.map((p) => {
      const rel = relative(repoPath, p.path);
      return {
        name: p.name,
        source: rel === "" ? "./" : `./${rel}`,
        description: p.description ?? "",
        ...(p.version ? { version: p.version } : {}),
        ...(p.manifest?.author ? { author: p.manifest.author } : {}),
        ...(p.manifest?.license ? { license: p.manifest.license } : {}),
        ...(p.manifest?.keywords ? { keywords: p.manifest.keywords } : {}),
      };
    }),
  };
  await writeFile(
    join(claudePluginDir, "marketplace.json"),
    JSON.stringify(marketplaceJson, null, 2),
  );
  barDebug(c.dim("Generated .claude-plugin/marketplace.json"));

  for (const plugin of plugins) {
    await preparePluginDirForVendor(plugin, ".claude-plugin", "CLAUDE_PLUGIN_ROOT");
  }
}

function findClaudeOrNull(): string | null {
  try {
    const path = execSync("which claude", { encoding: "utf-8", stdio: "pipe" }).trim();
    if (path) return path;
  } catch {
    /* not on PATH */
  }

  const home = homedir();
  const candidates = [
    join(home, ".local", "bin", "claude"),
    join(home, ".bun", "bin", "claude"),
    "/usr/local/bin/claude",
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Copies or synthesises `<vendorDir>/plugin.json` inside a plugin. */
export async function preparePluginDirForVendor(
  plugin: Plugin,
  vendorDir: string,
  envVar: string,
): Promise<void> {
  const pluginPath = plugin.path;
  const openPluginDir = join(pluginPath, ".plugin");
  const vendorPluginDir = join(pluginPath, vendorDir);
  const hasOpenPlugin = existsSync(join(openPluginDir, "plugin.json"));
  const hasVendorPlugin = existsSync(join(vendorPluginDir, "plugin.json"));

  if (hasOpenPlugin && !hasVendorPlugin) {
    await cp(openPluginDir, vendorPluginDir, { recursive: true });
    barDebug(c.dim(`${plugin.name}: translated .plugin/ → ${vendorDir}/`));
  }
  if (!hasOpenPlugin && !hasVendorPlugin) {
    await mkdir(vendorPluginDir, { recursive: true });
    await writeFile(
      join(vendorPluginDir, "plugin.json"),
      JSON.stringify(
        {
          name: plugin.name,
          description: plugin.description ?? "",
          version: plugin.version ?? "0.0.0",
        },
        null,
        2,
      ),
    );
    barDebug(c.dim(`${plugin.name}: generated ${vendorDir}/plugin.json`));
  }

  await translateEnvVars(pluginPath, plugin.name, envVar);
}

/** Plugin-root variables each vendor understands. */
const KNOWN_PLUGIN_ROOT_VARS = [
  "PLUGIN_ROOT",
  "CLAUDE_PLUGIN_ROOT",
  "CURSOR_PLUGIN_ROOT",
  "CODEX_PLUGIN_ROOT",
  "KIMI_PLUGIN_ROOT",
];

/** Rewrites other vendors' plugin-root variables to this vendor's own. */
async function translateEnvVars(
  pluginPath: string,
  pluginName: string,
  envVar: string,
): Promise<void> {
  const configFiles = [
    join(pluginPath, "hooks", "hooks.json"),
    join(pluginPath, ".mcp.json"),
    join(pluginPath, ".lsp.json"),
  ];
  const target = `\${${envVar}}`;
  const patterns = KNOWN_PLUGIN_ROOT_VARS.filter((v) => v !== envVar).map((v) => `\${${v}}`);

  for (const filePath of configFiles) {
    if (!existsSync(filePath)) continue;
    let content = await readFile(filePath, "utf-8");
    let changed = false;
    for (const pattern of patterns) {
      if (content.includes(pattern)) {
        content = content.replaceAll(pattern, target);
        changed = true;
      }
    }
    if (changed) {
      await writeFile(filePath, content);
      barDebug(
        c.dim(
          `${pluginName}: translated plugin root → \${${envVar}} in ${filePath.split("/").pop()}`,
        ),
      );
    }
  }
}

/** Derives a stable marketplace name from any supported source form. */
export function deriveMarketplaceName(source: string): string {
  if (source.match(/^[\w-]+\/[\w.-]+$/)) return source.replace("/", "-");

  const sshMatch = source.match(/^git@[^:]+:(.+?)(?:\.git)?$/);
  if (sshMatch?.[1]) {
    const parts = sshMatch[1].split("/").filter(Boolean);
    if (parts.length >= 2) return `${parts[parts.length - 2]}-${parts[parts.length - 1]}`;
  }

  try {
    const url = new URL(source);
    const parts = url.pathname
      .replace(/\.git$/, "")
      .split("/")
      .filter(Boolean);
    if (parts.length >= 2) return `${parts[parts.length - 2]}-${parts[parts.length - 1]}`;
  } catch {
    /* not a URL */
  }

  const parts = source.replace(/\/$/, "").split("/");
  return parts[parts.length - 1] || "plugins";
}

/** Extracts `owner/repo` for the GitHub marketplace source form. */
export function extractGitHubRepo(source: string): string | null {
  const shorthand = source.match(/^([\w-]+\/[\w.-]+)$/);
  if (shorthand?.[1]) return shorthand[1];
  const httpsMatch = source.match(/^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
  if (httpsMatch?.[1]) return httpsMatch[1];
  const sshMatch = source.match(/^git@github\.com:([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
  if (sshMatch?.[1]) return sshMatch[1];
  return null;
}

/** True when a source must be fetched rather than read from disk. */
export function isRemoteSource(source: string): boolean {
  if (source.match(/^[\w-]+\/[\w.-]+$/)) return true;
  return source.startsWith("git@") || source.startsWith("https://") || source.startsWith("http://");
}

/** Rewrites shorthand and ssh sources as https git URLs. */
export function normalizeGitUrl(source: string): string {
  if (source.match(/^[\w-]+\/[\w.-]+$/)) return `https://github.com/${source}`;
  const sshMatch = source.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch?.[1] && sshMatch[2]) return `https://${sshMatch[1]}/${sshMatch[2]}`;
  return source;
}

/** True when Claude Code has never seen this marketplace. */
export async function isMarketplaceNew(marketplaceName: string): Promise<boolean> {
  const knownPath = join(homedir(), ".claude", "plugins", "known_marketplaces.json");
  if (!existsSync(knownPath)) return true;
  try {
    const data = await readJsonObject(knownPath);
    return !data?.[marketplaceName];
  } catch {
    return true;
  }
}

/** Toggles `autoUpdate` for an already-registered marketplace. */
export async function setAutoUpdate(marketplaceName: string, enabled: boolean): Promise<void> {
  const knownPath = join(homedir(), ".claude", "plugins", "known_marketplaces.json");
  const data = await readJsonObject(knownPath);
  if (!data) return;

  const entry = data[marketplaceName] as KnownMarketplace | undefined;
  if (!entry) return;
  entry.autoUpdate = enabled;
  await writeFile(knownPath, JSON.stringify(data, null, 2));
}
