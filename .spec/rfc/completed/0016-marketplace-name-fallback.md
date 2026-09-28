# RFC 0016: Marketplace Name Empty-Source Fallback

**Status:** Implemented

## Summary

`deriveMarketplaceName` returns `plugins` for a source that yields no usable path segment, instead of returning an empty string.

## Problem

The final fallback split the source on `/` and returned the last segment. For an empty or segment-free source that segment was the empty string, which is nullish-coalesced but not nullish, so `?? "plugins"` never fired. The result was an empty marketplace name, which propagated into `known_marketplaces.json`, cache directory paths, and every `<plugin>@<marketplace>` reference.

## Goals

Guarantee a non-empty, filesystem-safe marketplace name for every source form the CLI accepts.

## Non-goals

Changing the naming scheme for valid sources, deduplicating marketplaces across sources, and handling sources that resolve to a name that already exists.

## Design

`deriveMarketplaceName` in `lib/install.ts` keeps its existing precedence: GitHub shorthand becomes `owner-repo`, then SSH URLs, then https URLs use the last two path segments, then a local path uses its directory name. Only the final fallback changes from `??` to a truthiness check so an empty segment yields `plugins`.

## Acceptance

`deriveMarketplaceName("")` returns `plugins`. All previously correct forms are unchanged, including the trailing-slash local path case. A derived name is never the empty string.
