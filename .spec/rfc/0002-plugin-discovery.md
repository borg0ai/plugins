# RFC 0002: Plugin Discovery and Manifest Parsing (child of 0001)

**Status:** Draft

**Parent:** [0001](0001-plugin-installer-capabilities.md)

## Summary

Discovery returns local plugin records from marketplace indexes, a plugin at repository root, or nested plugin directories. It recognizes `.plugin`, `.claude-plugin`, `.cursor-plugin`, `.codex-plugin`, skill, command, agent, and root `SKILL.md` markers.

## Problem

Installation depends on finding plugin components and reading optional metadata. Discovery rules determine which directories install and which manifest fields supply names, versions, descriptions, and component paths.

## Goals

Specify deterministic source scanning and normalized plugin records, including marketplace entries with local and remote sources.

## Non-goals

Target detection, source cloning, target translation, installation, and new manifest formats.

## Design

`lib/discover.ts` checks marketplace files first, then the repository root, then scans subdirectories to depth two while skipping hidden directories. Marketplace `metadata.pluginRoot` defaults to `.`. String sources resolve locally; non-string sources are returned as remote entries; missing local paths are reported. Component metadata comes from manifests and conventional component directories. Markdown metadata uses a minimal flat YAML frontmatter parser. The normalized shape is `Plugin` in `lib/types.ts`.

## Acceptance

Discovery output identifies all matching local plugins, remote marketplace entries, and missing local source paths. Manifest and component paths in returned records resolve to the selected plugin. Supported manifest directories and scan depth match source behavior.
