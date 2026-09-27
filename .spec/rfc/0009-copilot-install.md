# RFC 0009: GitHub Copilot CLI Installation (child of 0001)

**Status:** Draft

**Parent:** [0001](0001-plugin-installer-capabilities.md)

## Summary

GitHub Copilot CLI installation registers a marketplace and installs each plugin by marketplace reference. Repositories without a recognized marketplace manifest receive a staged marketplace generated from discovered plugins.

## Problem

Copilot expects marketplace registration and plugin references; arbitrary plugin directories need a marketplace wrapper before native installation.

## Goals

Describe marketplace reuse or generation, registration, and plugin installation routing.

## Non-goals

Standalone legacy `gh copilot`, other target adapters, and general discovery semantics.

## Design

`lib/install.ts` recognizes root, `.github/plugin`, and `.claude-plugin` marketplace manifests. Without one, it stages the source, prepares plugin roots, and writes a `.claude-plugin/marketplace.json` containing discovered plugin references. It then invokes `copilot plugin marketplace add` and installs each `<plugin>@<marketplace>` reference.

## Acceptance

Existing recognized marketplaces are registered from source. Other discovered plugins are exposed through generated marketplace metadata. Registration and installation errors remain visible to the CLI caller.
