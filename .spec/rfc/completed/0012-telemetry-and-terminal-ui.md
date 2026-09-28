# RFC 0012: Telemetry and Terminal Interaction (child of 0001)

**Status:** Implemented

**Parent:** [0001](0001-plugin-installer-capabilities.md)

## Summary

The CLI renders terminal progress, warnings, errors, and interactive plugin selection. Anonymous install telemetry is sent asynchronously unless environment or CI policy disables it.

## Problem

Terminal interaction communicates multi-target progress and supports plugin selection; telemetry reports install events under explicit opt-out and CI suppression rules.

## Goals

Record terminal interaction behavior and telemetry event fields and opt-out conditions.

## Non-goals

Installation semantics, target discovery, additional analytics, and changes to data collection policy.

## Design

`lib/ui.ts` provides ANSI-aware progress and selection UI, disabling color for non-TTY or `NO_COLOR`; `--debug` controls diagnostic output. `lib/telemetry.ts` suppresses events only when `DISABLE_TELEMETRY` or `DO_NOT_TRACK` is set, and posts install event data asynchronously to the configured telemetry endpoint. CI environments are detected but not suppressed: a `ci=1` parameter is attached so the endpoint can filter automated runs. The event contains source, plugin names/count, successful targets, and scope.

## Acceptance

TTY and non-TTY output remain readable, selection returns chosen plugin IDs, and telemetry is not sent when `DISABLE_TELEMETRY` or `DO_NOT_TRACK` is set. CI runs still send a `ci=1` tagged event. Install completion does not wait for telemetry delivery.
