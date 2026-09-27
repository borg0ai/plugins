/**
 * Installation. Each target is installed through its own native plugin system;
 * nothing is copied into a foreign layout. The vendor-neutral `.plugin/`
 * manifest is translated into whatever that target reads.
 */
import { dirname, join, relative } from "path";
import { mkdir, cp, readFile, readdir, rename, writeFile, rm } from "fs/promises";
import { existsSync } from "fs";
import { execFileSync, execSync } from "child_process";
import { homedir } from "os";
import { createHash } from "crypto";
import { barDebug, barLine, c, step, stepDone, warn } from "./ui.ts";
import type { InstallResult, Plugin, Scope, Target } from "./types.ts";

/** Targets that only support per-user installs. */
const PER_USER_ONLY = ["grok", "kimi", "github-copilot", "vscode", "opencode"];

let cachePopulated = false;

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
          break;
        }
        barDebug(c.dim("Falling back to direct file-based install"));
      }
      const workspace = await stageInstallWorkspace(plugins, repoPath, target.id);
      await installToClaudeCode(workspace.plugins, scope, workspace.repoPath, source);
      break;
    }
    case "cursor": {
      if (cachePopulated) return;
      const workspace = await stageInstallWorkspace(plugins, repoPath, target.id);
      await installToCursor(workspace.plugins, scope, workspace.repoPath, source);
      break;
    }
    case "codex": {
      const officialRef = getOfficialCodexPluginRef(source);
      if (officialRef) {
        installViaCodexCli(officialRef);
        break;
      }
      const workspace = await stageInstallWorkspace(plugins, repoPath, target.id);
      await installToCodex(workspace.plugins, scope, workspace.repoPath, source);
      break;
    }
    case "grok": {
      const nativeSource = getGrokNativeSource(source, plugins, repoPath);
      if (nativeSource) {
        await installToGrok(plugins, nativeSource);
        break;
      }
      const workspace = await stageInstallWorkspace(plugins, repoPath, target.id);
      await installToGrok(workspace.plugins);
      break;
    }
    case "kimi": {
      const workspace = await stageInstallWorkspace(plugins, repoPath, target.id);
      await installToKimi(workspace.plugins);
      break;
    }
    case "github-copilot": {
      await installToGitHubCopilot(plugins, repoPath, source);
      break;
    }
    case "vscode": {
      const workspace = await stageInstallWorkspace(plugins, repoPath, target.id);
      await installToVsCode(workspace.plugins);
      break;
    }
    case "opencode": {
      const workspace = await stageInstallWorkspace(plugins, repoPath, target.id);
      await installToOpenCode(workspace.plugins, workspace.repoPath);
      break;
    }
    default:
      throw new Error(`Unsupported target: ${target.id}`);
  }
}

/* ------------------------------------------------------------------ staging */

export async function stageInstallWorkspace(
  plugins: Plugin[],
  repoPath: string,
  targetId: string,
  stagingBaseDir = join(homedir(), ".cache", "opencode-plugins", ".install-staging"),
): Promise<{ repoPath: string; plugins: Plugin[] }> {
  const stageKey = createHash("sha1").update(repoPath).digest("hex");
  const stageRoot = join(stagingBaseDir, stageKey, targetId);
  const stagedRepoPath = join(stageRoot, "repo");
  await mkdir(stageRoot, { recursive: true });
  await rm(stagedRepoPath, { recursive: true, force: true });
  await cp(repoPath, stagedRepoPath, { recursive: true });
  const stagedPlugins = plugins.map((plugin) => {
    const relPath = relative(repoPath, plugin.path);
    return { ...plugin, path: relPath === "" ? stagedRepoPath : join(stagedRepoPath, relPath) };
  });
  return { repoPath: stagedRepoPath, plugins: stagedPlugins };
}

/* ------------------------------------------------------- official shortcuts */

const OFFICIAL_MARKETPLACE_SOURCE = "anthropics/claude-plugins-official";

function getGitHubSourceRepo(source: string): string | null {
  const shorthand = source.match(/^([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
  if (shorthand) return shorthand[1]!.toLowerCase();
  const https = source.match(/^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
  if (https) return https[1]!.toLowerCase();
  const ssh = source.match(/^git@github\.com:([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
  if (ssh) return ssh[1]!.toLowerCase();
  return null;
}

function getOfficialPluginRef(source: string): string | null {
  return getGitHubSourceRepo(source) === "vercel/vercel-plugin" ? "vercel@claude-plugins-official" : null;
}

function getOfficialCodexPluginRef(source: string): string | null {
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
    barDebug(c.dim(`Claude CLI install failed: ${err instanceof Error ? err.message : String(err)}`));
    return false;
  }
}

function installViaCodexCli(pluginRef: string): void {
  step(`Installing ${c.cyan(pluginRef)} via Codex marketplace`);
  runNativeCommand("Codex", "codex", ["plugin", "add", pluginRef]);
  stepDone(`Installed ${c.cyan(pluginRef)} via Codex marketplace`);
}

/* ------------------------------------------------------------- Claude Code */

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
  if (process.platform === "win32") {
    await installToCursorExtensions(plugins, scope, repoPath, source);
    return;
  }
  await installToPluginCache(plugins, scope, repoPath, source);
}

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
  barDebug("");
  await prepareForClaudeCode(plugins, repoPath, marketplaceName);

  step("Registering marketplace");
  await mkdir(pluginsDir, { recursive: true });
  const knownPath = join(pluginsDir, "known_marketplaces.json");
  let knownMarketplaces: Record<string, unknown> = {};
  if (existsSync(knownPath)) {
    try {
      knownMarketplaces = JSON.parse(await readFile(knownPath, "utf-8"));
    } catch {
      /* treat as empty */
    }
  }
  const githubRepo = extractGitHubRepo(source);
  const marketplacesDir = join(pluginsDir, "marketplaces");
  const marketplaceInstallLocation = join(marketplacesDir, marketplaceName);
  await mkdir(marketplacesDir, { recursive: true });
  if (existsSync(marketplaceInstallLocation)) {
    await rm(marketplaceInstallLocation, { recursive: true, force: true });
  }
  await cp(repoPath, marketplaceInstallLocation, { recursive: true });
  barDebug(c.dim(`Marketplace copied to ${marketplaceInstallLocation}`));

  if (knownMarketplaces[marketplaceName]) {
    stepDone(`Marketplace ${c.dim(`'${marketplaceName}'`)} already registered`);
  } else {
    let marketplaceSource: unknown;
    if (githubRepo) {
      marketplaceSource = { source: "github", repo: githubRepo };
    } else if (isRemoteSource(source)) {
      const gitUrl = normalizeGitUrl(source);
      marketplaceSource = { source: "git", url: gitUrl.endsWith(".git") ? gitUrl : `${gitUrl}.git` };
    } else {
      marketplaceSource = { source: "directory", path: repoPath };
    }
    knownMarketplaces[marketplaceName] = {
      source: marketplaceSource,
      installLocation: marketplaceInstallLocation,
      lastUpdated: new Date().toISOString(),
    };
    await writeFile(knownPath, JSON.stringify(knownMarketplaces, null, 2));
    stepDone("Marketplace registered");
  }
  barDebug("");

  const installedPath = join(pluginsDir, "installed_plugins.json");
  let installedData: { version: number; plugins: Record<string, unknown[]> } = {
    version: 2,
    plugins: {},
  };
  if (existsSync(installedPath)) {
    try {
      const parsed = JSON.parse(await readFile(installedPath, "utf-8"));
      installedData.version = parsed.version ?? 2;
      installedData.plugins = parsed.plugins ?? {};
    } catch {
      /* keep defaults */
    }
  }
  const gitSha = tryGitSha(repoPath);
  const versionKey = gitSha ? gitSha.slice(0, 12) : (plugins[0]?.version ?? "0.0.0");

  for (const plugin of plugins) {
    const pluginKey = `${plugin.name}@${marketplaceName}`;
    const version = plugin.version ?? "0.0.0";
    step(`Installing ${c.bold(pluginKey)}...`);
    const cacheDest = join(cacheDir, marketplaceName, plugin.name, versionKey);
    await mkdir(cacheDest, { recursive: true });
    await cp(plugin.path, cacheDest, { recursive: true });
    barDebug(c.dim(`Cached to ${cacheDest}`));
    const now = new Date().toISOString();
    const entry: Record<string, unknown> = {
      scope,
      installPath: cacheDest,
      version,
      installedAt: now,
      lastUpdated: now,
    };
    if (gitSha) entry.gitCommitSha = gitSha;
    installedData.plugins[pluginKey] = [entry];
    stepDone(`Installed ${c.cyan(pluginKey)}`);
  }
  await writeFile(installedPath, JSON.stringify(installedData, null, 2));

  const settingsPath = join(home, ".claude", "settings.json");
  let settings: Record<string, unknown> = {};
  let settingsCorrupted = false;
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(await readFile(settingsPath, "utf-8"));
    } catch {
      settingsCorrupted = true;
    }
  }
  if (settingsCorrupted) {
    warn("Could not parse ~/.claude/settings.json — skipping enabledPlugins update to avoid overwriting existing settings.");
    barLine(c.dim("You may need to manually enable the plugins in Claude Code settings."));
  } else {
    const enabled = (settings.enabledPlugins as Record<string, boolean>) ?? {};
    for (const plugin of plugins) {
      enabled[`${plugin.name}@${marketplaceName}`] = true;
    }
    settings.enabledPlugins = enabled;
    await writeFile(settingsPath, JSON.stringify(settings, null, 2));
  }
  cachePopulated = true;
}

async function installToCursorExtensions(
  plugins: Plugin[],
  scope: Scope,
  repoPath: string,
  source: string,
): Promise<void> {
  const marketplaceName = plugins[0]?.marketplace ?? deriveMarketplaceName(source);
  const extensionsDir = join(homedir(), ".cursor", "extensions");
  step("Preparing plugins for Cursor...");
  barDebug("");
  await prepareForClaudeCode(plugins, repoPath, marketplaceName);
  await mkdir(extensionsDir, { recursive: true });
  const extensionsJsonPath = join(extensionsDir, "extensions.json");
  let extensions: Record<string, unknown>[] = [];
  if (existsSync(extensionsJsonPath)) {
    try {
      const parsed = JSON.parse(await readFile(extensionsJsonPath, "utf-8"));
      if (Array.isArray(parsed)) extensions = parsed;
    } catch {
      /* keep empty */
    }
  }
  const gitSha = tryGitSha(repoPath);
  const versionKey = gitSha ? gitSha.slice(0, 12) : (plugins[0]?.version ?? "0.0.0");

  for (const plugin of plugins) {
    const identifier = `${marketplaceName}.${plugin.name}`;
    const version = plugin.version ?? "0.0.0";
    step(`Installing ${c.bold(`${plugin.name}@${marketplaceName}`)}...`);
    const folderName = `${marketplaceName}.${plugin.name}-${versionKey}`;
    const destDir = join(extensionsDir, folderName);
    await mkdir(destDir, { recursive: true });
    await cp(plugin.path, destDir, { recursive: true });
    extensions = extensions.filter((e) => (e.identifier as { id?: string })?.id !== identifier);
    extensions.push({
      identifier: { id: identifier },
      version,
      location: { $mid: 1, path: `/${destDir.replace(/\\/g, "/")}`, scheme: "file" },
      relativeLocation: folderName,
      metadata: { installedTimestamp: Date.now(), ...(gitSha ? { gitCommitSha: gitSha } : {}) },
    });
    stepDone(`Installed ${c.cyan(`${plugin.name}@${marketplaceName}`)}`);
  }
  await writeFile(extensionsJsonPath, JSON.stringify(extensions, null, 2));
  cachePopulated = true;
}

/* -------------------------------------------------------------------- Codex */

async function installToCodex(
  plugins: Plugin[],
  _scope: Scope,
  repoPath: string,
  source: string,
): Promise<void> {
  const marketplaceName = plugins[0]?.marketplace ?? deriveMarketplaceName(source);
  const home = homedir();
  const cacheDir = join(home, ".codex", "plugins", "cache");
  const configPath = join(home, ".codex", "config.toml");
  const marketplaceDir = join(home, ".agents", "plugins");
  const marketplacePath = join(marketplaceDir, "marketplace.json");
  step("Preparing plugins for Codex...");
  barDebug("");
  for (const plugin of plugins) {
    await preparePluginDirForVendor(plugin, ".codex-plugin", "CODEX_PLUGIN_ROOT");
    await enrichForCodex(plugin);
  }

  const gitSha = tryGitSha(repoPath);
  const versionKey = gitSha ?? "local";
  const pluginPaths: Record<string, string> = {};
  for (const plugin of plugins) {
    step(`Installing ${c.bold(`${plugin.name}@${marketplaceName}`)}...`);
    const cacheDest = join(cacheDir, marketplaceName, plugin.name, versionKey);
    await mkdir(cacheDest, { recursive: true });
    await cp(plugin.path, cacheDest, { recursive: true });
    pluginPaths[plugin.name] = cacheDest;
    stepDone(`Installed ${c.cyan(`${plugin.name}@${marketplaceName}`)}`);
  }

  step("Updating marketplace...");
  await mkdir(marketplaceDir, { recursive: true });
  let marketplace: { name: string; interface: unknown; plugins: Record<string, unknown>[] } = {
    name: "opencode-plugins",
    interface: { displayName: "Plugins CLI" },
    plugins: [],
  };
  if (existsSync(marketplacePath)) {
    try {
      const existing = JSON.parse(await readFile(marketplacePath, "utf-8"));
      if (existing && typeof existing === "object" && Array.isArray(existing.plugins)) {
        marketplace = existing;
      }
    } catch {
      /* keep default */
    }
  }
  for (const plugin of plugins) {
    const relPath = relative(home, pluginPaths[plugin.name]!);
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
    const pluginKey = `${plugin.name}@opencode-plugins`;
    const tomlSection = `[plugins."${pluginKey}"]`;
    if (configContent.includes(tomlSection)) continue;
    configContent += `\n${tomlSection}\nenabled = true\n`;
    configChanged = true;
  }
  if (configChanged) await writeFile(configPath, configContent);
  stepDone("Config updated");
}

async function enrichForCodex(plugin: Plugin): Promise<void> {
  const manifestPath = join(plugin.path, ".codex-plugin", "plugin.json");
  const manifest = await readJsonObject(manifestPath);
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
  const author = manifest.author as { name?: string } | undefined;
  const iface: Record<string, unknown> = {
    displayName: plugin.name.charAt(0).toUpperCase() + plugin.name.slice(1),
    shortDescription: plugin.description ?? "",
    developerName: author?.name ?? "Unknown",
    category: "Coding",
    capabilities: ["Interactive", "Write"],
  };
  if (manifest.homepage) iface.websiteURL = manifest.homepage;
  else if (manifest.repository) iface.websiteURL = manifest.repository;
  for (const candidate of ["assets/app-icon.png", "assets/icon.png", "assets/logo.png", "assets/logo.svg"]) {
    if (existsSync(join(plugin.path, candidate))) {
      iface.logo = `./${candidate}`;
      iface.composerIcon = `./${candidate}`;
      break;
    }
  }
  manifest.interface = iface;
  changed = true;
  if (changed) {
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    barDebug(c.dim(`${plugin.name}: enriched .codex-plugin/plugin.json for Codex`));
  }
}

/* --------------------------------------------------------------------- Grok */

async function installToGrok(plugins: Plugin[], source?: string): Promise<void> {
  step("Preparing plugins for Grok Build...");
  barDebug("");
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
  const message = err instanceof Error ? err.message : String(err);
  return /\balready installed\b/i.test(message);
}

function getGrokNativeSource(source: string, plugins: Plugin[], repoPath: string): string | null {
  if (plugins.length !== 1 || plugins[0]?.path !== repoPath) return null;
  if (!existsSync(join(repoPath, ".claude-plugin", "plugin.json"))) return null;
  const isGitSource =
    /^https?:\/\//.test(source) ||
    /^git@/.test(source) ||
    /^[\w.-]+\/[\w.-]+(?:\.git)?$/.test(source);
  return isGitSource ? source : null;
}

/* --------------------------------------------------------------------- Kimi */

async function installToKimi(plugins: Plugin[]): Promise<void> {
  step("Preparing plugins for Kimi Code...");
  barDebug("");
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
    installed.plugins = installed.plugins.filter((entry) => entry.id !== plugin.name);
    installed.plugins.push({
      id: plugin.name,
      root: managedRoot,
      source: "local-path",
      enabled: existing?.enabled ?? true,
      installedAt: existing?.installedAt ?? now,
      updatedAt: now,
      originalSource: plugin.path,
      ...(existing?.capabilities ? { capabilities: existing.capabilities } : {}),
      ...(existing?.github ? { github: existing.github } : {}),
    });
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
}

type KimiRecord = {
  id: string;
  root: string;
  source: string;
  enabled: boolean;
  installedAt: string;
  updatedAt: string;
  originalSource: string;
  capabilities?: unknown;
  github?: unknown;
};

async function copyToKimiManagedRoot(kimiHome: string, pluginId: string, sourceRoot: string): Promise<string> {
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

async function readKimiInstalledFile(path: string): Promise<{ version: 1; plugins: KimiRecord[] }> {
  if (!existsSync(path)) return { version: 1, plugins: [] };
  const parsed = await readJsonObject(path);
  if (!parsed || !Array.isArray(parsed.plugins)) {
    throw new Error(`Could not parse ${path}; Kimi plugin records were left unchanged.`);
  }
  return { version: 1, plugins: parsed.plugins as KimiRecord[] };
}

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
    /* no compatibility layer to clean */
  }
  const mcpPath = join(kimiHome, "mcp.json");
  const mcpConfig = await readJsonObject(mcpPath);
  const servers = mcpConfig?.mcpServers;
  if (!servers || typeof servers !== "object") return;
  const entries = Object.entries(servers as Record<string, unknown>);
  const retained = Object.fromEntries(
    entries.filter(([name]) => !prefixes.some((prefix) => name.startsWith(prefix))),
  );
  if (Object.keys(retained).length === entries.length) return;
  mcpConfig.mcpServers = retained;
  await writeFile(mcpPath, JSON.stringify(mcpConfig, null, 2));
}

async function enrichForKimi(plugin: Plugin): Promise<void> {
  const manifestPath = join(plugin.path, ".kimi-plugin", "plugin.json");
  const manifest = await readJsonObject(manifestPath);
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
    manifest.mcpServers = mcpConfig.mcpServers;
    changed = true;
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

async function readKimiHooks(pluginPath: string, declaredHooks: unknown): Promise<unknown[]> {
  let source = declaredHooks;
  if (typeof declaredHooks === "string") {
    source = await readJsonObject(join(pluginPath, declaredHooks.replace(/^\.\//, "")));
  }
  if (!source) {
    source = await readJsonObject(join(pluginPath, "hooks", "hooks.json"));
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) return [];
  const hookMap = (source as { hooks?: unknown }).hooks;
  if (!hookMap || typeof hookMap !== "object" || Array.isArray(hookMap)) return [];
  const result: Record<string, unknown>[] = [];
  for (const [event, groups] of Object.entries(hookMap as Record<string, unknown>)) {
    if (!Array.isArray(groups)) continue;
    for (const raw of groups) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const group = raw as { hooks?: unknown; matcher?: unknown };
      const hooks = Array.isArray(group.hooks) ? group.hooks : [group];
      for (const rawHook of hooks) {
        if (!rawHook || typeof rawHook !== "object" || Array.isArray(rawHook)) continue;
        const hook = rawHook as { type?: unknown; command?: unknown; timeout?: unknown };
        if (hook.type !== "command" || typeof hook.command !== "string") continue;
        const kimiHook: Record<string, unknown> = { event, command: hook.command };
        if (typeof group.matcher === "string") kimiHook.matcher = group.matcher;
        if (typeof hook.timeout === "number") kimiHook.timeout = hook.timeout;
        result.push(kimiHook);
      }
    }
  }
  return result;
}

/* --------------------------------------------------------- GitHub Copilot */

async function installToGitHubCopilot(plugins: Plugin[], repoPath: string, source: string): Promise<void> {
  step("Preparing plugins for GitHub Copilot CLI...");
  barDebug("");
  const sourceHasMarketplace = hasCopilotMarketplaceManifest(repoPath);
  const marketplaceName = plugins[0]?.marketplace ?? deriveMarketplaceName(source);
  let marketplaceSource = source;
  let marketplacePlugins = plugins;
  if (!sourceHasMarketplace) {
    const workspace = await stageGitHubCopilotMarketplace(plugins, repoPath, marketplaceName);
    marketplaceSource = workspace.repoPath;
    marketplacePlugins = workspace.plugins;
  }
  step("Registering plugin marketplace in GitHub Copilot CLI...");
  try {
    runNativeCommand("GitHub Copilot CLI", "copilot", ["plugin", "marketplace", "add", marketplaceSource]);
  } catch (err) {
    barDebug(c.dim(`Copilot marketplace registration returned: ${String(err)}`));
  }
  stepDone("Plugin marketplace registered in GitHub Copilot CLI");
  for (const plugin of marketplacePlugins) {
    const pluginRef = `${plugin.name}@${marketplaceName}`;
    step(`Installing ${c.bold(pluginRef)}...`);
    runNativeCommand("GitHub Copilot CLI", "copilot", ["plugin", "install", pluginRef]);
    stepDone(`Installed ${c.cyan(pluginRef)}`);
  }
}

function hasCopilotMarketplaceManifest(repoPath: string): boolean {
  return [
    join(repoPath, "marketplace.json"),
    join(repoPath, ".github", "plugin", "marketplace.json"),
    join(repoPath, ".claude-plugin", "marketplace.json"),
  ].some((p) => existsSync(p));
}

async function stageGitHubCopilotMarketplace(
  plugins: Plugin[],
  repoPath: string,
  marketplaceName: string,
  stagingBaseDir = join(homedir(), ".cache", "opencode-plugins", "copilot-marketplaces"),
): Promise<{ repoPath: string; plugins: Plugin[] }> {
  const workspace = await stageInstallWorkspace(plugins, repoPath, "github-copilot", stagingBaseDir);
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
  return workspace;
}

/* ------------------------------------------------------------------- VS Code */

async function installToVsCode(plugins: Plugin[]): Promise<void> {
  step("Preparing plugins for Visual Studio Code...");
  barDebug("");
  for (const plugin of plugins) {
    await preparePluginDirForVendor(plugin, ".plugin", "PLUGIN_ROOT");
  }
  step("Registering agent plugins in VS Code...");
  await addVsCodePluginLocations(plugins.map((plugin) => plugin.path));
  stepDone("Agent plugins registered in VS Code");
}

async function addVsCodePluginLocations(
  pluginPaths: string[],
  settingsPath = getVsCodeSettingsPathDefault(),
): Promise<void> {
  let settingsContent = "{}\n";
  if (existsSync(settingsPath)) {
    settingsContent = await readFile(settingsPath, "utf-8");
  }
  const settings = parseJsoncObject(settingsContent, settingsPath);
  const existing = settings["chat.pluginLocations"];
  if (existing !== undefined && (!existing || typeof existing !== "object" || Array.isArray(existing))) {
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
}

function getVsCodeSettingsPathDefault(): string {
  const home = homedir();
  const product = detectCodeBinary() || !detectCodeBinaryInsiders() ? "Code" : "Code - Insiders";
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", product, "User", "settings.json");
  }
  if (process.platform === "win32") {
    return join(
      process.env.APPDATA ?? join(home, "AppData", "Roaming"),
      product,
      "User",
      "settings.json",
    );
  }
  return join(home, ".config", product, "User", "settings.json");
}

function detectCodeBinary(): boolean {
  try {
    execSync("which code", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function detectCodeBinaryInsiders(): boolean {
  try {
    execSync("which code-insiders", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/* ----------------------------------------------------------------- OpenCode */

/**
 * OpenCode has no vendor manifest format. It reads skills from its skills
 * directories and loads behaviour from JS/TS modules named in `opencode.json`.
 * This mirrors the other targets: translate, then register with the native
 * system rather than copying a foreign tree.
 */
async function installToOpenCode(plugins: Plugin[], repoPath: string): Promise<void> {
  const configDir = getOpenCodeConfigDir();
  const pluginsDir = join(configDir, "plugins");
  const skillsDir = join(configDir, "skills");
  const managedDir = join(configDir, "plugins", "managed");
  const configPath = join(configDir, "opencode.json");

  step("Preparing plugins for OpenCode...");
  barDebug("");

  for (const plugin of plugins) {
    const managedRoot = join(managedDir, plugin.name);
    await rm(managedRoot, { recursive: true, force: true });
    await mkdir(dirname(managedRoot), { recursive: true });
    await cp(plugin.path, managedRoot, { recursive: true });
    await preparePluginDirForVendor({ ...plugin, path: managedRoot }, ".plugin", "PLUGIN_ROOT");
    barDebug(c.dim(`${plugin.name}: staged at ${managedRoot}`));

    // Skills are filesystem-discovered; OpenCode's plugin API cannot register them.
    for (const skill of plugin.skills) {
      const from = join(managedRoot, "skills", skill.name);
      if (!existsSync(from)) continue;
      const to = join(skillsDir, skill.name);
      await rm(to, { recursive: true, force: true });
      await mkdir(dirname(to), { recursive: true });
      await cp(from, to, { recursive: true });
      stepDone(`Installed skill ${c.cyan(skill.name)}`);
    }

    // Hooks, commands, agents, MCP and LSP need a module OpenCode can import.
    const adapterName = `${plugin.name}-plugin`;
    const needsAdapter =
      plugin.hasHooks || plugin.commands.length > 0 || plugin.agents.length > 0 || plugin.hasMcp || plugin.hasLsp;
    if (needsAdapter) {
      await writeFile(
        join(pluginsDir, `${adapterName}.js`),
        renderOpenCodeAdapter(plugin, managedRoot),
      );
      stepDone(`Wrote OpenCode adapter ${c.cyan(`${adapterName}.js`)}`);
    }

    if (plugin.hasLsp) {
      warn(`${plugin.name}: OpenCode has no plugin-scoped LSP registration; add the servers to opencode.json manually.`);
    }
  }

  step("Registering plugins in opencode.json...");
  const config = await readJsonObject(configPath);
  const next: Record<string, unknown> = config ?? {};
  const declared = Array.isArray(next.plugin) ? ([...next.plugin] as unknown[]) : [];
  for (const plugin of plugins) {
    const needsAdapter =
      plugin.hasHooks || plugin.commands.length > 0 || plugin.agents.length > 0 || plugin.hasMcp || plugin.hasLsp;
    if (!needsAdapter) continue;
    const entry = `./plugins/${plugin.name}-plugin.js`;
    if (!declared.includes(entry)) declared.push(entry);
  }
  if (declared.length > 0) next.plugin = declared;
  await mkdir(configDir, { recursive: true });
  await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`);
  stepDone("opencode.json updated");
  barDebug(c.dim(`Managed plugin root: ${repoPath}`));
}

/**
 * Emit an OpenCode plugin module.
 *
 * The vendor-neutral `SessionStart` hook has no OpenCode equivalent, so it is not
 * translated here. What OpenCode does document is `experimental.session.compacting`,
 * which lets a plugin push context that must survive a compaction. That is the only
 * hook this adapter claims to implement, and it is what keeps the workflow router
 * from being lost in a long session.
 */
function renderOpenCodeAdapter(plugin: Plugin, managedRoot: string): string {
  const root = JSON.stringify(managedRoot);
  const skillName = plugin.skills[0]?.name ?? "";
  const commands = plugin.commands.map((entry) => entry.name);
  const agents = plugin.agents.map((entry) => entry.name);
  return `// Generated by opencode-plugins for ${plugin.name}. Do not edit by hand.
//
// The vendor-neutral SessionStart hook has no OpenCode equivalent, so nothing is
// injected at session start. OpenCode discovers skills from disk and exposes them
// through its native \`skill\` tool, which already puts this plugin's name and
// description in front of the model. This adapter only preserves that router
// across compaction.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = ${root};
const SKILL_NAME = ${JSON.stringify(skillName)};
const COMMANDS = ${JSON.stringify(commands)};
const AGENTS = ${JSON.stringify(agents)};

function readSkillBody() {
  if (!SKILL_NAME) return "";
  const skillMd = join(PLUGIN_ROOT, "skills", SKILL_NAME, "SKILL.md");
  if (!existsSync(skillMd)) return "";
  return readFileSync(skillMd, "utf-8").replace(/^---\\r?\\n[\\s\\S]*?\\r?\\n---/, "").trim();
}

export const ${camel(plugin.name)}Plugin = async ({ client }) => {
  return {
    "experimental.session.compacting": async (_input, output) => {
      const body = readSkillBody();
      if (!body) return;
      output.context.push(
        \`Active plugin: ${plugin.name} (v\${${JSON.stringify(plugin.version ?? "0.0.0")}}). Commands: \${
          COMMANDS.length + AGENTS.length
        }. When compaction replaces context, re-read \${SKILL_NAME} before choosing a workflow.\\n\\n\${body}\`,
      );
      await client.app.log({
        body: {
          service: ${JSON.stringify(plugin.name)},
          level: "info",
          message: "workflow router preserved across compaction",
        },
      });
    },
  };
};
`;
}

function camel(name: string): string {
  return name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part, index) =>
      index === 0 ? part.charAt(0).toLowerCase() + part.slice(1) : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join("");
}

function getOpenCodeConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, "opencode");
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "opencode");
  }
  return join(homedir(), ".config", "opencode");
}

/* ------------------------------------------------------------------ helpers */

function runNativeCommand(label: string, command: string, args: string[]): string {
  try {
    return execFileSync(command, args, { encoding: "utf-8", stdio: "pipe", timeout: 120_000 });
  } catch (err) {
    const error = err as { stderr?: { toString(): string }; message?: string };
    const stderr = error.stderr?.toString().trim();
    throw new Error(`${label} installation failed.${stderr ? ` ${stderr}` : ` ${error.message ?? ""}`}`);
  }
}

async function readJsonObject(path: string): Promise<Record<string, any> | null> {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(await readFile(path, "utf-8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    /* unreadable or malformed */
  }
  return null;
}

function parseJsoncObject(content: string, filePath: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(removeTrailingJsoncCommas(stripJsoncComments(content)));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("root value is not an object");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not parse ${filePath}; VS Code settings were left unchanged. ${message}`);
  }
}

function stripJsoncComments(content: string): string {
  let result = "";
  let inString = false;
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i]!;
    if (inString) {
      result += char;
      if (char === "\\") {
        i += 1;
        result += content[i] ?? "";
      } else if (char === '"') {
        inString = false;
      }
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
        i += 1;
      }
      if (i < content.length) result += content[i];
      continue;
    }
    if (char === "/" && content[i + 1] === "*") {
      result += "  ";
      i += 2;
      while (i < content.length && !(content[i] === "*" && content[i + 1] === "/")) {
        result += content[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      if (i < content.length) {
        result += "  ";
        i += 1;
      }
      continue;
    }
    result += char;
  }
  return result;
}

function removeTrailingJsoncCommas(content: string): string {
  let result = "";
  let inString = false;
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i]!;
    if (inString) {
      result += char;
      if (char === "\\") i += 1;
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
      while (/\s/.test(content[next] ?? "")) next += 1;
      if (content[next] === "}" || content[next] === "]") continue;
    }
    result += char;
  }
  return result;
}

function updateJsoncRootProperty(content: string, key: string, value: unknown): string {
  const sanitized = stripJsoncComments(content);
  const property = findJsoncRootProperty(sanitized, key);
  const formattedValue = JSON.stringify(value, null, 2).replaceAll("\n", "\n  ");
  if (property.valueStart !== undefined && property.valueEnd !== undefined) {
    return `${content.slice(0, property.valueStart)}${formattedValue}${content.slice(property.valueEnd)}`;
  }
  const closingBrace = property.objectEnd - 1;
  let last = closingBrace - 1;
  while (last > property.objectStart && /\s/.test(sanitized[last] ?? "")) last -= 1;
  const hasEntries = last > property.objectStart;
  const separator = !hasEntries || sanitized[last] === "," ? "" : ",";
  const addition = `${separator}\n  ${JSON.stringify(key)}: ${formattedValue}\n`;
  return `${content.slice(0, closingBrace)}${addition}${content.slice(closingBrace)}`;
}

function findJsoncRootProperty(
  content: string,
  wantedKey: string,
): { objectStart: number; objectEnd: number; valueStart?: number; valueEnd?: number } {
  let index = skipWhitespace(content, 0);
  if (content[index] !== "{") throw new Error("VS Code settings must be a JSON object.");
  const objectStart = index;
  index += 1;
  for (;;) {
    index = skipWhitespace(content, index);
    if (content[index] === "}") return { objectStart, objectEnd: index + 1 };
    if (content[index] !== '"') throw new Error("Could not locate a VS Code settings property.");
    const keyStart = index;
    const keyEnd = findJsonStringEnd(content, keyStart);
    const key = JSON.parse(content.slice(keyStart, keyEnd)) as string;
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
      index += 1;
      continue;
    }
    if (content[index] === "}") return { objectStart, objectEnd: index + 1 };
    throw new Error("Could not locate a VS Code settings property.");
  }
}

function skipWhitespace(content: string, index: number): number {
  let i = index;
  while (/\s/.test(content[i] ?? "")) i += 1;
  return i;
}

function findJsonStringEnd(content: string, start: number): number {
  for (let index = start + 1; index < content.length; index += 1) {
    if (content[index] === "\\") index += 1;
    else if (content[index] === '"') return index + 1;
  }
  throw new Error("Unterminated JSON string.");
}

function findJsonValueEnd(content: string, start: number): number {
  const first = content[start];
  if (first === '"') return findJsonStringEnd(content, start);
  if (first !== "{" && first !== "[") {
    let index = start;
    while (index < content.length && !/[\s,}\]]/.test(content[index]!)) index += 1;
    return index;
  }
  const closers = [first === "{" ? "}" : "]"];
  for (let index = start + 1; index < content.length; index += 1) {
    const char = content[index];
    if (char === '"') {
      index = findJsonStringEnd(content, index) - 1;
    } else if (char === "{") {
      closers.push("}");
    } else if (char === "[") {
      closers.push("]");
    } else if (char === closers[closers.length - 1]) {
      closers.pop();
      if (closers.length === 0) return index + 1;
    }
  }
  throw new Error("Unterminated JSON value.");
}

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
      const entry: Record<string, unknown> = {
        name: p.name,
        source: rel === "" ? "./" : `./${rel}`,
        description: p.description ?? "",
      };
      if (p.version) entry.version = p.version;
      if (p.manifest?.author) entry.author = p.manifest.author;
      if (p.manifest?.license) entry.license = p.manifest.license;
      if (p.manifest?.keywords) entry.keywords = p.manifest.keywords;
      return entry;
    }),
  };
  await writeFile(join(claudePluginDir, "marketplace.json"), JSON.stringify(marketplaceJson, null, 2));
  for (const plugin of plugins) {
    await preparePluginDirForVendor(plugin, ".claude-plugin", "CLAUDE_PLUGIN_ROOT");
  }
}

function findClaudeOrNull(): string | null {
  try {
    const path = execSync("which claude", { encoding: "utf-8", stdio: "pipe" }).trim();
    if (path) return path;
  } catch {
    /* probe known locations */
  }
  const home = homedir();
  for (const candidate of [
    join(home, ".local", "bin", "claude"),
    join(home, ".bun", "bin", "claude"),
    "/usr/local/bin/claude",
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function preparePluginDirForVendor(
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
      `${JSON.stringify(
        { name: plugin.name, description: plugin.description ?? "", version: plugin.version ?? "0.0.0" },
        null,
        2,
      )}\n`,
    );
    barDebug(c.dim(`${plugin.name}: generated ${vendorDir}/plugin.json`));
  }
  await translateEnvVars(pluginPath, plugin.name, envVar);
}

const KNOWN_PLUGIN_ROOT_VARS = [
  "PLUGIN_ROOT",
  "CLAUDE_PLUGIN_ROOT",
  "CURSOR_PLUGIN_ROOT",
  "CODEX_PLUGIN_ROOT",
  "KIMI_PLUGIN_ROOT",
];

async function translateEnvVars(pluginPath: string, pluginName: string, envVar: string): Promise<void> {
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
      barDebug(c.dim(`${pluginName}: translated plugin root → \${${envVar}} in ${filePath.split("/").pop()}`));
    }
  }
}

function tryGitSha(repoPath: string): string | undefined {
  try {
    return execSync("git rev-parse HEAD", { cwd: repoPath, encoding: "utf-8", stdio: "pipe" }).trim();
  } catch {
    return undefined;
  }
}

export function deriveMarketplaceName(source: string): string {
  if (source.match(/^[\w-]+\/[\w.-]+$/)) return source.replace("/", "-");
  const sshMatch = source.match(/^git@[^:]+:(.+?)(?:\.git)?$/);
  if (sshMatch) {
    const parts = sshMatch[1]!.split("/").filter(Boolean);
    if (parts.length >= 2) return `${parts[parts.length - 2]}-${parts[parts.length - 1]}`;
  }
  try {
    const url = new URL(source);
    const parts = url.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
    if (parts.length >= 2) return `${parts[parts.length - 2]}-${parts[parts.length - 1]}`;
  } catch {
    /* not a URL */
  }
  const parts = source.replace(/\/$/, "").split("/");
  return parts[parts.length - 1] ?? "plugins";
}

function extractGitHubRepo(source: string): string | null {
  const shorthand = source.match(/^([\w-]+\/[\w.-]+)$/);
  if (shorthand) return shorthand[1]!;
  const httpsMatch = source.match(/^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
  if (httpsMatch) return httpsMatch[1]!;
  const sshMatch = source.match(/^git@github\.com:([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1]!;
  return null;
}

function isRemoteSource(source: string): boolean {
  return Boolean(
    source.match(/^[\w-]+\/[\w.-]+$/) ||
      source.startsWith("git@") ||
      source.startsWith("https://") ||
      source.startsWith("http://"),
  );
}

function normalizeGitUrl(source: string): string {
  if (source.match(/^[\w-]+\/[\w.-]+$/)) return `https://github.com/${source}`;
  const sshMatch = source.match(/^git@([^:]+):(.+?)\.git$/);
  if (sshMatch) return `https://${sshMatch[1]}/${sshMatch[2]}`;
  return source;
}

export async function isMarketplaceNew(marketplaceName: string): Promise<boolean> {
  const knownPath = join(homedir(), ".claude", "plugins", "known_marketplaces.json");
  if (!existsSync(knownPath)) return true;
  try {
    const data = JSON.parse(await readFile(knownPath, "utf-8")) as Record<string, unknown>;
    return !data[marketplaceName];
  } catch {
    return true;
  }
}

export async function setAutoUpdate(marketplaceName: string, enabled: boolean): Promise<void> {
  const knownPath = join(homedir(), ".claude", "plugins", "known_marketplaces.json");
  if (!existsSync(knownPath)) return;
  let data: Record<string, Record<string, unknown>> = {};
  try {
    data = JSON.parse(await readFile(knownPath, "utf-8"));
  } catch {
    return;
  }
  if (!data[marketplaceName]) return;
  data[marketplaceName]!.autoUpdate = enabled;
  await writeFile(knownPath, JSON.stringify(data, null, 2));
}
