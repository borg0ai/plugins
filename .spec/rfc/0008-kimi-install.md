# RFC 0008: Kimi Code Plugin Installation (child of 0001)

**Status:** Draft

**Parent:** [0001](0001-plugin-installer-capabilities.md)

## Summary

Kimi Code installation stages a Kimi-compatible plugin, copies it into Kimi's managed plugin root, and atomically updates `plugins/installed.json`. Skills, commands, MCP, and command hooks receive compatibility metadata.

## Problem

Kimi's native store and supported component set differ from the source plugin format; registration must preserve installed records and warn about unsupported agents and LSP servers.

## Goals

Specify Kimi metadata translation, managed copy, record update, and compatibility cleanup behavior.

## Non-goals

Other target adapters and support for Kimi agents or LSP servers.

## Design

`lib/install.ts` prepares `.kimi-plugin/plugin.json` and environment references, translates `.mcp.json` servers and command hooks, and copies plugin files to `$KIMI_CODE_HOME/plugins/managed/<id>` (default `~/.kimi-code`). It preserves existing enabled/install timestamps and optional capabilities/GitHub metadata, writes a temporary installed-record file, then renames it into place. It removes matching legacy compatibility entries. Agent or LSP presence emits a warning.

## Acceptance

Managed files and installed records agree on plugin root and ID. Existing metadata is preserved where supported. A malformed installed record fails without replacing it; unsupported agents/LSP are reported.
