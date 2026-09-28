import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installToOpenCode, validateSkillForOpenCode } from "../lib/opencode";
import * as ui from "../lib/ui";
import type { NamedEntry, Plugin } from "../lib/types";

let configDir: string;
let repo: string;

function oc(...segments: string[]): string {
  return join(configDir, "opencode", ...segments);
}

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), "plugins-oc-skill-cfg-"));
  repo = await mkdtemp(join(tmpdir(), "plugins-oc-skill-repo-"));
  process.env.XDG_CONFIG_HOME = configDir;
});

afterEach(async () => {
  delete process.env.XDG_CONFIG_HOME;
  vi.resetModules();
  await rm(configDir, { recursive: true, force: true });
  await rm(repo, { recursive: true, force: true });
});

function makePlugin(skills: NamedEntry[]): Plugin {
  return {
    name: "alpha",
    version: "1.0.0",
    description: "Alpha plugin",
    path: repo,
    skills,
    commands: [],
    agents: [],
    rules: [],
    hasHooks: false,
    hasMcp: false,
    hasLsp: false,
    manifest: null,
  };
}

/** Writes `skills/<dir>/SKILL.md` and returns a Plugin carrying that skill. */
async function pluginWithSkill(dir: string, frontmatter: string): Promise<Plugin> {
  await mkdir(join(repo, "skills", dir), { recursive: true });
  await writeFile(join(repo, "skills", dir, "SKILL.md"), `${frontmatter}\n\nBody\n`);
  const [, name = dir, description = ""] =
    frontmatter.match(/name:\s*(.+)\ndescription:\s*(.+)/) ?? [];
  return makePlugin([{ name: name!.trim(), description: description!.trim() }]);
}

describe("validateSkillForOpenCode", () => {
  it("accepts a conventional skill name", () => {
    expect(
      validateSkillForOpenCode({ name: "git-release", description: "Ship a release" }),
    ).toEqual([]);
  });

  it("accepts digits and single hyphens", () => {
    expect(validateSkillForOpenCode({ name: "web3-v2", description: "d" })).toEqual([]);
  });

  it("rejects uppercase", () => {
    expect(validateSkillForOpenCode({ name: "MySkill", description: "d" })).toHaveLength(1);
  });

  it("rejects underscores and dots", () => {
    expect(validateSkillForOpenCode({ name: "my_skill", description: "d" })).toHaveLength(1);
    expect(validateSkillForOpenCode({ name: "skill.v2", description: "d" })).toHaveLength(1);
  });

  it("rejects consecutive, leading, and trailing hyphens", () => {
    expect(validateSkillForOpenCode({ name: "a--b", description: "d" })).toHaveLength(1);
    expect(validateSkillForOpenCode({ name: "-ab", description: "d" })).toHaveLength(1);
    expect(validateSkillForOpenCode({ name: "ab-", description: "d" })).toHaveLength(1);
  });

  it("rejects a name longer than 64 characters", () => {
    expect(validateSkillForOpenCode({ name: "a".repeat(65), description: "d" })).toHaveLength(1);
  });

  it("rejects an empty description", () => {
    const problems = validateSkillForOpenCode({ name: "ok", description: "" });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/description/i);
  });

  it("rejects a description longer than 1024 characters", () => {
    expect(validateSkillForOpenCode({ name: "ok", description: "x".repeat(1025) })).toHaveLength(1);
  });

  it("accepts a description of exactly 1024 characters", () => {
    expect(validateSkillForOpenCode({ name: "ok", description: "x".repeat(1024) })).toEqual([]);
  });
});

describe("installToOpenCode: skill conformance", () => {
  it("installs a valid skill", async () => {
    const plugin = await pluginWithSkill("git-release", "name: git-release\ndescription: Ship it");

    await installToOpenCode([plugin], repo);

    await expect(rm(oc("skills", "git-release", "SKILL.md"))).resolves.toBeUndefined();
  });

  it("skips a skill whose name OpenCode cannot load", async () => {
    const warn = vi.spyOn(ui, "warn").mockImplementation(() => {});
    const plugin = await pluginWithSkill("My_Skill", "name: My_Skill\ndescription: Bad name");

    await installToOpenCode([plugin], repo);

    await expect(
      import("node:fs/promises").then((fs) => fs.access(oc("skills", "My_Skill"))),
    ).rejects.toThrow();
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).toContain("My_Skill");
  });

  it("skips a skill with no description", async () => {
    const warn = vi.spyOn(ui, "warn").mockImplementation(() => {});
    const plugin = await pluginWithSkill("bare", "name: bare\ndescription: ");

    await installToOpenCode([plugin], repo);

    await expect(
      import("node:fs/promises").then((fs) => fs.access(oc("skills", "bare"))),
    ).rejects.toThrow();
    expect(warn).toHaveBeenCalled();
  });

  it("installs valid skills even when a sibling skill is invalid", async () => {
    vi.spyOn(ui, "warn").mockImplementation(() => {});
    const good = await pluginWithSkill("good-one", "name: good-one\ndescription: Fine");
    const bad = await pluginWithSkill("BAD", "name: BAD\ndescription: Nope");
    const plugin = makePlugin([...good.skills, ...bad.skills]);
    await mkdir(join(repo, "skills", "good-one"), { recursive: true });
    await writeFile(
      join(repo, "skills", "good-one", "SKILL.md"),
      "name: good-one\ndescription: Fine\n",
    );
    await mkdir(join(repo, "skills", "BAD"), { recursive: true });
    await writeFile(join(repo, "skills", "BAD", "SKILL.md"), "name: BAD\ndescription: Nope\n");

    await installToOpenCode([plugin], repo);

    await expect(
      import("node:fs/promises").then((fs) => fs.access(oc("skills", "good-one", "SKILL.md"))),
    ).resolves.toBeUndefined();
  });

  it("reports each skipped skill by name and reason", async () => {
    const warn = vi.spyOn(ui, "warn").mockImplementation(() => {});
    const a = await pluginWithSkill("A_B", "name: A_B\ndescription: x");
    const b = await pluginWithSkill("ok2", "name: ok2\ndescription: y");
    const plugin = makePlugin([...a.skills, ...b.skills]);
    await mkdir(join(repo, "skills", "A_B"), { recursive: true });
    await writeFile(join(repo, "skills", "A_B", "SKILL.md"), "name: A_B\ndescription: x\n");
    await mkdir(join(repo, "skills", "ok2"), { recursive: true });
    await writeFile(join(repo, "skills", "ok2", "SKILL.md"), "name: ok2\ndescription: y\n");

    await installToOpenCode([plugin], repo);

    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(messages.some((m) => m.includes("A_B"))).toBe(true);
    expect(messages.some((m) => m.includes("ok2"))).toBe(false);
  });
});
