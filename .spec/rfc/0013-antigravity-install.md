# RFC 0013: Google Antigravity Plugin Installation

**Status:** Draft

## Summary

Add Google Antigravity as an install target. Antigravity ships a native plugin
system — a `agy` CLI with a `plugin` subcommand tree, a plugin directory under
`~/.gemini/config/plugins/`, and an enablement registry in
`~/.gemini/config/config.json`. Install open-plugin format repositories into it by
copying the plugin tree into Antigravity's own layout, writing the manifest and
version marker its loader expects, and registering the plugin. Components
Antigravity does not implement are reported, never presented as installed.

## Problem

The CLI has no Antigravity target. `selectTargets` rejects `antigravity` as an
unknown target, auto-detection never selects it, and `installPluginsUnsafe` has
no `antigravity` branch. Users therefore cannot install plugins into Antigravity
with this CLI even though Antigravity has a first-class plugin system that
understands most of what the open-plugin format already expresses.

A prior assumption that Antigravity's plugin support is speculative turned out to
be wrong, and the opposite risk is now the live one: inventing a config format for
a target that already has a documented, on-disk one would produce an installer
that writes plausible-looking files Antigravity never reads.

## Goals

Register Antigravity as a detectable and explicitly selectable target. Install
plugin components Antigravity actually implements, through its real layout. Report
every component Antigravity does not implement, and report install failures
instead of claiming success. Preserve unrelated content in the files the installer
touches.

## Non-goals

Changes to OpenCode or other existing adapters. Changes to plugin discovery in
`lib/discover.ts`. Supporting plugin-scoped `rules`, which Antigravity does not
implement. Installing to a per-project or per-local Antigravity location.
Publishing to, or installing from, an Antigravity plugin marketplace. Modifying
`~/.gemini/settings.json`, which is shared with the Gemini CLI and is outside the
plugin surface this RFC covers.

## Design

### Investigation

The Design section of the original draft required investigating Antigravity's
plugin interface before choosing install paths. That investigation was performed
against a real Antigravity installation rather than against documentation, and
the findings below are the basis for every decision in this section.

**Native CLI.** Antigravity ships `agy`, whose plugin subcommand tree is
`list`, `import`, `install <target>`, `uninstall`, `enable`, `disable`,
`validate [path]`, and `link`. `install` accepts `plugin@marketplace` as well as
a local directory.

**Component contract.** `agy plugin validate <dir>` requires `<dir>/plugin.json`
and reports the component set it recognises:

```
[ok] /path/to/chrome-devtools-plugin
    ✔ skills      : 5 processed
    - agents      : skipped (not found)
    - commands    : skipped (not found)
    - mcpServers  : skipped (not found)
    - hooks       : skipped (not found)
```

The recognised set is `skills`, `agents`, `commands`, `mcpServers`, `hooks`.
There is no `rules` component. This is the load-bearing finding: it is the
authoritative answer to which open-plugin components can be installed, and it
came from the target itself rather than from inference.

**On-disk layout.** Verified against the three plugins actually installed on the
investigating machine:

- Plugin root: `~/.gemini/config/plugins/`
- Per plugin: `plugin.json` with `name`, `version`, `description`, `author`,
  `license`, `keywords`, `repository`; `installed_version.json` containing
  `{"version": "..."}`; `skills/<skill>/SKILL.md`; optional `policies/*.toml`;
  optional `gemini-extension.json`
- Enablement registry: `~/.gemini/config/config.json`, shaped
  `{"plugins": {"<name>": {"enabled": true}}}`

**Related but out of scope.** Global rules live at `~/.gemini/<ideName>/GEMINI.md`
and `~/.gemini/GEMINI.md`; workspace rules at `.agents/rules/` with `.agent/rules/`
as an accepted alternate. Workflows, which are Antigravity's analogue of
commands, live at `~/.gemini/<ideName>/global_workflows/` and
`.agents/workflows/`. MCP servers are configured outside plugins, in
`~/.gemini/config/mcp_config.json` and `~/.gemini/settings.json`. None of these
are plugin-scoped, so none of them are install destinations for this RFC.

**Detection signals.** `Antigravity IDE.app` is a VS Code fork with application
name `antigravity-ide` and extension directory `~/.antigravity/extensions`. A
separate Electron shell keeps user data in
`~/Library/Application Support/Antigravity`, and IDE state in
`~/.gemini/antigravity-ide/`. All of these are under `$HOME`.

### Skills are the direct path

`skills/<name>/SKILL.md` is the same convention the open-plugin format already
uses, and `plugin.json` carries the same `name`/`version`/`description` fields
`lib/discover.ts` already reads. Skills and manifest therefore need no
translation, only a copy and a registration.

### Install mechanism

Prefer the native CLI, fall back to direct file writes.

When `agy` is on PATH, invoke `agy plugin install <dir>` against a staged
workspace, reusing the existing `runNativeCommand` helper so a failure surfaces
as an `InstallResult` failure with the command's stderr attached. When `agy` is
absent, the installer performs the equivalent itself: copy the plugin tree to
`~/.gemini/config/plugins/<name>/`, write `installed_version.json`, and register
the plugin in `config.json`.

The fallback is not a lesser path. It is the same mechanism the Claude Code,
Cursor and VS Code adapters already use — write the target's real files directly —
and it is what makes the target work on machines that have the IDE but not the
CLI. The CLI is preferred only because delegating lets Antigravity own its own
bookkeeping when it is available.

Plugins are staged through the existing `stageInstallWorkspace` before either
path runs, so an install survives the user deleting their checkout, and
`preparePluginDirForVendor(plugin, ".plugin", "PLUGIN_ROOT")` supplies or
synthesises the `plugin.json` that `agy plugin validate` requires.

### Registration without clobbering

`config.json` is shared with the Gemini CLI and already holds non-plugin keys
such as `userSettings`. The installer reads it, sets
`plugins.<name>.enabled = true` for each installed plugin, and writes the result
back, leaving every other key untouched. A `config.json` that exists but cannot
be parsed is reported as a failure and left alone, following the treatment
`installToPluginCache` already gives an unreadable `settings.json`. Overwriting
an unparseable file with a fresh object would silently destroy the user's other
settings.

### Unsupported components

`rules` is not in Antigravity's component set. A plugin carrying `rules/`
installs its supported components and emits a warning naming the rules that were
not installed. Rules are not relocated to `~/.gemini/<ideName>/GEMINI.md`:
that file is global memory rather than a plugin artefact, and merging into it
would need an ownership ledger to avoid accumulating duplicates across
reinstalls. The same reasoning excludes `lsp`, which discovery reports via
`hasLsp` but Antigravity does not implement.

### Scope

Every Antigravity path is under `$HOME`, so the target joins `PER_USER_ONLY` in
`install.ts` and a non-`user` scope request warns and is ignored, matching the
existing behaviour of grok, kimi, github-copilot, vscode and opencode.

### Files

- `lib/targets.ts` — register the `antigravity` definition with config path
  `~/.gemini/config`, and detect it from `agy` or `antigravity` on PATH, an
  existing `~/.gemini/config/config.json`, or the macOS Antigravity app directory
- `lib/install.ts` — add `antigravity` to `PER_USER_ONLY`, add the dispatch
  branch, and add `installToAntigravity`
- `test/antigravity.test.ts` — install and registration tests against a temporary
  `HOME`
- `test/targets.test.ts` — extend with the new definition and detection
- `index.ts` — help text
- `README.md` — target table

## Acceptance

`plugins targets` lists `antigravity` with its config path and a detection
result derived from the signals above. `plugins add <source> --target
antigravity` installs into a real Antigravity layout: the plugin tree lands under
`~/.gemini/config/plugins/<name>/`, contains a `plugin.json` that
`agy plugin validate` accepts, carries an `installed_version.json`, and is
registered as enabled in `config.json`. The same install succeeds with `agy`
absent from PATH. A `config.json` containing unrelated keys keeps them intact
afterwards, and an unparseable `config.json` is reported rather than replaced.

A plugin with `skills/`, `commands/`, `agents/`, `.mcp.json` and
`hooks/hooks.json` installs all of them. A plugin with `rules/` or `.lsp.json`
installs its supported components and warns, by component name, about what was
not installed. An install failure, including a non-zero `agy plugin install`,
produces a failure result carrying the underlying message.

Validation is performed against a real Antigravity installation on this machine —
`agy plugin validate` run over the installed result, and the resulting
`config.json` diffed against the pre-install file — and not only through
generated-file assertions. Tests that redirect `HOME` to a temporary directory
remain, but they do not by themselves satisfy this criterion.
