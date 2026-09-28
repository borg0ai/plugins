import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discover } from "../lib/discover";

let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "plugins-discover-"));
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

/** Writes `contents` to `<repo>/<relPath>`, creating parent directories. */
async function write(relPath: string, contents: string): Promise<string> {
  const target = join(repo, relPath);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, contents);
  return target;
}

describe("discover: rules-only plugins", () => {
  it("finds a repository whose only component is rules", async () => {
    await write("rules/style.md", "---\ndescription: Style rules\n---\n");

    const result = await discover(repo);
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]!.rules).toEqual([{ name: "style", description: "Style rules" }]);
  });

  it("finds a nested plugin that only has rules", async () => {
    await write("packages/beta/rules/style.md", "---\ndescription: Style rules\n---\n");

    const result = await discover(repo);
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]!.name).toBe("beta");
    expect(result.plugins[0]!.rules.map((r) => r.name)).toEqual(["style"]);
  });

  it("still reports no plugins when no marker is present", async () => {
    await write("README.md", "# Just a readme\n");

    expect((await discover(repo)).plugins).toHaveLength(0);
  });

  it("does not let rules weaken the depth limit", async () => {
    await write("a/b/c/d/e/rules/style.md", "---\ndescription: Too deep\n---\n");

    expect((await discover(repo)).plugins).toHaveLength(0);
  });

  it("does not let rules weaken the hidden-directory rule", async () => {
    await write(".hidden/rules/style.md", "---\ndescription: Hidden\n---\n");
    await write("packages/beta/rules/style.md", "---\ndescription: Visible\n---\n");

    const result = await discover(repo);
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]!.name).toBe("beta");
  });

  it("does not change detection for a plugin that has other markers", async () => {
    await write("skills/alpha/SKILL.md", "---\nname: alpha\n---\n");
    await write("rules/style.md", "---\ndescription: Style rules\n---\n");

    const plugin = (await discover(repo)).plugins[0]!;
    expect(plugin.skills.map((s) => s.name)).toEqual(["alpha"]);
    expect(plugin.rules.map((r) => r.name)).toEqual(["style"]);
  });
});

describe("discover: root plugin", () => {
  it("finds a root plugin via SKILL.md", async () => {
    await write("skills/alpha/SKILL.md", "---\nname: alpha\n---\n");

    const result = await discover(repo);
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]!.skills.map((s) => s.name)).toEqual(["alpha"]);
    expect(result.plugins[0]!.path).toBe(repo);
  });

  it("falls back to a root SKILL.md when there is no skills/ directory", async () => {
    await write("SKILL.md", "---\nname: solo\ndescription: A solo plugin\n---\n");

    const result = await discover(repo);
    expect(result.plugins).toHaveLength(1);
    // Without a manifest the plugin is named after its directory.
    expect(result.plugins[0]!.name).toBe(repo.split("/").pop());
    expect(result.plugins[0]!.skills).toEqual([{ name: "solo", description: "A solo plugin" }]);
  });

  it("keeps a boolean frontmatter value out of the skill description", async () => {
    await write("skills/flagged/SKILL.md", "---\nname: flagged\ndescription: true\n---\n");

    const result = await discover(repo);
    const skill = result.plugins[0]!.skills[0]!;
    expect(skill.name).toBe("flagged");
    expect(skill.description).toBe("");
  });

  it("reads plugin metadata from a .plugin manifest", async () => {
    await write(".plugin/plugin.json", JSON.stringify({ name: "gamma-pack", version: "2.0.0" }));
    await write("skills/gamma/SKILL.md", "---\nname: gamma\n---\n");

    const result = await discover(repo);
    expect(result.plugins[0]!.version).toBe("2.0.0");
    expect(result.plugins[0]!.manifest).toMatchObject({ name: "gamma-pack" });
  });

  it("reports hooks, mcp and lsp presence", async () => {
    await write("skills/alpha/SKILL.md", "---\nname: alpha\n---\n");
    await write("hooks/hooks.json", "{}");
    await write(".mcp.json", "{}");
    await write(".lsp.json", "{}");

    const plugin = (await discover(repo)).plugins[0]!;
    expect(plugin.hasHooks).toBe(true);
    expect(plugin.hasMcp).toBe(true);
    expect(plugin.hasLsp).toBe(true);
  });

  it("leaves the capability flags false when the files are absent", async () => {
    await write("skills/beta/SKILL.md", "---\nname: beta\n---\n");

    const plugin = (await discover(repo)).plugins[0]!;
    expect(plugin.hasHooks).toBe(false);
    expect(plugin.hasMcp).toBe(false);
    expect(plugin.hasLsp).toBe(false);
  });

  it("does not treat a bare capability file as a plugin", async () => {
    await write("hooks/hooks.json", "{}");

    expect((await discover(repo)).plugins).toHaveLength(0);
  });
});

describe("discover: nested scan", () => {
  it("finds a nested plugin in a subdirectory", async () => {
    await write("packages/beta/commands/deploy.md", "---\nname: deploy\n---\n");

    const result = await discover(repo);
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]!.commands.map((c) => c.name)).toEqual(["deploy"]);
  });

  it("collects commands, agents and rules from a nested plugin", async () => {
    await write("packages/beta/commands/deploy.mdc", "---\ndescription: Deploy it\n---\n");
    await write(
      "packages/beta/agents/reviewer.md",
      "---\nname: reviewer\ndescription: Reviews\n---\n",
    );
    await write("packages/beta/rules/style.md", "---\ndescription: Style rules\n---\n");

    const plugin = (await discover(repo)).plugins[0]!;
    expect(plugin.commands).toEqual([{ name: "deploy", description: "Deploy it" }]);
    expect(plugin.agents).toEqual([{ name: "reviewer", description: "Reviews" }]);
    expect(plugin.rules).toEqual([{ name: "style", description: "Style rules" }]);
  });

  it("skips an agent file that is missing a name or description", async () => {
    await write("packages/beta/agents/nameless.md", "---\ndescription: No name here\n---\n");

    expect((await discover(repo)).plugins[0]!.agents).toEqual([]);
  });

  it("ignores dot-directories while scanning", async () => {
    await write(".hidden/secret/SKILL.md", "---\nname: secret\n---\n");
    await write("packages/beta/SKILL.md", "---\nname: beta\n---\n");

    const result = await discover(repo);
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]!.skills.map((s) => s.name)).toEqual(["beta"]);
  });

  it("does not descend past the configured depth", async () => {
    await write("a/b/c/d/e/deep/SKILL.md", "---\nname: deep\n---\n");

    expect((await discover(repo)).plugins).toHaveLength(0);
  });
});

describe("discover: marketplace index", () => {
  it("resolves plugin sources relative to the marketplace pluginRoot", async () => {
    await write(
      ".plugin/marketplace.json",
      JSON.stringify({
        name: "acme",
        metadata: { pluginRoot: "packages" },
        plugins: [{ name: "alpha", source: "./alpha" }],
      }),
    );
    await write("packages/alpha/SKILL.md", "---\nname: alpha\n---\n");

    const result = await discover(repo);
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]!.name).toBe("alpha");
    expect(result.plugins[0]!.marketplace).toBe("acme");
    expect(result.plugins[0]!.path).toBe(join(repo, "packages", "alpha"));
  });

  it("records sources that do not exist as missingPaths", async () => {
    await write(
      "marketplace.json",
      JSON.stringify({ name: "acme", plugins: [{ name: "ghost", source: "./ghost" }] }),
    );

    const result = await discover(repo);
    expect(result.plugins).toHaveLength(0);
    expect(result.missingPaths).toEqual(["./ghost"]);
  });

  it("separates non-string sources as remote plugins", async () => {
    await write(
      "marketplace.json",
      JSON.stringify({
        name: "acme",
        plugins: [
          {
            name: "hosted",
            description: "Lives elsewhere",
            source: { source: "github", repo: "o/r" },
          },
        ],
      }),
    );

    const result = await discover(repo);
    expect(result.plugins).toHaveLength(0);
    expect(result.remotePlugins).toEqual([
      { name: "hosted", description: "Lives elsewhere", source: { source: "github", repo: "o/r" } },
    ]);
  });

  it("honours an explicit skills list and skips paths without SKILL.md", async () => {
    // Skill paths are resolved against the marketplace pluginRoot, not the plugin dir.
    await write(
      "marketplace.json",
      JSON.stringify({
        name: "acme",
        metadata: { pluginRoot: "alpha" },
        plugins: [
          {
            name: "alpha",
            source: "./",
            skills: ["./skills/one", "./skills/absent"],
          },
        ],
      }),
    );
    await write("alpha/skills/one/SKILL.md", "---\nname: one\n---\n");
    await write("alpha/skills/two/SKILL.md", "---\nname: two\n---\n");

    const plugin = (await discover(repo)).plugins[0]!;
    expect(plugin.skills.map((s) => s.name)).toEqual(["one"]);
    expect(plugin.explicitSkillPaths).toEqual(["./skills/one", "./skills/absent"]);
  });

  it("ignores a marketplace.json whose plugins value is not an array", async () => {
    await write("marketplace.json", JSON.stringify({ name: "acme", plugins: "nope" }));
    await write("skills/alpha/SKILL.md", "---\nname: alpha\n---\n");

    const result = await discover(repo);
    expect(result.plugins).toHaveLength(1);
  });
});
