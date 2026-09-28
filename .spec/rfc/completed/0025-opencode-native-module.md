# RFC 0025: OpenCode Native Plugin Module

**Status:** Implemented

## Summary

Let a plugin ship a native OpenCode module in `.opencode-plugin/`. When present, the CLI installs that module instead of generating a hook adapter, so a plugin author can use the whole OpenCode plugin API rather than only what a generic translation can express.

## Problem

The OpenCode installer always generates `<plugin-name>-plugin.js` itself. A plugin that ships its own OpenCode module is ignored, and if it happens to use the generated filename it is silently overwritten, which is data loss rather than a missing feature.

This matters because translation has a hard ceiling. RFC 0020 through 0022 cover `mcp`, `command`, `agent`, `instructions`, `lsp`, skills, and two tool hook events. The real OpenCode plugin API also offers custom tools via the `tool` hook, workspace adapters via `experimental_workspace.register`, `auth` and `provider` hooks, roughly thirty `event` types, `chat.params`, `chat.headers`, `permission.ask`, `experimental.chat.system.transform`, and `experimental.text.complete`. No translator covers that intersection; only a plugin author writing OpenCode directly can.

The plugin format already has this convention. `.claude-plugin/`, `.codex-plugin/`, `.kimi-plugin/`, and `.cursor-plugin/` are vendor-named directories. `.opencode-plugin/` is the missing member of that family and is not currently recognised.

## Goals

Recognise `.opencode-plugin/` as a plugin marker and manifest directory, install a plugin-authored OpenCode module alongside the CLI's own generated output, and never destroy or silently overwrite an author's file.

## Non-goals

Suppressing the generated hook adapter when a native module is present. Replacing the automatic translation of hooks, skills, commands, agents, MCP servers, rules, or LSP servers. Supporting the separate Agent Plugins 1.0 layout, which is RFC 0024. Editing or linting the author's module beyond a syntax check. Bundling a module's npm dependencies.

## Design

A native module is additive, not a replacement. The CLI keeps generating and installing its own `<plugin-name>-plugin.js` from `hooks.json` exactly as in RFC 0021, and keeps translating skills, commands, agents, MCP servers, rules, and LSP servers as in RFC 0020 and 0022. A plugin's `hooks.json` is an explicit statement by its author, and dropping it because the plugin also ships a native module would silently disable declared behaviour, which is the failure this whole effort exists to remove. OpenCode loads every file in `<config>/plugins/`, so both are live.

The cost of that choice is that a plugin which implements the same tool hooks in both places would run them twice. That is the author's own doing and the rule is simple to state: implement a hook natively and do not also declare it in `hooks.json`. To make the footgun visible, the installer warns, without blocking, when the native module's text also mentions `tool.execute.before` or `tool.execute.after` while `hooks.json` declares tool hooks.

`.opencode-plugin/` is added to the manifest directory list in `lib/discover.ts`, which makes it a recognised plugin marker and a readable `plugin.json` source, and to the marketplace search paths. A module is any `.js`, `.mjs`, or `.ts` file in that directory, excluding `plugin.json`. When several are present the lexicographically first is installed and the rest are reported, so the choice is deterministic rather than filesystem-dependent.

Before installation the module is validated by running `node --check` against a `.mjs` copy of its final contents. A module that fails to parse aborts that plugin's OpenCode install with an error naming the file and the syntax error, and nothing is written. A module that cannot start OpenCode is worse than a missing feature, so this is a hard failure rather than a warning.

The module is installed to `<config>/plugins/<plugin-name>-opencode.js`, a name that cannot collide with the generated adapter. If that path is already occupied by a file the CLI did not write, the install fails rather than overwriting. The CLI never writes over a plugin-authored module.

Two conveniences are provided so an author does not have to hardcode an absolute path. Any `${PLUGIN_ROOT}` or sibling vendor variable in the module text is rewritten to the managed absolute path, matching what the CLI already does for JSON config. A short preamble is prepended declaring a module-scope `const PLUGIN_ROOT = "<managed path>";`, so author code that references `PLUGIN_ROOT` resolves to the staged location without importing anything. Both are best-effort text operations; the syntax check runs on the final, rewritten text so a rewrite can never produce an unparseable module.

When no native module is present, behaviour is unchanged from RFC 0020 to 0022.

## Acceptance

A plugin containing `.opencode-plugin/my.js` installs that file to `<config>/plugins/<name>-opencode.js`. A plugin with both `hooks.json` and a native module ends up with both `<name>-plugin.js` and `<name>-opencode.js` installed, and the tool hooks declared in `hooks.json` still work. A plugin with a native module and no `hooks.json` gets only the native module. A module that also implements tool hooks while `hooks.json` declares them produces a non-blocking warning naming the duplication. A module that fails `node --check` aborts the plugin's install with a message naming the file, and no file is written. A module referencing `${PLUGIN_ROOT}` is rewritten to the managed path, the installed file parses, and `PLUGIN_ROOT` resolves to the managed directory. An existing non-CLI file at the destination path is not overwritten; the install reports the conflict. A plugin whose only content is `.opencode-plugin/` is discovered as a plugin.
