# plugins

Install [open-plugin](https://github.com/vercel-labs/plugins) format plugins into coding agents and editors, including Claude Code, Cursor, Codex, Grok Build, Kimi Code, GitHub Copilot CLI, and VS Code.

```bash
npx plugins add owner/repo
```

## Usage

### Add plugins from a GitHub repo

```bash
# GitHub shorthand
npx plugins add vercel/vercel-plugin

# Full HTTPS URL
npx plugins add https://github.com/vercel/vercel-plugin

# SSH URL (auto-retries via HTTPS if SSH auth fails)
npx plugins add git@github.com:vercel/vercel-plugin.git
```

### Add plugins from a local directory

```bash
npx plugins add ./my-plugins
npx plugins add /absolute/path/to/plugins
```

### Discover plugins without installing

```bash
npx plugins discover owner/repo
```

### List detected agent tools

```bash
npx plugins targets
```

## Commands

| Command                     | Description                                           |
| --------------------------- | ----------------------------------------------------- |
| `plugins add <source>`      | Discover and install plugins from a source            |
| `plugins discover <source>` | Inspect plugins without installing (dry run)          |
| `plugins targets`           | List available agent tools and their detection status |

If no subcommand is given, `plugins <source>` defaults to `add`.

## Flags

| Flag       | Short | Default     | Description                                                        |
| ---------- | ----- | ----------- | ------------------------------------------------------------------ |
| `--target` | `-t`  | auto-detect | Install to a specific agent tool (for example, `grok` or `vscode`) |
| `--scope`  | `-s`  | `user`      | Installation scope: `user`, `project`, or `local`                  |
| `--yes`    | `-y`  | `false`     | Skip the confirmation prompt                                       |
| `--help`   | `-h`  |             | Show usage information                                             |

## Supported targets

The CLI auto-detects which agent tools are installed and installs to all of them.

| Target                                                                                     | Detection                                  |
| ------------------------------------------------------------------------------------------ | ------------------------------------------ |
| [Claude Code](https://code.claude.com)                                                     | `claude` binary on PATH                    |
| [Cursor](https://cursor.com)                                                               | `cursor` binary on PATH                    |
| [Codex](https://openai.com/codex/)                                                         | `codex` binary on PATH                     |
| [Grok Build](https://x.ai/cli)                                                             | `grok` binary on PATH                      |
| [Kimi Code](https://www.kimi.com/code)                                                     | `kimi` on PATH or Kimi's install directory |
| [GitHub Copilot CLI](https://docs.github.com/en/copilot/concepts/agents/about-plugins)     | `copilot` binary on PATH                   |
| [Visual Studio Code](https://code.visualstudio.com/docs/agent-customization/agent-plugins) | `code` or `code-insiders` binary on PATH   |

### Target details

- Codex installs `vercel/vercel-plugin` through Codex's curated `vercel@openai-curated` marketplace entry. That native package contains the Codex-supported Vercel surfaces and avoids upstream lifecycle hooks that are not compatible with Codex.
- Grok Build uses its native `grok plugin install` command. Its Claude Code compatibility provides skills, commands, agents, hooks, MCP servers, and LSP support.
- Kimi Code installs into its native plugin store, which the `/plugins` TUI reads on reload. Kimi plugins support skills, commands, hooks, and MCP servers; Kimi does not currently expose plugin agents or LSP servers.
- GitHub Copilot CLI registers the source with `copilot plugin marketplace add`, then installs `plugin@marketplace`. This avoids Copilot's deprecated direct local-path installs and keeps `copilot plugin update` working. This is the standalone Copilot CLI, not the legacy `gh copilot` extension.
- VS Code registers the staged OpenPlugin directory in its user-level `chat.pluginLocations` setting. VS Code agent plugins are currently a Preview feature; enable `chat.plugins.enabled` if your organization manages that setting.

Kimi, Copilot CLI, and VS Code install plugins per-user. Their native plugin systems do not currently provide the CLI's `project` or `local` installation scopes.

## How it works

### Source resolution

The CLI accepts GitHub shorthand (`owner/repo`), HTTPS URLs, SSH URLs, or local paths. Remote repos are shallow-cloned to `~/.cache/plugins/<slug>`. SSH URLs that fail automatically retry via HTTPS.

### Plugin discovery

Discovery follows a 3-step fallback:

1. **Marketplace index** — looks for a `marketplace.json` that indexes multiple plugins
2. **Root plugin** — checks if the repo root itself is a plugin
3. **Recursive scan** — scans subdirectories (up to 2 levels deep) for plugin directories

A plugin is any directory containing skills, commands, agents, rules, hooks, MCP servers, or LSP servers.

### Installation

The CLI translates the vendor-neutral `.plugin/` format into target-specific formats, then installs via the target's native plugin system. Plugin authors write once; the CLI handles the rest.

## Environment variables

| Variable            | Purpose                                                                          |
| ------------------- | -------------------------------------------------------------------------------- |
| `DISABLE_TELEMETRY` | Disable anonymous install telemetry                                              |
| `DO_NOT_TRACK`      | Disable anonymous install telemetry ([standard](https://consoledonottrack.com/)) |
| `NO_COLOR`          | Disable color output                                                             |
| `FORCE_COLOR`       | Force color output                                                               |

## Development

```bash
npm install
npm run build
node dist/index.js --help
```

Zero runtime dependencies. Built with [tsup](https://tsup.egoist.dev/) as a single bundled ESM file targeting Node.js 18+.

## License

[Apache 2.0](./LICENSE)
