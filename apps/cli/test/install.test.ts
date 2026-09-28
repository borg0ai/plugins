import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deriveMarketplaceName,
  enrichForCodex,
  enrichForKimi,
  extractGitHubRepo,
  getGitHubSourceRepo,
  getOfficialCodexPluginRef,
  getOfficialPluginRef,
  isRemoteSource,
  normalizeGitUrl,
  parseJsoncObject,
  preparePluginDirForVendor,
  readKimiHooks,
  removeTrailingJsoncCommas,
  stripJsoncComments,
  updateJsoncRootProperty,
} from "../lib/install";
import type { Plugin } from "../lib/types";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "plugins-install-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Builds a minimal Plugin whose path points inside the temp dir. */
function makePlugin(overrides: Partial<Plugin> = {}): Plugin {
  return {
    name: "alpha",
    version: "1.0.0",
    description: "Alpha plugin",
    path: dir,
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

async function writeJson(relPath: string, value: unknown): Promise<string> {
  const target = join(dir, relPath);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, JSON.stringify(value, null, 2));
  return target;
}

describe("source helpers", () => {
  it("normalizes a GitHub shorthand to owner/repo", () => {
    expect(getGitHubSourceRepo("vercel/vercel-plugin")).toBe("vercel/vercel-plugin");
    expect(getGitHubSourceRepo("vercel/vercel-plugin.git")).toBe("vercel/vercel-plugin");
  });

  it("normalizes https and ssh GitHub URLs", () => {
    expect(getGitHubSourceRepo("https://github.com/vercel/vercel-plugin")).toBe(
      "vercel/vercel-plugin",
    );
    expect(getGitHubSourceRepo("git@github.com:vercel/vercel-plugin.git")).toBe(
      "vercel/vercel-plugin",
    );
  });

  it("returns null for a source that is not a GitHub repo", () => {
    expect(getGitHubSourceRepo("/local/path")).toBeNull();
    expect(getGitHubSourceRepo("https://gitlab.com/o/r")).toBeNull();
  });

  it("maps the vercel plugin to the official marketplace refs", () => {
    expect(getOfficialPluginRef("vercel/vercel-plugin")).toBe("vercel@claude-plugins-official");
    expect(getOfficialCodexPluginRef("https://github.com/vercel/vercel-plugin")).toBe(
      "vercel@openai-curated",
    );
  });

  it("has no official ref for an unknown repo", () => {
    expect(getOfficialPluginRef("acme/widgets")).toBeNull();
    expect(getOfficialCodexPluginRef("acme/widgets")).toBeNull();
  });

  it("recognises remote sources", () => {
    expect(isRemoteSource("acme/widgets")).toBe(true);
    expect(isRemoteSource("git@github.com:acme/widgets.git")).toBe(true);
    expect(isRemoteSource("https://github.com/acme/widgets")).toBe(true);
    expect(isRemoteSource("/local/path")).toBe(false);
    expect(isRemoteSource("./relative")).toBe(false);
  });

  it("normalises a remote source to an https git URL", () => {
    expect(normalizeGitUrl("acme/widgets")).toBe("https://github.com/acme/widgets");
    expect(normalizeGitUrl("git@github.com:acme/widgets.git")).toBe(
      "https://github.com/acme/widgets",
    );
    expect(normalizeGitUrl("/local/path")).toBe("/local/path");
  });

  it("extracts the GitHub repo for known_marketplaces.json", () => {
    expect(extractGitHubRepo("https://github.com/vercel/vercel-plugin")).toBe(
      "vercel/vercel-plugin",
    );
    expect(extractGitHubRepo("git@github.com:vercel/vercel-plugin.git")).toBe(
      "vercel/vercel-plugin",
    );
    expect(extractGitHubRepo("/local/path")).toBeNull();
  });
});

describe("deriveMarketplaceName", () => {
  it("uses owner-repo for a GitHub shorthand", () => {
    expect(deriveMarketplaceName("vercel/vercel-plugin")).toBe("vercel-vercel-plugin");
  });

  it("uses owner-repo for an ssh URL", () => {
    expect(deriveMarketplaceName("git@github.com:vercel/vercel-plugin.git")).toBe(
      "vercel-vercel-plugin",
    );
  });

  it("uses the last two path segments for an https URL", () => {
    expect(deriveMarketplaceName("https://github.com/vercel/vercel-plugin")).toBe(
      "vercel-vercel-plugin",
    );
  });

  it("falls back to the directory name for a local path", () => {
    expect(deriveMarketplaceName("/Users/me/plugins/my-plugins")).toBe("my-plugins");
    expect(deriveMarketplaceName("/Users/me/plugins/my-plugins/")).toBe("my-plugins");
  });

  it("falls back to 'plugins' for an empty source", () => {
    expect(deriveMarketplaceName("")).toBe("plugins");
  });
});

describe("JSONC helpers", () => {
  it("strips line and block comments without touching string contents", () => {
    const content = '{\n  // a comment\n  "url": "http://x/y", /* inline */\n  "b": 1\n}';
    const stripped = stripJsoncComments(content);
    expect(stripped).not.toContain("a comment");
    expect(stripped).not.toContain("inline");
    expect(stripped).toContain('"url": "http://x/y"');
  });

  it("strips trailing commas but keeps commas inside strings", () => {
    expect(removeTrailingJsoncCommas('{"a": 1,}')).toBe('{"a": 1}');
    expect(removeTrailingJsoncCommas('{"a": "x,"}')).toBe('{"a": "x,"}');
  });

  it("parses a JSONC object with comments and trailing commas", () => {
    const parsed = parseJsoncObject('{\n  // hi\n  "a": 1,\n}\n', "settings.json");
    expect(parsed).toEqual({ a: 1 });
  });

  it("rejects a JSONC root that is not an object", () => {
    expect(() => parseJsoncObject("[1,2]", "settings.json")).toThrow(/settings\.json/);
  });

  it("replaces an existing root property in place", () => {
    const content =
      '{\n  "a": 1,\n  "chat.pluginLocations": {\n    "/old": true\n  },\n  "b": 2\n}\n';
    const updated = updateJsoncRootProperty(content, "chat.pluginLocations", { "/new": true });
    expect(parseJsoncObject(updated, "s")).toEqual({
      a: 1,
      "chat.pluginLocations": { "/new": true },
      b: 2,
    });
  });

  it("appends a missing root property", () => {
    const updated = updateJsoncRootProperty('{\n  "a": 1\n}\n', "chat.pluginLocations", {
      "/x": true,
    });
    expect(parseJsoncObject(updated, "s")).toEqual({
      a: 1,
      "chat.pluginLocations": { "/x": true },
    });
  });

  it("appends into an empty object", () => {
    const updated = updateJsoncRootProperty("{}", "chat.pluginLocations", { "/x": true });
    expect(parseJsoncObject(updated, "s")).toEqual({ "chat.pluginLocations": { "/x": true } });
  });

  it("preserves the original formatting of untouched keys", () => {
    const content = '{\n\t"a": 1\n}\n';
    const updated = updateJsoncRootProperty(content, "chat.pluginLocations", {});
    expect(updated).toContain('"a": 1');
  });
});

describe("preparePluginDirForVendor", () => {
  it("copies .plugin/ to the vendor directory when only the open manifest exists", async () => {
    await writeJson(".plugin/plugin.json", { name: "alpha" });

    await preparePluginDirForVendor(makePlugin(), ".claude-plugin", "CLAUDE_PLUGIN_ROOT");

    const copied = JSON.parse(await readFile(join(dir, ".claude-plugin", "plugin.json"), "utf-8"));
    expect(copied).toEqual({ name: "alpha" });
  });

  it("synthesises a manifest when neither directory exists", async () => {
    await preparePluginDirForVendor(makePlugin(), ".cursor-plugin", "CURSOR_PLUGIN_ROOT");

    const generated = JSON.parse(
      await readFile(join(dir, ".cursor-plugin", "plugin.json"), "utf-8"),
    );
    expect(generated).toEqual({ name: "alpha", description: "Alpha plugin", version: "1.0.0" });
  });

  it("leaves an existing vendor manifest untouched", async () => {
    await writeJson(".plugin/plugin.json", { name: "open" });
    await writeJson(".codex-plugin/plugin.json", { name: "vendor" });

    await preparePluginDirForVendor(makePlugin(), ".codex-plugin", "CODEX_PLUGIN_ROOT");

    const vendor = JSON.parse(await readFile(join(dir, ".codex-plugin", "plugin.json"), "utf-8"));
    expect(vendor).toEqual({ name: "vendor" });
  });

  it("rewrites known plugin-root env vars to the vendor variable", async () => {
    await writeJson(".claude-plugin/plugin.json", { name: "alpha" });
    await mkdir(join(dir, "hooks"), { recursive: true });
    await writeFile(
      join(dir, "hooks", "hooks.json"),
      JSON.stringify({ command: "node ${CLAUDE_PLUGIN_ROOT}/run.js" }),
    );

    await preparePluginDirForVendor(makePlugin(), ".cursor-plugin", "CURSOR_PLUGIN_ROOT");

    const hooks = JSON.parse(await readFile(join(dir, "hooks", "hooks.json"), "utf-8"));
    expect(hooks.command).toBe("node ${CURSOR_PLUGIN_ROOT}/run.js");
  });

  it("leaves the vendor's own variable alone", async () => {
    await writeJson(".claude-plugin/plugin.json", { name: "alpha" });
    await mkdir(join(dir, "hooks"), { recursive: true });
    await writeFile(
      join(dir, "hooks", "hooks.json"),
      JSON.stringify({ command: "run ${CURSOR_PLUGIN_ROOT}/x" }),
    );

    await preparePluginDirForVendor(makePlugin(), ".cursor-plugin", "CURSOR_PLUGIN_ROOT");

    const hooks = JSON.parse(await readFile(join(dir, "hooks", "hooks.json"), "utf-8"));
    expect(hooks.command).toBe("run ${CURSOR_PLUGIN_ROOT}/x");
  });
});

describe("enrichForCodex", () => {
  it("adds skills, mcpServers and interface metadata", async () => {
    await writeJson(".codex-plugin/plugin.json", { name: "alpha" });
    await mkdir(join(dir, "skills"), { recursive: true });
    await writeFile(join(dir, ".mcp.json"), "{}");

    await enrichForCodex(makePlugin());

    const manifest = JSON.parse(await readFile(join(dir, ".codex-plugin", "plugin.json"), "utf-8"));
    expect(manifest.skills).toBe("./skills/");
    expect(manifest.mcpServers).toBe("./.mcp.json");
    expect(manifest.interface.displayName).toBe("Alpha");
    expect(manifest.interface.shortDescription).toBe("Alpha plugin");
    expect(manifest.interface.capabilities).toEqual(["Interactive", "Write"]);
  });

  it("does not overwrite an existing interface block", async () => {
    await writeJson(".codex-plugin/plugin.json", {
      name: "alpha",
      interface: { displayName: "Kept" },
    });

    await enrichForCodex(makePlugin());

    const manifest = JSON.parse(await readFile(join(dir, ".codex-plugin", "plugin.json"), "utf-8"));
    expect(manifest.interface).toEqual({ displayName: "Kept" });
  });

  it("picks up a logo asset when present", async () => {
    await writeJson(".codex-plugin/plugin.json", { name: "alpha" });
    await mkdir(join(dir, "assets"), { recursive: true });
    await writeFile(join(dir, "assets", "icon.png"), "");

    await enrichForCodex(makePlugin());

    const manifest = JSON.parse(await readFile(join(dir, ".codex-plugin", "plugin.json"), "utf-8"));
    expect(manifest.interface.logo).toBe("./assets/icon.png");
  });

  it("is a no-op when there is no codex manifest", async () => {
    await expect(enrichForCodex(makePlugin())).resolves.toBeUndefined();
  });
});

describe("enrichForKimi", () => {
  it("adds skills, commands and merged mcp servers", async () => {
    await writeJson(".kimi-plugin/plugin.json", { name: "alpha" });
    await mkdir(join(dir, "skills"), { recursive: true });
    await mkdir(join(dir, "commands"), { recursive: true });
    await writeFile(
      join(dir, ".mcp.json"),
      JSON.stringify({ mcpServers: { fs: { command: "fs" } } }),
    );

    await enrichForKimi(makePlugin());

    const manifest = JSON.parse(await readFile(join(dir, ".kimi-plugin", "plugin.json"), "utf-8"));
    expect(manifest.skills).toBe("./skills/");
    expect(manifest.commands).toBe("./commands/");
    expect(manifest.mcpServers).toEqual({ fs: { command: "fs" } });
  });

  it("flattens Claude-style hooks into kimi hook records", async () => {
    await writeJson(".kimi-plugin/plugin.json", { name: "alpha" });
    await writeJson("hooks/hooks.json", {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "echo hi", timeout: 5 }],
          },
        ],
      },
    });

    await enrichForKimi(makePlugin());

    const manifest = JSON.parse(await readFile(join(dir, ".kimi-plugin", "plugin.json"), "utf-8"));
    expect(manifest.hooks).toEqual([
      { event: "PreToolUse", command: "echo hi", matcher: "Bash", timeout: 5 },
    ]);
  });
});

describe("readKimiHooks", () => {
  it("returns an empty list when there is no hooks file", async () => {
    expect(await readKimiHooks(dir, undefined)).toEqual([]);
  });

  it("ignores non-command hooks", async () => {
    await writeJson("hooks/hooks.json", {
      hooks: { PreToolUse: [{ hooks: [{ type: "prompt", command: "x" }] }] },
    });

    expect(await readKimiHooks(dir, undefined)).toEqual([]);
  });

  it("accepts a hook group that is itself a single hook", async () => {
    await writeJson("hooks/hooks.json", {
      hooks: { PostToolUse: [{ type: "command", command: "after" }] },
    });

    expect(await readKimiHooks(dir, undefined)).toEqual([
      { event: "PostToolUse", command: "after" },
    ]);
  });

  it("follows a declared relative hooks path", async () => {
    await writeJson("config/hooks.json", {
      hooks: { SessionStart: [{ type: "command", command: "start" }] },
    });

    expect(await readKimiHooks(dir, "./config/hooks.json")).toEqual([
      { event: "SessionStart", command: "start" },
    ]);
  });
});
