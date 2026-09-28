# RFC 0001: Plugin Installer Capabilities (Umbrella)

**Status:** Implemented

**Type:** Umbrella

## Summary

This umbrella indexes the CLI's current plugin features and proposed target integrations. Child RFCs separate existing behavior contracts from future target work.

## Problem

The repository contains multiple independently implemented features but no RFC history. A single umbrella provides one index without mixing target-specific behavior into one specification.

## Goals

Completion means every existing-feature child has a source-based contract and every proposed-target child has explicit acceptance criteria. No child may imply external compatibility without validation.

## Non-goals

Other future targets, unrelated bug fixes, and external compatibility claims are out of scope; track them in a separate RFC.

## Children

| RFC | Concern |
|-----|---------|
| [0023](../rejected/0023-posthog-telemetry.md) | PostHog CLI Telemetry |
| [0012](0012-telemetry-and-terminal-ui.md) | Telemetry and Terminal Interaction |
| [0011](0011-opencode-install.md) | OpenCode Plugin Installation |
| [0010](0010-vscode-install.md) | VS Code Agent Plugin Installation |
| [0009](0009-copilot-install.md) | GitHub Copilot CLI Installation |
| [0008](0008-kimi-install.md) | Kimi Code Plugin Installation |
| [0007](0007-grok-install.md) | Grok Build Plugin Installation |
| [0006](0006-codex-install.md) | Codex Plugin Installation |
| [0005](0005-claude-cursor-install.md) | Claude Code and Cursor Installation |
| [0004](0004-target-detection.md) | Agent Target Detection and Selection |
| [0003](0003-cli-source-and-install-flow.md) | CLI Source and Install Flow |
| [0002](0002-plugin-discovery.md) | Plugin Discovery and Manifest Parsing |

## Acceptance

The umbrella may close when all children meet their Goals criteria. Do not reopen it for unrelated future target support.
