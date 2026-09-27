/** Target registry. One entry per agent tool the CLI can install into. */
import { dirname, join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";
import { execFileSync, execSync } from "child_process";
import type { Target, TargetDef } from "./types.ts";

const HOME = homedir();

function getVsCodeSettingsPath(): string {
  const product = detectBinary("code") || !detectBinary("code-insiders") ? "Code" : "Code - Insiders";
  if (process.platform === "darwin") {
    return join(HOME, "Library", "Application Support", product, "User", "settings.json");
  }
  if (process.platform === "win32") {
    return join(
      process.env.APPDATA ?? join(HOME, "AppData", "Roaming"),
      product,
      "User",
      "settings.json",
    );
  }
  return join(HOME, ".config", product, "User", "settings.json");
}

/**
 * OpenCode reads plugins and config from an XDG-style directory. `OPENCODE_CONFIG`
 * is honoured because OpenCode itself resolves its config through XDG_CONFIG_HOME.
 */
function getOpenCodeConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, "opencode");
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(HOME, "AppData", "Roaming"), "opencode");
  }
  return join(HOME, ".config", "opencode");
}

export const TARGET_DEFS: TargetDef[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    description: "Anthropic's CLI coding agent",
    configPath: join(HOME, ".claude"),
  },
  {
    id: "cursor",
    name: "Cursor",
    description: "AI-powered code editor",
    configPath: join(HOME, ".cursor"),
  },
  {
    id: "codex",
    name: "Codex",
    description: "OpenAI's coding agent",
    configPath: join(HOME, ".codex"),
  },
  {
    id: "grok",
    name: "Grok Build",
    description: "xAI's CLI coding agent",
    configPath: join(HOME, ".grok"),
  },
  {
    id: "kimi",
    name: "Kimi Code",
    description: "Moonshot AI's CLI coding agent",
    configPath: process.env.KIMI_CODE_HOME ?? join(HOME, ".kimi-code"),
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot CLI",
    description: "GitHub Copilot's standalone coding agent",
    configPath: join(HOME, ".copilot"),
  },
  {
    id: "vscode",
    name: "Visual Studio Code",
    description: "VS Code agent plugins (Preview)",
    configPath: dirname(getVsCodeSettingsPath()),
  },
  {
    id: "opencode",
    name: "OpenCode",
    description: "Anomaly's open-source AI coding agent",
    configPath: getOpenCodeConfigDir(),
  },
];

export async function getTargets(): Promise<Target[]> {
  const targets: Target[] = [];
  for (const def of TARGET_DEFS) {
    targets.push({ ...def, detected: detectTarget(def) });
  }
  return targets;
}

function detectTarget(def: TargetDef): boolean {
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
    case "opencode":
      return detectBinary("opencode") || existsSync(getOpenCodeConfigDir());
    default:
      return false;
  }
}

function getKimiBinary(): string | null {
  try {
    const path = execSync("which kimi", { encoding: "utf-8", stdio: "pipe" }).trim();
    if (path) return path;
  } catch {
    /* fall through to candidate probing */
  }
  const kimiHome = process.env.KIMI_CODE_HOME ?? join(HOME, ".kimi-code");
  const extension = process.platform === "win32" ? ".exe" : "";
  const candidates = [
    join(kimiHome, "bin", `kimi${extension}`),
    join(HOME, ".local", "bin", `kimi${extension}`),
    join(HOME, ".kimi", "bin", `kimi${extension}`),
  ];
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "pipe", timeout: 10_000 });
      return candidate;
    } catch {
      /* keep probing */
    }
  }
  return null;
}

function detectBinary(name: string): boolean {
  try {
    execSync(`which ${name}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
