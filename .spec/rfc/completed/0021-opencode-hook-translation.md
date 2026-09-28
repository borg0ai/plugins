# RFC 0021: OpenCode Hook Translation (child of 0019)

**Status:** Implemented

**Parent:** [0019](0019-opencode-component-parity.md)

## Summary

Translate a plugin's `hooks/hooks.json` into OpenCode plugin hook implementations instead of ignoring them, and expose the plugin root as an environment variable the translated hooks can rely on.

## Problem

`hooks/hooks.json` is installed for Claude Code, Cursor, Codex, and Grok Build. For OpenCode the hook file is copied into the managed tree and then ignored; the generated adapter implements only `experimental.session.compacting`, which is a context-preservation aid and not a translation of any plugin hook event. A plugin that relies on a `PreToolUse` or `PostToolUse` command hook is therefore installed into OpenCode with its safety behavior silently absent.

## Goals

Map each supported vendor-neutral hook event to a real OpenCode hook, preserve the command and its arguments, and surface events that have no OpenCode equivalent rather than dropping them.

## Non-goals

Translating hook matchers into OpenCode's event model where no equivalent exists, executing hooks at install time, and reimplementing OpenCode's own permission system.

## Design

The generated `<name>-plugin.js` module keeps its existing `experimental.session.compacting` implementation and gains real hook mappings. Available hooks are taken from the installed `@opencode-ai/plugin` `Hooks` interface: `command.execute.before`, `tool.execute.before`, `tool.execute.after`, `shell.env`, `event`, and `chat.message`.

Mapping, for the vendor-neutral event names the plugin format defines:

- `PreToolUse` and `PostToolUse` become `tool.execute.before` and `tool.execute.after`. A Claude-style `matcher` naming a tool is honored by comparing against the hook's `tool` argument; a matcher that names a shell or command surface maps to `command.execute.before` where the event is a command event.
- `SessionStart` has no OpenCode equivalent. The existing adapter already documents this and instead preserves the skill router across `experimental.session.compacting`; that behavior is retained rather than duplicated.
- Any other event is reported at install time as unsupported for this target instead of being written as a no-op.

Translated commands are executed with the plugin root already resolved, so `${PLUGIN_ROOT}` and the other vendors' plugin-root variables are substituted at generation time rather than being left for a shell that will not define them. The module also implements `shell.env` to export the plugin root for tool subprocesses, which is the documented way to make values available to commands OpenCode runs.

Because the module is loaded from `<config>/plugins/`, it is auto-loaded at startup and does not need a `plugin` entry in `opencode.json`. The existing registration stays for idempotence and is harmless.

## Acceptance

A plugin with `PreToolUse` and `PostToolUse` command hooks produces an adapter implementing `tool.execute.before` and `tool.execute.after` that run the declared commands. A `SessionStart` hook does not produce a duplicate or invented mapping. An event with no OpenCode equivalent produces an install-time report naming the event. The generated module contains no unresolved plugin-root variable. Generated adapters are valid JavaScript.
