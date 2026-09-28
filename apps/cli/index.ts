/** CLI entrypoint. Parses arguments, then delegates to discovery and install. */
import { parseArgs } from "node:util";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { discover } from "./lib/discover.ts";
import { getTargets } from "./lib/targets.ts";
import {
  deriveMarketplaceName,
  getOfficialPluginRef,
  installPlugins,
  isMarketplaceNew,
  setAutoUpdate,
} from "./lib/install.ts";
import {
  banner,
  barEmpty,
  barLine,
  c,
  error,
  footer,
  header,
  multiSelect,
  S,
  setDebug,
  step,
  stepDone,
  stepError,
} from "./lib/ui.ts";
import type { Plugin, RemotePlugin, Scope, Target } from "./lib/types.ts";

/** Flags shared by every command. */
interface CommandOptions {
  help?: boolean;
  target?: string;
  scope?: string;
  yes?: boolean;
  remote?: boolean;
  debug?: boolean;
}

const SCOPES: Scope[] = ["user", "project", "local"];

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      target: { type: "string", short: "t" },
      scope: { type: "string", short: "s", default: "user" },
      yes: { type: "boolean", short: "y" },
      remote: { type: "boolean" },
      debug: { type: "boolean" },
    },
    allowPositionals: true,
    strict: true,
  }) as { values: CommandOptions; positionals: string[] };

  const [command, ...rest] = positionals;
  if (values.debug) setDebug(true);

  if (values.help || !command) {
    printUsage();
    return;
  }

  switch (command) {
    case "add":
      await cmdInstall(rest[0], values);
      return;
    case "discover":
      await cmdDiscover(rest[0], values);
      return;
    case "targets":
      await cmdTargets();
      return;
    default:
      // A bare source is shorthand for `add`.
      await cmdInstall(command, values);
  }
}

try {
  await main();
} catch (err) {
  barEmpty();
  error("Could not complete the command.", [
    err instanceof Error ? err.message : String(err),
    "Run again with --debug for more detail.",
  ]);
  footer();
  process.exitCode = 1;
}

function printUsage(): void {
  console.log(`
${c.bold("plugins")} — Install open-plugin format plugins into agent tools

${c.dim("Usage:")}
  ${c.cyan("plugins add")} <repo-path-or-url>          Install plugins from a repo
  ${c.cyan("plugins discover")} <repo-path-or-url>     Discover plugins in a repo
  ${c.cyan("plugins targets")}                         List available install targets
  ${c.cyan("plugins")} <repo-path-or-url>              Shorthand for add

${c.dim("Options:")}
  ${c.yellow("-t, --target")} <target>   Target tool (e.g. claude-code). Default: auto-detect
  ${c.yellow("-s, --scope")} <scope>     Install scope: user, project, local. Default: user
  ${c.yellow("-y, --yes")}               Skip confirmation prompts
  ${c.yellow("--remote")}                Include remote-source plugins in output
  ${c.yellow("--debug")}                 Show verbose installation output
  ${c.yellow("-h, --help")}              Show this help
`);
}

async function cmdDiscover(source: string | undefined, opts: CommandOptions): Promise<void> {
  if (!source) {
    error("Provide a repo path or URL");
    process.exit(1);
  }

  banner();
  header("plugins");
  const repoPath = resolveSource(source);
  const { plugins, remotePlugins, missingPaths } = await discover(repoPath);

  if (plugins.length === 0 && remotePlugins.length === 0) {
    barEmpty();
    step("No plugins found.");
    footer();
    return;
  }

  if (plugins.length > 0) {
    barEmpty();
    step(`Found ${c.bold(String(plugins.length))} local plugin(s)`);
    barEmpty();
    printPluginTable(plugins);
  }

  if (remotePlugins.length > 0) {
    if (opts.remote) {
      barEmpty();
      step(
        `${c.bold(String(remotePlugins.length))} remote plugin(s) ${c.dim("(hosted in external repos)")}`,
      );
      barEmpty();
      printRemotePluginTable(remotePlugins);
    } else {
      barEmpty();
      barLine(c.dim(`${remotePlugins.length} remote plugin(s) not shown. Run:`));
      barLine(`  ${c.cyan(`npx @borg0ai/plugins discover ${source} --remote`)}`);
    }
    printMissingPaths(missingPaths);
  }

  footer();
}

async function cmdTargets(): Promise<void> {
  const targets = await getTargets();
  banner();
  header("plugins");

  if (targets.length === 0) {
    barEmpty();
    step("No supported targets detected.");
    footer();
    return;
  }

  barEmpty();
  step("Available install targets");
  barEmpty();
  for (const t of targets) {
    barLine(`  ${c.bold(t.name)}`);
    barLine(`  ${c.dim(t.description)}`);
    barLine(`  Config: ${c.dim(t.configPath)}`);
    barLine(`  Status: ${t.detected ? c.green("detected") : c.dim("not found")}`);
    barEmpty();
  }
  footer();
}

async function cmdInstall(source: string | undefined, opts: CommandOptions): Promise<void> {
  if (!source) {
    error("Provide a repo path or URL");
    process.exit(1);
  }

  banner();
  header("plugins");
  const repoPath = resolveSource(source);
  const { plugins, remotePlugins, missingPaths } = await discover(repoPath);

  if (plugins.length === 0) {
    barEmpty();
    step("No plugins found.");
    if (remotePlugins.length > 0) {
      barLine(c.dim(`${remotePlugins.length} remote plugin(s) not shown. Run:`));
      barLine(`  ${c.cyan(`npx @borg0ai/plugins discover ${source} --remote`)}`);
      printMissingPaths(missingPaths);
    }
    footer();
    return;
  }

  const targets = await getTargets();
  const installTargets = await selectTargets(targets, opts.target);
  if (!installTargets) return;
  barEmpty();

  const scope = resolveScope(opts.scope);
  const selectedPlugins = await selectPlugins(
    plugins,
    remotePlugins,
    missingPaths,
    source,
    installTargets,
    scope,
    opts,
  );
  if (!selectedPlugins) return;

  const marketplaceName = selectedPlugins[0]?.marketplace ?? deriveMarketplaceName(source);
  const willInstallToClaude = installTargets.some(isClaudeBacked);
  const isNew = willInstallToClaude && (await isMarketplaceNew(marketplaceName));

  const installedTargets: Target[] = [];
  const failedTargets: Array<{ target: Target; message: string }> = [];
  for (const target of installTargets) {
    const result = await installPlugins(selectedPlugins, target, scope, repoPath, source);
    if (result.succeeded) {
      installedTargets.push(target);
      continue;
    }
    const message = result.message ?? "The installer did not provide an error message.";
    stepError(`${target.name} installation failed`);
    barLine(c.dim(message));
    failedTargets.push({ target, message });
  }

  const installedViaOfficialCli = !!getOfficialPluginRef(source);
  const installedToClaude = installedTargets.some(isClaudeBacked);
  if (isNew && installedToClaude && !installedViaOfficialCli) {
    let enableAutoUpdate = true;
    if (!opts.yes && process.stdin.isTTY) {
      barEmpty();
      const response = await readLine(
        `${c.cyan(S.stepActive)}  Enable auto-updates? ${c.dim("[Y/n]")} `,
      );
      enableAutoUpdate = response.trim().toLowerCase() !== "n";
    }
    if (enableAutoUpdate) {
      await setAutoUpdate(marketplaceName, true);
      stepDone("Auto-updates enabled");
    }
  }

  if (failedTargets.length > 0) {
    barEmpty();
    error(
      failedTargets.length === installTargets.length
        ? "No target installations completed."
        : "Installed with target failures.",
      failedTargets.map(({ target, message }) => `${target.name}: ${message}`),
    );
    footer("Retry a failed target with --target <target>.");
    process.exitCode = 1;
    return;
  }

  barEmpty();
  stepDone(`${c.green("Done.")}  Restart your agent tools to load the plugins.`);
  footer();
}

/** Cursor on non-Windows shares Claude Code's plugin cache. */
function isClaudeBacked(t: Target): boolean {
  return t.id === "claude-code" || (t.id === "cursor" && process.platform !== "win32");
}

/** Resolves --target, or every detected tool. Returns null after exiting. */
function selectTargets(targets: Target[], requested?: string): Target[] | null {
  const detected = targets.filter((t) => t.detected);

  if (requested) {
    const found = targets.find((t) => t.id === requested);
    if (!found) {
      barEmpty();
      stepError(`Unknown target: ${c.bold(requested)}`);
      barLine(c.dim(`Available: ${targets.map((t) => t.id).join(", ")}`));
      footer();
      process.exit(1);
    }
    if (!found.detected) {
      barEmpty();
      barLine(c.yellow(`Warning: ${found.name} was not detected on this system.`));
    }
    return [found];
  }

  if (detected.length === 0) {
    barEmpty();
    stepError("No supported targets detected.");
    barLine(
      c.dim(
        "No supported agent binary was found on PATH (claude, cursor, codex, grok, kimi, copilot, or code).",
      ),
    );
    barLine(c.dim("Use --target to specify one manually."));
    footer();
    process.exit(1);
  }

  return detected;
}

/** Validates --scope, exiting with usage when it is not a known scope. */
function resolveScope(requested?: string): Scope {
  const scope = requested ?? "user";
  if (!SCOPES.includes(scope as Scope)) {
    error(`Unknown scope: ${c.bold(scope)}`);
    barLine(c.dim(`Available: ${SCOPES.join(", ")}`));
    footer();
    process.exit(1);
  }
  return scope as Scope;
}

/** Confirms or interactively selects the plugins to install. */
async function selectPlugins(
  plugins: Plugin[],
  remotePlugins: RemotePlugin[],
  missingPaths: string[],
  source: string,
  installTargets: Target[],
  scope: Scope,
  opts: CommandOptions,
): Promise<Plugin[] | null> {
  if (plugins.length === 1 || opts.yes) {
    step(`Found ${c.bold(String(plugins.length))} plugin(s)`);
    barEmpty();
    printPluginTable(plugins);
    if (remotePlugins.length > 0) {
      barEmpty();
      barLine(c.dim(`+ ${remotePlugins.length} remote plugin(s) not included. Run:`));
      barLine(`  ${c.cyan(`npx @borg0ai/plugins discover ${source} --remote`)}`);
      printMissingPaths(missingPaths);
    }
    printInstallPlan(installTargets, scope);
    if (!opts.yes) {
      const response = await readLine(`${c.cyan(S.stepActive)}  Install? ${c.dim("[Y/n]")} `);
      if (response.trim().toLowerCase() === "n") {
        step("Aborted.");
        footer();
        return null;
      }
    }
    return plugins;
  }

  step(`Found ${c.bold(String(plugins.length))} plugin(s)`);
  barEmpty();
  const selected = await multiSelect(
    "Select plugins to install",
    plugins.map((p) => {
      const parts = pluginComponents(p);
      return { label: p.name, value: p.name, hint: parts.length ? parts.join(", ") : undefined };
    }),
  );
  if (!selected || selected.length === 0) {
    step("Aborted.");
    footer();
    return null;
  }

  if (remotePlugins.length > 0) {
    barLine(c.dim(`+ ${remotePlugins.length} remote plugin(s) not included. Run:`));
    barLine(`  ${c.cyan(`npx @borg0ai/plugins discover ${source} --remote`)}`);
    printMissingPaths(missingPaths);
  }
  printInstallPlan(installTargets, scope);

  return plugins.filter((p) => selected.includes(p.name));
}

function printInstallPlan(installTargets: Target[], scope: Scope): void {
  barEmpty();
  barLine(`${c.dim("Targets:")}  ${installTargets.map((t) => c.cyan(t.name)).join(c.dim(", "))}`);
  barLine(`${c.dim("Scope:")}    ${c.cyan(scope)}`);
  barEmpty();
}

/** Human summary of what a plugin contains. */
function pluginComponents(p: Plugin): string[] {
  const parts: string[] = [];
  if (p.skills.length)
    parts.push(`${p.skills.length} ${p.skills.length === 1 ? "skill" : "skills"}`);
  if (p.commands.length)
    parts.push(`${p.commands.length} ${p.commands.length === 1 ? "cmd" : "cmds"}`);
  if (p.agents.length)
    parts.push(`${p.agents.length} ${p.agents.length === 1 ? "agent" : "agents"}`);
  if (p.rules.length) parts.push(`${p.rules.length} ${p.rules.length === 1 ? "rule" : "rules"}`);
  if (p.hasHooks) parts.push("hooks");
  if (p.hasMcp) parts.push("mcp");
  if (p.hasLsp) parts.push("lsp");
  return parts;
}

function printPluginTable(plugins: Plugin[]): void {
  const nameWidth = Math.max(...plugins.map((p) => p.name.length), 4);
  const compStrs = plugins.map((p) => pluginComponents(p).join(", "));
  const compWidth = Math.max(...compStrs.map((s) => s.length), 0);
  const termWidth = process.stdout.columns || 80;
  const descWidth = Math.max(termWidth - 3 - nameWidth - 2 - compWidth - 2, 20);

  plugins.forEach((p, i) => {
    const comp = compStrs[i]!;
    const desc = truncate(p.description ?? "", descWidth);
    barLine(
      `${c.bold(p.name.padEnd(nameWidth))}  ${comp ? c.cyan(comp.padEnd(compWidth)) : " ".repeat(compWidth)}  ${c.dim(desc)}`,
    );
  });
}

function printRemotePluginTable(plugins: RemotePlugin[]): void {
  const nameWidth = Math.max(...plugins.map((p) => p.name.length), 4);
  const termWidth = process.stdout.columns || 80;
  const descWidth = Math.max(termWidth - 3 - nameWidth - 2, 20);

  for (const p of plugins) {
    barLine(
      `${c.bold(p.name.padEnd(nameWidth))}  ${c.dim(truncate(p.description ?? "", descWidth))}`,
    );
  }
}

function printMissingPaths(paths: string[]): void {
  if (paths.length === 0) return;
  for (const p of paths) barLine(c.dim(`  source not found: ${p}`));
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function sshToHttps(sshUrl: string): string | null {
  const m = sshUrl.match(/^git@([^:]+):(.+)$/);
  if (!m?.[1] || !m[2]) return null;
  return `https://${m[1]}/${m[2]}`;
}

/** Clones a remote source into the plugin cache, or resolves a local path. */
function resolveSource(source: string): string {
  const isRemote =
    source.startsWith("https://") ||
    source.startsWith("git@") ||
    !!source.match(/^[\w-]+\/[\w.-]+$/);
  if (!isRemote) return resolve(source);

  const url = source.match(/^[\w-]+\/[\w.-]+$/) ? `https://github.com/${source}` : source;
  const cacheDir = join(homedir(), ".cache", "plugins");
  mkdirSync(cacheDir, { recursive: true });
  const slug = url
    .replace(/^https?:\/\//, "")
    .replace(/^git@/, "")
    .replace(/\.git$/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const tmpDir = join(cacheDir, slug);
  if (existsSync(join(tmpDir, ".git", "HEAD"))) rmSync(tmpDir, { recursive: true, force: true });

  step(`Source: ${c.dim(url)}`);
  barEmpty();
  try {
    execSync(`git clone --depth 1 -q "${url}" "${tmpDir}"`, { stdio: "pipe" });
  } catch (err) {
    if (!explainCloneFailure(err, url, tmpDir, source)) {
      footer();
      process.exit(1);
    }
    stepDone("Repository cloned");
    barEmpty();
    return tmpDir;
  }
  stepDone("Repository cloned");
  barEmpty();
  return tmpDir;
}

/**
 * Reports why a clone failed, retrying once over HTTPS when SSH auth fails.
 * Returns true when the retry succeeded.
 */
function explainCloneFailure(err: unknown, url: string, tmpDir: string, source: string): boolean {
  const failure = err as { stderr?: Buffer | string; message?: string; status?: number | null };
  const stderr = failure.stderr?.toString() ?? "";

  if (url.startsWith("git@") && stderr.includes("Permission denied")) {
    const httpsUrl = sshToHttps(url);
    if (httpsUrl) {
      barLine(c.yellow("SSH authentication failed. Retrying over HTTPS..."));
      step(`Source: ${c.dim(httpsUrl)}`);
      barEmpty();
      try {
        execSync(`git clone --depth 1 -q "${httpsUrl}" "${tmpDir}"`, { stdio: "inherit" });
        return true;
      } catch {
        /* fall through to the shared error reporting below */
      }
    }
  }

  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });

  if (
    stderr.includes("Permission denied") ||
    stderr.includes("Could not read from remote repository")
  ) {
    barEmpty();
    stepError(`Could not access ${c.bold(url)}`);
    barEmpty();
    barLine(c.dim("Make sure you have access to this repository. For private repos, try:"));
    barLine(`  ${c.dim("HTTPS:")} plugins add https://github.com/owner/repo`);
    barLine(`  ${c.dim("       (uses git credential helper / browser auth)")}`);
    barLine(`  ${c.dim("SSH:")}   plugins add git@github.com:owner/repo.git`);
    barLine(`  ${c.dim("       (requires SSH keys)")}`);
  } else if (
    stderr.includes("not found") ||
    stderr.includes("does not exist") ||
    failure.status === 128
  ) {
    barEmpty();
    stepError(`Repository not found: ${c.bold(url)}`);
    barLine(c.dim("Check that the URL is correct and the repository exists."));
  } else {
    barEmpty();
    stepError("git clone failed.");
    if (stderr.trim()) barLine(c.dim(stderr.trim()));
  }

  void source;
  return false;
}

/** Prompts for a line of input; exits cleanly on Ctrl-D. */
function readLine(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve_) => {
    let answered = false;
    rl.on("close", () => {
      if (!answered) {
        process.stdout.write("\n");
        process.exit(0);
      }
    });
    rl.question(prompt, (answer) => {
      answered = true;
      rl.close();
      if (!process.stdin.isTTY) process.stdout.write("\n");
      resolve_(answer);
    });
  });
}
