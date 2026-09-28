# RFC 0003: CLI Source and Install Flow (child of 0001)

**Status:** Implemented

**Parent:** [0001](0001-plugin-installer-capabilities.md)

## Summary

The CLI accepts local paths, GitHub shorthand, HTTPS URLs, and SSH URLs, then exposes add, discover, and targets commands. Add coordinates discovery, target selection, plugin confirmation, per-target installation results, auto-update choice, and telemetry. Source behavior from the supplied bundled CLI must remain available in `index.ts` and supporting `lib/*` modules; newer targets may extend that behavior.

## Problem

Users need one entry point to locate plugin repositories and invoke selected native installers. Source resolution and orchestration define this user-facing lifecycle. Replacing bundled output with source modules must not silently drop existing user-visible behavior.

## Goals

Preserve accepted source forms, command semantics, prompts, failure reporting, remote marketplace visibility during installation, actionable Git clone diagnostics, official-install auto-update behavior, responsive plugin tables, and Codex app metadata translation. Keep current OpenCode and other target support as additive capabilities.

## Non-goals

Plugin recognition, target-specific file formats, terminal rendering internals, and target detection policy.

## Design

`index.ts` parses strict CLI options. `add` and shorthand resolve sources, shallow-clone remote repositories into `~/.cache/plugins`, discover plugins, choose explicit or detected targets, optionally prompt/select plugins, then install targets sequentially. SSH clone permission failures retry through HTTPS. Each target failure is reported; all-target failures set nonzero exit status. `discover` supports `--remote`; `targets` prints detection state. `--yes`, `--scope`, `--target`, and `--debug` control the workflow. Preserve bundled CLI behavior that reports remote marketplace entries and missing paths during `add`, gives actionable clone failure categories, avoids enabling marketplace auto-updates after official native CLI installation, truncates table descriptions to terminal width, and prints a newline after non-TTY confirmation. Preserve Codex `.app.json` registration in `enrichForCodex`.

## Acceptance

CLI usage matches supported commands and options. Local and remote source inputs resolve as described; target-specific failures remain visible and produce nonzero status when installation is incomplete. Bundled CLI behaviors named in Goals remain present. Codex manifests with `.app.json` retain their `apps` reference. Added target support does not remove or alter them; existing cache contents remain untouched.
