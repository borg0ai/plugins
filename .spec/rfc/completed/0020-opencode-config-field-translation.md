# RFC 0020: OpenCode Config Field Translation (child of 0019)

**Status:** Implemented

**Parent:** [0019](0019-opencode-component-parity.md)

## Summary

Translate a plugin's MCP servers, commands, agents, rules, and LSP servers into the corresponding `opencode.json` configuration fields, preserving unrelated user configuration.

## Problem

Only skills reach OpenCode today. Five components that other targets install are dropped. The current installer also warns that OpenCode has no plugin-scoped LSP registration and tells the user to edit `opencode.json` by hand, which is wrong: `lsp` is a documented configuration field, so the CLI can and should write it.

## Goals

Give every dropped component a verified `opencode.json` destination, keep unrelated configuration intact, and keep plugin-owned entries removable and re-runnable without duplication.

## Non-goals

Translating `hooks/hooks.json` into JavaScript hook modules, which is RFC 0021. Validating skill frontmatter, which is RFC 0022. Editing values a plugin does not define, and reformatting the whole config file.

## Design

`lib/opencode.ts` gains a config translation step that runs before the file is written. Destinations, taken from the installed `@opencode-ai/sdk` `Config` type and the OpenCode docs:

- MCP: `mcp: { [name]: McpLocalConfig | McpRemoteConfig }`. A stdio server becomes `{ type: "local", command: string[], environment?, enabled? }`; an HTTP or SSE server becomes `{ type: "remote", url, headers?, enabled? }`. Server names are namespaced per plugin so two plugins cannot collide.
- Commands: `command: { [name]: { template, description?, agent?, model? } }`, taking the command body as `template`.
- Agents: `agent: { [name]: AgentConfig }`, using `description`, `prompt` from the agent body, and `mode: "subagent"`. AgentConfig accepts `model`, `temperature`, `top_p`, `prompt`, `tools`, `description`, `mode`, `color`, and `permission`; only fields a plugin actually declares are written.
- Rules: `instructions: string[]`, appending the absolute path of each installed rule file. The field is documented as "additional instruction files or patterns to include", which is the faithful destination for rule documents.
- LSP: `lsp: { [name]: { command: string[], extensions?, env?, initialization? } }`.

Plugin root variables such as `${PLUGIN_ROOT}` are resolved to absolute managed paths at translation time for `mcp.environment`, `lsp.env`, and any `command` array, because those fields hold values rather than documents and cannot carry a runtime variable.

Every entry the CLI writes is recorded under a single per-plugin ownership key so a later install can replace that plugin's entries without disturbing other plugins or the user's own entries. An existing `opencode.json` is read, merged, and rewritten, preserving key order and unrelated fields, and leaving a trailing newline as the current implementation does. The inaccurate LSP warning is removed.

## Acceptance

A plugin with MCP servers, commands, agents, rules, and an LSP server produces the corresponding `mcp`, `command`, `agent`, `instructions`, and `lsp` entries in `opencode.json`, each shaped as the SDK types require. Unrelated user keys and user-defined entries for the same fields survive. Installing the same plugin twice does not duplicate entries, and a plugin whose components shrink has its stale entries removed. No warning claims LSP must be configured by hand.
