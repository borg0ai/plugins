# RFC 0007: Grok Build Plugin Installation (child of 0001)

**Status:** Draft

**Parent:** [0001](0001-plugin-installer-capabilities.md)

## Summary

Grok Build installation uses `grok plugin install`. A single root Claude-format plugin from a remote source can install directly; other layouts are staged and prepared with Grok's compatibility manifest root.

## Problem

Grok's native installer and Claude-format compatibility determine which source forms can be passed directly and which require adaptation.

## Goals

Document direct-source routing, staged fallback, native invocation, and idempotent already-installed handling.

## Non-goals

Other target adapters and any claim that every plugin component is supported by Grok.

## Design

`lib/install.ts` passes through a remote source only when discovery found exactly one plugin at repository root with `.claude-plugin/plugin.json`. Otherwise it stages the plugin, prepares `.claude-plugin` metadata and `CLAUDE_PLUGIN_ROOT`, then invokes `grok plugin install <source> --trust`. An already-installed error is treated as success.

## Acceptance

Eligible root plugin sources use native source installation. Other plugin layouts use staged compatibility metadata. Native errors other than already-installed are surfaced as target failures.
