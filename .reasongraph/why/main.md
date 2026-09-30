# Why: main

<!-- reasongraph:v1 generated 2026-09-30 — review before sharing; edit freely, edits are preserved -->

## Intent
Rebuild `.spec` RFCs from the plugins codebase so feature coverage and install-target gaps (including OpenCode and Antigravity) are documented before any implementation changes.

## Decisions

### Scaffold `.spec` and deliver RFCs from existing implementation
Status: directed
Touches: `.spec/`, `.spec/ROADMAP.md`, `.spec/TASK_TRACKING.md`, `.spec/rfc/*`

The agent initialized the missing `.spec` tree via `specify init` (next id `0001`) and rebuilt RFCs from the current code surface instead of treating an unproven install-failure root cause as fact. All RFCs stayed `Draft`; no implementation files were edited.

### Split feature coverage into one umbrella plus eleven single-concern child RFCs
Status: discussed
Touches: `.spec/rfc/*`, `.spec/ROADMAP.md`, `.spec/TASK_TRACKING.md`

Feature scope was broken into one overview umbrella and eleven child RFCs covering discovery, CLI, target detection, install adapters, terminal interaction, and telemetry. The split follows the one-RFC-one-concern rule so install-target and adapter work stay independently reviewable.

Considered/rejected: A single mega-RFC bundling unrelated install and CLI concerns was rejected because it would mix acceptance criteria and drift from the specify umbrella/child convention.

### Record OpenCode as implemented in code but omitted from README support table
Status: discussed
Touches: `.spec/rfc/*`, `README*`

Code inspection showed an OpenCode detect/install adapter already exists, while the README supported-targets table did not list OpenCode. RFCs capture that documentation gap without asserting a specific runtime failure cause from code alone.

### Treat Antigravity (AGY) as unsupported pending a dedicated install RFC
Status: directed
Touches: `.spec/rfc/0013-antigravity-install.md`, `.spec/rfc/*`, `.spec/ROADMAP.md`, `.spec/TASK_TRACKING.md`

After clarifying AGY means Google Antigravity, the agent added RFC 0013 for Antigravity plugin install and updated the target-detection and umbrella RFCs. The RFC states there is no current target registration and that install mechanics must be verified against Antigravity’s real interface before claiming support.

Risk: Documenting a future adapter before the host API is confirmed could bake incorrect install paths into later implementation if the RFC is approved without that verification.
Reviewer attention: Confirm RFC 0013 and linked detection/umbrella text do not imply Antigravity is already installable.

### Keep validate/sync-check green and block implementation until RFC approval
Status: discussed
Touches: `.spec/rfc/*`, `.spec/ROADMAP.md`, `.spec/TASK_TRACKING.md`

After delivery, the agent ran RFC validation and `sync-check` with no errors (initially twelve RFCs; Antigravity added afterward with the same checks passing). Implementation remains gated on explicit RFC review outcomes rather than delivery alone.

### Prefer skills-first OpenCode support before full plugin-component mapping
Status: discussed
Touches: `.spec/rfc/0011-*.md`

OpenCode research found the installer copies skills and generates a plugin module, but the generated module only implements `experimental.session.compacting`, while commands, agents, MCP, and LSP trigger generation without real wiring. The recommended path is to make skills reliably discoverable first (correct `SKILL.md` layout, frontmatter/name checks, no silent overwrite), then map only hooks that OpenCode’s plugin API truly supports and report unsupported components instead of false success.

Considered/rejected: Jumping straight to full plugin-component conversion was weighed as broader but deferred because unverified mappings would report install success while features remain inert.
Risk: Skills-only scope leaves commands/agents/MCP/LSP non-functional on OpenCode until later RFCs expand mapping.
Reviewer attention: Confirm RFC 0011 is rewritten with these gaps and acceptance criteria before any adapter code changes.

### Fix OpenCode config path and JSONC handling as part of install correctness
Status: discussed
Touches: `.spec/rfc/0011-*.md`

Current config handling builds only default XDG/APPDATA paths and rewrites the whole file as JSON, which can miss custom OpenCode config locations and strip JSONC comments/formatting. Any OpenCode support plan should address custom config paths and JSONC-safe updates, with acceptance based on skill discovery, plugin load, and hook invocation in a real OpenCode session—not merely generated files existing.

Risk: Naive JSON rewrite can destroy user comments or alternate config layouts.

### Flag shell-injection and unsafe scope handling in the reviewed installer bundle
Status: discussed
Touches: `index.ts`, `lib/install.ts`

The reviewed bundle clones remotes via shell-string `execSync` with the source URL embedded, and Claude official install similarly interpolates `--scope` into a shell command. Both were judged high risk; the preferred fix is argument-array `execFileSync` plus runtime allowlisting of scope to `user|project|local`.

Considered/rejected: Leaving string-based `execSync` was rejected because quoted user-controlled URLs and scope values can break out of the shell.
Risk: Unpatched clones or scope flags remain command-injection surfaces.
Reviewer attention: Confirm install and clone paths never pass user-controlled strings through a shell.

### Treat missing OpenCode target wiring as a hard install gap in the reviewed bundle
Status: discussed
Touches: `lib/targets.ts`, `lib/install.ts`

The reviewed bundle's `TARGET_DEFS` and `installPluginsUnsafe` switch omit OpenCode, so `--target opencode` and auto-detect cannot reach an installer. Adapter or README changes alone cannot make that bundle installable into OpenCode.

Risk: Callers may assume OpenCode works when only discovery or docs mention it.

### Avoid destructive Kimi cleanup by prefix matching
Status: discussed
Touches: `lib/install.ts`

Kimi post-install cleanup that deletes skills and MCP servers by plugin-name prefix was judged unsafe because unrelated user entries can share a prefix. Cleanup should remove only installer-owned exact records.

Risk: Prefix-based cleanup can delete user skills or MCP config outside the install.

### Do not report Copilot marketplace registration success on swallowed errors
Status: discussed
Touches: `lib/install.ts`

Capturing marketplace-add failures and still printing success hides real install failures. Registration should distinguish already-present from hard failure and only claim success on a real success path.

Reviewer attention: Verify Copilot install fails or warns when marketplace registration actually fails.

### Replace plugin-cache destinations on reinstall instead of overlay copy
Status: discussed
Touches: `lib/install.ts`

Direct `cp` into an existing versioned cache directory can mix stale and new files across reinstalls. Cache writes should replace or clear the destination before copy.

Risk: Stale cached plugin files can load after updates.

### Treat the pasted bundle as a different lineage from current lib sources
Status: directed
Touches: `lib/targets.ts`, `lib/install.ts`, `index.ts`

Side-by-side comparison showed the pasted build is not the same as workspace `lib/*`: OpenCode presence, Cursor/Windows install paths, cache layout, CLI messaging, and telemetry versioning diverge. Similarity of logic does not imply the paste is fully covered by `lib/*`.

### Require lib/apps CLI behavior to be a functional superset of the pasted bundle
Status: directed
Touches: `apps/cli/*`, `lib/*`, `index.ts`, `.spec/rfc/0003-cli-source-and-install-flow.md`

Version number parity was explicitly deprioritized; the requirement is that every paste-era install/discover UX behavior remain available while newer targets may add features. RFC 0003 captured restore items: remote/missing path hints on `add`, classified git-clone errors, and official-CLI auto-update skip semantics, without deleting or migrating existing on-disk caches.

Considered/rejected: Treating OpenCode-only additions as proof of full paste coverage was rejected; coverage is judged by preserved paste behaviors, not by extra targets.
Risk: Divergent cache roots mean old `~/.cache/plugins` data is unused by a newer cache path without migration.
Reviewer attention: Confirm paste-era CLI behaviors remain present after source moves into `apps/cli`.

### Keep OpenCode as a first-party installer concern, not delegated to npx skills
Status: directed
Touches: `apps/cli/lib/targets.ts`, `apps/cli/lib/install.ts`, `apps/cli/lib/opencode.ts`, `test/opencode.test.ts`

External `npx skills` does not install into OpenCode. After the CLI moved under `apps/cli`, OpenCode target/adapter code and `lib/opencode` were missing while tests still expected them, so OpenCode support must live in this repo's installer. Partial skill discovery without install/mapping is insufficient.

Risk: Install can report success while commands, agents, MCP, rules, or root `SKILL.md` are not actually registered in OpenCode.
Reviewer attention: Confirm OpenCode target registration, adapter module, and component install paths exist and are covered by tests.

### Specify PostHog-backed CLI telemetry via RFC 0023
Status: directed — RFC delivered and plan presented; implementation gated on approval
Touches: `apps/cli/lib/telemetry.ts`, `.spec/rfc/0023-*.md`

Telemetry should use official `posthog-node`, keep existing event fields/CI/opt-out flags, flush/shutdown before process exit, and fail open so telemetry errors do not change CLI exit status. Project key comes from env (`POSTHOG_PROJECT_API_KEY`, optional host override); absent key disables telemetry. A prior telemetry RFC was already Implemented, so a new RFC was used instead of reopening it.

Considered/rejected: Reopening archived RFC 0012 was rejected in favor of a dedicated PostHog RFC after an id collision with an OpenCode umbrella.

### Treat Agent Plugins 1.0 as a packaging convention, not automatic cross-agent runtime
Status: discussed
Touches: `apps/cli/lib/discover.ts`, `apps/cli/lib/install.ts`

Upstream Agent Plugins 1.0 standardizes discovery of skills and MCP via root `plugin.json`, `skills/`, and `mcp.json`; commands/hooks/agents remain client-defined. Listed launch clients did not include OpenCode, so OpenCode loading still depends on this repo's adapter, not format compliance alone.

### Deliver RFC 0024 for dual Open Plugins 0.1 and Agent Plugins 1.0 conformance
Status: directed — RFC validated; implementation not started in this transcript portion
Touches: `.spec/rfc/0024-opencode-agent-plugins-conformance.md`, `apps/cli/lib/discover.ts`, `apps/cli/lib/types.ts`, `apps/cli/lib/opencode.ts`

RFC 0024 defines two supported manifest patterns: Open Plugins 0.1 at `.plugin/plugin.json`, and Agent Plugins 1.0 at root `plugin.json` only when it matches the 1.0 schema. Discovery/install should accept both while retaining legacy layout compatibility. Preferred approach is first-class recognition in discover/install rather than an OpenCode-only side entrance that leaves normal discovery incomplete.

Considered/rejected: An OpenCode-only conversion entrypoint was weighed and rejected because standard plugins would still be missed by ordinary discovery.
Reviewer attention: Confirm both manifest paths are specified with clear schema gates and legacy compatibility acceptance criteria.

### Standardize install pipeline as clone, format-identify, then target install
Status: directed
Touches: `apps/cli/index.ts`, `apps/cli/lib/discover.ts`, `apps/cli/lib/install.ts`

The intended end-to-end flow is: clone the given plugin repo, search and classify the bundle format (Open Plugins 0.1 vs Agent Plugins 1.0), then install into the selected agent target. Format identification is a required step before target-specific install mapping.

Reviewer attention: Verify discover classifies both formats before any target install path runs.

### Identify plugin format per discovered plugin, not once per repository
Status: discussed
Touches: `.spec/rfc/0024-open-plugins-0-1-parser-package.md`, `apps/cli/lib/discover.ts`

Format detection must run for each discovered plugin package so one repository can mix Open Plugins 0.1 and Agent Plugins 1.0. A single whole-repo format judgment would misclassify mixed layouts.

Reviewer attention: Confirm discovery and RFC acceptance criteria require per-plugin format selection.

### Support both formats via a format-adapter layer feeding a shared OpenCode installer
Status: discussed
Touches: `apps/cli/lib/discover.ts`, `apps/cli/lib/opencode.ts`, `docs/OPENG_PLUGINS_0_1.md`, `docs/AGENT_PLUGINS_1_0.md`

Open Plugins 0.1 is recognized by `.plugin/plugin.json` with MCP from `.mcp.json`; Agent Plugins 1.0 requires a root `plugin.json` whose `$schema` is the Agent Plugins 1.0 canonical schema, with MCP from `mcp.json`. Each format is read and validated separately into a unified internal plugin record that keeps a format tag and source paths; manifests are not merged. The shared installer converts components into OpenCode targets. Agent Plugins portable components are limited to Skills and MCP; existing Open Plugins commands, hooks, agents, rules, and LSP conversion stay on the 0.1 path. Agent Plugins MCP transports such as stdio and streamable-http must not reuse the old `.mcp.json` parser unchanged.

Considered/rejected: Separate full installers per format were rejected because they would duplicate OpenCode config merge, idempotent update, and error-handling logic.
Risk: Unsupported Agent Plugins MCP transports need an explicit reporting path when OpenCode cannot host them.

### Prioritize completing Open Plugins 0.1 support before Agent Plugins 1.0 implementation
Status: directed
Touches: `apps/cli/lib/opencode.ts`, `apps/cli/lib/discover.ts`, `docs/AGENT_PLUGINS_1_0.md`, `README.md`

Open Plugins 0.1 OpenCode install and component conversion already exist via prior RFCs, so that path is kept as the working compatibility line. Agent Plugins 1.0 work in this stretch focuses on project specs and status documentation rather than finishing a second installer first.

### Add uppercase format specs and link both from README
Status: directed
Touches: `docs/OPENG_PLUGINS_0_1.md`, `docs/AGENT_PLUGINS_1_0.md`, `README.md`

Open Plugins 0.1 needed its own contract doc matching the discoverer and installer, not only an Agent Plugins 1.0 doc. Specs use uppercase filenames `OPENG_PLUGINS_0_1.md` and `AGENT_PLUGINS_1_0.md`, and README links both so format differences and current support status are discoverable.

### Extract format parsing into packages/open-plugins and packages/agent-plugins
Status: discussed
Touches: `packages/open-plugins`, `packages/agent-plugins`, `apps/cli/lib/discover.ts`, `apps/cli/lib/opencode.ts`

Format recognition, validation, and parsing should leave the CLI so new formats do not keep expanding CLI branches. `packages/open-plugins` owns Open Plugins 0.1 inputs; `packages/agent-plugins` owns Agent Plugins 1.0 inputs; both emit a shared plugin record. CLI keeps clone/search orchestration and target installers; parser packages must not know OpenCode config paths or write install files. Existing `packages/*` workspace and Vite bundling allow private workspace packages without extra runtime installs for users.

Considered/rejected: CLI-only modules under apps/cli/lib/formats were rejected because parsers would stay CLI-bound and harder to reuse or evolve independently.

### Split mixed dual-format RFC into 0024 for 0.1 and 0028 for 1.0 with package boundaries
Status: directed
Touches: `.spec/rfc/0024-open-plugins-0-1-parser-package.md`, `.spec/rfc/0028-agent-plugins-1-0.md`

RFC 0024 previously mixed both formats, so it is scoped to the Open Plugins 0.1 parser package and RFC 0028 covers the Agent Plugins 1.0 parser package, each with separate acceptance criteria. Both RFCs document the same boundary: format packages parse and validate; CLI discovers and orchestrates install; target adapters convert; parsers do not traverse repositories or install files. RFCs remain Draft after validation and sync-check.

### Treat Open Plugins 0.1 doc mismatches as P1 implementation defects vs P2 doc or limitation gaps
Status: directed
Touches: `docs/OPENG_PLUGINS_0_1.md`, `apps/cli/lib/opencode.ts`, `apps/cli/lib/discover.ts`

Static review found the Open Plugins 0.1 doc does not fully match current code. Config parse failure continuing with an empty object and then overwriting the file, plus native-module reinstall ownership/conflict bugs, are classified as implementation defects. Native modules and generated hooks installing together, incomplete discovery markers including `.opencode-plugin/*` and bare `rules/`, silent skips for unconvertible MCP/LSP, and skill-path install mismatches are classified as documentation fixes or explicit limitation statements. No code or tests were changed in that review pass.

Risk: Failed OpenCode config parse can overwrite user config; reinstall and dual-module hooks paths can corrupt ownership or run hooks twice.
Reviewer attention: Confirm whether P2 items should change code to match the doc or narrow the doc to current behavior before further 0.1 work.
