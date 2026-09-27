# RFC 0010: VS Code Agent Plugin Installation (child of 0001)

**Status:** Draft

**Parent:** [0001](0001-plugin-installer-capabilities.md)

## Summary

VS Code agent plugin installation prepares discovered plugins and registers their paths in user settings under `chat.pluginLocations`.

## Problem

VS Code loads plugins from configured locations; registration must preserve unrelated JSONC settings and existing plugin entries.

## Goals

Document user settings path selection, plugin preparation, JSONC update, and per-user scope.

## Non-goals

Other target settings formats, project/local scopes, and VS Code feature availability claims beyond current source documentation.

## Design

`lib/targets.ts` selects the settings path for Code or Code Insiders across macOS, Windows, and Linux. `lib/install.ts` stages plugin directories, parses JSONC, preserves other root properties and boolean location entries, then enables each installed plugin path in `chat.pluginLocations`.

## Acceptance

Settings retain unrelated values and existing plugin locations, while each installed plugin path is enabled. Per-user installation is the only supported scope for this target.
