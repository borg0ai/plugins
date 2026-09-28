# RFC 0026: Published Invocation Name

**Status:** Implemented

## Summary

Every place the CLI or its documentation tells a user how to invoke it says `npx plugins`, which resolves to an unrelated package on npm. Correct them to `npx @borg0ai/plugins`, the package this repository actually publishes.

## Problem

The published package is `@borg0ai/plugins`, but three surfaces advertise a different command:

- `README.md` shows `npx plugins add`, `npx plugins discover`, and `npx plugins targets` in eight places.
- The CLI prints `npx plugins discover <source> --remote` in four places, as a copy-pasteable hint when a marketplace has remote entries. A user who copies it runs an unrelated package.
- The `pluginify` skill uses `npx plugins` in twelve places, so a generated plugin is verified against the wrong command.

A user following any of these either gets an error or silently runs a different tool.

## Goals

Make every published invocation form name the real package, so a copied command works.

## Non-goals

Renaming the package or the `opencode-plugins` bin. Changing the command name the usage screen displays, which is a separate question about bin naming. Changing any other user-facing wording, and changing what the CLI does.

## Design

Replace `npx plugins` with `npx @borg0ai/plugins` in the README, in the four CLI hint strings, and in the `pluginify` skill. The scope subcommand names, flags, and arguments are unchanged; only the package specifier is corrected.

The CLI's own usage screen keeps its current command spelling. That spelling is a separate inconsistency with the `opencode-plugins` bin name, and changing it would alter more surface than this RFC authorises; it is reported rather than silently fixed.

Because the four hint strings are user-visible output, the behavioural comparison against the pre-TypeScript bundle will differ on exactly those lines. The comparison is updated to normalise the corrected invocation so it keeps proving everything else, and the single intended difference is recorded rather than hidden.

## Acceptance

No file in the repository, the CLI output, or the `pluginify` skill tells a user to run `npx plugins`. Running the corrected form resolves the published package. Every other user-visible string is unchanged, and the comparison against the prior bundle passes once the intended invocation difference is accounted for.
