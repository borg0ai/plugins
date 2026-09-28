import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOpenCodeConfigDir, installToOpenCode, renderOpenCodeAdapter } from "../lib/opencode";
import { TARGET_DEFS, getTargets } from "../lib/targets";
import type { Plugin } from "../lib/types";

let configDir: string;
let repo: string;

/** Path inside the OpenCode config dir, which lives under XDG_CONFIG_HOME. */
function oc(...segments: string[]): string {
  return join(configDir, "opencode", ...segments);
}

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), "plugins-opencode-config-"));
  repo = await mkdtemp(join(tmpdir(), "plugins-opencode-repo-"));
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

/** A plugin with one skill on disk, which is what triggers skill copying. */
async function pluginWithSkill(name = "alpha", skill = "alpha"): Promise<Plugin> {
  await mkdir(join(repo, "skills", skill), { recursive: true });
  await writeFile(
    join(repo, "skills", skill, "SKILL.md"),
    `---\nname: ${skill}\ndescription: The ${skill} skill\n---\n\nBody text\n`,
  );
  return makePlugin({ skills: [{ name: skill, description: `The ${skill} skill` }] });
}

describe("getOpenCodeConfigDir", () => {
  it("uses XDG_CONFIG_HOME when set", () => {
    process.env.XDG_CONFIG_HOME = "/tmp/xdg-root";
    expect(getOpenCodeConfigDir()).toBe(join("/tmp/xdg-root", "opencode"));
  });

  it("falls back to the platform default when XDG_CONFIG_HOME is unset", () => {
    delete process.env.XDG_CONFIG_HOME;
    const dir = getOpenCodeConfigDir();
    expect(dir.endsWith(join("opencode")) || dir.endsWith(join("opencode"))).toBe(true);
  });
});

describe("targets: opencode registration", () => {
  it("registers opencode after vscode in the target list", () => {
    const ids = TARGET_DEFS.map((t) => t.id);
    expect(ids).toContain("opencode");
    expect(ids.indexOf("opencode")).toBe(ids.indexOf("vscode") + 1);
  });

  it("points opencode at the resolved config dir", async () => {
    // TARGET_DEFS is built at module load, so re-import to observe the override.
    process.env.XDG_CONFIG_HOME = "/tmp/xdg-opencode";
    vi.resetModules();
    const { TARGET_DEFS: reloaded } = await import("../lib/targets");
    expect(reloaded.find((t) => t.id === "opencode")?.configPath).toBe(
      join("/tmp/xdg-opencode", "opencode"),
    );
  });

  it("exposes a detection flag for opencode", async () => {
    const target = (await getTargets()).find((t) => t.id === "opencode");
    expect(typeof target?.detected).toBe("boolean");
  });
});

describe("installToOpenCode: managed content", () => {
  it("copies the plugin into the managed root", async () => {
    const plugin = await pluginWithSkill();

    await installToOpenCode([plugin], repo);

    await expect(
      readFile(oc("plugins", "managed", "alpha", "skills", "alpha", "SKILL.md"), "utf-8"),
    ).resolves.toContain("Body text");
  });

  it("copies skills into the OpenCode skills directory", async () => {
    const plugin = await pluginWithSkill();

    await installToOpenCode([plugin], repo);

    await expect(readFile(oc("skills", "alpha", "SKILL.md"), "utf-8")).resolves.toContain(
      "Body text",
    );
  });

  it("replaces a previous managed copy instead of merging into it", async () => {
    const plugin = await pluginWithSkill();
    const managed = oc("plugins", "managed", "alpha");
    await mkdir(managed, { recursive: true });
    await writeFile(join(managed, "stale.txt"), "old");

    await installToOpenCode([plugin], repo);

    await expect(readFile(join(managed, "stale.txt"), "utf-8")).rejects.toThrow();
  });

  it("writes an open plugin manifest into the managed copy", async () => {
    const plugin = await pluginWithSkill();

    await installToOpenCode([plugin], repo);

    const manifest = JSON.parse(
      await readFile(oc("plugins", "managed", "alpha", ".plugin", "plugin.json"), "utf-8"),
    );
    expect(manifest).toEqual({ name: "alpha", description: "Alpha plugin", version: "1.0.0" });
  });
});

describe("installToOpenCode: adapters and registration", () => {
  it("writes no adapter for a skills-only plugin", async () => {
    const plugin = await pluginWithSkill();

    await installToOpenCode([plugin], repo);

    await expect(readFile(oc("plugins", "alpha-plugin.js"), "utf-8")).rejects.toThrow();
  });

  it("writes an adapter when the plugin has commands", async () => {
    const plugin = makePlugin({ commands: [{ name: "deploy", description: "" }] });

    await installToOpenCode([plugin], repo);

    const adapter = await readFile(oc("plugins", "alpha-plugin.js"), "utf-8");
    expect(adapter).toContain("export const alphaPlugin");
    expect(adapter).toContain("const PLUGIN_ROOT = ");
  });

  it("registers the adapter path in opencode.json", async () => {
    const plugin = makePlugin({ agents: [{ name: "reviewer", description: "" }] });

    await installToOpenCode([plugin], repo);

    const config = JSON.parse(await readFile(oc("opencode.json"), "utf-8"));
    expect(config.plugin).toEqual(["./plugins/alpha-plugin.js"]);
  });

  it("preserves unrelated opencode.json entries", async () => {
    await mkdir(oc(), { recursive: true });
    await writeFile(
      oc("opencode.json"),
      JSON.stringify({ theme: "dark", plugin: ["./plugins/existing.js"] }, null, 2),
    );
    const plugin = makePlugin({ hasHooks: true });

    await installToOpenCode([plugin], repo);

    const config = JSON.parse(await readFile(oc("opencode.json"), "utf-8"));
    expect(config.theme).toBe("dark");
    expect(config.plugin).toEqual(["./plugins/existing.js", "./plugins/alpha-plugin.js"]);
  });

  it("does not duplicate an already-registered adapter", async () => {
    const plugin = makePlugin({ hasHooks: true });
    await installToOpenCode([plugin], repo);

    await installToOpenCode([plugin], repo);

    const config = JSON.parse(await readFile(oc("opencode.json"), "utf-8"));
    expect(config.plugin).toEqual(["./plugins/alpha-plugin.js"]);
  });

  it("omits the plugin key entirely when nothing needs an adapter", async () => {
    const plugin = await pluginWithSkill();

    await installToOpenCode([plugin], repo);

    const config = JSON.parse(await readFile(oc("opencode.json"), "utf-8"));
    expect(config.plugin).toBeUndefined();
  });

  it("ends opencode.json with a trailing newline", async () => {
    const plugin = makePlugin({ hasHooks: true });

    await installToOpenCode([plugin], repo);

    const raw = await readFile(oc("opencode.json"), "utf-8");
    expect(raw.endsWith("}\n")).toBe(true);
  });
});

describe("renderOpenCodeAdapter", () => {
  it("exports a camelCased plugin entry point", () => {
    const source = renderOpenCodeAdapter(makePlugin({ name: "my-plugin" }), "/managed/my-plugin");
    expect(source).toContain("export const myPluginPlugin");
  });

  it("embeds the managed root, skill name, commands and agents", () => {
    const plugin = makePlugin({
      skills: [{ name: "alpha", description: "" }],
      commands: [{ name: "deploy", description: "" }],
      agents: [{ name: "reviewer", description: "" }],
    });
    const source = renderOpenCodeAdapter(plugin, "/managed/alpha");
    expect(source).toContain('const PLUGIN_ROOT = "/managed/alpha"');
    expect(source).toContain('const SKILL_NAME = "alpha"');
    expect(source).toContain('const COMMANDS = ["deploy"]');
    expect(source).toContain('const AGENTS = ["reviewer"]');
  });

  it("registers only the compaction hook", () => {
    const source = renderOpenCodeAdapter(makePlugin(), "/managed/alpha");
    expect(source).toContain("experimental.session.compacting");
  });

  it("falls back to 0.0.0 when the plugin has no version", () => {
    const source = renderOpenCodeAdapter(makePlugin({ version: undefined }), "/managed/alpha");
    expect(source).toContain('"0.0.0"');
  });
});
