import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ManifestParseError, parsePluginManifest, readManifest } from "../src/manifest";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "open-plugins-manifest-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("parsePluginManifest", () => {
  it("parses a valid manifest object", () => {
    const manifest = parsePluginManifest(
      JSON.stringify({ name: "gamma-pack", version: "2.0.0", description: "A pack" }),
    );
    expect(manifest).toMatchObject({ name: "gamma-pack", version: "2.0.0" });
  });

  it("throws a ManifestParseError naming the file for invalid JSON", () => {
    const err = catchError(() => parsePluginManifest("{nope", "/p/.plugin/plugin.json"));
    expect(err).toBeInstanceOf(ManifestParseError);
    expect(err!.message).toContain("/p/.plugin/plugin.json");
    expect(err!.message).toContain("Invalid JSON");
  });

  it("throws when the document is not a JSON object", () => {
    for (const raw of ["[]", "null", '"text"', "42"]) {
      const err = catchError(() => parsePluginManifest(raw, "plugin.json"));
      expect(err).toBeInstanceOf(ManifestParseError);
      expect(err!.message).toContain("must contain a JSON object");
    }
  });

  it("exposes the manifest path on the error", () => {
    const err = catchError(() => parsePluginManifest("[]", "/x/plugin.json"));
    expect(err).toBeInstanceOf(ManifestParseError);
    expect((err as ManifestParseError).manifestPath).toBe("/x/plugin.json");
  });
});

describe("readManifest", () => {
  it("returns null when no manifest exists", async () => {
    expect(await readManifest(dir)).toBeNull();
  });

  it("reads the manifest from the format directory", async () => {
    await mkdir(join(dir, ".plugin"));
    await writeFile(join(dir, ".plugin", "plugin.json"), JSON.stringify({ name: "pack" }));
    expect((await readManifest(dir))?.name).toBe("pack");
  });

  it("prefers the first manifest directory in priority order", async () => {
    await mkdir(join(dir, ".plugin"));
    await mkdir(join(dir, ".opencode-plugin"));
    await writeFile(join(dir, ".opencode-plugin", "plugin.json"), JSON.stringify({ name: "low" }));
    await writeFile(join(dir, ".plugin", "plugin.json"), JSON.stringify({ name: "high" }));
    expect((await readManifest(dir))?.name).toBe("high");
  });

  it("falls through to a lower-priority manifest when the first is malformed", async () => {
    await mkdir(join(dir, ".plugin"));
    await mkdir(join(dir, ".opencode-plugin"));
    await writeFile(join(dir, ".plugin", "plugin.json"), "{bad json");
    await writeFile(join(dir, ".opencode-plugin", "plugin.json"), JSON.stringify({ name: "low" }));
    expect((await readManifest(dir))?.name).toBe("low");
  });

  it("returns null when every candidate manifest is malformed", async () => {
    await mkdir(join(dir, ".plugin"));
    await writeFile(join(dir, ".plugin", "plugin.json"), "[]");
    expect(await readManifest(dir)).toBeNull();
  });
});

function catchError(fn: () => unknown): Error | undefined {
  try {
    fn();
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
  return undefined;
}
