#!/usr/bin/env node

// index.ts
import { parseArgs } from "util";
import { resolve, join as join4 } from "path";
import { execSync as execSync3 } from "child_process";
import { existsSync as existsSync3, rmSync, mkdirSync } from "fs";
import { homedir as homedir3 } from "os";
import { createInterface } from "readline";

// lib/discover.ts
import { join } from "path";
import { readFile, readdir, stat } from "fs/promises";
import { existsSync } from "fs";
async function discover(repoPath) {
  const marketplacePaths = [
    join(repoPath, "marketplace.json"),
    join(repoPath, ".plugin", "marketplace.json"),
    join(repoPath, ".claude-plugin", "marketplace.json"),
    join(repoPath, ".cursor-plugin", "marketplace.json"),
    join(repoPath, ".codex-plugin", "marketplace.json")
  ];
  for (const mp of marketplacePaths) {
    if (await fileExists(mp)) {
      const data = await readJson(mp);
      if (data && typeof data === "object" && "plugins" in data && Array.isArray(data.plugins)) {
        return discoverFromMarketplace(repoPath, data);
      }
    }
  }
  if (await isPluginDir(repoPath)) {
    const plugin = await inspectPlugin(repoPath);
    return { plugins: plugin ? [plugin] : [], remotePlugins: [], missingPaths: [] };
  }
  const plugins = [];
  await scanForPlugins(repoPath, plugins, 2);
  return { plugins, remotePlugins: [], missingPaths: [] };
}
async function scanForPlugins(dirPath, results, depth) {
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
async function discoverFromMarketplace(repoPath, marketplace) {
  const plugins = [];
  const remotePlugins = [];
  const missingPaths = [];
  const root = marketplace.metadata?.pluginRoot ?? ".";
  for (const entry of marketplace.plugins) {
    if (typeof entry.source !== "string") {
      remotePlugins.push({
        name: entry.name,
        description: entry.description || void 0,
        source: entry.source
      });
      continue;
    }
    const sourcePath = join(repoPath, root, entry.source.replace(/^\.\//, ""));
    if (!await dirExists(sourcePath)) {
      missingPaths.push(entry.source);
      continue;
    }
    let skills;
    if (entry.skills && Array.isArray(entry.skills)) {
      skills = [];
      for (const skillPath of entry.skills) {
        const resolvedPath = join(repoPath, root, skillPath.replace(/^\.\//, ""));
        const skillMd = join(resolvedPath, "SKILL.md");
        if (await fileExists(skillMd)) {
          const content = await readFile(skillMd, "utf-8");
          const fm = parseFrontmatter(content);
          skills.push({
            name: fm.name ?? dirName(resolvedPath),
            description: fm.description ?? ""
          });
        }
      }
    } else {
      skills = await discoverSkills(sourcePath);
    }
    let manifest = null;
    for (const manifestDir of [".plugin", ".claude-plugin", ".cursor-plugin", ".codex-plugin"]) {
      const manifestPath = join(sourcePath, manifestDir, "plugin.json");
      if (await fileExists(manifestPath)) {
        manifest = await readJson(manifestPath);
        break;
      }
    }
    const [commands, agents, rules, hasHooks, hasMcp, hasLsp] = await Promise.all([
      discoverCommands(sourcePath),
      discoverAgents(sourcePath),
      discoverRules(sourcePath),
      fileExists(join(sourcePath, "hooks", "hooks.json")),
      fileExists(join(sourcePath, ".mcp.json")),
      fileExists(join(sourcePath, ".lsp.json"))
    ]);
    const name = entry.name || manifest?.name || dirName(sourcePath);
    plugins.push({
      name,
      version: entry.version || manifest?.version || void 0,
      description: entry.description || manifest?.description || void 0,
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
      marketplaceEntry: entry
    });
  }
  return { plugins, remotePlugins, missingPaths };
}
async function isPluginDir(dirPath) {
  const checks = [
    join(dirPath, ".plugin", "plugin.json"),
    join(dirPath, ".claude-plugin", "plugin.json"),
    join(dirPath, ".cursor-plugin", "plugin.json"),
    join(dirPath, ".codex-plugin", "plugin.json"),
    join(dirPath, "skills"),
    join(dirPath, "commands"),
    join(dirPath, "agents"),
    join(dirPath, "SKILL.md")
  ];
  for (const check of checks) {
    if (await pathExists(check)) return true;
  }
  return false;
}
async function inspectPlugin(pluginPath) {
  let manifest = null;
  for (const manifestDir of [".plugin", ".claude-plugin", ".cursor-plugin", ".codex-plugin"]) {
    const manifestPath = join(pluginPath, manifestDir, "plugin.json");
    if (await fileExists(manifestPath)) {
      manifest = await readJson(manifestPath);
      break;
    }
  }
  const name = manifest?.name ?? dirName(pluginPath);
  const [skills, commands, agents, rules, hasHooks, hasMcp, hasLsp] = await Promise.all([
    discoverSkills(pluginPath),
    discoverCommands(pluginPath),
    discoverAgents(pluginPath),
    discoverRules(pluginPath),
    fileExists(join(pluginPath, "hooks", "hooks.json")),
    fileExists(join(pluginPath, ".mcp.json")),
    fileExists(join(pluginPath, ".lsp.json"))
  ]);
  return {
    name,
    version: manifest?.version,
    description: manifest?.description,
    path: pluginPath,
    marketplace: void 0,
    skills,
    commands,
    agents,
    rules,
    hasHooks,
    hasMcp,
    hasLsp,
    manifest,
    explicitSkillPaths: void 0,
    marketplaceEntry: void 0
  };
}
async function discoverSkills(pluginPath) {
  const skillsDir = join(pluginPath, "skills");
  const entries = await readDirSafe(skillsDir);
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillMd = join(skillsDir, entry.name, "SKILL.md");
    if (await fileExists(skillMd)) {
      const content = await readFile(skillMd, "utf-8");
      const fm = parseFrontmatter(content);
      skills.push({
        name: fm.name ?? entry.name,
        description: fm.description ?? ""
      });
    }
  }
  if (skills.length === 0) {
    const rootSkill = join(pluginPath, "SKILL.md");
    if (await fileExists(rootSkill)) {
      const content = await readFile(rootSkill, "utf-8");
      const fm = parseFrontmatter(content);
      skills.push({
        name: fm.name ?? dirName(pluginPath),
        description: fm.description ?? ""
      });
    }
  }
  return skills;
}
async function discoverCommands(pluginPath) {
  const commandsDir = join(pluginPath, "commands");
  const entries = await readDirSafe(commandsDir);
  const commands = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.match(/\.(md|mdc|markdown)$/)) continue;
    const filePath = join(commandsDir, entry.name);
    const content = await readFile(filePath, "utf-8");
    const fm = parseFrontmatter(content);
    commands.push({
      name: entry.name.replace(/\.(md|mdc|markdown)$/, ""),
      description: fm.description ?? ""
    });
  }
  return commands;
}
async function discoverAgents(pluginPath) {
  const agentsDir = join(pluginPath, "agents");
  const entries = await readDirSafe(agentsDir);
  const agents = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.match(/\.(md|mdc|markdown)$/)) continue;
    const filePath = join(agentsDir, entry.name);
    const content = await readFile(filePath, "utf-8");
    const fm = parseFrontmatter(content);
    if (fm.name && fm.description) {
      agents.push({
        name: fm.name,
        description: fm.description
      });
    }
  }
  return agents;
}
async function discoverRules(pluginPath) {
  const rulesDir = join(pluginPath, "rules");
  const entries = await readDirSafe(rulesDir);
  const rules = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.match(/\.(mdc|md|markdown)$/)) continue;
    const filePath = join(rulesDir, entry.name);
    const content = await readFile(filePath, "utf-8");
    const fm = parseFrontmatter(content);
    rules.push({
      name: entry.name.replace(/\.(mdc|md|markdown)$/, ""),
      description: fm.description ?? ""
    });
  }
  return rules;
}
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match?.[1]) return {};
  const result = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w[\w-]*):\s*(.+)$/);
    if (kv) {
      let val = kv[2].trim();
      if (val.startsWith('"') && val.endsWith('"') || val.startsWith("'") && val.endsWith("'")) {
        val = val.slice(1, -1);
      }
      if (val === "true") {
        result[kv[1]] = true;
      } else if (val === "false") {
        result[kv[1]] = false;
      } else {
        result[kv[1]] = val;
      }
    }
  }
  return result;
}
function dirName(p) {
  const parts = p.replace(/\/$/, "").split("/");
  return parts[parts.length - 1] ?? "unknown";
}
async function fileExists(path) {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}
async function dirExists(dirPath) {
  try {
    const s = await stat(dirPath);
    return s.isDirectory();
  } catch {
    return false;
  }
}
async function pathExists(p) {
  return existsSync(p);
}
async function readJson(path) {
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}
async function readDirSafe(dirPath) {
  try {
    return await readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

// lib/targets.ts
import { dirname, join as join2 } from "path";
import { homedir } from "os";
import { execFileSync, execSync } from "child_process";
var HOME = homedir();
function getVsCodeSettingsPath() {
  const product = detectBinary("code") || !detectBinary("code-insiders") ? "Code" : "Code - Insiders";
  if (process.platform === "darwin") {
    return join2(HOME, "Library", "Application Support", product, "User", "settings.json");
  }
  if (process.platform === "win32") {
    return join2(
      process.env.APPDATA ?? join2(HOME, "AppData", "Roaming"),
      product,
      "User",
      "settings.json"
    );
  }
  return join2(HOME, ".config", product, "User", "settings.json");
}
var TARGET_DEFS = [
  {
    id: "claude-code",
    name: "Claude Code",
    description: "Anthropic's CLI coding agent",
    configPath: join2(HOME, ".claude")
  },
  {
    id: "cursor",
    name: "Cursor",
    description: "AI-powered code editor",
    configPath: join2(HOME, ".cursor")
  },
  {
    id: "codex",
    name: "Codex",
    description: "OpenAI's coding agent",
    configPath: join2(HOME, ".codex")
  },
  {
    id: "grok",
    name: "Grok Build",
    description: "xAI's CLI coding agent",
    configPath: join2(HOME, ".grok")
  },
  {
    id: "kimi",
    name: "Kimi Code",
    description: "Moonshot AI's CLI coding agent",
    configPath: process.env.KIMI_CODE_HOME ?? join2(HOME, ".kimi-code")
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot CLI",
    description: "GitHub Copilot\u2019s standalone coding agent",
    configPath: join2(HOME, ".copilot")
  },
  {
    id: "vscode",
    name: "Visual Studio Code",
    description: "VS Code agent plugins (Preview)",
    configPath: dirname(getVsCodeSettingsPath())
  }
];
async function getTargets() {
  const targets = [];
  for (const def of TARGET_DEFS) {
    const detected = detectTarget(def);
    targets.push({ ...def, detected });
  }
  return targets;
}
function detectTarget(def) {
  switch (def.id) {
    case "claude-code":
      return detectBinary("claude");
    case "cursor":
      return detectBinary("cursor");
    case "codex":
      return detectBinary("codex");
    case "grok":
      return detectBinary("grok");
    case "kimi":
      return getKimiBinary() !== null;
    case "github-copilot":
      return detectBinary("copilot");
    case "vscode":
      return detectBinary("code") || detectBinary("code-insiders");
    default:
      return false;
  }
}
function getKimiBinary() {
  try {
    const path = execSync("which kimi", {
      encoding: "utf-8",
      stdio: "pipe"
    }).trim();
    if (path) return path;
  } catch {
  }
  const kimiHome = process.env.KIMI_CODE_HOME ?? join2(HOME, ".kimi-code");
  const extension = process.platform === "win32" ? ".exe" : "";
  const candidates = [
    join2(kimiHome, "bin", `kimi${extension}`),
    join2(HOME, ".local", "bin", `kimi${extension}`),
    join2(HOME, ".kimi", "bin", `kimi${extension}`)
  ];
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "pipe", timeout: 1e4 });
      return candidate;
    } catch {
    }
  }
  return null;
}
function detectBinary(name) {
  try {
    execSync(`which ${name}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// lib/install.ts
import { dirname as dirname2, join as join3, relative } from "path";
import { mkdir, cp, readFile as readFile2, readdir as readdir2, rename, writeFile, rm } from "fs/promises";
import { existsSync as existsSync2 } from "fs";
import { execFileSync as execFileSync2, execSync as execSync2 } from "child_process";
import { homedir as homedir2 } from "os";
import { createHash } from "crypto";

// lib/ui.ts
var isColorSupported = process.env.FORCE_COLOR !== "0" && !process.env.NO_COLOR && (process.env.FORCE_COLOR !== void 0 || process.stdout.isTTY);
function ansi(code) {
  return isColorSupported ? `\x1B[${code}m` : "";
}
var reset = ansi("0");
var bold = ansi("1");
var dim = ansi("2");
var italic = ansi("3");
var underline = ansi("4");
var red = ansi("31");
var green = ansi("32");
var yellow = ansi("33");
var blue = ansi("34");
var magenta = ansi("35");
var cyan = ansi("36");
var gray = ansi("90");
var bgGreen = ansi("42");
var bgRed = ansi("41");
var bgYellow = ansi("43");
var bgCyan = ansi("46");
var black = ansi("30");
var c = {
  bold: (s) => `${bold}${s}${reset}`,
  dim: (s) => `${dim}${s}${reset}`,
  italic: (s) => `${italic}${s}${reset}`,
  underline: (s) => `${underline}${s}${reset}`,
  red: (s) => `${red}${s}${reset}`,
  green: (s) => `${green}${s}${reset}`,
  yellow: (s) => `${yellow}${s}${reset}`,
  blue: (s) => `${blue}${s}${reset}`,
  magenta: (s) => `${magenta}${s}${reset}`,
  cyan: (s) => `${cyan}${s}${reset}`,
  gray: (s) => `${gray}${s}${reset}`,
  bgGreen: (s) => `${bgGreen}${black}${s}${reset}`,
  bgRed: (s) => `${bgRed}${black}${s}${reset}`,
  bgYellow: (s) => `${bgYellow}${black}${s}${reset}`,
  bgCyan: (s) => `${bgCyan}${black}${s}${reset}`
};
var S = {
  // Box drawing
  bar: "\u2502",
  barEnd: "\u2514",
  barStart: "\u250C",
  barH: "\u2500",
  corner: "\u256E",
  // Bullets
  diamond: "\u25C7",
  diamondFilled: "\u25C6",
  bullet: "\u25CF",
  circle: "\u25CB",
  check: "\u2714",
  cross: "\u2716",
  arrow: "\u2192",
  warning: "\u25B2",
  info: "\u2139",
  step: "\u25C7",
  stepActive: "\u25C6",
  stepComplete: "\u25CF",
  stepError: "\u25A0"
};
function barLine(content = "") {
  console.log(`${c.gray(S.bar)}  ${content}`);
}
function barEmpty() {
  console.log(`${c.gray(S.bar)}`);
}
var _debug = false;
function setDebug(enabled) {
  _debug = enabled;
}
function barDebug(content = "") {
  if (_debug) barLine(content);
}
function step(content) {
  console.log(`${c.gray(S.step)}  ${content}`);
}
function stepDone(content) {
  console.log(`${c.green(S.stepComplete)}  ${content}`);
}
function stepError(content) {
  console.log(`${c.red(S.stepError)}  ${content}`);
}
function header(label) {
  console.log();
  console.log(`${c.gray(S.barStart)}  ${c.bgCyan(` ${label} `)}`);
}
function footer(message) {
  if (message) {
    console.log(`${c.gray(S.barEnd)}  ${message}`);
  } else {
    console.log(`${c.gray(S.barEnd)}`);
  }
}
function error(title, details) {
  console.log(`${c.red(S.stepError)}  ${c.red(c.bold(title))}`);
  if (details) {
    for (const line of details) {
      barLine(c.dim(line));
    }
  }
}
function warn(message) {
  barLine(`${c.yellow(S.warning)}  ${c.yellow(message)}`);
}
async function multiSelect(title, options, maxVisible = 8) {
  if (!process.stdin.isTTY) {
    return options.map((o) => o.value);
  }
  const { createInterface: createInterface2, emitKeypressEvents } = await import("readline");
  const { Writable } = await import("stream");
  const silentOutput = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    }
  });
  return new Promise((resolve2) => {
    const rl = createInterface2({
      input: process.stdin,
      output: silentOutput,
      terminal: false
    });
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    emitKeypressEvents(process.stdin, rl);
    let query = "";
    let cursor = 0;
    const selected = new Set(options.map((o) => o.value));
    let lastRenderHeight = 0;
    const filter = (item, q) => {
      if (!q) return true;
      const lq = q.toLowerCase();
      return item.label.toLowerCase().includes(lq) || (item.hint?.toLowerCase().includes(lq) ?? false);
    };
    const getFiltered = () => options.filter((item) => filter(item, query));
    const clearRender = () => {
      if (lastRenderHeight > 0) {
        process.stdout.write(`\x1B[${lastRenderHeight}A`);
        for (let i = 0; i < lastRenderHeight; i++) {
          process.stdout.write("\x1B[2K\x1B[1B");
        }
        process.stdout.write(`\x1B[${lastRenderHeight}A`);
      }
    };
    const render = (state = "active") => {
      clearRender();
      const lines = [];
      const filtered = getFiltered();
      const icon = state === "active" ? c.cyan(S.stepActive) : state === "cancel" ? c.red(S.stepError) : c.green(S.stepComplete);
      lines.push(`${icon}  ${state === "active" ? title : c.dim(title)}`);
      if (state === "active") {
        const blockCursor = isColorSupported ? `\x1B[7m \x1B[0m` : "_";
        lines.push(`${c.gray(S.bar)}  ${c.dim("Search:")} ${query}${blockCursor}`);
        lines.push(
          `${c.gray(S.bar)}  ${c.dim("\u2191\u2193 move, space toggle, a all, n none, enter confirm")}`
        );
        lines.push(`${c.gray(S.bar)}`);
        const visibleStart = Math.max(
          0,
          Math.min(cursor - Math.floor(maxVisible / 2), filtered.length - maxVisible)
        );
        const visibleEnd = Math.min(filtered.length, visibleStart + maxVisible);
        const visibleItems = filtered.slice(visibleStart, visibleEnd);
        if (filtered.length === 0) {
          lines.push(`${c.gray(S.bar)}  ${c.dim("No matches found")}`);
        } else {
          for (let i = 0; i < visibleItems.length; i++) {
            const item = visibleItems[i];
            const actualIndex = visibleStart + i;
            const isSelected = selected.has(item.value);
            const isCursor = actualIndex === cursor;
            const radio = isSelected ? c.green(S.stepComplete) : c.dim(S.circle);
            const label = isCursor ? c.underline(item.label) : item.label;
            const hint = item.hint ? c.dim(` (${item.hint})`) : "";
            const pointer = isCursor ? c.cyan("\u276F") : " ";
            lines.push(`${c.gray(S.bar)} ${pointer} ${radio} ${label}${hint}`);
          }
          const hiddenBefore = visibleStart;
          const hiddenAfter = filtered.length - visibleEnd;
          if (hiddenBefore > 0 || hiddenAfter > 0) {
            const parts = [];
            if (hiddenBefore > 0) parts.push(`\u2191 ${hiddenBefore} more`);
            if (hiddenAfter > 0) parts.push(`\u2193 ${hiddenAfter} more`);
            lines.push(`${c.gray(S.bar)}  ${c.dim(parts.join("  "))}`);
          }
        }
        lines.push(`${c.gray(S.bar)}`);
        const selectedLabels = options.filter((o) => selected.has(o.value)).map((o) => o.label);
        if (selectedLabels.length === 0) {
          lines.push(`${c.gray(S.bar)}  ${c.dim("Selected: (none)")}`);
        } else {
          const summary = selectedLabels.length <= 3 ? selectedLabels.join(", ") : `${selectedLabels.slice(0, 3).join(", ")} +${selectedLabels.length - 3} more`;
          lines.push(`${c.gray(S.bar)}  ${c.green("Selected:")} ${summary}`);
        }
        lines.push(c.gray(S.barEnd));
      } else if (state === "submit") {
        const selectedLabels = options.filter((o) => selected.has(o.value)).map((o) => o.label);
        lines.push(`${c.gray(S.bar)}  ${c.dim(selectedLabels.join(", "))}`);
      } else if (state === "cancel") {
        lines.push(`${c.gray(S.bar)}  ${c.dim("Cancelled")}`);
      }
      process.stdout.write(lines.join("\n") + "\n");
      lastRenderHeight = lines.length;
    };
    const cleanup = () => {
      process.stdin.removeListener("keypress", onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      rl.close();
    };
    const onKeypress = (_str, key) => {
      if (!key) return;
      const filtered = getFiltered();
      if (key.name === "return") {
        render("submit");
        cleanup();
        resolve2([...selected]);
        return;
      }
      if (key.name === "escape" || key.ctrl && key.name === "c") {
        render("cancel");
        cleanup();
        resolve2(null);
        return;
      }
      if (key.name === "up") {
        cursor = Math.max(0, cursor - 1);
        render();
        return;
      }
      if (key.name === "down") {
        cursor = Math.min(filtered.length - 1, cursor + 1);
        render();
        return;
      }
      if (key.name === "space") {
        const item = filtered[cursor];
        if (item) {
          if (selected.has(item.value)) selected.delete(item.value);
          else selected.add(item.value);
        }
        render();
        return;
      }
      if (key.name === "backspace") {
        query = query.slice(0, -1);
        cursor = 0;
        render();
        return;
      }
      if (key.sequence && !key.ctrl && !key.meta && key.sequence.length === 1) {
        if (key.sequence === "a" && query === "") {
          for (const o of options) selected.add(o.value);
          render();
          return;
        }
        if (key.sequence === "n" && query === "") {
          selected.clear();
          render();
          return;
        }
        query += key.sequence;
        cursor = 0;
        render();
        return;
      }
    };
    process.stdin.on("keypress", onKeypress);
    render();
  });
}
var BANNER_LINES = [
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2557     \u2588\u2588\u2557   \u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2557\u2588\u2588\u2588\u2557   \u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557",
  "\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2551     \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D \u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D",
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2551     \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551  \u2588\u2588\u2588\u2557\u2588\u2588\u2551\u2588\u2588\u2554\u2588\u2588\u2557 \u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557",
  "\u2588\u2588\u2554\u2550\u2550\u2550\u255D \u2588\u2588\u2551     \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551\u2588\u2588\u2551\u255A\u2588\u2588\u2557\u2588\u2588\u2551\u255A\u2550\u2550\u2550\u2550\u2588\u2588\u2551",
  "\u2588\u2588\u2551     \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u255A\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u255A\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2551\u2588\u2588\u2551 \u255A\u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551",
  "\u255A\u2550\u255D     \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D \u255A\u2550\u2550\u2550\u2550\u2550\u255D  \u255A\u2550\u2550\u2550\u2550\u2550\u255D \u255A\u2550\u255D\u255A\u2550\u255D  \u255A\u2550\u2550\u2550\u255D\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D"
];
var GRADIENT = [
  [60, 60, 60],
  [90, 90, 90],
  [125, 125, 125],
  [160, 160, 160],
  [200, 200, 200],
  [240, 240, 240]
];
function rgb(r, g, b) {
  return isColorSupported ? `\x1B[38;2;${r};${g};${b}m` : "";
}
function banner() {
  console.log();
  for (let i = 0; i < BANNER_LINES.length; i++) {
    const [r, g, b] = GRADIENT[i];
    console.log(`${rgb(r, g, b)}${BANNER_LINES[i]}${reset}`);
  }
}

// lib/install.ts
var cachePopulated = false;
async function installPlugins(plugins, target, scope, repoPath, source) {
  try {
    await installPluginsUnsafe(plugins, target, scope, repoPath, source);
    return { succeeded: true };
  } catch (err) {
    return {
      succeeded: false,
      message: err instanceof Error ? err.message : String(err)
    };
  }
}
async function installPluginsUnsafe(plugins, target, scope, repoPath, source) {
  if (scope !== "user" && ["grok", "kimi", "github-copilot", "vscode"].includes(target.id)) {
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
    default:
      throw new Error(`Unsupported target: ${target.id}`);
  }
}
async function stageInstallWorkspace(plugins, repoPath, targetId, stagingBaseDir = join3(homedir2(), ".cache", "plugins", ".install-staging")) {
  const stageKey = createHash("sha1").update(repoPath).digest("hex");
  const stageRoot = join3(stagingBaseDir, stageKey, targetId);
  const stagedRepoPath = join3(stageRoot, "repo");
  await mkdir(stageRoot, { recursive: true });
  await rm(stagedRepoPath, { recursive: true, force: true });
  await cp(repoPath, stagedRepoPath, { recursive: true });
  const stagedPlugins = plugins.map((plugin) => {
    const relPath = relative(repoPath, plugin.path);
    return {
      ...plugin,
      path: relPath === "" ? stagedRepoPath : join3(stagedRepoPath, relPath)
    };
  });
  return {
    repoPath: stagedRepoPath,
    plugins: stagedPlugins
  };
}
var OFFICIAL_MARKETPLACE_SOURCE = "anthropics/claude-plugins-official";
function getGitHubSourceRepo(source) {
  let repo = null;
  const shorthand = source.match(/^([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
  if (shorthand) repo = shorthand[1].toLowerCase();
  if (!repo) {
    const https = source.match(/^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
    if (https) repo = https[1].toLowerCase();
  }
  if (!repo) {
    const ssh = source.match(/^git@github\.com:([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
    if (ssh) repo = ssh[1].toLowerCase();
  }
  return repo;
}
function getOfficialPluginRef(source) {
  const repo = getGitHubSourceRepo(source);
  if (repo === "vercel/vercel-plugin") {
    return "vercel@claude-plugins-official";
  }
  return null;
}
function getOfficialCodexPluginRef(source) {
  return getGitHubSourceRepo(source) === "vercel/vercel-plugin" ? "vercel@openai-curated" : null;
}
async function installViaClaudeCli(pluginRef, scope) {
  const claude = findClaudeOrNull();
  if (!claude) return false;
  try {
    step("Registering official Claude marketplace");
    execSync2(`${claude} plugin marketplace add ${OFFICIAL_MARKETPLACE_SOURCE}`, {
      stdio: "pipe",
      timeout: 12e4
    });
    stepDone("Official marketplace registered");
    step(`Installing ${c.cyan(pluginRef)} via Claude CLI`);
    execSync2(`${claude} plugin install "${pluginRef}" --scope ${scope}`, {
      stdio: "pipe",
      timeout: 12e4
    });
    stepDone(`Installed ${c.cyan(pluginRef)} via Claude CLI`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    barDebug(c.dim(`Claude CLI install failed: ${msg}`));
    return false;
  }
}
function installViaCodexCli(pluginRef) {
  step(`Installing ${c.cyan(pluginRef)} via Codex marketplace`);
  runNativeCommand("Codex", "codex", ["plugin", "add", pluginRef]);
  stepDone(`Installed ${c.cyan(pluginRef)} via Codex marketplace`);
}
async function installToClaudeCode(plugins, scope, repoPath, source) {
  await installToPluginCache(plugins, scope, repoPath, source);
}
async function installToCursor(plugins, scope, repoPath, source) {
  if (cachePopulated) return;
  if (process.platform === "win32") {
    await installToCursorExtensions(plugins, scope, repoPath, source);
    return;
  }
  await installToPluginCache(plugins, scope, repoPath, source);
}
async function installToPluginCache(plugins, scope, repoPath, source) {
  const marketplaceName = plugins[0]?.marketplace ?? deriveMarketplaceName(source);
  const home = homedir2();
  const pluginsDir = join3(home, ".claude", "plugins");
  const cacheDir = join3(pluginsDir, "cache");
  step("Preparing plugins for Cursor...");
  barEmpty();
  await prepareForClaudeCode(plugins, repoPath, marketplaceName);
  step("Registering marketplace");
  await mkdir(pluginsDir, { recursive: true });
  const knownPath = join3(pluginsDir, "known_marketplaces.json");
  let knownMarketplaces = {};
  if (existsSync2(knownPath)) {
    try {
      knownMarketplaces = JSON.parse(await readFile2(knownPath, "utf-8"));
    } catch {
    }
  }
  const githubRepo = extractGitHubRepo(source);
  const marketplacesDir = join3(pluginsDir, "marketplaces");
  const marketplaceInstallLocation = join3(marketplacesDir, marketplaceName);
  await mkdir(marketplacesDir, { recursive: true });
  if (existsSync2(marketplaceInstallLocation)) {
    await rm(marketplaceInstallLocation, { recursive: true });
  }
  await cp(repoPath, marketplaceInstallLocation, { recursive: true });
  barDebug(c.dim(`Marketplace copied to ${marketplaceInstallLocation}`));
  if (knownMarketplaces[marketplaceName]) {
    stepDone(`Marketplace ${c.dim("'" + marketplaceName + "'")} already registered`);
  } else {
    let marketplaceSource;
    if (githubRepo) {
      marketplaceSource = { source: "github", repo: githubRepo };
    } else if (isRemoteSource(source)) {
      const gitUrl = normalizeGitUrl(source);
      marketplaceSource = {
        source: "git",
        url: gitUrl.endsWith(".git") ? gitUrl : gitUrl + ".git"
      };
    } else {
      marketplaceSource = { source: "directory", path: repoPath };
    }
    knownMarketplaces[marketplaceName] = {
      source: marketplaceSource,
      installLocation: marketplaceInstallLocation,
      lastUpdated: (/* @__PURE__ */ new Date()).toISOString()
    };
    await writeFile(knownPath, JSON.stringify(knownMarketplaces, null, 2));
    stepDone("Marketplace registered");
  }
  barEmpty();
  const installedPath = join3(pluginsDir, "installed_plugins.json");
  let installedData = {
    version: 2,
    plugins: {}
  };
  if (existsSync2(installedPath)) {
    try {
      const parsed = JSON.parse(await readFile2(installedPath, "utf-8"));
      installedData.version = parsed.version ?? 2;
      installedData.plugins = parsed.plugins ?? {};
    } catch {
    }
  }
  let gitSha;
  try {
    gitSha = execSync2("git rev-parse HEAD", {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: "pipe"
    }).trim();
  } catch {
  }
  for (const plugin of plugins) {
    const pluginRef = `${plugin.name}@${marketplaceName}`;
    const version = plugin.version ?? "0.0.0";
    const versionKey = gitSha ? gitSha.slice(0, 12) : version;
    step(`Installing ${c.bold(pluginRef)}...`);
    const cacheDest = join3(cacheDir, marketplaceName, plugin.name, versionKey);
    await mkdir(cacheDest, { recursive: true });
    await cp(plugin.path, cacheDest, { recursive: true });
    barDebug(c.dim(`Cached to ${cacheDest}`));
    const pluginKey = `${plugin.name}@${marketplaceName}`;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const entry = {
      scope,
      installPath: cacheDest,
      version,
      installedAt: now,
      lastUpdated: now
    };
    if (gitSha) entry.gitCommitSha = gitSha;
    installedData.plugins[pluginKey] = [entry];
    stepDone(`Installed ${c.cyan(pluginRef)}`);
  }
  await writeFile(installedPath, JSON.stringify(installedData, null, 2));
  barDebug(c.dim("Updated installed_plugins.json"));
  const settingsPath = join3(home, ".claude", "settings.json");
  let settings = {};
  let settingsCorrupted = false;
  if (existsSync2(settingsPath)) {
    try {
      settings = JSON.parse(await readFile2(settingsPath, "utf-8"));
    } catch {
      settingsCorrupted = true;
    }
  }
  if (settingsCorrupted) {
    warn(
      "Could not parse ~/.claude/settings.json \u2014 skipping enabledPlugins update to avoid overwriting existing settings."
    );
    barLine(c.dim("You may need to manually enable the plugins in Claude Code settings."));
  } else {
    const enabled = settings.enabledPlugins ?? {};
    for (const plugin of plugins) {
      const pluginKey = `${plugin.name}@${marketplaceName}`;
      enabled[pluginKey] = true;
    }
    settings.enabledPlugins = enabled;
    await writeFile(settingsPath, JSON.stringify(settings, null, 2));
    barDebug(c.dim("Updated settings.json enabledPlugins"));
  }
  cachePopulated = true;
}
async function installToCursorExtensions(plugins, scope, repoPath, source) {
  const marketplaceName = plugins[0]?.marketplace ?? deriveMarketplaceName(source);
  const home = homedir2();
  const extensionsDir = join3(home, ".cursor", "extensions");
  step("Preparing plugins for Cursor...");
  barEmpty();
  await prepareForClaudeCode(plugins, repoPath, marketplaceName);
  await mkdir(extensionsDir, { recursive: true });
  const extensionsJsonPath = join3(extensionsDir, "extensions.json");
  let extensions = [];
  if (existsSync2(extensionsJsonPath)) {
    try {
      const parsed = JSON.parse(await readFile2(extensionsJsonPath, "utf-8"));
      if (Array.isArray(parsed)) extensions = parsed;
    } catch {
    }
  }
  let gitSha;
  try {
    gitSha = execSync2("git rev-parse HEAD", {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: "pipe"
    }).trim();
  } catch {
  }
  for (const plugin of plugins) {
    const pluginRef = `${plugin.name}@${marketplaceName}`;
    const version = plugin.version ?? "0.0.0";
    const versionKey = gitSha ? gitSha.slice(0, 12) : version;
    const folderName = `${marketplaceName}.${plugin.name}-${versionKey}`;
    const destDir = join3(extensionsDir, folderName);
    step(`Installing ${c.bold(pluginRef)}...`);
    await mkdir(destDir, { recursive: true });
    await cp(plugin.path, destDir, { recursive: true });
    barDebug(c.dim(`Copied to ${destDir}`));
    const identifier = `${marketplaceName}.${plugin.name}`;
    extensions = extensions.filter((e) => e?.identifier?.id !== identifier);
    const uriPath = "/" + destDir.replace(/\\/g, "/");
    extensions.push({
      identifier: { id: identifier },
      version,
      location: { $mid: 1, path: uriPath, scheme: "file" },
      relativeLocation: folderName,
      metadata: {
        installedTimestamp: Date.now(),
        ...gitSha ? { gitCommitSha: gitSha } : {}
      }
    });
    stepDone(`Installed ${c.cyan(pluginRef)}`);
  }
  await writeFile(extensionsJsonPath, JSON.stringify(extensions, null, 2));
  barDebug(c.dim("Updated extensions.json"));
  cachePopulated = true;
}
async function installToCodex(plugins, scope, repoPath, source) {
  const marketplaceName = plugins[0]?.marketplace ?? deriveMarketplaceName(source);
  const home = homedir2();
  const cacheDir = join3(home, ".codex", "plugins", "cache");
  const configPath = join3(home, ".codex", "config.toml");
  const marketplaceDir = join3(home, ".agents", "plugins");
  const marketplacePath = join3(marketplaceDir, "marketplace.json");
  const marketplaceRoot = home;
  step("Preparing plugins for Codex...");
  barEmpty();
  for (const plugin of plugins) {
    await preparePluginDirForVendor(plugin, ".codex-plugin", "CODEX_PLUGIN_ROOT");
    await enrichForCodex(plugin);
  }
  let gitSha;
  try {
    gitSha = execSync2("git rev-parse HEAD", {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: "pipe"
    }).trim();
  } catch {
  }
  const versionKey = gitSha ?? "local";
  const pluginPaths = {};
  for (const plugin of plugins) {
    const pluginRef = `${plugin.name}@${marketplaceName}`;
    step(`Installing ${c.bold(pluginRef)}...`);
    const cacheDest = join3(cacheDir, marketplaceName, plugin.name, versionKey);
    await mkdir(cacheDest, { recursive: true });
    await cp(plugin.path, cacheDest, { recursive: true });
    pluginPaths[plugin.name] = cacheDest;
    barDebug(c.dim(`Cached to ${cacheDest}`));
    stepDone(`Installed ${c.cyan(pluginRef)}`);
  }
  step("Updating marketplace...");
  await mkdir(marketplaceDir, { recursive: true });
  let marketplace = {
    name: "plugins-cli",
    interface: { displayName: "Plugins CLI" },
    plugins: []
  };
  if (existsSync2(marketplacePath)) {
    try {
      const existing = JSON.parse(await readFile2(marketplacePath, "utf-8"));
      if (existing && typeof existing === "object" && Array.isArray(existing.plugins)) {
        marketplace = existing;
      }
    } catch {
    }
  }
  for (const plugin of plugins) {
    const cacheDest = pluginPaths[plugin.name];
    const relPath = relative(marketplaceRoot, cacheDest);
    marketplace.plugins = marketplace.plugins.filter(
      (e) => e.name !== plugin.name
    );
    marketplace.plugins.push({
      name: plugin.name,
      source: {
        source: "local",
        path: `./${relPath}`
      },
      policy: {
        installation: "AVAILABLE",
        authentication: "ON_INSTALL"
      },
      category: "Coding"
    });
  }
  await writeFile(marketplacePath, JSON.stringify(marketplace, null, 2));
  stepDone("Marketplace updated");
  step("Updating config.toml...");
  await mkdir(join3(home, ".codex"), { recursive: true });
  let configContent = "";
  if (existsSync2(configPath)) {
    configContent = await readFile2(configPath, "utf-8");
  }
  let configChanged = false;
  for (const plugin of plugins) {
    const pluginKey = `${plugin.name}@plugins-cli`;
    const tomlSection = `[plugins."${pluginKey}"]`;
    if (configContent.includes(tomlSection)) {
      barDebug(c.dim(`${pluginKey} already in config.toml`));
      continue;
    }
    const entry = `
${tomlSection}
enabled = true
`;
    configContent += entry;
    configChanged = true;
    barDebug(c.dim(`Added ${pluginKey} to config.toml`));
  }
  if (configChanged) {
    await writeFile(configPath, configContent);
  }
  stepDone("Config updated");
}
async function enrichForCodex(plugin) {
  const codexManifestPath = join3(plugin.path, ".codex-plugin", "plugin.json");
  if (!existsSync2(codexManifestPath)) return;
  let manifest;
  try {
    manifest = JSON.parse(await readFile2(codexManifestPath, "utf-8"));
  } catch {
    return;
  }
  if (manifest.interface) return;
  let changed = false;
  if (!manifest.skills && existsSync2(join3(plugin.path, "skills"))) {
    manifest.skills = "./skills/";
    changed = true;
  }
  if (!manifest.mcpServers && existsSync2(join3(plugin.path, ".mcp.json"))) {
    manifest.mcpServers = "./.mcp.json";
    changed = true;
  }
  if (!manifest.apps && existsSync2(join3(plugin.path, ".app.json"))) {
    manifest.apps = "./.app.json";
    changed = true;
  }
  const name = manifest.name ?? plugin.name;
  const description = manifest.description ?? plugin.description ?? "";
  const author = manifest.author;
  const iface = {
    displayName: name.charAt(0).toUpperCase() + name.slice(1),
    shortDescription: description,
    developerName: author?.name ?? "Unknown",
    category: "Coding",
    capabilities: ["Interactive", "Write"]
  };
  if (manifest.homepage) iface.websiteURL = manifest.homepage;
  else if (manifest.repository) iface.websiteURL = manifest.repository;
  const assetCandidates = [
    "assets/app-icon.png",
    "assets/icon.png",
    "assets/logo.png",
    "assets/logo.svg"
  ];
  for (const candidate of assetCandidates) {
    if (existsSync2(join3(plugin.path, candidate))) {
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
async function installToGrok(plugins, source) {
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
function installGrokPlugin(pluginName, source) {
  try {
    runNativeCommand("Grok Build", "grok", ["plugin", "install", source, "--trust"]);
    stepDone(`Installed ${c.cyan(pluginName)}`);
  } catch (err) {
    if (!isAlreadyInstalledError(err)) throw err;
    stepDone(`${c.cyan(pluginName)} is already installed`);
  }
}
function isAlreadyInstalledError(err) {
  const message = err instanceof Error ? err.message : String(err);
  return /\balready installed\b/i.test(message);
}
function getGrokNativeSource(source, plugins, repoPath) {
  if (plugins.length !== 1 || plugins[0]?.path !== repoPath) return null;
  if (!existsSync2(join3(repoPath, ".claude-plugin", "plugin.json"))) return null;
  const isGitSource = /^https?:\/\//.test(source) || /^git@/.test(source) || /^[\w.-]+\/[\w.-]+(?:\.git)?$/.test(source);
  return isGitSource ? source : null;
}
async function installToKimi(plugins) {
  step("Preparing plugins for Kimi Code...");
  barEmpty();
  for (const plugin of plugins) {
    await preparePluginDirForVendor(plugin, ".kimi-plugin", "KIMI_PLUGIN_ROOT");
    await enrichForKimi(plugin);
  }
  await installToKimiNativeStore(plugins);
}
async function installToKimiNativeStore(plugins) {
  const kimiHome = process.env.KIMI_CODE_HOME ?? join3(homedir2(), ".kimi-code");
  const pluginsDir = join3(kimiHome, "plugins");
  const installedPath = join3(pluginsDir, "installed.json");
  const installed = await readKimiInstalledFile(installedPath);
  for (const plugin of plugins) {
    const managedRoot = await copyToKimiManagedRoot(kimiHome, plugin.name, plugin.path);
    const existing = installed.plugins.find((entry) => entry.id === plugin.name);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const record = {
      id: plugin.name,
      root: managedRoot,
      source: "local-path",
      enabled: existing?.enabled ?? true,
      installedAt: existing?.installedAt ?? now,
      updatedAt: now,
      originalSource: plugin.path,
      ...existing?.capabilities ? { capabilities: existing.capabilities } : {},
      ...existing?.github ? { github: existing.github } : {}
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
async function copyToKimiManagedRoot(kimiHome, pluginId, sourceRoot) {
  const managedRoot = join3(kimiHome, "plugins", "managed", pluginId);
  const managedDir = dirname2(managedRoot);
  await mkdir(managedDir, { recursive: true });
  const stagingRoot = join3(managedDir, `${pluginId}-${Date.now()}-${process.pid}`);
  await rm(stagingRoot, { recursive: true, force: true });
  await cp(sourceRoot, stagingRoot, { recursive: true });
  await rm(managedRoot, { recursive: true, force: true });
  await rename(stagingRoot, managedRoot);
  return managedRoot;
}
async function readKimiInstalledFile(path) {
  if (!existsSync2(path)) return { version: 1, plugins: [] };
  const parsed = await readJsonObject(path);
  if (!parsed || !Array.isArray(parsed.plugins)) {
    throw new Error(`Could not parse ${path}; Kimi plugin records were left unchanged.`);
  }
  return {
    version: 1,
    plugins: parsed.plugins
  };
}
async function removeKimiCompatibilityLayer(plugins, kimiHome) {
  const prefixes = plugins.map((plugin) => `${plugin.name}-`);
  const skillsDir = join3(kimiHome, "skills");
  try {
    const entries = await readdir2(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (prefixes.some((prefix) => entry.name.startsWith(prefix))) {
        await rm(join3(skillsDir, entry.name), { recursive: true, force: true });
      }
    }
  } catch {
  }
  const mcpPath = join3(kimiHome, "mcp.json");
  const mcpConfig = await readJsonObject(mcpPath);
  if (!mcpConfig?.mcpServers || typeof mcpConfig.mcpServers !== "object") return;
  const servers = mcpConfig.mcpServers;
  const retained = Object.fromEntries(
    Object.entries(servers).filter(([name]) => !prefixes.some((prefix) => name.startsWith(prefix)))
  );
  if (Object.keys(retained).length === Object.keys(servers).length) return;
  mcpConfig.mcpServers = retained;
  await writeFile(mcpPath, JSON.stringify(mcpConfig, null, 2));
}
async function enrichForKimi(plugin) {
  const manifestPath = join3(plugin.path, ".kimi-plugin", "plugin.json");
  const manifest = await readJsonObject(manifestPath);
  if (!manifest) return;
  let changed = false;
  if (!manifest.skills && existsSync2(join3(plugin.path, "skills"))) {
    manifest.skills = "./skills/";
    changed = true;
  }
  if (!manifest.commands && existsSync2(join3(plugin.path, "commands"))) {
    manifest.commands = "./commands/";
    changed = true;
  }
  const mcpConfig = await readJsonObject(join3(plugin.path, ".mcp.json"));
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
async function readKimiHooks(pluginPath, declaredHooks) {
  let source = declaredHooks;
  if (typeof declaredHooks === "string") {
    source = await readJsonObject(join3(pluginPath, declaredHooks.replace(/^\.\//, "")));
  }
  if (!source) {
    source = await readJsonObject(join3(pluginPath, "hooks", "hooks.json"));
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) return [];
  const hookMap = source.hooks;
  if (!hookMap || typeof hookMap !== "object" || Array.isArray(hookMap)) return [];
  const result = [];
  for (const [event, groups] of Object.entries(hookMap)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!group || typeof group !== "object" || Array.isArray(group)) continue;
      const groupRecord = group;
      const hooks = Array.isArray(groupRecord.hooks) ? groupRecord.hooks : [groupRecord];
      for (const hook of hooks) {
        if (!hook || typeof hook !== "object" || Array.isArray(hook)) continue;
        const hookRecord = hook;
        if (hookRecord.type !== "command" || typeof hookRecord.command !== "string") continue;
        const kimiHook = {
          event,
          command: hookRecord.command
        };
        if (typeof groupRecord.matcher === "string") kimiHook.matcher = groupRecord.matcher;
        if (typeof hookRecord.timeout === "number") kimiHook.timeout = hookRecord.timeout;
        result.push(kimiHook);
      }
    }
  }
  return result;
}
async function installToGitHubCopilot(plugins, repoPath, source) {
  step("Preparing plugins for GitHub Copilot CLI...");
  barEmpty();
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
    runNativeCommand("GitHub Copilot CLI", "copilot", [
      "plugin",
      "marketplace",
      "add",
      marketplaceSource
    ]);
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
function hasCopilotMarketplaceManifest(repoPath) {
  return [
    join3(repoPath, "marketplace.json"),
    join3(repoPath, ".github", "plugin", "marketplace.json"),
    join3(repoPath, ".claude-plugin", "marketplace.json")
  ].some(existsSync2);
}
async function stageGitHubCopilotMarketplace(plugins, repoPath, marketplaceName, stagingBaseDir = join3(homedir2(), ".cache", "plugins", "copilot-marketplaces")) {
  const workspace = await stageInstallWorkspace(
    plugins,
    repoPath,
    "github-copilot",
    stagingBaseDir
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
        ...plugin.version ? { version: plugin.version } : {}
      };
    })
  };
  const marketplaceDir = join3(workspace.repoPath, ".claude-plugin");
  await mkdir(marketplaceDir, { recursive: true });
  await writeFile(join3(marketplaceDir, "marketplace.json"), JSON.stringify(marketplace, null, 2));
  barDebug(c.dim(`Generated durable Copilot marketplace at ${workspace.repoPath}`));
  return workspace;
}
async function installToVsCode(plugins) {
  step("Preparing plugins for Visual Studio Code...");
  barEmpty();
  for (const plugin of plugins) {
    await preparePluginDirForVendor(plugin, ".plugin", "PLUGIN_ROOT");
  }
  step("Registering agent plugins in VS Code...");
  await addVsCodePluginLocations(plugins.map((plugin) => plugin.path));
  stepDone("Agent plugins registered in VS Code");
}
async function addVsCodePluginLocations(pluginPaths, settingsPath = getVsCodeSettingsPath()) {
  let settingsContent = "{}\n";
  if (existsSync2(settingsPath)) {
    settingsContent = await readFile2(settingsPath, "utf-8");
  }
  const settings = parseJsoncObject(settingsContent, settingsPath);
  const existing = settings["chat.pluginLocations"];
  if (existing !== void 0 && (!existing || typeof existing !== "object" || Array.isArray(existing))) {
    throw new Error(`${settingsPath}: chat.pluginLocations must be an object.`);
  }
  const locations = {};
  if (existing) {
    for (const [path, enabled] of Object.entries(existing)) {
      if (typeof enabled === "boolean") locations[path] = enabled;
    }
  }
  for (const pluginPath of pluginPaths) locations[pluginPath] = true;
  const updatedContent = updateJsoncRootProperty(
    settingsContent,
    "chat.pluginLocations",
    locations
  );
  await mkdir(dirname2(settingsPath), { recursive: true });
  await writeFile(settingsPath, updatedContent);
  barDebug(c.dim(`Updated ${settingsPath} chat.pluginLocations`));
}
function runNativeCommand(label, command, args) {
  try {
    return execFileSync2(command, args, {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 12e4
    });
  } catch (err) {
    const error2 = err;
    const stderr = error2.stderr?.toString().trim();
    throw new Error(
      `${label} installation failed.${stderr ? ` ${stderr}` : ` ${error2.message ?? ""}`}`
    );
  }
}
async function readJsonObject(path) {
  if (!existsSync2(path)) return null;
  try {
    const parsed = JSON.parse(await readFile2(path, "utf-8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
  }
  return null;
}
function parseJsoncObject(content, filePath) {
  try {
    const parsed = JSON.parse(removeTrailingJsoncCommas(stripJsoncComments(content)));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("root value is not an object");
    }
    return parsed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not parse ${filePath}; VS Code settings were left unchanged. ${message}`
    );
  }
}
function stripJsoncComments(content) {
  let result = "";
  let inString = false;
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (inString) {
      result += char;
      if (char === "\\") {
        result += content[++i] ?? "";
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
function removeTrailingJsoncCommas(content) {
  let result = "";
  let inString = false;
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
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
function updateJsoncRootProperty(content, key, value) {
  const sanitized = stripJsoncComments(content);
  const property = findJsoncRootProperty(sanitized, key);
  const formattedValue = JSON.stringify(value, null, 2).replaceAll("\n", "\n  ");
  if (property.valueStart !== void 0 && property.valueEnd !== void 0) {
    return `${content.slice(0, property.valueStart)}${formattedValue}${content.slice(property.valueEnd)}`;
  }
  const closingBrace = property.objectEnd - 1;
  let last = closingBrace - 1;
  while (last > property.objectStart && /\s/.test(sanitized[last] ?? "")) last--;
  const hasEntries = last > property.objectStart;
  const separator = !hasEntries || sanitized[last] === "," ? "" : ",";
  const addition = `${separator}
  ${JSON.stringify(key)}: ${formattedValue}
`;
  return `${content.slice(0, closingBrace)}${addition}${content.slice(closingBrace)}`;
}
function findJsoncRootProperty(content, wantedKey) {
  let index = skipWhitespace(content, 0);
  if (content[index] !== "{") throw new Error("VS Code settings must be a JSON object.");
  const objectStart = index;
  index++;
  while (true) {
    index = skipWhitespace(content, index);
    if (content[index] === "}") {
      return { objectStart, objectEnd: index + 1 };
    }
    if (content[index] !== '"') throw new Error("Could not locate a VS Code settings property.");
    const keyStart = index;
    const keyEnd = findJsonStringEnd(content, keyStart);
    const key = JSON.parse(content.slice(keyStart, keyEnd));
    index = skipWhitespace(content, keyEnd);
    if (content[index] !== ":") throw new Error("Could not locate a VS Code settings property.");
    const valueStart = skipWhitespace(content, index + 1);
    const valueEnd = findJsonValueEnd(content, valueStart);
    if (key === wantedKey)
      return {
        objectStart,
        objectEnd: findJsonValueEnd(content, objectStart),
        valueStart,
        valueEnd
      };
    index = skipWhitespace(content, valueEnd);
    if (content[index] === ",") {
      index++;
      continue;
    }
    if (content[index] === "}") return { objectStart, objectEnd: index + 1 };
    throw new Error("Could not locate a VS Code settings property.");
  }
}
function skipWhitespace(content, index) {
  while (/\s/.test(content[index] ?? "")) index++;
  return index;
}
function findJsonStringEnd(content, start) {
  for (let index = start + 1; index < content.length; index++) {
    if (content[index] === "\\") {
      index++;
    } else if (content[index] === '"') {
      return index + 1;
    }
  }
  throw new Error("Unterminated JSON string.");
}
function findJsonValueEnd(content, start) {
  const first = content[start];
  if (first === '"') return findJsonStringEnd(content, start);
  if (first !== "{" && first !== "[") {
    let index = start;
    while (index < content.length && !/[\s,}\]]/.test(content[index])) index++;
    return index;
  }
  const closers = [first === "{" ? "}" : "]"];
  for (let index = start + 1; index < content.length; index++) {
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
async function prepareForClaudeCode(plugins, repoPath, marketplaceName) {
  const claudePluginDir = join3(repoPath, ".claude-plugin");
  await mkdir(claudePluginDir, { recursive: true });
  const marketplaceJson = {
    name: marketplaceName,
    owner: { name: "plugins" },
    plugins: plugins.map((p) => {
      const rel = relative(repoPath, p.path);
      const sourcePath = rel === "" ? "./" : `./${rel}`;
      const entry = {
        name: p.name,
        source: sourcePath,
        description: p.description ?? ""
      };
      if (p.version) entry.version = p.version;
      if (p.manifest?.author) entry.author = p.manifest.author;
      if (p.manifest?.license) entry.license = p.manifest.license;
      if (p.manifest?.keywords) entry.keywords = p.manifest.keywords;
      return entry;
    })
  };
  await writeFile(
    join3(claudePluginDir, "marketplace.json"),
    JSON.stringify(marketplaceJson, null, 2)
  );
  barDebug(c.dim("Generated .claude-plugin/marketplace.json"));
  for (const plugin of plugins) {
    await preparePluginDirForVendor(plugin, ".claude-plugin", "CLAUDE_PLUGIN_ROOT");
  }
}
function findClaudeOrNull() {
  try {
    const path = execSync2("which claude", { encoding: "utf-8", stdio: "pipe" }).trim();
    if (path) return path;
  } catch {
  }
  const home = homedir2();
  const candidates = [
    join3(home, ".local", "bin", "claude"),
    join3(home, ".bun", "bin", "claude"),
    "/usr/local/bin/claude"
  ];
  for (const candidate of candidates) {
    if (existsSync2(candidate)) return candidate;
  }
  return null;
}
async function preparePluginDirForVendor(plugin, vendorDir, envVar) {
  const pluginPath = plugin.path;
  const openPluginDir = join3(pluginPath, ".plugin");
  const vendorPluginDir = join3(pluginPath, vendorDir);
  const hasOpenPlugin = existsSync2(join3(openPluginDir, "plugin.json"));
  const hasVendorPlugin = existsSync2(join3(vendorPluginDir, "plugin.json"));
  if (hasOpenPlugin && !hasVendorPlugin) {
    await cp(openPluginDir, vendorPluginDir, { recursive: true });
    barDebug(c.dim(`${plugin.name}: translated .plugin/ \u2192 ${vendorDir}/`));
  }
  if (!hasOpenPlugin && !hasVendorPlugin) {
    await mkdir(vendorPluginDir, { recursive: true });
    await writeFile(
      join3(vendorPluginDir, "plugin.json"),
      JSON.stringify(
        {
          name: plugin.name,
          description: plugin.description ?? "",
          version: plugin.version ?? "0.0.0"
        },
        null,
        2
      )
    );
    barDebug(c.dim(`${plugin.name}: generated ${vendorDir}/plugin.json`));
  }
  await translateEnvVars(pluginPath, plugin.name, envVar);
}
var KNOWN_PLUGIN_ROOT_VARS = [
  "PLUGIN_ROOT",
  "CLAUDE_PLUGIN_ROOT",
  "CURSOR_PLUGIN_ROOT",
  "CODEX_PLUGIN_ROOT",
  "KIMI_PLUGIN_ROOT"
];
async function translateEnvVars(pluginPath, pluginName, envVar) {
  const configFiles = [
    join3(pluginPath, "hooks", "hooks.json"),
    join3(pluginPath, ".mcp.json"),
    join3(pluginPath, ".lsp.json")
  ];
  const target = `\${${envVar}}`;
  const patterns = KNOWN_PLUGIN_ROOT_VARS.filter((v) => v !== envVar).map((v) => `\${${v}}`);
  for (const filePath of configFiles) {
    if (!existsSync2(filePath)) continue;
    let content = await readFile2(filePath, "utf-8");
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
          `${pluginName}: translated plugin root \u2192 \${${envVar}} in ${filePath.split("/").pop()}`
        )
      );
    }
  }
}
function deriveMarketplaceName(source) {
  if (source.match(/^[\w-]+\/[\w.-]+$/)) {
    return source.replace("/", "-");
  }
  const sshMatch = source.match(/^git@[^:]+:(.+?)(?:\.git)?$/);
  if (sshMatch) {
    const parts2 = sshMatch[1].split("/").filter(Boolean);
    if (parts2.length >= 2) {
      return `${parts2[parts2.length - 2]}-${parts2[parts2.length - 1]}`;
    }
  }
  try {
    const url = new URL(source);
    const parts2 = url.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
    if (parts2.length >= 2) {
      return `${parts2[parts2.length - 2]}-${parts2[parts2.length - 1]}`;
    }
  } catch {
  }
  const parts = source.replace(/\/$/, "").split("/");
  return parts[parts.length - 1] ?? "plugins";
}
function extractGitHubRepo(source) {
  const shorthand = source.match(/^([\w-]+\/[\w.-]+)$/);
  if (shorthand) return shorthand[1];
  const httpsMatch = source.match(/^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
  if (httpsMatch) return httpsMatch[1];
  const sshMatch = source.match(/^git@github\.com:([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];
  return null;
}
function isRemoteSource(source) {
  if (source.match(/^[\w-]+\/[\w.-]+$/)) return true;
  if (source.startsWith("git@")) return true;
  if (source.startsWith("https://") || source.startsWith("http://")) return true;
  return false;
}
function normalizeGitUrl(source) {
  if (source.match(/^[\w-]+\/[\w.-]+$/)) {
    return `https://github.com/${source}`;
  }
  const sshMatch = source.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return `https://${sshMatch[1]}/${sshMatch[2]}`;
  }
  return source;
}
async function isMarketplaceNew(marketplaceName) {
  const knownPath = join3(homedir2(), ".claude", "plugins", "known_marketplaces.json");
  if (!existsSync2(knownPath)) return true;
  try {
    const data = JSON.parse(await readFile2(knownPath, "utf-8"));
    return !data[marketplaceName];
  } catch {
    return true;
  }
}
async function setAutoUpdate(marketplaceName, enabled) {
  const knownPath = join3(homedir2(), ".claude", "plugins", "known_marketplaces.json");
  if (!existsSync2(knownPath)) return;
  let data = {};
  try {
    data = JSON.parse(await readFile2(knownPath, "utf-8"));
  } catch {
    return;
  }
  if (!data[marketplaceName]) return;
  data[marketplaceName].autoUpdate = enabled;
  await writeFile(knownPath, JSON.stringify(data, null, 2));
}

// lib/telemetry.ts
var TELEMETRY_URL = "https://plugins-telemetry.labs.vercel.dev/t";
var cliVersion = null;
function isCI() {
  return !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITLAB_CI || process.env.CIRCLECI || process.env.TRAVIS || process.env.BUILDKITE || process.env.JENKINS_URL || process.env.TEAMCITY_VERSION);
}
function isEnabled() {
  return !process.env.DISABLE_TELEMETRY && !process.env.DO_NOT_TRACK;
}
function setVersion(version) {
  cliVersion = version;
}
function track(data) {
  if (!isEnabled()) return;
  try {
    const params = new URLSearchParams();
    if (cliVersion) {
      params.set("v", cliVersion);
    }
    if (isCI()) {
      params.set("ci", "1");
    }
    for (const [key, value] of Object.entries(data)) {
      if (value !== void 0 && value !== null) {
        params.set(key, String(value));
      }
    }
    fetch(`${TELEMETRY_URL}?${params.toString()}`).catch(() => {
    });
  } catch {
  }
}

// index.ts
setVersion("1.2.8");
async function main() {
  const { values: parsedValues, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      target: { type: "string", short: "t" },
      scope: { type: "string", short: "s", default: "user" },
      yes: { type: "boolean", short: "y" },
      remote: { type: "boolean" },
      debug: { type: "boolean" }
    },
    allowPositionals: true,
    strict: true
  });
  const values = parsedValues;
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
  const message = err instanceof Error ? err.message : String(err);
  barEmpty();
  error("Could not complete the command.", [message, "Run again with --debug for more detail."]);
  footer();
  process.exitCode = 1;
}
function printUsage() {
  console.log(`
${c.bold("plugins")} \u2014 Install open-plugin format plugins into agent tools

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
async function cmdDiscover(source, opts) {
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
        `${c.bold(String(remotePlugins.length))} remote plugin(s) ${c.dim("(hosted in external repos)")}`
      );
      barEmpty();
      printRemotePluginTable(remotePlugins);
    } else {
      barEmpty();
      barLine(c.dim(`${remotePlugins.length} remote plugin(s) not shown. Run:`));
      barLine(`  ${c.cyan(`npx plugins discover ${source} --remote`)}`);
    }
    printMissingPaths(missingPaths);
  }
  footer();
}
async function cmdTargets() {
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
async function cmdInstall(source, opts) {
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
      barLine(`  ${c.cyan(`npx plugins discover ${source} --remote`)}`);
      printMissingPaths(missingPaths);
    }
    footer();
    return;
  }
  const targets = await getTargets();
  const detectedTargets = targets.filter((t) => t.detected);
  let installTargets;
  if (opts.target) {
    const found = targets.find((t) => t.id === opts.target);
    if (!found) {
      barEmpty();
      stepError(`Unknown target: ${c.bold(opts.target)}`);
      barLine(c.dim(`Available: ${targets.map((t) => t.id).join(", ")}`));
      footer();
      process.exit(1);
    }
    if (!found.detected) {
      barEmpty();
      barLine(c.yellow(`Warning: ${found.name} was not detected on this system.`));
    }
    installTargets = [found];
  } else if (detectedTargets.length === 0) {
    barEmpty();
    stepError("No supported targets detected.");
    barLine(
      c.dim(
        "No supported agent binary was found on PATH (claude, cursor, codex, grok, kimi, copilot, or code)."
      )
    );
    barLine(c.dim("Use --target to specify one manually."));
    footer();
    process.exit(1);
  } else {
    installTargets = detectedTargets;
  }
  barEmpty();
  let selectedPlugins;
  if (plugins.length === 1 || opts.yes) {
    step(`Found ${c.bold(String(plugins.length))} plugin(s)`);
    barEmpty();
    printPluginTable(plugins);
    if (remotePlugins.length > 0) {
      barEmpty();
      barLine(c.dim(`+ ${remotePlugins.length} remote plugin(s) not included. Run:`));
      barLine(`  ${c.cyan(`npx plugins discover ${source} --remote`)}`);
      printMissingPaths(missingPaths);
    }
    barEmpty();
    barLine(`${c.dim("Targets:")}  ${installTargets.map((t) => c.cyan(t.name)).join(c.dim(", "))}`);
    barLine(`${c.dim("Scope:")}    ${c.cyan(opts.scope ?? "user")}`);
    barEmpty();
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
    step(`Found ${c.bold(String(plugins.length))} plugin(s)`);
    barEmpty();
    const options = plugins.map((p) => {
      const parts = pluginComponents(p);
      const hint = parts.length ? parts.join(", ") : void 0;
      return { label: p.name, value: p.name, hint };
    });
    const selected = await multiSelect("Select plugins to install", options);
    if (!selected || selected.length === 0) {
      step("Aborted.");
      footer();
      return;
    }
    selectedPlugins = plugins.filter((p) => selected.includes(p.name));
    if (remotePlugins.length > 0) {
      barLine(c.dim(`+ ${remotePlugins.length} remote plugin(s) not included. Run:`));
      barLine(`  ${c.cyan(`npx plugins discover ${source} --remote`)}`);
      printMissingPaths(missingPaths);
    }
    barEmpty();
    barLine(`${c.dim("Targets:")}  ${installTargets.map((t) => c.cyan(t.name)).join(c.dim(", "))}`);
    barLine(`${c.dim("Scope:")}    ${c.cyan(opts.scope ?? "user")}`);
    barEmpty();
  }
  const scope = opts.scope ?? "user";
  const marketplaceName = selectedPlugins[0]?.marketplace ?? deriveMarketplaceName(source);
  const willInstallToClaude = installTargets.some(
    (t) => t.id === "claude-code" || t.id === "cursor" && process.platform !== "win32"
  );
  const isNew = willInstallToClaude && await isMarketplaceNew(marketplaceName);
  const installedTargets = [];
  const failedTargets = [];
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
  const installedToClaude = installedTargets.some(
    (t) => t.id === "claude-code" || t.id === "cursor" && process.platform !== "win32"
  );
  if (isNew && installedToClaude && !installedViaOfficialCli) {
    let enableAutoUpdate = true;
    if (!opts.yes && process.stdin.isTTY) {
      barEmpty();
      const response = await readLine(
        `${c.cyan(S.stepActive)}  Enable auto-updates? ${c.dim("[Y/n]")} `
      );
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
    scope
  });
  if (failedTargets.length > 0) {
    barEmpty();
    error(
      failedTargets.length === installTargets.length ? "No target installations completed." : "Installed with target failures.",
      failedTargets.map(({ target, message }) => `${target.name}: ${message}`)
    );
    footer("Retry a failed target with --target <target>.");
    process.exitCode = 1;
    return;
  }
  barEmpty();
  stepDone(c.green("Done.") + "  Restart your agent tools to load the plugins.");
  footer();
}
function pluginComponents(p) {
  const parts = [];
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
function printPluginTable(plugins) {
  const nameWidth = Math.max(...plugins.map((p) => p.name.length), 4);
  const compStrs = plugins.map((p) => pluginComponents(p).join(", "));
  const compWidth = Math.max(...compStrs.map((s) => s.length), 0);
  const termWidth = process.stdout.columns || 80;
  const descWidth = Math.max(termWidth - 3 - nameWidth - 2 - compWidth - 2, 20);
  for (let i = 0; i < plugins.length; i++) {
    const p = plugins[i];
    const name = p.name.padEnd(nameWidth);
    const comp = compStrs[i];
    const desc = truncate(p.description ?? "", descWidth);
    barLine(
      `${c.bold(name)}  ${comp ? c.cyan(comp.padEnd(compWidth)) : " ".repeat(compWidth)}  ${c.dim(desc)}`
    );
  }
}
function printRemotePluginTable(plugins) {
  const nameWidth = Math.max(...plugins.map((p) => p.name.length), 4);
  const termWidth = process.stdout.columns || 80;
  const descWidth = Math.max(termWidth - 3 - nameWidth - 2, 20);
  for (const p of plugins) {
    const name = p.name.padEnd(nameWidth);
    const desc = truncate(p.description ?? "", descWidth);
    barLine(`${c.bold(name)}  ${c.dim(desc)}`);
  }
}
function printMissingPaths(paths) {
  if (paths.length === 0) return;
  for (const p of paths) {
    barLine(c.dim(`  source not found: ${p}`));
  }
}
function truncate(s, max) {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "\u2026";
}
function sshToHttps(sshUrl) {
  const m = sshUrl.match(/^git@([^:]+):(.+)$/);
  if (!m) return null;
  return `https://${m[1]}/${m[2]}`;
}
function resolveSource(source) {
  if (source.startsWith("https://") || source.startsWith("git@") || source.match(/^[\w-]+\/[\w.-]+$/)) {
    const url = source.match(/^[\w-]+\/[\w.-]+$/) ? `https://github.com/${source}` : source;
    const cacheDir = join4(homedir3(), ".cache", "plugins");
    mkdirSync(cacheDir, { recursive: true });
    const slug = url.replace(/^https?:\/\//, "").replace(/^git@/, "").replace(/\.git$/, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    const tmpDir = join4(cacheDir, slug);
    if (existsSync3(join4(tmpDir, ".git", "HEAD"))) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    step(`Source: ${c.dim(url)}`);
    barEmpty();
    try {
      execSync3(`git clone --depth 1 -q "${url}" "${tmpDir}"`, { stdio: "pipe" });
    } catch (err) {
      const stderr = err.stderr?.toString() ?? "";
      if (url.startsWith("git@") && stderr.includes("Permission denied")) {
        const httpsUrl = sshToHttps(url);
        if (httpsUrl) {
          barLine(c.yellow("SSH authentication failed. Retrying over HTTPS..."));
          step(`Source: ${c.dim(httpsUrl)}`);
          barEmpty();
          try {
            execSync3(`git clone --depth 1 -q "${httpsUrl}" "${tmpDir}"`, { stdio: "inherit" });
            stepDone("Repository cloned");
            barEmpty();
            return tmpDir;
          } catch {
          }
        }
      }
      if (existsSync3(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
      if (stderr.includes("Permission denied") || stderr.includes("Could not read from remote repository")) {
        barEmpty();
        stepError(`Could not access ${c.bold(url)}`);
        barEmpty();
        barLine(c.dim("Make sure you have access to this repository. For private repos, try:"));
        barLine(`  ${c.dim("HTTPS:")} plugins add https://github.com/owner/repo`);
        barLine(`  ${c.dim("       (uses git credential helper / browser auth)")}`);
        barLine(`  ${c.dim("SSH:")}   plugins add git@github.com:owner/repo.git`);
        barLine(`  ${c.dim("       (requires SSH keys)")}`);
      } else if (stderr.includes("not found") || stderr.includes("does not exist") || err.status === 128) {
        barEmpty();
        stepError(`Repository not found: ${c.bold(url)}`);
        barLine(c.dim("Check that the URL is correct and the repository exists."));
      } else {
        barEmpty();
        stepError("git clone failed.");
        if (stderr.trim()) barLine(c.dim(stderr.trim()));
      }
      footer();
      process.exit(1);
    }
    stepDone("Repository cloned");
    barEmpty();
    return tmpDir;
  }
  return resolve(source);
}
function readLine(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve2) => {
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
      resolve2(answer);
    });
  });
}