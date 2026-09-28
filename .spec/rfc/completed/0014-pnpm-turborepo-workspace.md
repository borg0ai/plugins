# RFC 0014: pnpm and Turborepo Workspace

**Status:** Implemented

## Summary

The repository is a pnpm workspace driven by Turborepo, with the published CLI in `apps/cli` and shared compiler and formatting configuration at the root.

## Problem

The CLI was a single package at the repository root with `index.ts` and `lib/*` beside `package.json`. There was no room for a second package without duplicating toolchain config, and no task runner to build, typecheck, or test across packages as a unit.

## Goals

Provide a workspace root that owns shared toolchain configuration and task orchestration, and move the published CLI into `apps/cli` without changing its package name, bin name, or published output.

## Non-goals

Changing CLI behavior, adding a second package, replacing the Vite build with a different bundler, and migrating from pnpm to another package manager.

## Design

`pnpm-workspace.yaml` declares `apps/*` and `packages/*`. The root `package.json` is private and owns `prettier` and `turbo`; `turbo.json` defines `build`, `dev`, `typecheck`, `test`, `test:watch`, `format:check`, and `clean`. `test` depends on `build` because the end-to-end suite spawns the built bundle. `tsconfig.base.json` holds strict compiler options and each package extends it. `apps/cli` keeps the published name `@borg0ai/plugins`, the `opencode-plugins` bin, and its own `tsconfig.json`, `vite.config.ts`, and `test/` directory. The superseded root `tsconfig.json` and `tsup.config.ts` are removed; the build remains a single bundled ESM file at `apps/cli/dist/index.js`.

## Acceptance

`pnpm install`, `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm format:check` all succeed from the repository root. `apps/cli/dist/index.js` is byte-for-byte behaviorally equivalent to the pre-workspace bundle. The published package name and bin path are unchanged.
