# RFC 0023: PostHog CLI Telemetry (child of 0001)

**Status:** Rejected

**Parent:** [0001](../completed/0001-plugin-installer-capabilities.md)

## Rejection

Rejected after implementation, and the implementation has since been removed. The
decision was to ship no analytics at all rather than to keep an opt-out mechanism
for a collector that was never enabled.

The integration was unconfigured: `isEnabled()` returned false whenever
`POSTHOG_PROJECT_API_KEY` was absent, so no event was ever delivered and no project
key was ever provisioned. That left a permanent runtime dependency, an environment
variable users had to discover, six tests, and a privacy surface, all in service of
a feature that was inert by default. Removing it restores the package's zero-runtime-
dependency property and leaves the CLI with no network calls of its own.

Deleting telemetry also removes the `DISABLE_TELEMETRY` and `DO_NOT_TRACK`
variables. `DO_NOT_TRACK` is a published convention, so if analytics is ever
reintroduced under a different design it should honour that standard again rather
than treat it as already handled.

## Summary

Replace the hand-built Vercel telemetry request with PostHog's official Node SDK. Preserve the existing install event contract, opt-outs, CI annotation, and non-fatal behavior.

## Problem

`apps/cli/lib/telemetry.ts` posts query-string events to a custom endpoint. It has no PostHog SDK integration, region configuration, SDK queue handling, or explicit flush before the short-lived CLI exits.

## Goals

Use `posthog-node` to capture current install events. Read project key from `POSTHOG_PROJECT_API_KEY`, allow `POSTHOG_HOST` override with PostHog US ingestion host as default, disable telemetry when key is absent or existing opt-out variables are set, retain `ci=1` property for detected CI, and flush best-effort before process exit without turning analytics failure into command failure.

## Non-goals

Adding new analytics events or user identity, changing collected event fields, removing opt-out variables, changing install behavior, or adding a custom proxy/backend.

## Design

Add the official `posthog-node` dependency to `apps/cli/package.json`. Its current major requires Node `^20.20.0 || >=22.22.0`. The package's `engines.node` is raised to `>=22.22.0` rather than pinning an older major, because Node 20 reached end of life in April 2026 and declaring support for it would promise an unmaintained runtime; the README's claim of zero runtime dependencies is corrected at the same time.

Refactor `apps/cli/lib/telemetry.ts` to construct a PostHog client from environment configuration, and capture the existing event properties plus version and CI annotation. Tracking becomes asynchronous and is awaited from `apps/cli/index.ts` after install results are known. All telemetry exceptions stay swallowed.

Delivery uses `captureImmediate`, not `capture` followed by a shutdown call. In the current SDK major the only shutdown method is `_shutdown`, which is underscore-prefixed and therefore not public API; relying on it would make the CLI hostage to an internal rename. The CLI sends exactly one event and then exits, so `captureImmediate` is the matching primitive: it sends immediately and resolves once the event is delivered, with no queue to flush and no shutdown to await. Client construction still sets `flushAt: 1` so a queued event is never lost if the process is cut short.

The environment-variable documentation and the telemetry tests are updated with the implementation.

## Acceptance

With a configured test key and a mocked PostHog client, install emits one event carrying the existing fields, the CLI version, and the CI annotation. A missing key, `DISABLE_TELEMETRY`, or `DO_NOT_TRACK` emits no event and constructs no client. Delivery is awaited, and a capture failure does not change the install's exit status. No event contains a new field or user identity, and the client is constructed with an anonymous per-process identifier rather than anything derived from the user or machine. The package's declared `engines.node` matches the SDK's requirement.
