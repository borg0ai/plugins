# Agent Plugins 1.0 Package Specification

This document records the Agent Plugins 1.0 package contract for this repository. It is an implementation reference, not a replacement for the [upstream specification](https://agent-plugins.org/specification), which remains normative.

The CLI currently supports the older Open Plugins 0.1 layout. Agent Plugins 1.0 discovery and installation are not implemented yet; this document defines the format boundary for that work.

## Package layout

An Agent Plugins 1.0 package has one root manifest and optional fixed-location components:

```text
my-plugin/
  plugin.json
  skills/
    summarize/
      SKILL.md
      scripts/
      references/
  mcp.json
  com.example.client/
```

`plugin.json` identifies the package and declares the specification schema. `skills/` contains Agent Skills. `mcp.json` contains MCP server configuration. A reverse-domain directory such as `com.example.client/` is reserved for client-specific extensions and is outside the portable core.

## Manifest

`plugin.json` must be a JSON object containing:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "my-plugin"
}
```

`$schema` and `name` are required. The manifest schema is closed. Allowed optional fields: `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`, and `extensions`. Clients must report and ignore unknown top-level fields; other manifest schema violations reject the package.

The `name` is 1–64 characters, uses lowercase ASCII letters, digits, hyphens, and periods, starts and ends with an alphanumeric character, and contains no consecutive `--` or `..`.

## Skills

Skills live under `skills/`. Each immediate child directory containing `SKILL.md` is one skill; clients must not recursively search for more skills. Skill content and metadata follow the [Agent Skills specification](https://agentskills.io/specification).

An invalid skill is skipped independently; it does not invalidate other skills or MCP servers. OpenCode installation must also enforce OpenCode's own skill-loading requirements and report skills it cannot load.

## MCP servers

`mcp.json` lives at package root. It must contain exactly `$schema` and `mcpServers` at top level:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "validator": {
      "type": "stdio",
      "command": "./bin/validator",
      "args": ["--config", "${PLUGIN_ROOT}/config.json"],
      "env": { "MODE": "strict" },
      "cwd": "${PLUGIN_ROOT}"
    },
    "deployment-api": {
      "type": "streamable-http",
      "url": "https://deploy.example.com/mcp"
    }
  }
}
```

The canonical schema is `https://agent-plugins.org/schemas/1.0.0/mcp.schema.json`. `mcpServers` maps names to one of these closed transport variants:

| Transport | Required fields | Optional fields |
| --- | --- | --- |
| `stdio` | `type`, `command` | `args`, `env`, `cwd` |
| `streamable-http` | `type`, `url` | `headers` |
| `sse` | `type`, `url` | `headers`; client support is optional |

`stdio.command` is one executable token, not a shell command. A package-relative command starts with `./` and resolves under the package root. Omitted `cwd` means package root. Clients must reject paths that escape the package root.

Clients provide `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` to stdio servers. Expand these placeholders in `args`, `env` values, and `cwd`; do not expand them in `command`, remote URLs, or HTTP headers. `${PLUGIN_DATA}` identifies a client-managed writable directory that persists across plugin updates.

Invalid server entries are isolated: skip and report the invalid server while continuing to load valid servers and skills. Do not put credentials in package headers; authentication is client-managed.

## Open Plugins 0.1 compatibility

Open Plugins 0.1 is a separate legacy layout, not an earlier Agent Plugins manifest revision:

| Format | Manifest marker | MCP configuration |
| --- | --- | --- |
| Open Plugins 0.1 | `.plugin/plugin.json` | `.mcp.json` |
| Agent Plugins 1.0 | Root `plugin.json` with canonical `$schema` | Root `mcp.json` with canonical `$schema` |

Keep format detection per plugin package. A root `plugin.json` without the Agent Plugins schema marker does not identify Agent Plugins 1.0. Do not silently rename files or reinterpret a 0.1 manifest as a 1.0 manifest. Existing Open Plugins 0.1 packages must remain discoverable and installable while Agent Plugins 1.0 support is added.

## OpenCode mapping

An OpenCode adapter maps standard components into OpenCode's native format:

- Copy each valid skill directory, including referenced files, under OpenCode's `skills/` directory.
- Map `stdio` MCP servers to OpenCode local servers: `command` plus `args` becomes the command array; `env` becomes `environment`; preserve `cwd` when valid.
- Map `streamable-http` servers to OpenCode remote servers, preserving URL and headers.
- Report `sse` servers as unsupported unless the installed OpenCode configuration contract can represent their transport faithfully.
- Resolve package-relative paths and `${PLUGIN_ROOT}` against the managed package copy. Provide a stable per-plugin data directory for `${PLUGIN_DATA}` or report the server as unsupported; never leave required placeholders unresolved.
- Namespace server names by plugin and update only entries owned by this CLI. Preserve unrelated user configuration and make repeat installs idempotent.

Open Plugins 0.1-only components such as commands, hooks, agents, rules, and LSP remain governed by the existing legacy adapter. They are not Agent Plugins 1.0 portable components.

## Upstream references

- [Agent Plugins 1.0 specification](https://agent-plugins.org/specification)
- [Manifest requirements](https://agent-plugins.org/plugin-authors/manifest)
- [MCP configuration requirements](https://agent-plugins.org/plugin-authors/mcp-servers)
- [Agent Skills specification](https://agentskills.io/specification)
