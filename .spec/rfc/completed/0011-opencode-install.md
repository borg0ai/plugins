# RFC 0011: OpenCode Plugin Installation (child of 0001)

**Status:** Implemented

**Parent:** [0001](0001-plugin-installer-capabilities.md)

## Summary

OpenCode installation copies each plugin to a managed config directory, copies discovered skills into OpenCode's skills directory, generates a JavaScript adapter for supported behavior, and registers adapter paths in `opencode.json`.

## Problem

OpenCode does not consume the source plugin layout directly. The adapter translates plugin components into OpenCode-loadable modules and config while preserving a managed source tree.

## Goals

Specify OpenCode target detection, config location, managed files, adapter coverage, and limitations.

## Non-goals

AGY or other unregistered tools, general OpenCode upstream compatibility claims, and LSP registration beyond current warning/manual configuration.

## Design

`lib/targets.ts` detects OpenCode from its binary or config directory, using XDG config root or platform defaults. `lib/install.ts` stages plugin files under `<config>/plugins/managed/<name>`, copies skills to `<config>/skills`, emits `<name>-plugin.js` when hooks, commands, agents, MCP, or LSP exist, then registers the adapter in `<config>/opencode.json`. LSP emits a manual-configuration warning. Current README omits OpenCode from the supported-target table despite this implementation.

## Acceptance

OpenCode target appears in target listing; installation creates managed plugin content, skill copies, required adapters, and config registration without deleting unrelated config entries. Unsupported LSP registration is reported. External loading behavior requires validation against the OpenCode version in use.
