/** Terminal styling, the vertical-bar log frame, and the multi-select prompt. */
import type { SelectOption } from "./types.ts";

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
const italic = ansi("3");
const underline = ansi("4");
const red = ansi("31");
const green = ansi("32");
const yellow = ansi("33");
const blue = ansi("34");
const magenta = ansi("35");
const cyan = ansi("36");
const gray = ansi("90");
const bgGreen = ansi("42");
const bgRed = ansi("41");
const bgYellow = ansi("43");
const bgCyan = ansi("46");
const black = ansi("30");

/** Text style helpers; each is a no-op when colour is unsupported. */
export const c = {
  bold: (s: string) => `${bold}${s}${reset}`,
  dim: (s: string) => `${dim}${s}${reset}`,
  italic: (s: string) => `${italic}${s}${reset}`,
  underline: (s: string) => `${underline}${s}${reset}`,
  red: (s: string) => `${red}${s}${reset}`,
  green: (s: string) => `${green}${s}${reset}`,
  yellow: (s: string) => `${yellow}${s}${reset}`,
  blue: (s: string) => `${blue}${s}${reset}`,
  magenta: (s: string) => `${magenta}${s}${reset}`,
  cyan: (s: string) => `${cyan}${s}${reset}`,
  gray: (s: string) => `${gray}${s}${reset}`,
  bgGreen: (s: string) => `${bgGreen}${black}${s}${reset}`,
  bgRed: (s: string) => `${bgRed}${black}${s}${reset}`,
  bgYellow: (s: string) => `${bgYellow}${black}${s}${reset}`,
  bgCyan: (s: string) => `${bgCyan}${black}${s}${reset}`,
};

/** Glyphs used by the log frame and status lines. */
export const S = {
  // Box drawing
  bar: "│",
  barEnd: "└",
  barStart: "┌",
  barH: "─",
  corner: "╮",
  // Bullets and status marks
  diamond: "◇",
  diamondFilled: "◆",
  bullet: "●",
  circle: "○",
  check: "✔",
  cross: "✖",
  arrow: "→",
  warning: "▲",
  info: "ℹ",
  step: "◇",
  stepActive: "◆",
  stepComplete: "●",
  stepError: "■",
};

export function barLine(content = ""): void {
  console.log(`${c.gray(S.bar)}  ${content}`);
}

export function barEmpty(): void {
  console.log(`${c.gray(S.bar)}`);
}

let debugEnabled = false;

/** Enables the extra `barDebug` output, driven by the `--debug` flag. */
export function setDebug(enabled: boolean): void {
  debugEnabled = enabled;
}

export function barDebug(content = ""): void {
  if (debugEnabled) barLine(content);
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
  console.log(`${c.gray(S.barStart)}  ${c.bgCyan(` ${label} `)}`);
}

export function footer(message?: string): void {
  console.log(message ? `${c.gray(S.barEnd)}  ${message}` : `${c.gray(S.barEnd)}`);
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

/** Which keypress handling step the prompt is showing. */
type RenderState = "active" | "submit" | "cancel";

/**
 * Searchable checkbox prompt. Without a TTY (piped input, CI) every option is
 * selected, so non-interactive runs install everything discovered.
 */
export async function multiSelect(
  title: string,
  options: SelectOption[],
  maxVisible = 8,
): Promise<string[] | null> {
  if (!process.stdin.isTTY) return options.map((o) => o.value);

  const { createInterface, emitKeypressEvents } = await import("node:readline");
  const { Writable } = await import("node:stream");
  const silentOutput = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });

  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: silentOutput, terminal: false });
    process.stdin.setRawMode(true);
    emitKeypressEvents(process.stdin, rl);

    let query = "";
    let cursor = 0;
    const selected = new Set(options.map((o) => o.value));
    let lastRenderHeight = 0;

    const getFiltered = () => options.filter((item) => matches(item, query));
    const selectedLabels = () => options.filter((o) => selected.has(o.value)).map((o) => o.label);

    const clearRender = () => {
      if (lastRenderHeight === 0) return;
      process.stdout.write(`\x1B[${lastRenderHeight}A`);
      for (let i = 0; i < lastRenderHeight; i++) process.stdout.write("\x1B[2K\x1B[1B");
      process.stdout.write(`\x1B[${lastRenderHeight}A`);
    };

    const render = (state: RenderState = "active") => {
      clearRender();
      const lines: string[] = [];
      const filtered = getFiltered();
      const icon =
        state === "active"
          ? c.cyan(S.stepActive)
          : state === "cancel"
            ? c.red(S.stepError)
            : c.green(S.stepComplete);
      lines.push(`${icon}  ${state === "active" ? title : c.dim(title)}`);

      if (state === "active") {
        const blockCursor = isColorSupported ? `\x1B[7m \x1B[0m` : "_";
        lines.push(`${c.gray(S.bar)}  ${c.dim("Search:")} ${query}${blockCursor}`);
        lines.push(
          `${c.gray(S.bar)}  ${c.dim("↑↓ move, space toggle, a all, n none, enter confirm")}`,
        );
        lines.push(`${c.gray(S.bar)}`);

        const visibleStart = Math.max(
          0,
          Math.min(cursor - Math.floor(maxVisible / 2), filtered.length - maxVisible),
        );
        const visibleEnd = Math.min(filtered.length, visibleStart + maxVisible);

        if (filtered.length === 0) {
          lines.push(`${c.gray(S.bar)}  ${c.dim("No matches found")}`);
        } else {
          for (let i = 0; i < visibleEnd - visibleStart; i++) {
            const item = filtered[visibleStart + i]!;
            const isSelected = selected.has(item.value);
            const isCursor = visibleStart + i === cursor;
            const radio = isSelected ? c.green(S.stepComplete) : c.dim(S.circle);
            const label = isCursor ? c.underline(item.label) : item.label;
            const hint = item.hint ? c.dim(` (${item.hint})`) : "";
            const pointer = isCursor ? c.cyan("❯") : " ";
            lines.push(`${c.gray(S.bar)} ${pointer} ${radio} ${label}${hint}`);
          }

          const hiddenBefore = visibleStart;
          const hiddenAfter = filtered.length - visibleEnd;
          if (hiddenBefore > 0 || hiddenAfter > 0) {
            const parts: string[] = [];
            if (hiddenBefore > 0) parts.push(`↑ ${hiddenBefore} more`);
            if (hiddenAfter > 0) parts.push(`↓ ${hiddenAfter} more`);
            lines.push(`${c.gray(S.bar)}  ${c.dim(parts.join("  "))}`);
          }
        }

        lines.push(`${c.gray(S.bar)}`);
        const labels = selectedLabels();
        if (labels.length === 0) {
          lines.push(`${c.gray(S.bar)}  ${c.dim("Selected: (none)")}`);
        } else {
          const summary =
            labels.length <= 3
              ? labels.join(", ")
              : `${labels.slice(0, 3).join(", ")} +${labels.length - 3} more`;
          lines.push(`${c.gray(S.bar)}  ${c.green("Selected:")} ${summary}`);
        }
        lines.push(c.gray(S.barEnd));
      } else if (state === "submit") {
        lines.push(`${c.gray(S.bar)}  ${c.dim(selectedLabels().join(", "))}`);
      } else {
        lines.push(`${c.gray(S.bar)}  ${c.dim("Cancelled")}`);
      }

      process.stdout.write(lines.join("\n") + "\n");
      lastRenderHeight = lines.length;
    };

    const cleanup = () => {
      process.stdin.removeListener("keypress", onKeypress);
      process.stdin.setRawMode(false);
      rl.close();
    };

    const onKeypress = (
      str: string | undefined,
      key: { name?: string; ctrl?: boolean; meta?: boolean; sequence?: string } | undefined,
    ) => {
      if (!key) return;
      const filtered = getFiltered();

      switch (key.name) {
        case "return":
          render("submit");
          cleanup();
          resolve([...selected]);
          return;
        case "escape":
          render("cancel");
          cleanup();
          resolve(null);
          return;
        case "up":
          cursor = Math.max(0, cursor - 1);
          render();
          return;
        case "down":
          cursor = Math.min(filtered.length - 1, cursor + 1);
          render();
          return;
        case "space": {
          const item = filtered[cursor];
          if (item) {
            if (selected.has(item.value)) selected.delete(item.value);
            else selected.add(item.value);
          }
          render();
          return;
        }
        case "backspace":
          query = query.slice(0, -1);
          cursor = 0;
          render();
          return;
        default:
          break;
      }

      if (key.ctrl && key.name === "c") {
        render("cancel");
        cleanup();
        resolve(null);
        return;
      }

      if (key.sequence && !key.ctrl && !key.meta && key.sequence.length === 1) {
        if (key.sequence === "a" && query === "") {
          for (const o of options) selected.add(o.value);
        } else if (key.sequence === "n" && query === "") {
          selected.clear();
        } else {
          query += key.sequence;
          cursor = 0;
        }
        render();
      }
    };

    process.stdin.on("keypress", onKeypress);
    render();
  });
}

function matches(item: SelectOption, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return (
    item.label.toLowerCase().includes(needle) ||
    (item.hint?.toLowerCase().includes(needle) ?? false)
  );
}

const BANNER_LINES = [
  "██████╗ ██╗     ██╗   ██╗ ██████╗ ██╗███╗   ██╗███████╗",
  "██╔══██╗██║     ██║   ██║██╔════╝ ██║████╗  ██║██╔════╝",
  "██████╔╝██║     ██║   ██║██║  ███╗██║██╔██╗ ██║███████╗",
  "██╔═══╝ ██║     ██║   ██║██║   ██║██║██║╚██╗██║╚════██║",
  "██║     ███████╗╚██████╔╝╚██████╔╝██║██║ ╚████║███████║",
  "╚═╝     ╚══════╝ ╚═════╝  ╚═════╝ ╚═╝╚═╝  ╚═══╝╚══════╝",
];

const GRADIENT: Array<[number, number, number]> = [
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
  for (let i = 0; i < BANNER_LINES.length; i++) {
    const [r, g, b] = GRADIENT[i]!;
    console.log(`${rgb(r, g, b)}${BANNER_LINES[i]}${reset}`);
  }
}
