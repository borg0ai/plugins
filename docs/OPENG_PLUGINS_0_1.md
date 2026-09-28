# Open Plugins 0.1

Open Plugins 0.1 is this repository's vendor-neutral plugin bundle format. This document defines its package layout and the behavior the `plugins` CLI implements. It is separate from [Agent Plugins 1.0](./AGENT_PLUGINS_1_0.md), which has a different root manifest and MCP file.

## Package layout

```text
my-plugin/
  .plugin/
    plugin.json
  skills/
    review/
      SKILL.md
      scripts/
      references/
  commands/
    deploy.md
  agents/
    reviewer.md
  rules/
    style.md
  hooks/
    hooks.json
  .mcp.json
  .lsp.json
  .opencode-plugin/
    main.js
```

All component directories are optional. `.plugin/plugin.json` is the canonical Open Plugins 0.1 identity manifest. `.opencode-plugin/` is an OpenCode-specific extension; it is not portable to other targets.

## Manifest

`.plugin/plugin.json` is a JSON object. Supported metadata:

| Field | Meaning |
| --- | --- |
| `name` | Plugin identifier; defaults to plugin directory name when absent |
| `version` | Plugin version |
| `description` | Short plugin description |
| `author` | Author metadata passed through to targets that support it |
| `license` | License metadata passed through to targets that support it |
| `keywords` | Search metadata passed through to targets that support it |

The current CLI parses this manifest as JSON and reads these fields without strict schema validation. Unknown fields remain available to target adapters but have no cross-target meaning unless an adapter documents them. Agent Plugins 1.0's `$schema` field and closed manifest schema do not apply to this format.

When a manifest is absent, the CLI has a compatibility path for plugin directories detected from supported component markers and derives the plugin name from the directory. Authors should include `.plugin/plugin.json` for stable identity and metadata.

## Components

| Component | Source location | Discovery behavior |
| --- | --- | --- |
| Skills | `skills/<directory>/SKILL.md` | Reads `name` and `description` frontmatter; falls back to directory name and empty description. If no nested skills exist, root `SKILL.md` is accepted. |
| Commands | `commands/*.{md,mdc,markdown}` | Name comes from filename without extension; `description` frontmatter is optional. |
| Agents | `agents/*.{md,mdc,markdown}` | Requires non-empty `name` and `description` frontmatter. |
| Rules | `rules/*.{md,mdc,markdown}` | Name comes from filename without extension; `description` frontmatter is optional. |
| Hooks | `hooks/hooks.json` | Target adapters translate supported hook events; unsupported events may be reported per target. |
| MCP servers | `.mcp.json` | Server definitions are read from `mcpServers` by target adapters. |
| LSP servers | `.lsp.json` | Target adapters translate supported server definitions. OpenCode accepts a server map, optionally under `servers`. |
| Native OpenCode module | `.opencode-plugin/*.{js,mjs,ts}` | OpenCode-specific module; OpenCode adapter installs one selected module and checks JavaScript syntax before install. |

Markdown frontmatter uses the CLI's flat `key: value` parser. It supports quoted scalar values and bare `true`/`false`; it does not implement general YAML features such as nested objects or lists.

Plugin root variables such as `${PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_ROOT}`, `${CURSOR_PLUGIN_ROOT}`, `${CODEX_PLUGIN_ROOT}`, and `${KIMI_PLUGIN_ROOT}` may be translated to the selected target's root variable or resolved managed path by the target adapter.

Component semantics are target-specific. A component being discoverable does not guarantee every target supports it. Installers must report unsupported translations instead of claiming they loaded.

## Discovery

The CLI resolves a supplied repository, then searches in this order:

1. Marketplace index at repository root or under `.plugin/`, `.claude-plugin/`, `.cursor-plugin/`, or `.codex-plugin/`.
2. Plugin at repository root.
3. Plugin directories up to two levels below repository root, skipping hidden directories.

A manifest under `.plugin/plugin.json`, `.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json`, or `.codex-plugin/plugin.json` identifies a plugin. Without a manifest, current discovery recognizes `skills/`, `commands/`, `agents/`, and root `SKILL.md` markers. A manifest-backed plugin may contain only one component.

## Marketplace index

An optional `marketplace.json` contains a `plugins` array. `metadata.pluginRoot` selects the base directory for local `source` paths and defaults to `.`. A local entry can include `name`, `version`, `description`, `source`, and an optional explicit `skills` path list. Explicit skill paths resolve against `pluginRoot`. Non-string `source` values are returned as remote marketplace entries; this CLI does not install those remote entries as part of local discovery.

## OpenCode installation

OpenCode receives a managed copy under `<OpenCode config>/plugins/managed/<name>`. The adapter copies valid skill directories, including their referenced files, to `<OpenCode config>/skills/`; maps MCP, commands, agents, rules, and LSP to OpenCode configuration; translates supported hooks into a generated module; and preserves unrelated user configuration. A plugin-authored `.opencode-plugin/` module takes precedence over generated hook translation. Reinstall replaces CLI-owned entries without duplicating them.

## Format distinction

| Format | Identity manifest | MCP file | Portable components |
| --- | --- | --- | --- |
| Open Plugins 0.1 | `.plugin/plugin.json` | `.mcp.json` | Components listed in this document; target support varies |
| Agent Plugins 1.0 | Root `plugin.json` with canonical `$schema` | Root `mcp.json` with canonical `$schema` | Skills and MCP only |

Do not infer Agent Plugins 1.0 from a root `plugin.json` alone. Do not rename `.mcp.json` to `mcp.json` or reinterpret an Open Plugins manifest as Agent Plugins 1.0 during install.

## References

- [Agent Plugins 1.0 package specification](./AGENT_PLUGINS_1_0.md)
- [OpenCode installation and component coverage, RFC 0011](../.spec/rfc/completed/0011-opencode-install.md)
- [OpenCode component parity, RFC 0019](../.spec/rfc/completed/0019-opencode-component-parity.md)
