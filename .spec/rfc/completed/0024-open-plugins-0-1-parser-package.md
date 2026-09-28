# RFC 0024: Open Plugins 0.1 Parser Package

**Status:** Implemented

## Summary

Extract Open Plugins 0.1 format recognition and parsing from the CLI into `packages/open-plugins`, preserving current discovery and installation behavior while keeping repository traversal and target-specific installation in the CLI.

## Problem

The CLI currently mixes Open Plugins 0.1 manifest parsing, component discovery, repository scanning, and target installation. This makes the format contract hard to reuse and causes format-specific logic to spread through CLI code. The repository already documents Open Plugins 0.1 as a distinct format identified by `.plugin/plugin.json` and `.mcp.json`; its parser should own that contract.

OpenCode support already translates supported Open Plugins 0.1 components through its target adapter (RFCs 0019–0022). This RFC preserves that behavior while moving only format parsing behind a package boundary.

## Goals

- Create `packages/open-plugins` as the owner of Open Plugins 0.1 manifest and component parsing.
- Preserve Open Plugins 0.1 manifest fields and component discovery currently consumed by the CLI.
- Keep repository cloning, marketplace traversal, plugin selection, target detection, and installation orchestration in `apps/cli`.
- Keep target-specific conversion, including OpenCode translation, inside target adapters.
- Preserve existing Open Plugins 0.1 CLI behavior and supported targets.

## Non-goals

- Supporting Agent Plugins 1.0; RFC 0028 owns that format.
- Moving repository traversal or target installation into the parser package.
- Changing Open Plugins 0.1 schemas, discovery rules, target behavior, or installed file layouts.
- Adding new OpenCode features or changing RFCs 0019–0022 behavior.

## Design

Add a workspace package at `packages/open-plugins` with types and pure parsing functions for `.plugin/plugin.json` and Open Plugins 0.1 component metadata. The package accepts a plugin directory and returns a format-specific parsed record; it does not clone repositories, enumerate marketplaces, read agent configuration, or write files.

Refactor `apps/cli/lib/discover.ts` to retain repository and marketplace traversal, identify Open Plugins 0.1 plugin roots, and call the package parser. Keep the CLI's normalized `Plugin` record as the boundary consumed by existing target installers. Adapt only the mapping between parsed Open Plugins data and that record. Existing target adapters continue to own conversion and installation, including `apps/cli/lib/opencode.ts`.

Keep workspace dependency wiring consistent with the existing pnpm/Turborepo setup. The CLI build must bundle the workspace package into the published executable so users do not need to install an extra runtime package.

## Acceptance

- `packages/open-plugins` parses `.plugin/plugin.json` and supported Open Plugins 0.1 components without importing CLI modules.
- Parsing returns explicit, typed results and actionable errors for malformed manifests; repository traversal remains in the CLI.
- CLI discovery produces equivalent normalized plugin records for existing Open Plugins 0.1 fixtures, including marketplace entries and standalone plugin roots.
- Existing component fields remain available to all target adapters; OpenCode translation and other target behavior remain unchanged.
- Workspace build bundles the parser package into the CLI artifact.
- Package and CLI tests cover valid manifests, malformed manifests, optional component directories, and compatibility with existing discovery behavior.
