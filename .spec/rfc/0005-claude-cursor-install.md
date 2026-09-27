# RFC 0005: Claude Code and Cursor Installation (child of 0001)

**Status:** Draft

**Parent:** [0001](0001-plugin-installer-capabilities.md)

## Summary

Claude Code and Cursor receive prepared plugin trees through the shared plugin cache layout. Claude Code may use its native marketplace CLI for the official Vercel plugin; Cursor has a Windows extension path and otherwise uses the shared cache.

## Problem

These targets share preparation and cache behavior but have target-specific scope and installation details that affect plugin loading and updates.

## Goals

Record marketplace registration, cache preparation, and Cursor-specific installation paths currently implemented.

## Non-goals

Codex, Grok, Kimi, Copilot, VS Code, OpenCode, and generic plugin discovery.

## Design

`lib/install.ts` first tries Claude's native marketplace flow for the known official source, falling back to direct file installation. Shared installation prepares Claude-compatible plugin directories, copies marketplace content, records marketplace metadata, and installs plugin cache entries. Cursor uses Windows extension installation on Windows and shared plugin-cache installation elsewhere. `stageInstallWorkspace` copies source into a per-target staging tree before vendor metadata preparation.

## Acceptance

Successful installation leaves plugin metadata and files in the native location for the selected target. Claude official-source failure falls back to direct installation. Cursor follows platform-specific routing without changing source files.
