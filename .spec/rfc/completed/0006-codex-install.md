# RFC 0006: Codex Plugin Installation (child of 0001)

**Status:** Implemented

**Parent:** [0001](0001-plugin-installer-capabilities.md)

## Summary

Codex installs the known official Vercel plugin through Codex's native marketplace command. Other discovered plugins are staged and translated into Codex plugin metadata before registration.

## Problem

Codex plugin structure and metadata differ from the vendor-neutral source format, so installation requires an adapter and preservation of Codex-specific fields.

## Goals

Specify official-source routing, staging, manifest enrichment, and Codex registration behavior.

## Non-goals

Other target adapters, future Codex formats, and unsupported upstream features.

## Design

`lib/install.ts` recognizes the Vercel repository and invokes `codex plugin add vercel@openai-curated`. Otherwise it stages the repo, prepares `.codex-plugin/plugin.json`, fills missing skills and MCP references, and derives interface metadata from plugin metadata and available icon assets before registering with Codex.

## Acceptance

The official source uses native marketplace routing. Generic sources retain a Codex manifest with supported plugin interface metadata and are registered through Codex's native command.
