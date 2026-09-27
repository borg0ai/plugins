/** Terminal output helpers. Presentation only; no install logic lives here. */

const isColorSupported =
  process.env.FORCE_COLOR !== "0" &&
  !process.env.NO_COLOR &&
  (process.env.FORCE_COLOR !== undefined || process.stdout.isTTY);

function ansi(code: string): string {
  return isColorSupported ? `\x1B[${code}m` : "";
}

const reset = ansi("0");
const bold = ansi("1");
const dim = ansi("2");
const underline = ansi("4");
const red = ansi("31");
const green = ansi("32");
const yellow = ansi("33");
const blue = ansi("34");
const magenta = ansi("35");
const cyan = ansi("36");
const gray = ansi("90");
const bgCyan = ansi("46");
const black = ansi("30");

export const c = {
  bold: (s: string) => `${bold}${s}${reset}`,
  dim: (s: string) => `${dim}${s}${reset}`,
  italic: (s: string) => `${ansi("3")}${s}${reset}`,
  underline: (s: string) => `${underline}${s}${reset}`,
  red: (s: string) => `${red}${s}${reset}`,
  green: (s: string) => `${green}${s}${reset}`,
  yellow: (s: string) => `${yellow}${s}${reset}`,
  blue: (s: string) => `${blue}${s}${reset}`,
  magenta: (s: string) => `${magenta}${s}${reset}`,
  cyan: (s: string) => `${cyan}${s}${reset}`,
  gray: (s: string) => `${gray}${s}${reset}`,
};

export const S = {
  bar: "\u2502",
  barEnd: "\u2514",
  barStart: "\u250C",
  diamond: "\u25C7",
  circle: "\u25CB",
  step: "\u25C7",
  stepActive: "\u25C6",
  stepComplete: "\u25CF",
  stepError: "\u25A0",
  warning: "\u25B2",
};

export function barLine(content = ""): void {
  console.log(`${c.gray(S.bar)}  ${content}`);
}

export function barEmpty(): void {
  console.log(`${c.gray(S.bar)}`);
}

let _debug = false;

export function setDebug(enabled: boolean): void {
  _debug = enabled;
}

export function barDebug(content = ""): void {
  if (_debug) barLine(content);
}

export function step(content: string): void {
  console.log(`${c.gray(S.step)}  ${content}`);
}

export function stepDone(content: string): void {
  console.log(`${c.green(S.stepComplete)}  ${content}`);
}

export function stepError(content: string): void {
  console.log(`${c.red(S.stepError)}  ${content}`);
}

export function header(label: string): void {
  console.log();
  console.log(`${c.gray(S.barStart)}  ${c.gray(`${bgCyan}${black} ${label} ${reset}`)}`);
}

export function footer(message?: string): void {
  console.log(message ? `${c.gray(S.barEnd)}  ${message}` : c.gray(S.barEnd));
}

export function error(title: string, details?: string[]): void {
  console.log(`${c.red(S.stepError)}  ${c.red(c.bold(title))}`);
  if (details) {
    for (const line of details) barLine(c.dim(line));
  }
}

export function warn(message: string): void {
  barLine(`${c.yellow(S.warning)}  ${c.yellow(message)}`);
}

export type SelectOption = { label: string; value: string; hint?: string };

/**
 * Interactive multi-select with search. Returns null on cancel.
 * Falls back to "select everything" when stdin is not a TTY.
 */
export async function multiSelect(
  title: string,
  options: SelectOption[],
  maxVisible = 8,
): Promise<string[] | null> {
  if (!process.stdin.isTTY) {
    return options.map((o) => o.value);
  }
  const { createInterface, emitKeypressEvents } = await import("readline");
  const { Writable } = await import("stream");
  const silentOutput = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: silentOutput, terminal: false });
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    emitKeypressEvents(process.stdin, rl);
    let query = "";
    let cursor = 0;
    const selected = new Set(options.map((o) => o.value));
    let lastRenderHeight = 0;

    const filter = (item: SelectOption, q: string): boolean => {
      if (!q) return true;
      const lq = q.toLowerCase();
      return (
        item.label.toLowerCase().includes(lq) || (item.hint?.toLowerCase().includes(lq) ?? false)
      );
    };
    const getFiltered = (): SelectOption[] => options.filter((item) => filter(item, query));

    const clearRender = (): void => {
      if (lastRenderHeight > 0) {
        process.stdout.write(`\x1B[${lastRenderHeight}A`);
        for (let i = 0; i < lastRenderHeight; i += 1) {
          process.stdout.write("\x1B[2K\x1B[1B");
        }
        process.stdout.write(`\x1B[${lastRenderHeight}A`);
      }
    };

    const render = (state: "active" | "submit" | "cancel" = "active"): void => {
      clearRender();
      const lines: string[] = [];
      const filtered = getFiltered();
      const icon =
        state === "active" ? c.cyan(S.stepActive) : state === "cancel" ? c.red(S.stepError) : c.green(S.stepComplete);
      lines.push(`${icon}  ${state === "active" ? title : c.dim(title)}`);
      if (state === "active") {
        const blockCursor = isColorSupported ? `\x1B[7m \x1B[0m` : "_";
        lines.push(`${c.gray(S.bar)}  ${c.dim("Search:")} ${query}${blockCursor}`);
        lines.push(`${c.gray(S.bar)}  ${c.dim("\u2191\u2193 move, space toggle, a all, n none, enter confirm")}`);
        lines.push(c.gray(S.bar));
        const visibleStart = Math.max(0, Math.min(cursor - Math.floor(maxVisible / 2), filtered.length - maxVisible));
        const visibleEnd = Math.min(filtered.length, visibleStart + maxVisible);
        const visibleItems = filtered.slice(visibleStart, visibleEnd);
        if (filtered.length === 0) {
          lines.push(`${c.gray(S.bar)}  ${c.dim("No matches found")}`);
        } else {
          for (let i = 0; i < visibleItems.length; i += 1) {
            const item = visibleItems[i]!;
            const actualIndex = visibleStart + i;
            const isSelected = selected.has(item.value);
            const isCursor = actualIndex === cursor;
            const radio = isSelected ? c.green(S.stepComplete) : c.dim(S.circle);
            const label = isCursor ? c.underline(item.label) : item.label;
            const hint = item.hint ? c.dim(` (${item.hint})`) : "";
            const pointer = isCursor ? c.cyan("\u276F") : " ";
            lines.push(`${c.gray(S.bar)} ${pointer} ${radio} ${label}${hint}`);
          }
          const hiddenBefore = visibleStart;
          const hiddenAfter = filtered.length - visibleEnd;
          if (hiddenBefore > 0 || hiddenAfter > 0) {
            const parts: string[] = [];
            if (hiddenBefore > 0) parts.push(`\u2191 ${hiddenBefore} more`);
            if (hiddenAfter > 0) parts.push(`\u2193 ${hiddenAfter} more`);
            lines.push(`${c.gray(S.bar)}  ${c.dim(parts.join("  "))}`);
          }
        }
        lines.push(c.gray(S.bar));
        const selectedLabels = options.filter((o) => selected.has(o.value)).map((o) => o.label);
        if (selectedLabels.length === 0) {
          lines.push(`${c.gray(S.bar)}  ${c.dim("Selected: (none)")}`);
        } else {
          const summary =
            selectedLabels.length <= 3
              ? selectedLabels.join(", ")
              : `${selectedLabels.slice(0, 3).join(", ")} +${selectedLabels.length - 3} more`;
          lines.push(`${c.gray(S.bar)}  ${c.green("Selected:")} ${summary}`);
        }
        lines.push(c.gray(S.barEnd));
      } else if (state === "submit") {
        const selectedLabels = options.filter((o) => selected.has(o.value)).map((o) => o.label);
        lines.push(`${c.gray(S.bar)}  ${c.dim(selectedLabels.join(", "))}`);
      } else {
        lines.push(`${c.gray(S.bar)}  ${c.dim("Cancelled")}`);
      }
      process.stdout.write(`${lines.join("\n")}\n`);
      lastRenderHeight = lines.length;
    };

    const cleanup = (): void => {
      process.stdin.removeListener("keypress", onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      rl.close();
    };

    const onKeypress = (_str: string, key: { name?: string; ctrl?: boolean; meta?: boolean; sequence?: string }): void => {
      if (!key) return;
      const filtered = getFiltered();
      if (key.name === "return") {
        render("submit");
        cleanup();
        resolve([...selected]);
        return;
      }
      if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        render("cancel");
        cleanup();
        resolve(null);
        return;
      }
      if (key.name === "up") {
        cursor = Math.max(0, cursor - 1);
        render();
        return;
      }
      if (key.name === "down") {
        cursor = Math.min(Math.max(filtered.length - 1, 0), cursor + 1);
        render();
        return;
      }
      if (key.name === "space") {
        const item = filtered[cursor];
        if (item) {
          if (selected.has(item.value)) selected.delete(item.value);
          else selected.add(item.value);
        }
        render();
        return;
      }
      if (key.name === "backspace") {
        query = query.slice(0, -1);
        cursor = 0;
        render();
        return;
      }
      if (key.sequence && !key.ctrl && !key.meta && key.sequence.length === 1) {
        if (key.sequence === "a" && query === "") {
          for (const o of options) selected.add(o.value);
          render();
          return;
        }
        if (key.sequence === "n" && query === "") {
          selected.clear();
          render();
          return;
        }
        query += key.sequence;
        cursor = 0;
        render();
      }
    };

    process.stdin.on("keypress", onKeypress);
    render();
  });
}

const BANNER_LINES = [
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2557     \u2588\u2588\u2557   \u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2557\u2588\u2588\u2588\u2557   \u2588\u2588\u2557\u2588\u2588\u2588\u2558\u2588\u2588\u2557",
  "\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2551     \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D \u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D",
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2551     \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551  \u2588\u2588\u2588\u2557\u2588\u2588\u2551\u2588\u2588\u2554\u2588\u2588\u2557 \u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2588\u2557",
  "\u2588\u2588\u2554\u2550\u2550\u2550\u255D \u2588\u2588\u2551     \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551\u2588\u2588\u2551\u255A\u2588\u2588\u2557\u2588\u2588\u2551\u255A\u2550\u2550\u2550\u2550\u2588\u2588\u2551",
  "\u2588\u2588\u2551     \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u255A\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u255A\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2551\u2588\u2588\u2551 \u255A\u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551",
  "\u255A\u2550\u255D     \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D \u255A\u2550\u2550\u2550\u2550\u2550\u255D  \u255A\u2550\u2550\u2550\u2550\u2550\u255D \u255A\u2550\u255D\u255A\u2550\u255D  \u255A\u2550\u2550\u2550\u255D\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D",
];

const GRADIENT: [number, number, number][] = [
  [60, 60, 60],
  [90, 90, 90],
  [125, 125, 125],
  [160, 160, 160],
  [200, 200, 200],
  [240, 240, 240],
];

function rgb(r: number, g: number, b: number): string {
  return isColorSupported ? `\x1B[38;2;${r};${g};${b}m` : "";
}

export function banner(): void {
  console.log();
  for (let i = 0; i < BANNER_LINES.length; i += 1) {
    const line = BANNER_LINES[i] ?? "";
    const [r, g, b] = GRADIENT[i] ?? [0, 0, 0];
    console.log(`${rgb(r, g, b)}${line}${reset}`);
  }
}
