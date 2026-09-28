# RFC 0017: Non-String Frontmatter Coercion

**Status:** Implemented

## Summary

Frontmatter values are only used as text when they are actually strings. Boolean and empty frontmatter values are treated as absent for skill, command, agent, and rule names and descriptions.

## Problem

The flat frontmatter parser coerces bare `true` and `false` to booleans. Consumers previously read `fm.description ?? ""`, so a `description: true` line produced a boolean in a field typed as a string. That boolean was then rendered into the plugin table, serialized into generated marketplace JSON, and passed to `JSON.stringify` as a bare `true` rather than a description.

## Goals

Keep every text field in a normalized plugin record a string, and fall back to a documented default when frontmatter supplies a non-string value.

## Non-goals

A full YAML frontmatter parser, supporting nested or multi-line values, and changing which keys the flat parser recognizes.

## Design

`lib/discover.ts` exports a `frontmatterString` helper that returns the value only when it is a non-empty string, otherwise `undefined`. Every name and description read from frontmatter goes through it, with `??` fallbacks to the directory name or an empty string as appropriate. This includes explicit `skills` lists in a marketplace entry, not just filesystem-discovered skills.

## Acceptance

A skill whose frontmatter is `description: true` reports an empty description rather than a boolean. The same applies to command, agent, and rule descriptions and to any name field. `frontmatterString` returns `undefined` for booleans, empty strings, and absent keys.
