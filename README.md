# plugins

Install [Open Plugins 0.1](docs/OPENG_PLUGINS_0_1.md) bundles into coding agents and editors, including Claude Code, Cursor, Codex, Grok Build, Kimi Code, GitHub Copilot CLI, VS Code, and OpenCode. The separate [Agent Plugins 1.0 package specification](docs/AGENT_PLUGINS_1_0.md) records the newer format and current support boundary.

```bash
npx @borg0ai/plugins add owner/repo
```

## Usage

### Add plugins from a GitHub repo

```bash
# GitHub shorthand
npx @borg0ai/plugins add vercel/vercel-plugin

# Full HTTPS URL
npx @borg0ai/plugins add https://github.com/vercel/vercel-plugin

# SSH URL (auto-retries via HTTPS if SSH auth fails)
npx @borg0ai/plugins add git@github.com:vercel/vercel-plugin.git
```

### Add plugins from a local directory

```bash
npx @borg0ai/plugins add ./my-plugins
npx @borg0ai/plugins add /absolute/path/to/plugins
```

### Discover plugins without installing

```bash
npx @borg0ai/plugins discover owner/repo
```

### List detected agent tools

```bash
npx @borg0ai/plugins targets
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
| [OpenCode](https://github.com/sst/opencode)                                            | `opencode` binary on PATH or its config directory |

### Target details

- Codex installs `vercel/vercel-plugin` through Codex's curated `vercel@openai-curated` marketplace entry. That native package contains the Codex-supported Vercel surfaces and avoids upstream lifecycle hooks that are not compatible with Codex.
- Grok Build uses its native `grok plugin install` command. Its Claude Code compatibility provides skills, commands, agents, hooks, MCP servers, and LSP support.
- Kimi Code installs into its native plugin store, which the `/plugins` TUI reads on reload. Kimi plugins support skills, commands, hooks, and MCP servers; Kimi does not currently expose plugin agents or LSP servers.
- GitHub Copilot CLI registers the source with `copilot plugin marketplace add`, then installs `plugin@marketplace`. This avoids Copilot's deprecated direct local-path installs and keeps `copilot plugin update` working. This is the standalone Copilot CLI, not the legacy `gh copilot` extension.
- VS Code registers the staged OpenPlugin directory in its user-level `chat.pluginLocations` setting. VS Code agent plugins are currently a Preview feature; enable `chat.plugins.enabled` if your organization manages that setting.
- OpenCode has no vendor manifest format, so the CLI translates each component into OpenCode's own representation. Plugins are staged under `<config>/plugins/managed/<name>`. Skills are copied into `<config>/skills` so OpenCode discovers them from disk; a skill OpenCode cannot load is reported rather than copied silently. MCP servers, commands, agents, and rules are written to the matching `opencode.json` fields (`mcp`, `command`, `agent`, `instructions`), and LSP servers to `lsp`. `<name>-plugin.js` is generated for tool hooks, mapped onto OpenCode's `tool.execute.before` / `tool.execute.after`, and the plugin root is exported through `shell.env`. Unrelated config entries are preserved, and a reinstall replaces only what the CLI previously wrote.

Kimi, Copilot CLI, VS Code, and OpenCode install plugins per-user. Their native plugin systems do not currently provide the CLI's `project` or `local` installation scopes.

## How it works

### Plugin formats

The CLI currently supports **Open Plugins 0.1** bundles: `.plugin/plugin.json` identifies the plugin, with components such as `skills/`, `commands/`, `agents/`, `rules/`, `hooks/hooks.json`, `.mcp.json`, and `.lsp.json`. See the [Open Plugins 0.1 specification](docs/OPENG_PLUGINS_0_1.md) for manifest, discovery, and component behavior.

**Agent Plugins 1.0** is a separate format: root `plugin.json` declares the canonical Agent Plugins schema, and root `mcp.json` declares standard MCP servers. Read the [Agent Plugins 1.0 package specification](docs/AGENT_PLUGINS_1_0.md). The CLI does not yet discover or install Agent Plugins 1.0 bundles.

### Source resolution

The CLI accepts GitHub shorthand (`owner/repo`), HTTPS URLs, SSH URLs, or local paths. Remote repos are shallow-cloned to `~/.cache/plugins/<slug>`. SSH URLs that fail automatically retry via HTTPS.

### Plugin discovery

Discovery follows a 3-step fallback:

1. **Marketplace index** — looks for a `marketplace.json` that indexes multiple plugins
2. **Root plugin** — checks if the repo root itself is a plugin
3. **Recursive scan** — scans subdirectories (up to 2 levels deep) for plugin directories

A plugin is any directory containing skills, commands, agents, rules, hooks, MCP servers, or LSP servers.

### Installation

The CLI discovers each Open Plugins 0.1 bundle, translates its supported components into the selected target's native format, then installs through that target's plugin system.

## Environment variables

| Variable            | Purpose                                                                          |
| ------------------- | -------------------------------------------------------------------------------- |
| `NO_COLOR`          | Disable color output                                                             |
| `FORCE_COLOR`       | Force color output                                                               |

The CLI collects no telemetry and makes no network requests.

## Development

This repo is a pnpm + Turborepo workspace. The published CLI lives in `apps/cli`.

```bash
pnpm install
pnpm build            # turbo run build -> apps/cli/dist/index.js
pnpm typecheck
pnpm test             # unit tests + end-to-end CLI tests
pnpm dev              # rebuild on change
```

Run the CLI locally:

```bash
node apps/cli/dist/index.js --help
pnpm --filter @borg0ai/plugins exec vite build   # build just the CLI
```

### Layout

```
apps/cli/            @borg0ai/plugins — the published CLI
  index.ts           argument parsing, command dispatch, terminal output
  lib/discover.ts    marketplace / root-plugin / recursive-scan discovery
  lib/targets.ts     supported agent tools and binary detection
  lib/install.ts     per-target install, vendor manifests, JSONC settings
  lib/opencode.ts    OpenCode managed tree, adapter and config translation
  lib/ui.ts          ANSI styling, log frame, multi-select prompt
  lib/types.ts       shared types
  test/              unit tests + CLI end-to-end tests
packages/open-plugins/  @borg0ai/open-plugins — Open Plugins 0.1 manifest and component parser
legacy/index.js      pre-TypeScript bundle, kept for behavioural comparison
```

Built with [Vite](https://vite.dev) as a single bundled ESM file targeting Node.js 22.22+, and tested with [Vitest](https://vitest.dev). Zero runtime dependencies.

## License

[Apache 2.0](./LICENSE)
