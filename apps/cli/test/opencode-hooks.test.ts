import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installToOpenCode, renderOpenCodeAdapter } from "../lib/opencode";
import * as ui from "../lib/ui";
import type { Plugin } from "../lib/types";

let configDir: string;
let repo: string;

function oc(...segments: string[]): string {
  return join(configDir, "opencode", ...segments);
}

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), "plugins-oc-hook-cfg-"));
  repo = await mkdtemp(join(tmpdir(), "plugins-oc-hook-repo-"));
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

/** Writes a `hooks/hooks.json` and returns a Plugin that declares it. */
async function pluginWithHooks(hooks: unknown): Promise<Plugin> {
  await mkdir(join(repo, "hooks"), { recursive: true });
  await writeFile(join(repo, "hooks", "hooks.json"), JSON.stringify(hooks));
  return makePlugin({ hasHooks: true });
}

const PRE_TOOL_USE = {
  hooks: {
    PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo guard" }] }],
  },
};

/** Reads the generated adapter module for a plugin. */
async function generatedAdapter(): Promise<string> {
  return readFile(oc("plugins", "alpha-plugin.js"), "utf-8");
}

describe("hook translation: tool hooks", () => {
  it("maps PreToolUse to tool.execute.before", async () => {
    await installToOpenCode([await pluginWithHooks(PRE_TOOL_USE)], repo);

    const source = await generatedAdapter();
    expect(source).toContain('"tool.execute.before"');
  });

  it("maps PostToolUse to tool.execute.after", async () => {
    const plugin = await pluginWithHooks({
      hooks: {
        PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "echo after" }] }],
      },
    });

    await installToOpenCode([plugin], repo);

    expect(await generatedAdapter()).toContain('"tool.execute.after"');
  });

  it("keeps the declared command in the generated module", async () => {
    await installToOpenCode([await pluginWithHooks(PRE_TOOL_USE)], repo);

    expect(await generatedAdapter()).toContain("echo guard");
  });

  it("gates the hook on the declared matcher", async () => {
    await installToOpenCode([await pluginWithHooks(PRE_TOOL_USE)], repo);

    const source = await generatedAdapter();
    expect(source).toContain("Bash");
    expect(source).toMatch(/input\.tool/);
  });

  it("maps both tool events from one hooks file", async () => {
    const plugin = await pluginWithHooks({
      hooks: {
        PreToolUse: [{ hooks: [{ type: "command", command: "echo pre" }] }],
        PostToolUse: [{ hooks: [{ type: "command", command: "echo post" }] }],
      },
    });

    await installToOpenCode([plugin], repo);

    const source = await generatedAdapter();
    expect(source).toContain('"tool.execute.before"');
    expect(source).toContain('"tool.execute.after"');
  });
});

describe("hook translation: unmappable and unknown events", () => {
  it("does not invent a mapping for SessionStart", async () => {
    const plugin = await pluginWithHooks({
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }] },
    });

    await installToOpenCode([plugin], repo);

    const source = await generatedAdapter();
    expect(source).not.toContain('"tool.execute.before"');
    expect(source).not.toContain('"command.execute.before"');
    // The skill router is preserved across compaction instead.
    expect(source).toContain("experimental.session.compacting");
  });

  it("reports an event with no OpenCode equivalent", async () => {
    const warn = vi.spyOn(ui, "warn").mockImplementation(() => {});
    const plugin = await pluginWithHooks({
      hooks: { Notification: [{ hooks: [{ type: "command", command: "echo n" }] }] },
    });

    await installToOpenCode([plugin], repo);

    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(messages.some((m) => m.includes("Notification"))).toBe(true);
  });

  it("ignores a non-command hook", async () => {
    const plugin = await pluginWithHooks({
      hooks: { PreToolUse: [{ hooks: [{ type: "prompt", command: "x" }] }] },
    });

    await installToOpenCode([plugin], repo);

    expect(await generatedAdapter()).not.toContain('"tool.execute.before"');
  });
});

describe("hook translation: environment", () => {
  it("exports the plugin root through shell.env", async () => {
    await installToOpenCode([await pluginWithHooks(PRE_TOOL_USE)], repo);

    const source = await generatedAdapter();
    expect(source).toContain('"shell.env"');
    expect(source).toContain("PLUGIN_ROOT");
  });

  it("leaves no unresolved plugin-root variable in the generated module", async () => {
    const plugin = await pluginWithHooks(PRE_TOOL_USE);
    plugin.commands = [{ name: "deploy", description: "d" }];
    await mkdir(join(repo, "commands"), { recursive: true });
    await writeFile(
      join(repo, "commands", "deploy.md"),
      "---\ndescription: d\n---\n\nRun ${PLUGIN_ROOT}/run.sh $ARGUMENTS\n",
    );

    await installToOpenCode([plugin], repo);

    expect(await generatedAdapter()).not.toMatch(/\$\{PLUGIN_ROOT\}/);
  });
});

describe("generated adapter validity", () => {
  it("keeps the existing compaction hook alongside translated hooks", () => {
    const source = renderOpenCodeAdapter(makePlugin(), "/managed/alpha");
    expect(source).toContain("experimental.session.compacting");
  });

  it("produces a module Node can import", async () => {
    const plugin = await pluginWithHooks(PRE_TOOL_USE);
    await installToOpenCode([plugin], repo);

    const mod = await import(pathToFileURL(oc("plugins", "alpha-plugin.js")).href);
    expect(typeof mod.alphaPlugin).toBe("function");

    const hooks = await mod.alphaPlugin({ client: { app: { log: async () => {} } } });
    expect(Object.keys(hooks)).toContain("tool.execute.before");
  });
});
