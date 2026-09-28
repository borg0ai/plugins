# RFC 0004: Agent Target Detection and Selection (child of 0001)

**Status:** Implemented

**Parent:** [0001](0001-plugin-installer-capabilities.md)

## Summary

The target registry identifies supported tools, their configuration roots, and whether each is detected on the host. Explicit target selection may proceed even when detection returns false.

## Problem

Automatic installation is limited to registered targets that detection recognizes. Missing registry entries or false detection prevent automatic selection even if a tool can consume compatible plugin content.

## Goals

Define the registered target IDs, detection signals, configuration paths, and selection behavior as implemented.

## Non-goals

Implementing Antigravity is tracked in [RFC 0013](../0013-antigravity-install.md). Other new targets, changing native install adapters, and unsupported compatibility claims remain out of scope.

## Design

`lib/targets.ts` registers Claude Code, Cursor, Codex, Grok Build, Kimi Code, GitHub Copilot CLI, VS Code, and OpenCode. Detection uses PATH binaries, except Kimi also probes candidate install paths and OpenCode accepts its config directory. Config roots account for XDG, Windows APPDATA, and VS Code product settings. `index.ts` auto-selects detected targets; `--target` accepts any registered ID and warns when target is not detected. An unregistered ID is rejected with the available IDs.

## Acceptance

`targets` lists every registered ID with detection status and config path. Automatic selection includes detected targets only; explicit selection accepts registered but undetected targets. Antigravity has no registry entry in current source; support criteria live in RFC 0013.
