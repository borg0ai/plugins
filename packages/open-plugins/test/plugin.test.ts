import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isPluginDir, parsePluginDir, parseSkillDir } from "../src/plugin";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "open-plugins-dir-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Writes `contents` to `<dir>/<relPath>`, creating parent directories. */
async function write(relPath: string, contents: string): Promise<string> {
  const target = join(dir, relPath);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, contents);
  return target;
}

describe("isPluginDir", () => {
  it("is true for a directory with a manifest", async () => {
    await write(".plugin/plugin.json", JSON.stringify({ name: "pack" }));
    expect(await isPluginDir(dir)).toBe(true);
  });

  it("is true for a directory with only component markers", async () => {
    await write("rules/style.md", "---\ndescription: Style\n---\n");
    expect(await isPluginDir(dir)).toBe(true);
  });

  it("is false for a directory with no markers", async () => {
    await write("README.md", "# Just a readme\n");
    expect(await isPluginDir(dir)).toBe(false);
  });
});

describe("parsePluginDir", () => {
  it("parses every component of a full plugin", async () => {
    await write(".plugin/plugin.json", JSON.stringify({ name: "pack", version: "1.2.3" }));
    await write("skills/alpha/SKILL.md", "---\nname: alpha\n---\n");
    await write("commands/deploy.mdc", "---\ndescription: Deploy it\n---\n");
    await write("agents/reviewer.md", "---\nname: reviewer\ndescription: Reviews\n---\n");
    await write("rules/style.md", "---\ndescription: Style rules\n---\n");
    await write("hooks/hooks.json", "{}");
    await write(".mcp.json", "{}");
    await write(".lsp.json", "{}");

    const parsed = await parsePluginDir(dir);
    expect(parsed.manifest?.name).toBe("pack");
    expect(parsed.skills).toEqual([{ name: "alpha", description: "" }]);
    expect(parsed.commands).toEqual([{ name: "deploy", description: "Deploy it" }]);
    expect(parsed.agents).toEqual([{ name: "reviewer", description: "Reviews" }]);
    expect(parsed.rules).toEqual([{ name: "style", description: "Style rules" }]);
    expect(parsed.hasHooks).toBe(true);
    expect(parsed.hasMcp).toBe(true);
    expect(parsed.hasLsp).toBe(true);
  });

  it("returns empty components and false flags for a bare plugin", async () => {
    await write("SKILL.md", "---\nname: solo\n---\n");

    const parsed = await parsePluginDir(dir);
    expect(parsed.manifest).toBeNull();
    expect(parsed.skills).toEqual([{ name: "solo", description: "" }]);
    expect(parsed.commands).toEqual([]);
    expect(parsed.agents).toEqual([]);
    expect(parsed.rules).toEqual([]);
    expect(parsed.hasHooks).toBe(false);
    expect(parsed.hasMcp).toBe(false);
    expect(parsed.hasLsp).toBe(false);
  });

  it("keeps parsing when the manifest is malformed", async () => {
    await write(".plugin/plugin.json", "{bad json");
    await write("skills/alpha/SKILL.md", "---\nname: alpha\n---\n");

    const parsed = await parsePluginDir(dir);
    expect(parsed.manifest).toBeNull();
    expect(parsed.skills.map((s) => s.name)).toEqual(["alpha"]);
  });

  it("skips agent files that are missing a name or description", async () => {
    await write("agents/nameless.md", "---\ndescription: No name here\n---\n");

    const parsed = await parsePluginDir(dir);
    expect(parsed.agents).toEqual([]);
  });

  it("falls back to a root SKILL.md when skills/ has none", async () => {
    await write("skills/empty/.gitkeep", "");
    await write("SKILL.md", "---\nname: root\n---\n");

    const parsed = await parsePluginDir(dir);
    expect(parsed.skills).toEqual([{ name: "root", description: "" }]);
  });
});

describe("parseSkillDir", () => {
  it("returns null when SKILL.md is missing", async () => {
    expect(await parseSkillDir(dir)).toBeNull();
  });

  it("names the skill after its directory when frontmatter has no name", async () => {
    await write("skills/beta/SKILL.md", "---\ndescription: Beta skill\n---\n");
    expect(await parseSkillDir(join(dir, "skills", "beta"))).toEqual({
      name: "beta",
      description: "Beta skill",
    });
  });
});
