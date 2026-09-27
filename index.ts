/** CLI entrypoint. Parses arguments, then delegates to discovery and install. */
import { parseArgs } from "util";
import { resolve, join } from "path";
import { execSync } from "child_process";
import { existsSync, mkdirSync, rmSync } from "fs";
import { homedir } from "os";
import { createInterface } from "readline";
import { discover } from "./lib/discover.ts";
import { getTargets } from "./lib/targets.ts";
import { deriveMarketplaceName, installPlugins, isMarketplaceNew, setAutoUpdate } from "./lib/install.ts";
import { setVersion, track } from "./lib/telemetry.ts";
import {
  banner,
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
import type { Plugin, Scope } from "./lib/types.ts";

setVersion("0.1.0");

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
  });

  const [command, ...rest] = positionals;
  if (values.debug) setDebug(true);
  if (values.help || !command) {
    printUsage();
    return;
  }

  switch (command) {
    case "add":
      await cmdInstall(rest[0], values);
      break;
    case "discover":
      await cmdDiscover(rest[0], values);
      break;
    case "targets":
      await cmdTargets();
      break;
    default:
      await cmdInstall(command, values);
  }
}

try {
  await main();
} catch (err) {
  error("Could not complete the command.", [
    err instanceof Error ? err.message : String(err),
    "Run again with --debug for more detail.",
  ]);
  footer();
  process.exitCode = 1;
}

function printUsage(): void {
  console.log(`
${c.bold("opencode-plugins")} — Install open-plugin format plugins into agent tools

${c.dim("Usage:")}
  ${c.cyan("opencode-plugins add")} <repo-path-or-url>       Install plugins from a repo
  ${c.cyan("opencode-plugins discover")} <repo-path-or-url>  Discover plugins in a repo
  ${c.cyan("opencode-plugins targets")}                      List available install targets
  ${c.cyan("opencode-plugins")} <repo-path-or-url>           Shorthand for add

${c.dim("Options:")}
  ${c.yellow("-t, --target")} <target>   Target tool (e.g. claude-code, opencode). Default: auto-detect
  ${c.yellow("-s, --scope")} <scope>     user | project | local. Default: user
  ${c.yellow("-y, --yes")}               Skip confirmation prompts
  ${c.yellow("--remote")}                Include remote-source plugins in output
  ${c.yellow("--debug")}                 Show verbose installation output
  ${c.yellow("-h, --help")}              Show this help
`);
}

async function cmdDiscover(source: string | undefined, opts: { remote?: boolean }): Promise<void> {
  if (!source) {
    error("Provide a repo path or URL");
    process.exit(1);
  }
  banner();
  header("opencode-plugins");
  const repoPath = resolveSource(source);
  const { plugins, remotePlugins, missingPaths } = await discover(repoPath);
  if (plugins.length === 0 && remotePlugins.length === 0) {
    footer();
    return;
  }
  if (plugins.length > 0) {
    step(`Found ${c.bold(String(plugins.length))} local plugin(s)`);
    printPluginTable(plugins);
  }
  if (remotePlugins.length > 0) {
    if (opts.remote) {
      step(`Found ${c.bold(String(remotePlugins.length))} remote plugin(s)`);
      printRemotePluginTable(remotePlugins);
    } else {
      step(`${remotePlugins.length} remote plugin(s) not shown. Run with --remote.`);
    }
    printMissingPaths(missingPaths);
  }
  footer();
}

async function cmdTargets(): Promise<void> {
  banner();
  header("opencode-plugins");
  const targets = await getTargets();
  if (targets.length === 0) {
    step("No supported targets detected.");
    footer();
    return;
  }
  step("Available install targets");
  for (const t of targets) {
    console.log(`${c.gray(S.bar)}  ${c.bold(t.name)}`);
    console.log(`${c.gray(S.bar)}  ${c.dim(t.description)}`);
    console.log(`${c.gray(S.bar)}  Config: ${c.dim(t.configPath)}`);
    console.log(`${c.gray(S.bar)}  Status: ${t.detected ? c.green("detected") : c.dim("not found")}`);
    console.log(c.gray(S.bar));
  }
  footer();
}

type CliValues = {
  target?: string;
  scope?: string;
  yes?: boolean;
  debug?: boolean;
};

async function cmdInstall(source: string | undefined, opts: CliValues): Promise<void> {
  if (!source) {
    error("Provide a repo path or URL");
    process.exit(1);
  }
  banner();
  header("opencode-plugins");
  const repoPath = resolveSource(source);
  const { plugins, remotePlugins, missingPaths } = await discover(repoPath);
  if (plugins.length === 0) {
    step("No plugins found.");
    footer();
    return;
  }

  const targets = await getTargets();
  const detectedTargets = targets.filter((t) => t.detected);
  let installTargets;
  if (opts.target) {
    const found = targets.find((t) => t.id === opts.target);
    if (!found) {
      stepError(`Unknown target: ${c.bold(opts.target)}`);
      console.log(`${c.gray(S.bar)}  ${c.dim(`Available: ${targets.map((t) => t.id).join(", ")}`)}`);
      footer();
      process.exit(1);
    }
    if (!found.detected) {
      console.log(`${c.gray(S.bar)}  ${c.yellow(`Warning: ${found.name} was not detected on this system.`)}`);
    }
    installTargets = [found];
  } else if (detectedTargets.length === 0) {
    stepError("No supported targets detected.");
    console.log(`${c.gray(S.bar)}  ${c.dim("No supported agent was found. Use --target to specify one.")}`);
    footer();
    process.exit(1);
  } else {
    installTargets = detectedTargets;
  }

  let selectedPlugins: Plugin[];
  if (plugins.length === 1 || opts.yes) {
    step(`Found ${c.bold(String(plugins.length))} plugin(s)`);
    printPluginTable(plugins);
    printMissingPaths(missingPaths);
    console.log(`${c.gray(S.bar)}  ${c.dim("Targets:")}  ${installTargets.map((t) => c.cyan(t.name)).join(", ")}`);
    console.log(`${c.gray(S.bar)}  ${c.dim("Scope:")}    ${c.cyan(opts.scope ?? "user")}`);
    if (!opts.yes) {
      const response = await readLine(`${c.cyan(S.stepActive)}  Install? ${c.dim("[Y/n]")} `);
      if (response.trim().toLowerCase() === "n") {
        step("Aborted.");
        footer();
        return;
      }
    }
    selectedPlugins = plugins;
  } else {
    const selected = await multiSelect(
      "Select plugins to install",
      plugins.map((p) => {
        const parts = pluginComponents(p);
        return { label: p.name, value: p.name, ...(parts.length ? { hint: parts.join(", ") } : {}) };
      }),
    );
    if (!selected || selected.length === 0) {
      step("Aborted.");
      footer();
      return;
    }
    selectedPlugins = plugins.filter((p) => selected.includes(p.name));
  }

  const scope = (opts.scope ?? "user") as Scope;
  const marketplaceName = selectedPlugins[0]?.marketplace ?? deriveMarketplaceName(source);
  const willInstallToClaude = installTargets.some(
    (t) => t.id === "claude-code" || (t.id === "cursor" && process.platform !== "win32"),
  );
  const isNew = willInstallToClaude && (await isMarketplaceNew(marketplaceName));

  const installedTargets: typeof installTargets = [];
  const failedTargets: { target: (typeof installTargets)[number]; message: string }[] = [];
  for (const target of installTargets) {
    const result = await installPlugins(selectedPlugins, target, scope, repoPath, source);
    if (result.succeeded) {
      installedTargets.push(target);
      continue;
    }
    stepError(`${target.name} installation failed`);
    console.log(`${c.gray(S.bar)}  ${c.dim(result.message ?? "No error message.")}`);
    failedTargets.push({ target, message: result.message ?? "" });
  }

  if (isNew && installedTargets.length > 0) {
    let enableAutoUpdate = true;
    if (!opts.yes && process.stdin.isTTY) {
      const response = await readLine(`${c.cyan(S.stepActive)}  Enable auto-updates? ${c.dim("[Y/n]")} `);
      enableAutoUpdate = response.trim().toLowerCase() !== "n";
    }
    if (enableAutoUpdate) {
      await setAutoUpdate(marketplaceName, true);
      stepDone("Auto-updates enabled");
    }
  }

  track({
    event: "install",
    source,
    plugins: selectedPlugins.map((p) => p.name).join(","),
    pluginCount: String(selectedPlugins.length),
    targets: installedTargets.map((t) => t.id).join(","),
    scope,
  });

  if (failedTargets.length > 0) {
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
  stepDone(c.green("Done.") + "  Restart your agent tools to load the plugins.");
  footer();
}

function pluginComponents(p: Plugin): string[] {
  const parts: string[] = [];
  if (p.skills.length) parts.push(`${p.skills.length} ${p.skills.length === 1 ? "skill" : "skills"}`);
  if (p.commands.length) parts.push(`${p.commands.length} ${p.commands.length === 1 ? "cmd" : "cmds"}`);
  if (p.agents.length) parts.push(`${p.agents.length} ${p.agents.length === 1 ? "agent" : "agents"}`);
  if (p.rules.length) parts.push(`${p.rules.length} ${p.rules.length === 1 ? "rule" : "rules"}`);
  if (p.hasHooks) parts.push("hooks");
  if (p.hasMcp) parts.push("mcp");
  if (p.hasLsp) parts.push("lsp");
  return parts;
}

function printPluginTable(plugins: Plugin[]): void {
  const nameWidth = Math.max(...plugins.map((p) => p.name.length), 4);
  const comps = plugins.map((p) => pluginComponents(p).join(", "));
  const compWidth = Math.max(...comps.map((s) => s.length), 0);
  for (let i = 0; i < plugins.length; i += 1) {
    const p = plugins[i]!;
    const comp = comps[i]!;
    console.log(
      `${c.gray(S.bar)}  ${c.bold(p.name.padEnd(nameWidth))}  ${c.cyan(comp.padEnd(compWidth))}  ${c.dim(p.description ?? "")}`,
    );
  }
}

function printRemotePluginTable(plugins: { name: string; description?: string }[]): void {
  for (const p of plugins) {
    console.log(`${c.gray(S.bar)}  ${c.bold(p.name)}  ${c.dim(p.description ?? "")}`);
  }
}

function printMissingPaths(paths: string[]): void {
  for (const p of paths) console.log(`${c.gray(S.bar)}  ${c.dim(`source not found: ${p}`)}`);
}

function sshToHttps(sshUrl: string): string | null {
  const m = sshUrl.match(/^git@([^:]+):(.+)$/);
  return m ? `https://${m[1]}/${m[2]}` : null;
}

function resolveSource(source: string): string {
  const isRemote =
    source.startsWith("https://") ||
    source.startsWith("git@") ||
    Boolean(source.match(/^[\w-]+\/[\w.-]+$/));
  if (!isRemote) return resolve(source);

  const url = source.match(/^[\w-]+\/[\w.-]+$/) ? `https://github.com/${source}` : source;
  const cacheDir = join(homedir(), ".cache", "opencode-plugins");
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
  try {
    execSync(`git clone --depth 1 -q "${url}" "${tmpDir}"`, { stdio: "pipe" });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.toString() ?? "";
    if (url.startsWith("git@") && stderr.includes("Permission denied")) {
      const httpsUrl = sshToHttps(url);
      if (httpsUrl) {
        execSync(`git clone --depth 1 -q "${httpsUrl}" "${tmpDir}"`, { stdio: "inherit" });
        stepDone("Repository cloned");
        return tmpDir;
      }
    }
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    stepError(`Could not clone ${c.bold(url)}`);
    footer();
    process.exit(1);
  }
  stepDone("Repository cloned");
  return tmpDir;
}

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
      resolve_(answer);
    });
  });
}
