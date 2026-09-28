import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installToOpenCode } from "../lib/opencode";
import { discover } from "../lib/discover";
import * as ui from "../lib/ui";
import type { Plugin } from "../lib/types";

let configDir: string;
let repo: string;

function oc(...segments: string[]): string {
  return join(configDir, "opencode", ...segments);
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), "plugins-oc-native-cfg-"));
  repo = await mkdtemp(join(tmpdir(), "plugins-oc-native-repo-"));
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

/** Writes a native OpenCode module into `.opencode-plugin/`. */
async function writeNativeModule(source: string, name = "custom.js"): Promise<Plugin> {
  await mkdir(join(repo, ".opencode-plugin"), { recursive: true });
  await writeFile(join(repo, ".opencode-plugin", name), source);
  return makePlugin();
}

/** Writes a hooks.json declaring a PreToolUse command hook. */
async function writeToolHooks(): Promise<void> {
  await mkdir(join(repo, "hooks"), { recursive: true });
  await writeFile(
    join(repo, "hooks", "hooks.json"),
    JSON.stringify({
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo g" }] }] },
    }),
  );
}

const VALID_MODULE = `export const Custom = async ({ client }) => {
  return { event: async ({ event }) => { void event; } };
};
`;

describe("discovery: .opencode-plugin is a plugin marker", () => {
  it("finds a plugin whose only content is a native module", async () => {
    await writeNativeModule(VALID_MODULE);

    const result = await discover(repo);
    expect(result.plugins).toHaveLength(1);
  });

  it("finds a nested plugin that only has a native module", async () => {
    const nested = join(repo, "packages", "beta", ".opencode-plugin");
    await mkdir(nested, { recursive: true });
    await writeFile(join(nested, "custom.js"), VALID_MODULE);

    const result = await discover(repo);
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]!.name).toBe("beta");
  });

  it("reads plugin metadata from a .opencode-plugin manifest", async () => {
    await mkdir(join(repo, ".opencode-plugin"), { recursive: true });
    await writeFile(
      join(repo, ".opencode-plugin", "plugin.json"),
      JSON.stringify({ name: "oc-pack" }),
    );
    await writeFile(join(repo, ".opencode-plugin", "custom.js"), VALID_MODULE);

    const result = await discover(repo);
    expect(result.plugins[0]!.name).toBe("oc-pack");
  });
});

describe("install: native module alongside generated output", () => {
  it("installs the native module to a non-colliding name", async () => {
    await installToOpenCode([await writeNativeModule(VALID_MODULE)], repo);

    expect(await exists(oc("plugins", "alpha-opencode.js"))).toBe(true);
  });

  it("still generates the hook adapter when hooks.json is present", async () => {
    const plugin = await writeNativeModule(VALID_MODULE);
    await writeToolHooks();
    plugin.hasHooks = true;

    await installToOpenCode([plugin], repo);

    // Both are live: the author's declared tool hooks keep working.
    expect(await exists(oc("plugins", "alpha-plugin.js"))).toBe(true);
    expect(await exists(oc("plugins", "alpha-opencode.js"))).toBe(true);
    const generated = await readFile(oc("plugins", "alpha-plugin.js"), "utf-8");
    expect(generated).toContain('"tool.execute.before"');
  });

  it("installs only the native module when there is no hooks.json", async () => {
    await installToOpenCode([await writeNativeModule(VALID_MODULE)], repo);

    expect(await exists(oc("plugins", "alpha-opencode.js"))).toBe(true);
    expect(await exists(oc("plugins", "alpha-plugin.js"))).toBe(false);
  });

  it("does not overwrite a non-CLI file already at the destination", async () => {
    const plugin = await writeNativeModule(VALID_MODULE);
    await mkdir(oc("plugins"), { recursive: true });
    await writeFile(oc("plugins", "alpha-opencode.js"), "// hand written\n");

    await expect(installToOpenCode([plugin], repo)).rejects.toThrow(/alpha-opencode\.js/);
    expect(await readFile(oc("plugins", "alpha-opencode.js"), "utf-8")).toBe("// hand written\n");
  });

  it("warns without blocking when the native module also implements tool hooks", async () => {
    const warn = vi.spyOn(ui, "warn").mockImplementation(() => {});
    const plugin = await writeNativeModule(
      `export const Custom = async () => ({ "tool.execute.before": async () => {} });\n`,
    );
    await writeToolHooks();
    plugin.hasHooks = true;

    await installToOpenCode([plugin], repo);

    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(messages.some((m) => /tool\.execute/.test(m))).toBe(true);
    expect(await exists(oc("plugins", "alpha-opencode.js"))).toBe(true);
  });

  it("installs the first module deterministically and reports the rest", async () => {
    const warn = vi.spyOn(ui, "warn").mockImplementation(() => {});
    await writeNativeModule("export const A = async () => ({});\n", "a-first.js");
    await writeNativeModule("export const B = async () => ({});\n", "b-second.js");

    await installToOpenCode([makePlugin()], repo);

    const installed = await readFile(oc("plugins", "alpha-opencode.js"), "utf-8");
    expect(installed).toContain("const A");
    expect(warn.mock.calls.map((c) => String(c[0])).some((m) => m.includes("b-second.js"))).toBe(
      true,
    );
  });
});

describe("install: native module validation", () => {
  it("aborts and writes nothing when the module does not parse", async () => {
    const plugin = await writeNativeModule("export const Broken = async () => {\n");

    await expect(installToOpenCode([plugin], repo)).rejects.toThrow(/alpha/);
    expect(await exists(oc("plugins", "alpha-opencode.js"))).toBe(false);
  });

  it("names the offending file in the error", async () => {
    const plugin = await writeNativeModule("const x = ;\n", "bad.js");

    await expect(installToOpenCode([plugin], repo)).rejects.toThrow(/bad\.js|alpha/);
  });
});

describe("install: plugin root injection", () => {
  it("rewrites ${PLUGIN_ROOT} to the managed path", async () => {
    await installToOpenCode(
      [await writeNativeModule(`export const P = async () => ({ t: "\${PLUGIN_ROOT}/x.js" });\n`)],
      repo,
    );

    const installed = await readFile(oc("plugins", "alpha-opencode.js"), "utf-8");
    expect(installed).not.toContain("${PLUGIN_ROOT}");
    expect(installed).toContain(join("managed", "alpha"));
  });

  it("declares PLUGIN_ROOT in module scope so author code can read it", async () => {
    await installToOpenCode(
      [await writeNativeModule("export const P = async () => ({ t: PLUGIN_ROOT });\n")],
      repo,
    );

    const installed = await readFile(oc("plugins", "alpha-opencode.js"), "utf-8");
    expect(installed).toMatch(/const PLUGIN_ROOT = "/);
    // The installed file must still be loadable.
    expect(() =>
      execFileSync(process.execPath, ["--check", oc("plugins", "alpha-opencode.js")], {
        stdio: "pipe",
      }),
    ).not.toThrow();
  });
});
