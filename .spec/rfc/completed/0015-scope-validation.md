# RFC 0015: CLI Scope Flag Validation

**Status:** Implemented

## Summary

`--scope` accepts only `user`, `project`, or `local`. An unrecognized value is rejected before any target installation runs, with the valid values listed.

## Problem

`--scope` was parsed as a free-form string and passed straight through to the installer. A typo such as `--scope nonsense` was accepted silently and written into generated install records, leaving a corrupt scope on disk with no diagnostic. The pre-TypeScript bundle had the same defect.

## Goals

Fail fast on an unknown scope, name the accepted values, and exit nonzero without touching any agent configuration.

## Non-goals

Adding new scope values, warning when a target silently ignores the requested scope, and validating `--target` beyond what already happens.

## Design

`index.ts` holds a `SCOPES` list and a `resolveScope` helper that defaults to `user`, reports `Unknown scope: <value>` with the available values, and exits 1. Validation runs after target selection and before `selectPlugins`, so no confirmation prompt or installation is reached. Targets whose native plugin systems are per-user only already warn and ignore a non-`user` scope; that behavior is unchanged and is specified in RFC 0005.

## Acceptance

`--scope nonsense` exits 1, prints the unknown value and the valid list, and leaves no install artifacts. `user`, `project`, and `local` are accepted. Omitting the flag still defaults to `user`.
