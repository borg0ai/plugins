# RFC 0028: Agent Plugins 1.0 Parser Package

**Status:** Draft

## Summary

Add `packages/agent-plugins` to recognize, validate, and parse Agent Plugins 1.0 packages; keep repository discovery and target installation in the CLI, and hand parsed data to target adapters through the CLI's normalized plugin record.

## Problem

Agent Plugins 1.0 uses a different contract from Open Plugins 0.1: root `plugin.json` with the canonical Agent Plugins schema identifies the package, and root `mcp.json` contains standard MCP server definitions. The CLI currently does not discover or install this format. Putting its manifest and component rules directly in CLI discovery would entangle a second format with repository traversal and Open Plugins 0.1 parsing.

RFC 0024 establishes `packages/open-plugins` as the Open Plugins 0.1 parser boundary. Agent Plugins 1.0 needs its own package so each parser owns one schema and neither format is guessed from shared component names.

## Goals

- Create `packages/agent-plugins` as the owner of Agent Plugins 1.0 manifest and component parsing.
- Recognize Agent Plugins 1.0 only when root `plugin.json` declares the canonical schema; parse MCP from root `mcp.json`.
- Preserve schema-defined fields needed by target adapters, including skills and MCP server definitions.
- Keep repository traversal, marketplace resolution, format selection, plugin selection, and install orchestration in `apps/cli`.
- Feed parsed output into the existing normalized CLI plugin record and target adapters.
- Support Agent Plugins 1.0 through OpenCode while preserving Open Plugins 0.1 behavior.

## Non-goals

- Changing or merging the Open Plugins 0.1 schema or parser; RFC 0024 owns it.
- Moving repository traversal, target detection, or file installation into either format package.
- Treating Open Plugins 0.1-only commands, hooks, agents, rules, or LSP as portable Agent Plugins 1.0 components.
- Changing other target adapters unless required to consume the normalized parsed record without losing existing behavior.
- Defining or replacing the upstream Agent Plugins 1.0 specification.

## Design

Add `packages/agent-plugins` as a workspace package with schema-specific types, format detection, validation, and pure parsing functions. Its input is one candidate package directory; its output is an explicit parsed Agent Plugins 1.0 record. It may read the package's manifest and declared fixed-location components, but it does not walk repositories, resolve marketplaces, select targets, mutate source files, or install files. Invalid recognized packages return actionable diagnostics; unrelated root `plugin.json` files are not classified as Agent Plugins 1.0.

Refactor `apps/cli/lib/discover.ts` to orchestrate per-package format detection and call the matching parser: `packages/open-plugins` for `.plugin/plugin.json`, `packages/agent-plugins` for root `plugin.json` with the canonical schema. Format selection occurs per plugin directory, including marketplace entries. Each package parser maps to the existing normalized CLI `Plugin` record, which remains the stable input to target installers. Keep target-specific conversion in adapters; `apps/cli/lib/opencode.ts` maps Agent Plugins skills and standard MCP definitions into OpenCode-native locations/configuration.

Use upstream Agent Plugins 1.0 schemas as normative validation sources. Preserve source metadata and report unsupported standard components or malformed MCP entries; do not silently reinterpret an Agent Plugins manifest as Open Plugins 0.1. When both manifests exist in one directory, canonical Agent Plugins schema selects that parser once, preventing duplicate installation of shared skills or MCP.

Wire the package through pnpm workspace metadata and bundle it into the CLI artifact using the existing build configuration. The parser package must not become a required separately installed runtime dependency.

## Acceptance

- `packages/agent-plugins` detects only root manifests with the canonical Agent Plugins 1.0 schema and parses schema-defined manifest fields, skills metadata, and root `mcp.json`.
- Package parsing is independent of CLI modules and repository traversal; malformed recognized packages produce actionable errors.
- CLI discovers Agent Plugins 1.0 packages, including MCP-only packages, in standalone roots, nested repository scans, and marketplace entries.
- Mixed repositories retain format identity per package; Open Plugins 0.1 packages continue through `packages/open-plugins` and preserve current behavior.
- The normalized CLI plugin record carries all fields needed by target adapters without format guessing or data loss.
- OpenCode installs Agent Plugins skills to its supported skills location and converts supported MCP server definitions into valid native configuration while preserving unrelated user settings.
- Unsupported target components are reported clearly and are not falsely reported as installed.
- Workspace build bundles `packages/agent-plugins` into the CLI artifact without requiring users to install a separate parser package.
- Package and CLI tests cover canonical and unrelated manifests, malformed manifest/MCP data, mixed-format repositories, marketplace discovery, and OpenCode installation behavior.
