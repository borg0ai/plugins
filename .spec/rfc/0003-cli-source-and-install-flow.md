# RFC 0003: CLI Source and Install Flow (child of 0001)

**Status:** Draft

**Parent:** [0001](0001-plugin-installer-capabilities.md)

## Summary

The CLI accepts local paths, GitHub shorthand, HTTPS URLs, and SSH URLs, then exposes add, discover, and targets commands. Add coordinates discovery, target selection, plugin confirmation, per-target installation results, auto-update choice, and telemetry.

## Problem

Users need one entry point to locate plugin repositories and invoke selected native installers. Source resolution and orchestration define this user-facing lifecycle.

## Goals

Document accepted source forms, command semantics, prompts, failure reporting, and process exit behavior.

## Non-goals

Plugin recognition, target-specific file formats, terminal rendering internals, and target detection policy.

## Design

`index.ts` parses strict CLI options. `add` and shorthand resolve sources, shallow-clone remote repositories into `~/.cache/opencode-plugins`, discover plugins, choose explicit or detected targets, optionally prompt/select plugins, then install targets sequentially. SSH clone permission failures retry through HTTPS. Each target failure is reported; all-target failures set nonzero exit status. `discover` supports `--remote`; `targets` prints detection state. `--yes`, `--scope`, `--target`, and `--debug` control the workflow.

## Acceptance

CLI usage matches supported commands and options. Local and remote source inputs resolve as described; target-specific failures remain visible and produce nonzero status when installation is incomplete.
