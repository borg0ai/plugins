# RFC 0019: OpenCode Component Parity (Umbrella)

**Status:** Implemented

**Type:** Umbrella

## Summary

The OpenCode target currently translates only a plugin's skills and a single compaction hook. This umbrella brings OpenCode to the same component coverage the other targets already have, so a plugin bundle installs into OpenCode as completely as it installs into Claude Code or Codex.

## Problem

Every other target translates the whole plugin bundle: MCP servers, hooks, commands, agents, rules, and LSP servers each land in that agent's native representation. OpenCode does not. Its installer writes skill directories and generates an adapter that implements `experimental.session.compacting` and nothing else, so MCP servers, commands, agents, rules, and LSP servers are silently dropped. It also emits a warning telling the user to register LSP servers manually, which is incorrect: OpenCode has a first-class `lsp` configuration field.

Verified against the installed `@opencode-ai/plugin` and `@opencode-ai/sdk` type definitions and the OpenCode documentation, every dropped component has a real destination. The gap is missing translation, not missing capability.

## Goals

Every component the plugin format defines has a defined, verified OpenCode destination, or an explicit, accurate statement of why not. No component is dropped silently. No user-facing warning asserts a limitation that does not exist.

## Non-goals

Adding or changing OpenCode itself, supporting OpenCode v2-specific surfaces before the installed version is confirmed, generating npm-published OpenCode plugins, and changing how any other target installs.

## Children

| RFC | Concern |
|-----|---------|
| [0022](0022-opencode-skill-metadata-conformance.md) | OpenCode Skill Metadata Conformance |
| [0021](0021-opencode-hook-translation.md) | OpenCode Hook Translation |
| [0020](0020-opencode-config-field-translation.md) | OpenCode Config Field Translation |

## Acceptance

Each child is Implemented and verified. A plugin exercising every component installs into a sandboxed OpenCode config, and each component is observable at its documented destination. Components with no faithful destination state the reason rather than being dropped. The inaccurate LSP warning is gone.
