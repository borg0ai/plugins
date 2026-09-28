import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installToOpenCode } from "../lib/opencode";
import * as ui from "../lib/ui";
import type { Plugin } from "../lib/types";

let configDir: string;
let repo: string;

/** Path inside the OpenCode config dir, which lives under XDG_CONFIG_HOME. */
function oc(...segments: string[]): string {
  return join(configDir, "opencode", ...segments);
}

async function readConfig(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(oc("opencode.json"), "utf-8"));
}

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), "plugins-oc-cfg-"));
  repo = await mkdtemp(join(tmpdir(), "plugins-oc-repo-"));
  process.env.XDG_CONFIG_HOME = configDir;
});

afterEach(async () => {
  delete process.env.XDG_CONFIG_HOME;
  vi.resetModules();
  await rm(configDir, { recursive: true, force: true });
  await rm(repo, { recursive: true, force: true });
});

function makePlugin(overrides: Partial<Plugin> = {}): Plugin {
  return {
    name: "alpha",
    version: "1.0.0",
    description: "Alpha plugin",
    path: repo,
    skills: [],
    commands: [],
    agents: [],
    rules: [],
    hasHooks: false,
    hasMcp: false,
    hasLsp: false,
    manifest: null,
    ...overrides,
  };
}

/**
 * Writes a plugin directory containing every translatable component.
 * Returns the matching Plugin record.
 */
async function fullPlugin(): Promise<Plugin> {
  await mkdir(join(repo, "commands"), { recursive: true });
  await mkdir(join(repo, "agents"), { recursive: true });
  await mkdir(join(repo, "rules"), { recursive: true });

  await writeFile(
    join(repo, "commands", "deploy.md"),
    "---\ndescription: Deploy the app\n---\n\nDeploy $ARGUMENTS to staging\n",
  );
  await writeFile(
    join(repo, "agents", "reviewer.md"),
    "---\ndescription: Reviews diffs\n---\n\nYou review diffs carefully.\n",
  );
  await writeFile(join(repo, "rules", "style.md"), "---\n---\n\nPrefer small commits.\n");

  await writeFile(
    join(repo, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        files: { command: "mcp-files", args: ["--root", "${PLUGIN_ROOT}"] },
        remote: { url: "https://mcp.example.com/sse", headers: { Authorization: "Bearer x" } },
      },
    }),
  );
  await writeFile(
    join(repo, ".lsp.json"),
    JSON.stringify({
      servers: {
        ts: { command: "typescript-language-server", args: ["--stdio"], extensions: [".ts"] },
      },
    }),
  );

  return makePlugin({
    commands: [{ name: "deploy", description: "Deploy the app" }],
    agents: [{ name: "reviewer", description: "Reviews diffs" }],
    rules: [{ name: "style", description: "" }],
    hasMcp: true,
    hasLsp: true,
  });
}

describe("opencode config: MCP servers", () => {
  it("registers a stdio server as a local MCP entry", async () => {
    await installToOpenCode([await fullPlugin()], repo);

    const mcp = (await readConfig()).mcp as Record<string, Record<string, unknown>>;
    expect(mcp["alpha.files"]).toMatchObject({
      type: "local",
      command: ["mcp-files", "--root", expect.stringContaining("managed")],
    });
  });

  it("registers an http server as a remote MCP entry", async () => {
    await installToOpenCode([await fullPlugin()], repo);

    const mcp = (await readConfig()).mcp as Record<string, Record<string, unknown>>;
    expect(mcp["alpha.remote"]).toMatchObject({
      type: "remote",
      url: "https://mcp.example.com/sse",
      headers: { Authorization: "Bearer x" },
    });
  });

  it("namespaces server names so two plugins cannot collide", async () => {
    await installToOpenCode([await fullPlugin()], repo);

    const mcp = (await readConfig()).mcp as Record<string, unknown>;
    expect(Object.keys(mcp).every((k) => k.startsWith("alpha."))).toBe(true);
  });
});

describe("opencode config: commands, agents, rules", () => {
  it("registers commands with their body as a template", async () => {
    await installToOpenCode([await fullPlugin()], repo);

    const command = (await readConfig()).command as Record<string, Record<string, unknown>>;
    expect(command.deploy).toMatchObject({
      template: "Deploy $ARGUMENTS to staging",
      description: "Deploy the app",
    });
  });

  it("registers agents as subagents with their body as a prompt", async () => {
    await installToOpenCode([await fullPlugin()], repo);

    const agent = (await readConfig()).agent as Record<string, Record<string, unknown>>;
    expect(agent.reviewer).toMatchObject({
      description: "Reviews diffs",
      prompt: "You review diffs carefully.",
      mode: "subagent",
    });
  });

  it("appends rule files to instructions", async () => {
    await installToOpenCode([await fullPlugin()], repo);

    const instructions = (await readConfig()).instructions as string[];
    expect(instructions).toHaveLength(1);
    expect(instructions[0]).toContain("rules");
    expect(instructions[0]).toContain("style.md");
  });

  it("does not namespace command and agent names, which users invoke directly", async () => {
    await installToOpenCode([await fullPlugin()], repo);

    const config = await readConfig();
    expect(Object.keys(config.command as object)).toEqual(["deploy"]);
    expect(Object.keys(config.agent as object)).toEqual(["reviewer"]);
  });
});

describe("opencode config: LSP servers", () => {
  it("registers an LSP server from .lsp.json", async () => {
    await installToOpenCode([await fullPlugin()], repo);

    const lsp = (await readConfig()).lsp as Record<string, Record<string, unknown>>;
    expect(lsp["alpha.ts"]).toMatchObject({
      command: ["typescript-language-server", "--stdio"],
      extensions: [".ts"],
    });
  });

  it("no longer warns that LSP must be configured by hand", async () => {
    const warn = vi.spyOn(ui, "warn").mockImplementation(() => {});
    const plugin = await fullPlugin();

    await installToOpenCode([plugin], repo);

    expect(warn).not.toHaveBeenCalled();
  });
});

describe("opencode config: preservation and idempotency", () => {
  it("preserves unrelated user configuration", async () => {
    await mkdir(oc(), { recursive: true });
    await writeFile(
      oc("opencode.json"),
      JSON.stringify({ theme: "dark", model: "anthropic/claude" }, null, 2),
    );

    await installToOpenCode([await fullPlugin()], repo);

    const config = await readConfig();
    expect(config.theme).toBe("dark");
    expect(config.model).toBe("anthropic/claude");
  });

  it("preserves user-defined entries in the same fields", async () => {
    await mkdir(oc(), { recursive: true });
    await writeFile(
      oc("opencode.json"),
      JSON.stringify({ command: { mine: { template: "do mine" } } }, null, 2),
    );

    await installToOpenCode([await fullPlugin()], repo);

    const command = (await readConfig()).command as Record<string, unknown>;
    expect(command.mine).toBeDefined();
    expect(command.deploy).toBeDefined();
  });

  it("does not duplicate entries on a second install", async () => {
    const plugin = await fullPlugin();
    await installToOpenCode([plugin], repo);
    await installToOpenCode([plugin], repo);

    const config = await readConfig();
    expect(Object.keys(config.mcp as object)).toHaveLength(2);
    expect(Object.keys(config.command as object)).toHaveLength(1);
    expect(config.instructions as string[]).toHaveLength(1);
  });

  it("removes entries for components the plugin no longer declares", async () => {
    const full = await fullPlugin();
    await installToOpenCode([full], repo);

    // Reinstall a plugin that still exists but has lost its commands.
    await rm(join(repo, "commands"), { recursive: true });
    await installToOpenCode([makePlugin({ hasMcp: true })], repo);

    const config = await readConfig();
    expect(config.command).toBeUndefined();
  });

  it("writes no translation keys for a plugin with no translatable components", async () => {
    await installToOpenCode([makePlugin()], repo);

    const config = await readConfig();
    for (const key of ["mcp", "command", "agent", "instructions", "lsp"]) {
      expect(config[key]).toBeUndefined();
    }
  });
});
