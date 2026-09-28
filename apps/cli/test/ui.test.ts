import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Imports a fresh copy of lib/ui so module-level colour detection re-runs. */
async function loadUi(env: Record<string, string | undefined>) {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) previous[key] = process.env[key];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  const mod = await import("../lib/ui");
  return {
    ui: mod,
    restore: () => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      vi.resetModules();
    },
  };
}

let spies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  spies = [];
});

afterEach(() => {
  for (const spy of spies) spy.mockRestore();
  delete process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;
  vi.resetModules();
});

/** Captures console.log output for the duration of `run`. */
function captureLog(run: () => void): string[] {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  });
  spies.push(spy);
  run();
  return lines;
}

describe("colour support", () => {
  it("emits no escape codes when NO_COLOR is set", async () => {
    const { ui, restore } = await loadUi({ NO_COLOR: "1", FORCE_COLOR: undefined });
    try {
      expect(ui.c.bold("x")).toBe("x");
      expect(ui.c.green("x")).toBe("x");
    } finally {
      restore();
    }
  });

  it("emits no escape codes when FORCE_COLOR is 0", async () => {
    const { ui, restore } = await loadUi({ NO_COLOR: undefined, FORCE_COLOR: "0" });
    try {
      expect(ui.c.red("x")).toBe("x");
    } finally {
      restore();
    }
  });

  it("emits escape codes when FORCE_COLOR is set", async () => {
    const { ui, restore } = await loadUi({ NO_COLOR: undefined, FORCE_COLOR: "1" });
    try {
      expect(ui.c.bold("x")).toContain("\x1B[1m");
    } finally {
      restore();
    }
  });
});

describe("banner and status lines", () => {
  it("prints one line per banner row", async () => {
    const { ui, restore } = await loadUi({ NO_COLOR: "1" });
    try {
      const lines = captureLog(() => ui.banner());
      // A leading blank line plus six gradient rows.
      expect(lines).toHaveLength(7);
    } finally {
      restore();
    }
  });

  it("prefixes status helpers with the vertical bar", async () => {
    const { ui, restore } = await loadUi({ NO_COLOR: "1" });
    try {
      const lines = captureLog(() => {
        ui.step("doing");
        ui.stepDone("done");
        ui.stepError("failed");
        ui.warn("careful");
      });
      expect(lines).toEqual([
        `${ui.S.step}  doing`,
        `${ui.S.stepComplete}  done`,
        `${ui.S.stepError}  failed`,
        `${ui.S.bar}  ${ui.S.warning}  careful`,
      ]);
    } finally {
      restore();
    }
  });

  it("prints a header with the label and a closing footer", async () => {
    const { ui, restore } = await loadUi({ NO_COLOR: "1" });
    try {
      const lines = captureLog(() => {
        ui.header("plugins");
        ui.footer("bye");
      });
      expect(lines[0]).toBe("");
      expect(lines[1]).toContain("plugins");
      expect(lines[2]).toBe(`${ui.S.barEnd}  bye`);
    } finally {
      restore();
    }
  });

  it("prints error details one dim line at a time", async () => {
    const { ui, restore } = await loadUi({ NO_COLOR: "1" });
    try {
      const lines = captureLog(() => ui.error("Broken.", ["first", "second"]));
      expect(lines).toHaveLength(3);
      expect(lines[0]).toContain("Broken.");
      expect(lines[1]).toContain("first");
      expect(lines[2]).toContain("second");
    } finally {
      restore();
    }
  });

  it("only prints debug lines when debug mode is enabled", async () => {
    const { ui, restore } = await loadUi({ NO_COLOR: "1" });
    try {
      ui.setDebug(false);
      expect(captureLog(() => ui.barDebug("hidden"))).toEqual([]);
      ui.setDebug(true);
      expect(captureLog(() => ui.barDebug("shown"))).toHaveLength(1);
      ui.setDebug(false);
    } finally {
      restore();
    }
  });
});

describe("multiSelect", () => {
  it("selects every option when stdin is not a TTY", async () => {
    const { ui, restore } = await loadUi({ NO_COLOR: "1" });
    try {
      const isTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
      const selected = await ui.multiSelect("Pick", [
        { label: "alpha", value: "a" },
        { label: "beta", value: "b" },
      ]);
      Object.defineProperty(process.stdin, "isTTY", { value: isTTY, configurable: true });
      expect(selected).toEqual(["a", "b"]);
    } finally {
      restore();
    }
  });
});
