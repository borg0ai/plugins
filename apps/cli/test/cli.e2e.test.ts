import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = join(packageRoot, "dist", "index.js");

let home: string;
let workspace: string;
let pluginRepo: string;
let emptyRepo: string;
let marketplaceRepo: string;

/**
 * Runs the bundled CLI. Builds the bundle first if it is missing so the suite
 * works both through `turbo run test` and as a bare `vitest run`.
 */
function runCli(args: string[]): { status: number; output: string } {
  if (!existsSync(bundle)) {
    execFileSync(
      process.execPath,
      [join(packageRoot, "node_modules", "vite", "bin", "vite.js"), "build"],
      { cwd: packageRoot, stdio: "pipe" },
    );
  }
  const result = spawnSync(process.execPath, [bundle, ...args], {
    encoding: "utf-8",
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    },
  });
  return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "plugins-home-"));
  workspace = await mkdtemp(join(tmpdir(), "plugins-e2e-"));
  pluginRepo = join(workspace, "plugin-repo");
  emptyRepo = join(workspace, "empty-repo");

  await mkdir(join(pluginRepo, "skills", "alpha"), { recursive: true });
  await writeFile(
    join(pluginRepo, "skills", "alpha", "SKILL.md"),
    "---\nname: alpha\ndescription: The alpha skill\n---\n\nBody\n",
  );
  await mkdir(emptyRepo, { recursive: true });

  marketplaceRepo = join(workspace, "marketplace-repo");
  await mkdir(join(marketplaceRepo, "packs", "alpha"), { recursive: true });
  await writeFile(join(marketplaceRepo, "packs", "alpha", "SKILL.md"), "---\nname: alpha\n---\n");
  await writeFile(
    join(marketplaceRepo, "marketplace.json"),
    JSON.stringify({
      name: "acme",
      plugins: [
        { name: "alpha", source: "./packs/alpha" },
        {
          name: "hosted",
          description: "Lives in another repo",
          source: { source: "github", repo: "acme/hosted" },
        },
        { name: "ghost", source: "./packs/ghost" },
      ],
    }),
  );
});

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
});

describe("cli: help", () => {
  it("prints usage for --help and exits 0", () => {
    const { status, output } = runCli(["--help"]);
    expect(status).toBe(0);
    expect(output).toContain("plugins add");
    expect(output).toContain("--target");
  });

  it("prints usage when no command is given", () => {
    const { status, output } = runCli([]);
    expect(status).toBe(0);
    expect(output).toContain("Install open-plugin format plugins");
  });

  it("prints usage for -h", () => {
    const { status, output } = runCli(["-h"]);
    expect(status).toBe(0);
    expect(output).toContain("Usage:");
  });
});

describe("cli: targets", () => {
  it("lists the install targets", () => {
    const { status, output } = runCli(["targets"]);
    expect(status).toBe(0);
    expect(output).toContain("Claude Code");
    expect(output).toContain("GitHub Copilot CLI");
    expect(output).toContain("Visual Studio Code");
    expect(output).toMatch(/Status: (detected|not found)/);
  });
});

describe("cli: discover", () => {
  it("reports plugins found in a local directory", () => {
    const { status, output } = runCli(["discover", pluginRepo]);
    expect(status).toBe(0);
    expect(output).toContain("Found 1 local plugin(s)");
    // Without a manifest, the plugin is named after its directory.
    expect(output).toContain("plugin-repo");
    expect(output).toContain("1 skill");
  });

  it("exits 1 when no source is provided", () => {
    const { status, output } = runCli(["discover"]);
    expect(status).toBe(1);
    expect(output).toContain("Provide a repo path or URL");
  });

  it("reports an empty repository", () => {
    const { status, output } = runCli(["discover", emptyRepo]);
    expect(status).toBe(0);
    expect(output).toContain("No plugins found.");
  });

  it("hides remote plugins unless --remote is passed", () => {
    const { output } = runCli(["discover", pluginRepo]);
    expect(output).not.toContain("remote plugin(s)");
  });

  it("points at --remote when a marketplace has remote entries", () => {
    const { status, output } = runCli(["discover", marketplaceRepo]);
    expect(status).toBe(0);
    expect(output).toContain("Found 1 local plugin(s)");
    expect(output).toContain("1 remote plugin(s) not shown");
    expect(output).toContain("--remote");
  });

  it("lists remote plugins and missing sources with --remote", () => {
    const { status, output } = runCli(["discover", marketplaceRepo, "--remote"]);
    expect(status).toBe(0);
    expect(output).toContain("1 remote plugin(s)");
    expect(output).toContain("hosted");
    expect(output).toContain("Lives in another repo");
    expect(output).toContain("source not found: ./packs/ghost");
  });
});

describe("cli: add", () => {
  it("exits 1 when no source is provided", () => {
    const { status, output } = runCli(["add"]);
    expect(status).toBe(1);
    expect(output).toContain("Provide a repo path or URL");
  });

  it("rejects an unknown target before installing anything", () => {
    const { status, output } = runCli(["add", pluginRepo, "--target", "not-a-tool"]);
    expect(status).toBe(1);
    expect(output).toContain("Unknown target: not-a-tool");
    expect(output).toContain("Available:");
  });

  it("reports an empty repository without installing", () => {
    const { status, output } = runCli(["add", emptyRepo, "--yes"]);
    expect(status).toBe(0);
    expect(output).toContain("No plugins found.");
  });

  it("rejects an unknown scope before installing anything", () => {
    const { status, output } = runCli(["add", pluginRepo, "--scope", "nonsense", "--yes"]);
    expect(status).toBe(1);
    expect(output).toContain("Unknown scope: nonsense");
    expect(output).toContain("user, project, local");
  });
});
