# RFC 0018: Rules-Only Plugin Detection

**Status:** Implemented

## Summary

Treat a directory containing only a `rules/` directory as a plugin, so rule-only plugins are discovered rather than skipped.

## Problem

`isPluginDir` in `lib/discover.ts` recognizes a plugin by the presence of a manifest in one of the four supported manifest directories, or by `skills/`, `commands/`, `agents/`, or a root `SKILL.md`. It does not recognize `rules/`. Discovery already reads `rules/` for any plugin it finds by another marker, so rules are supported as a component but not as a sole marker. A plugin that ships only rules is therefore never detected: at the repository root it falls through to the recursive scan, where its single subdirectory is not a plugin either, and the repo reports no plugins.

## Goals

Detect a plugin whose only component is `rules/`, consistent with how `skills/`, `commands/`, and `agents/` are already treated as plugin markers.

## Non-goals

Changing rule parsing, adding rule-file formats, and broadening the recursive scan depth. Manifest directory recognition is unchanged.

## Design

Add `"rules"` to the marker list checked by `isPluginDir`. The marker list stays in one place so the set of recognized plugin shapes is enumerated once. No other discovery or install code changes: `discoverMarkdownDir` already reads `rules/`, and `pluginComponents` already reports a rule count, so a rules-only plugin needs no new rendering or install path. Behavior for directories that contain none of the markers is unchanged.

## Acceptance

A repository whose root contains only `rules/` is discovered as a single plugin with its rules populated. A nested plugin containing only `rules/` is found by the recursive scan. Repositories with no recognized marker still report no plugins, and the existing depth and hidden-directory rules are unchanged.
