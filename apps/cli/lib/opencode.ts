/**
 * OpenCode installation.
 *
 * OpenCode has no vendor manifest format. It reads skills from its skills
 * directories and loads behaviour from JS modules named in `opencode.json`.
 * This mirrors the other targets: translate, then register with the native
 * system rather than copying a foreign tree.
 */
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { cp, mkdir, access, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { homedir, tmpdir } from "node:os";
import { barDebug, c, step, stepDone, warn } from "./ui.ts";
import { preparePluginDirForVendor } from "./install.ts";
import type { NamedEntry, Plugin } from "./types.ts";

const execFileAsync = promisify(execFile);

/** True when a path exists, for conflict checks before writing. */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * OpenCode reads plugins and config from an XDG-style directory. `XDG_CONFIG_HOME`
 * is honoured because OpenCode itself resolves its config through XDG_CONFIG_HOME.
 */
export function getOpenCodeConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, "opencode");
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "opencode");
  }
  return join(homedir(), ".config", "opencode");
}

/** True when the plugin has behaviour that needs an OpenCode module. */
function needsAdapter(plugin: Plugin): boolean {
  return (
    plugin.hasHooks ||
    plugin.commands.length > 0 ||
    plugin.agents.length > 0 ||
    plugin.hasMcp ||
    plugin.hasLsp
  );
}

/** Markdown extensions the plugin format allows for a component file. */
const MARKDOWN = /\.(md|mdc|markdown)$/;

/** A config field the CLI owns entries in, and therefore must be able to clear. */
const OWNED_FIELDS = ["mcp", "command", "agent", "lsp"] as const;

/** What a plugin contributes to `opencode.json`, keyed by config field. */
type Translation = Partial<Record<(typeof OWNED_FIELDS)[number], Record<string, unknown>>> & {
  instructions?: string[];
};

/**
 * Locates a component file by its discovery name, which may have been derived
 * from a frontmatter `name` rather than the filename.
 */
async function findComponentFile(dir: string, name: string): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !MARKDOWN.test(entry.name)) continue;
    if (entry.name.replace(MARKDOWN, "") === name) return join(dir, entry.name);
  }
  return null;
}

/** The markdown body of a component file, with its frontmatter removed. */
async function readComponentBody(path: string): Promise<string> {
  const raw = await readFile(path, "utf-8");
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

/**
 * Replaces plugin-root variables with the managed absolute path. OpenCode's
 * `mcp`, `lsp`, and `command` fields hold plain values, so a variable left in
 * place would never be expanded at runtime.
 */
function resolveRootVars(value: string, managedRoot: string): string {
  return value.replace(
    /\$\{(?:PLUGIN_ROOT|CLAUDE_PLUGIN_ROOT|CURSOR_PLUGIN_ROOT|CODEX_PLUGIN_ROOT|KIMI_PLUGIN_ROOT)\}/g,
    managedRoot,
  );
}

/** Translates one MCP server definition into OpenCode's shape. */
function translateMcpServer(
  name: string,
  server: Record<string, unknown>,
  managedRoot: string,
): Record<string, unknown> | null {
  if (typeof server.url === "string") {
    const entry: Record<string, unknown> = {
      type: "remote",
      url: resolveRootVars(server.url, managedRoot),
      enabled: true,
    };
    if (server.headers && typeof server.headers === "object") entry.headers = server.headers;
    if (typeof server.timeout === "number") entry.timeout = server.timeout;
    return entry;
  }

  if (typeof server.command === "string") {
    const argv = [server.command, ...toStringArray(server.args)].map((part) =>
      resolveRootVars(part, managedRoot),
    );
    const entry: Record<string, unknown> = { type: "local", command: argv, enabled: true };
    if (server.env && typeof server.env === "object") {
      entry.environment = mapStrings(server.env as Record<string, unknown>, (v) =>
        resolveRootVars(v, managedRoot),
      );
    }
    return entry;
  }

  return null;
}

/** Translates one LSP server definition into OpenCode's shape. */
function translateLspServer(
  name: string,
  server: Record<string, unknown>,
  managedRoot: string,
): Record<string, unknown> | null {
  if (server.disabled === true) return { disabled: true };
  if (typeof server.command !== "string") return null;

  const argv = [server.command, ...toStringArray(server.args)].map((part) =>
    resolveRootVars(part, managedRoot),
  );
  const entry: Record<string, unknown> = { command: argv };
  if (server.extensions) entry.extensions = toStringArray(server.extensions);
  if (server.env && typeof server.env === "object") {
    entry.env = mapStrings(server.env as Record<string, unknown>, (v) =>
      resolveRootVars(v, managedRoot),
    );
  }
  if (server.initialization && typeof server.initialization === "object") {
    entry.initialization = server.initialization;
  }
  return entry;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function mapStrings(
  source: Record<string, unknown>,
  fn: (value: string) => string,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string") result[key] = fn(value);
  }
  return result;
}

/**
 * Translates every non-skill component of a plugin into `opencode.json` fields.
 * Returns only the fields this plugin contributes to.
 */
async function translatePlugin(plugin: Plugin, managedRoot: string): Promise<Translation> {
  const result: Translation = {};

  if (plugin.hasMcp) {
    const mcpConfig = await readJsonObject(join(managedRoot, ".mcp.json"));
    const servers = mcpConfig?.mcpServers;
    if (servers && typeof servers === "object") {
      const entries: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(servers as Record<string, unknown>)) {
        if (!value || typeof value !== "object") continue;
        const entry = translateMcpServer(name, value as Record<string, unknown>, managedRoot);
        if (entry) entries[`${plugin.name}.${name}`] = entry;
      }
      if (Object.keys(entries).length > 0) result.mcp = entries;
    }
  }

  if (plugin.hasLsp) {
    const lspConfig = await readJsonObject(join(managedRoot, ".lsp.json"));
    // The plugin format is not fixed on a wrapper key, so accept either a
    // `servers` map or a bare map of server definitions.
    const servers =
      lspConfig?.servers && typeof lspConfig.servers === "object"
        ? (lspConfig.servers as Record<string, unknown>)
        : lspConfig;
    if (servers && typeof servers === "object") {
      const entries: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(servers)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const entry = translateLspServer(name, value as Record<string, unknown>, managedRoot);
        if (entry) entries[`${plugin.name}.${name}`] = entry;
      }
      if (Object.keys(entries).length > 0) result.lsp = entries;
    }
  }

  for (const command of plugin.commands) {
    const file = await findComponentFile(join(managedRoot, "commands"), command.name);
    if (!file) continue;
    const entry: Record<string, unknown> = {
      template: resolveRootVars(await readComponentBody(file), managedRoot),
    };
    if (command.description) entry.description = command.description;
    (result.command ??= {})[command.name] = entry;
  }

  for (const agent of plugin.agents) {
    const file = await findComponentFile(join(managedRoot, "agents"), agent.name);
    if (!file) continue;
    const entry: Record<string, unknown> = {
      prompt: resolveRootVars(await readComponentBody(file), managedRoot),
      mode: "subagent",
    };
    if (agent.description) entry.description = agent.description;
    (result.agent ??= {})[agent.name] = entry;
  }

  const instructions: string[] = [];
  for (const rule of plugin.rules) {
    const file = await findComponentFile(join(managedRoot, "rules"), rule.name);
    if (file) instructions.push(file);
  }
  if (instructions.length > 0) result.instructions = instructions;

  return result;
}

/** Which config entries a plugin previously wrote, so a reinstall can replace them. */
interface Ownership {
  mcp?: string[];
  command?: string[];
  agent?: string[];
  lsp?: string[];
  instructions?: string[];
  /** Name of the native module the CLI installed, used to detect conflicts. */
  module?: string;
}

const OWNERSHIP_FILE = ".installed.json";

async function readOwnership(path: string): Promise<Record<string, Ownership>> {
  const data = await readJsonObject(path);
  return (data as Record<string, Ownership> | null) ?? {};
}

/**
 * Merges a translation into an existing config, removing the entries this same
 * plugin wrote on a previous install and leaving everything else untouched.
 *
 * Command and agent names are not namespaced, because users invoke them
 * directly, so ownership cannot be inferred from the key. It is tracked in a
 * sidecar manifest instead of being written into the user's config.
 */
function mergeTranslation(
  config: Record<string, unknown>,
  translation: Translation,
  previous: Ownership,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...config };

  for (const field of OWNED_FIELDS) {
    const existing = next[field];
    if (
      existing !== undefined &&
      (!existing || typeof existing !== "object" || Array.isArray(existing))
    ) {
      // A user value of the wrong shape is left untouched rather than clobbered.
      continue;
    }
    const base: Record<string, unknown> = { ...((existing as Record<string, unknown>) ?? {}) };
    for (const key of previous[field] ?? []) delete base[key];

    const incoming = translation[field] ?? {};
    const merged = { ...base, ...incoming };
    if (Object.keys(merged).length === 0) delete next[field];
    else next[field] = merged;
  }

  const ownedInstructions = previous.instructions ?? [];
  if (ownedInstructions.length > 0 || translation.instructions) {
    const existing = Array.isArray(next.instructions) ? (next.instructions as string[]) : [];
    const kept = existing.filter((p) => !ownedInstructions.includes(p));
    const merged = [...kept, ...(translation.instructions ?? [])];
    if (merged.length === 0) delete next.instructions;
    else next.instructions = merged;
  }

  return next;
}

/** Records the entries a translation wrote, for the next install to replace. */
function ownershipFor(translation: Translation): Ownership {
  const ownership: Ownership = {};
  for (const field of OWNED_FIELDS) {
    const keys = Object.keys(translation[field] ?? {});
    if (keys.length > 0) ownership[field] = keys;
  }
  if (translation.instructions && translation.instructions.length > 0) {
    ownership.instructions = translation.instructions;
  }
  return ownership;
}

/** OpenCode requires skill names to be lowercase alphanumerics, hyphen-separated. */
const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SKILL_NAME_MAX = 64;
const SKILL_DESCRIPTION_MAX = 1024;

/**
 * Reports why OpenCode would refuse to load a skill. OpenCode requires a name
 * matching its pattern that also equals the containing directory name, and a
 * non-empty description within its length limit.
 */
export function validateSkillForOpenCode(skill: NamedEntry): string[] {
  const problems: string[] = [];
  if (skill.name.length === 0 || skill.name.length > SKILL_NAME_MAX) {
    problems.push(`name must be 1-${SKILL_NAME_MAX} characters`);
  } else if (!SKILL_NAME.test(skill.name)) {
    problems.push(
      `name "${skill.name}" must be lowercase alphanumeric words separated by single hyphens`,
    );
  }
  if (skill.description.length === 0) {
    problems.push("description is required");
  } else if (skill.description.length > SKILL_DESCRIPTION_MAX) {
    problems.push(`description must be at most ${SKILL_DESCRIPTION_MAX} characters`);
  }
  return problems;
}

export async function installToOpenCode(plugins: Plugin[], repoPath: string): Promise<void> {
  const configDir = getOpenCodeConfigDir();
  const pluginsDir = join(configDir, "plugins");
  const skillsDir = join(configDir, "skills");
  const managedDir = join(configDir, "plugins", "managed");
  const configPath = join(configDir, "opencode.json");

  step("Preparing plugins for OpenCode...");
  barDebug("");

  const translations: Array<{ plugin: Plugin; translation: Translation }> = [];

  for (const plugin of plugins) {
    const managedRoot = join(managedDir, plugin.name);
    await rm(managedRoot, { recursive: true, force: true });
    await mkdir(dirname(managedRoot), { recursive: true });
    await cp(plugin.path, managedRoot, { recursive: true });
    await preparePluginDirForVendor({ ...plugin, path: managedRoot }, ".plugin", "PLUGIN_ROOT");
    barDebug(c.dim(`${plugin.name}: staged at ${managedRoot}`));

    translations.push({ plugin, translation: await translatePlugin(plugin, managedRoot) });

    // Skills are filesystem-discovered; OpenCode's plugin API cannot register them.
    for (const skill of plugin.skills) {
      const problems = validateSkillForOpenCode(skill);
      if (problems.length > 0) {
        warn(
          `${plugin.name}: skipped skill ${c.cyan(skill.name || "(unnamed)")} — OpenCode cannot load it: ${problems.join("; ")}.`,
        );
        continue;
      }
      const from = join(managedRoot, "skills", skill.name);
      if (!existsSync(from)) continue;
      const to = join(skillsDir, skill.name);
      await rm(to, { recursive: true, force: true });
      await mkdir(dirname(to), { recursive: true });
      await cp(from, to, { recursive: true });
      stepDone(`Installed skill ${c.cyan(skill.name)}`);
    }

    if (needsAdapter(plugin)) {
      const hooks = plugin.hasHooks ? await translateHooks(managedRoot, plugin.name) : [];
      await writeFile(
        join(pluginsDir, generatedAdapterName(plugin.name)),
        renderOpenCodeAdapter(plugin, managedRoot, hooks),
      );
      stepDone(`Wrote OpenCode adapter ${c.cyan(generatedAdapterName(plugin.name))}`);
    }
  }

  step("Registering plugins in opencode.json...");
  const ownershipPath = join(pluginsDir, OWNERSHIP_FILE);
  const ownership = await readOwnership(ownershipPath);
  const config = await readJsonObject(configPath);
  let next: Record<string, unknown> = config ?? {};

  for (const { plugin, translation } of translations) {
    next = mergeTranslation(next, translation, ownership[plugin.name] ?? {});
    ownership[plugin.name] = ownershipFor(translation);
  }

  for (const plugin of plugins) {
    const previous = ownership[plugin.name]?.module;
    const installed = await installNativeModule(
      plugin,
      join(managedDir, plugin.name),
      pluginsDir,
      previous,
      plugin.hasHooks,
    );
    if (installed) {
      ownership[plugin.name] = { ...ownership[plugin.name], module: installed };
    } else if (previous) {
      const { module: _removed, ...rest } = ownership[plugin.name]!;
      ownership[plugin.name] = rest;
    }
  }

  const declared: unknown[] = Array.isArray(next.plugin) ? [...(next.plugin as unknown[])] : [];
  for (const plugin of plugins) {
    if (!needsAdapter(plugin)) continue;
    const entry = `./plugins/${generatedAdapterName(plugin.name)}`;
    if (!declared.includes(entry)) declared.push(entry);
  }
  if (declared.length > 0) next.plugin = declared;

  await mkdir(configDir, { recursive: true });
  await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`);
  await mkdir(pluginsDir, { recursive: true });
  await writeFile(ownershipPath, `${JSON.stringify(ownership, null, 2)}\n`);
  stepDone("opencode.json updated");
  barDebug(c.dim(`Managed plugin root: ${repoPath}`));
}

/** Directory a plugin uses to ship a native OpenCode module. */
const NATIVE_DIR = ".opencode-plugin";

/** Extensions accepted for a native OpenCode module. */
const NATIVE_EXT = /\.(js|mjs|ts)$/;

/** The CLI's own generated hook adapter, kept even when a native module exists. */
function generatedAdapterName(pluginName: string): string {
  return `${pluginName}-plugin.js`;
}

/** The destination for a plugin-authored native module, which cannot collide. */
function nativeModuleName(pluginName: string): string {
  return `${pluginName}-opencode.js`;
}

/**
 * Finds the plugin's native OpenCode module. When several are present the
 * lexicographically first wins, so the choice does not depend on the order the
 * filesystem happens to return entries in.
 */
async function findNativeModule(
  managedRoot: string,
): Promise<{ path: string; name: string; extras: string[] } | null> {
  const dir = join(managedRoot, NATIVE_DIR);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const candidates = entries
    .filter((entry) => entry.isFile() && NATIVE_EXT.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const first = candidates[0];
  if (!first) return null;
  return { path: join(dir, first), name: first, extras: candidates.slice(1) };
}

/** The variables a plugin may use to refer to its own root. */
const ROOT_VAR =
  /\$\{(?:PLUGIN_ROOT|CLAUDE_PLUGIN_ROOT|CURSOR_PLUGIN_ROOT|CODEX_PLUGIN_ROOT|KIMI_PLUGIN_ROOT)\}/g;

/**
 * Prepares a plugin-authored module for installation: rewrites plugin-root
 * variables to the managed absolute path and declares `PLUGIN_ROOT` in module
 * scope so author code can reference it without importing anything.
 */
function prepareNativeModule(source: string, managedRoot: string): string {
  const preamble = [
    "// Installed by the plugins CLI. Do not edit; re-run the installer instead.",
    `const PLUGIN_ROOT = ${JSON.stringify(managedRoot)};`,
    "",
  ].join("\n");
  return preamble + source.replace(ROOT_VAR, managedRoot);
}

/**
 * Fails when a module cannot be parsed. A module that cannot load would break
 * OpenCode's startup for every plugin, so this is a hard failure.
 */
async function assertParses(source: string, pluginName: string, label: string): Promise<void> {
  const scratch = join(tmpdir(), `plugins-native-check-${process.pid}-${Date.now()}.mjs`);
  try {
    await writeFile(scratch, source);
    await execFileAsync(process.execPath, ["--check", scratch]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${pluginName}: ${label} is not valid JavaScript and was not installed. ${message.trim()}`,
    );
  } finally {
    await rm(scratch, { force: true });
  }
}

/**
 * Installs a plugin-authored OpenCode module, unless something the CLI did not
 * write already occupies the destination.
 */
async function installNativeModule(
  plugin: Plugin,
  managedRoot: string,
  pluginsDir: string,
  previousModule: string | undefined,
  warnIfHooksDeclared: boolean,
): Promise<string | undefined> {
  const found = await findNativeModule(managedRoot);
  if (!found) return undefined;

  for (const extra of found.extras) {
    warn(
      `${plugin.name}: ${c.cyan(join(NATIVE_DIR, extra))} was ignored; ${c.cyan(found.name)} is installed as the native module.`,
    );
  }

  const destination = join(pluginsDir, nativeModuleName(plugin.name));
  if ((await exists(destination)) && previousModule !== nativeModuleName(plugin.name)) {
    throw new Error(
      `${destination} already exists and was not written by this installer; refusing to overwrite it.`,
    );
  }

  const source = await readFile(found.path, "utf-8");
  const prepared = prepareNativeModule(source, managedRoot);
  await assertParses(prepared, plugin.name, join(NATIVE_DIR, found.name));

  await mkdir(pluginsDir, { recursive: true });
  await writeFile(destination, prepared);
  stepDone(`Installed native OpenCode module ${c.cyan(nativeModuleName(plugin.name))}`);

  if (warnIfHooksDeclared) {
    const declared = [...source.matchAll(/tool\.execute\.(?:before|after)/g)].map((m) => m[0]);
    if (declared.length > 0) {
      warn(
        `${plugin.name}: ${c.cyan(found.name)} also implements ${c.cyan([...new Set(declared)].join(", "))}, and ${c.cyan("hooks/hooks.json")} declares tool hooks. They may both run; implement a hook in only one place.`,
      );
    }
  }

  return nativeModuleName(plugin.name);
}

interface TranslatedHook {
  event: string;
  command: string;
  matcher?: string;
  timeout?: number;
}

/**
 * Vendor-neutral events that map onto an OpenCode hook, and the OpenCode hook
 * each becomes. Verified against the `@opencode-ai/plugin` `Hooks` interface.
 */
const EVENT_MAP: Record<string, "tool.execute.before" | "tool.execute.after"> = {
  PreToolUse: "tool.execute.before",
  PostToolUse: "tool.execute.after",
};

/** Events with no OpenCode equivalent, kept out of the generated module. */
const UNMAPPABLE_EVENTS = new Set(["SessionStart"]);

/** Flattens `hooks/hooks.json` into command hooks OpenCode can implement. */
async function translateHooks(managedRoot: string, pluginName: string): Promise<TranslatedHook[]> {
  const config = await readJsonObject(join(managedRoot, "hooks", "hooks.json"));
  const hookMap = config?.hooks;
  if (!hookMap || typeof hookMap !== "object" || Array.isArray(hookMap)) return [];

  const translated: TranslatedHook[] = [];
  for (const [event, groups] of Object.entries(hookMap as Record<string, unknown>)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!group || typeof group !== "object" || Array.isArray(group)) continue;
      const record = group as { matcher?: unknown; hooks?: unknown };
      const hooks = Array.isArray(record.hooks) ? record.hooks : [record];
      for (const hook of hooks) {
        if (!hook || typeof hook !== "object" || Array.isArray(hook)) continue;
        const entry = hook as { type?: unknown; command?: unknown; timeout?: unknown };
        if (entry.type !== "command" || typeof entry.command !== "string") continue;
        if (!EVENT_MAP[event]) {
          warn(
            `${pluginName}: hook event ${c.cyan(event)} has no OpenCode equivalent and was not translated.`,
          );
          continue;
        }
        const result: TranslatedHook = { event, command: entry.command };
        if (typeof record.matcher === "string") result.matcher = record.matcher;
        if (typeof entry.timeout === "number") result.timeout = entry.timeout;
        translated.push(result);
      }
    }
  }
  return translated;
}

/** Emits the JavaScript statements implementing one translated tool hook. */
function renderToolHookBody(hook: TranslatedHook): string {
  const command = resolveRootVars(hook.command, "@@ROOT@@");
  const gate = hook.matcher
    ? `      if (input.tool !== ${JSON.stringify(hook.matcher)}) return;`
    : "";
  return `${gate}
      await runHook(${JSON.stringify(command)});`;
}

/**
 * Emit an OpenCode plugin module.
 *
 * The vendor-neutral `SessionStart` hook has no OpenCode equivalent, so it is not
 * translated as a session hook. What OpenCode does document is
 * `experimental.session.compacting`, which lets a plugin push context that must
 * survive a compaction; that keeps the workflow router from being lost in a long
 * session. Tool hooks are translated onto OpenCode's own before/after hooks.
 */
export function renderOpenCodeAdapter(
  plugin: Plugin,
  managedRoot: string,
  hooks: TranslatedHook[] = [],
): string {
  const root = JSON.stringify(managedRoot);
  const skillName = plugin.skills[0]?.name ?? "";
  const commands = plugin.commands.map((entry) => entry.name);
  const agents = plugin.agents.map((entry) => entry.name);
  const surfaceCount = commands.length + agents.length;

  const byOpenCodeHook = new Map<string, string[]>();
  for (const hook of hooks) {
    const target = EVENT_MAP[hook.event];
    if (!target) continue;
    const list = byOpenCodeHook.get(target) ?? [];
    list.push(renderToolHookBody(hook).replaceAll("@@ROOT@@", managedRoot));
    byOpenCodeHook.set(target, list);
  }

  const hookEntries = [...byOpenCodeHook.entries()]
    .map(
      ([name, bodies]) =>
        `    ${JSON.stringify(name)}: async (input, _output) => {\n${bodies.join("\n")}\n    },`,
    )
    .join("\n");

  return `// Generated by plugins for ${plugin.name}. Do not edit by hand.
//
// The vendor-neutral SessionStart hook has no OpenCode equivalent, so nothing is
// injected at session start. OpenCode discovers skills from disk and exposes them
// through its native \`skill\` tool, which already puts this plugin's name and
// description in front of the model. This adapter preserves that router across
// compaction and maps tool hooks onto OpenCode's own tool hooks.
import { readFileSync, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const run = promisify(execFile);
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

// Runs a translated vendor-neutral hook command with the plugin root exported.
async function runHook(command) {
  try {
    await run("/bin/sh", ["-c", command], { env: { ...process.env, PLUGIN_ROOT } });
  } catch (err) {
    await client.app.log({
      body: {
        service: ${JSON.stringify(plugin.name)},
        level: "error",
        message: "hook command failed: " + String(err && err.message ? err.message : err),
      },
    });
  }
}

export const ${camel(plugin.name)}Plugin = async ({ client, $ }) => {
  return {
    "shell.env": async (input, output) => {
      output.env.PLUGIN_ROOT = PLUGIN_ROOT;
    },
    "experimental.session.compacting": async (_input, output) => {
      const body = readSkillBody();
      if (!body) return;
      output.context.push(
        \`Active plugin: ${plugin.name} (v\${${JSON.stringify(plugin.version ?? "0.0.0")}}). Commands: \${
          surfaceCount
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
${hookEntries}
  };
};
`;
}

/** Turns a plugin name into a valid JavaScript identifier suffix. */
function camel(name: string): string {
  return name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part, index) =>
      index === 0
        ? part.charAt(0).toLowerCase() + part.slice(1)
        : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join("");
}

/** Reads an existing opencode.json, tolerating a missing or invalid file. */
async function readJsonObject(path: string): Promise<Record<string, unknown> | null> {
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf-8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* an unreadable config is replaced rather than crashing the install */
  }
  return null;
}
