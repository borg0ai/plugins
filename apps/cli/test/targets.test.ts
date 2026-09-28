import { describe, expect, it, vi } from "vitest";
import { TARGET_DEFS, getTargets } from "../lib/targets";

describe("TARGET_DEFS", () => {
  it("exposes a unique id for every registered target", () => {
    const ids = TARGET_DEFS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("registers the supported agent tools", () => {
    expect(TARGET_DEFS.map((t) => t.id)).toEqual([
      "claude-code",
      "cursor",
      "codex",
      "grok",
      "kimi",
      "github-copilot",
      "vscode",
      "opencode",
    ]);
  });

  it("gives every target a human name, description and config path", () => {
    for (const target of TARGET_DEFS) {
      expect(target.name.length).toBeGreaterThan(0);
      expect(target.description.length).toBeGreaterThan(0);
      expect(target.configPath.length).toBeGreaterThan(0);
    }
  });

  it("roots the kimi config path in KIMI_CODE_HOME when it is set", async () => {
    const previous = process.env.KIMI_CODE_HOME;
    process.env.KIMI_CODE_HOME = "/tmp/kimi-home-override";
    try {
      // TARGET_DEFS is built at module load, so re-import to observe the override.
      vi.resetModules();
      const { TARGET_DEFS: reloaded } = await import("../lib/targets");
      expect(reloaded.find((t) => t.id === "kimi")?.configPath).toBe("/tmp/kimi-home-override");
    } finally {
      if (previous === undefined) delete process.env.KIMI_CODE_HOME;
      else process.env.KIMI_CODE_HOME = previous;
      vi.resetModules();
    }
  });
});

describe("getTargets", () => {
  it("returns every registered target with a boolean detection flag", async () => {
    const targets = await getTargets();
    expect(targets).toHaveLength(TARGET_DEFS.length);
    for (const target of targets) {
      expect(typeof target.detected).toBe("boolean");
    }
  });

  it("preserves the definition order", async () => {
    const targets = await getTargets();
    expect(targets.map((t) => t.id)).toEqual(TARGET_DEFS.map((t) => t.id));
  });

  it("carries the definition fields through to each detected target", async () => {
    const [first] = await getTargets();
    expect(first).toMatchObject({
      id: TARGET_DEFS[0]!.id,
      name: TARGET_DEFS[0]!.name,
      description: TARGET_DEFS[0]!.description,
      configPath: TARGET_DEFS[0]!.configPath,
    });
  });
});
