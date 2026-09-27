# RFC 0013: Google Antigravity Plugin Installation (child of 0001)

**Status:** Draft

**Parent:** [0001](0001-plugin-installer-capabilities.md)

## Summary

Add Google Antigravity as an install target so users can install discovered plugins into its supported plugin or extension mechanism. Current source has no Antigravity target or installer.

## Problem

The CLI currently rejects Antigravity as an unknown target, and auto-detection cannot select it. Users therefore cannot use this CLI to install plugins into Antigravity.

## Goals

Register Antigravity as a detectable and explicitly selectable target, then install compatible plugin components through a verified native mechanism. Unsupported plugin components must be reported instead of silently presented as installed.

## Non-goals

Changes to OpenCode or other existing adapters, changes to source plugin discovery, and support claims for components that Antigravity does not expose.

## Design

Investigate Antigravity's current plugin interface and configuration contract before choosing install paths or conversion rules. Then add target detection/config resolution in `lib/targets.ts`, dispatch and native installation in `lib/install.ts`, and user-facing target documentation. Reuse common discovery records from `lib/types.ts`; do not copy a foreign target's config format without evidence. Keep target install scope consistent with capabilities verified from Antigravity itself.

## Acceptance

The CLI lists Antigravity and detects an installed instance using verified signals. `--target antigravity` installs supported plugin components through its documented native interface; unrelated configuration is preserved. Missing/unsupported components and install failures are reported. Validate against a real Antigravity installation, not only generated-file assertions.
