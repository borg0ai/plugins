# RFC 0022: OpenCode Skill Metadata Conformance (child of 0019)

**Status:** Implemented

**Parent:** [0019](0019-opencode-component-parity.md)

## Summary

Validate each skill's name and description against OpenCode's documented requirements before copying it into the OpenCode skills directory, so an invalid skill is reported instead of being silently ignored by OpenCode.

## Problem

The installer copies every discovered skill to `~/.config/opencode/skills/<name>/SKILL.md`. OpenCode documents strict requirements for that directory, and the current installer satisfies none of them:

- `name` must match `^[a-z0-9]+(-[a-z0-9]+)*$`, be 1 to 64 characters, and equal the name of the directory containing `SKILL.md`.
- `description` is required and must be 1 to 1024 characters.

Discovery normalizes a missing description to an empty string, and skill names come from plugin frontmatter or a directory name, so a skill named `My_Skill`, `v2.0`, or one with no description is copied into place and then never appears in OpenCode's `skill` tool. The install reports success, so the failure is invisible. This is the one component whose destination path is already correct, but whose content may be unusable.

## Goals

Reject or report skills that OpenCode cannot load, keep the rest working exactly as they do today, and keep the rule in one place so it applies wherever skills are installed.

## Non-goals

Rewriting a plugin author's skill to make it conform, changing the flat frontmatter parser, and applying OpenCode's rules to other targets. Names are not silently rewritten, because a rename would break the name-to-directory match and diverge from what the plugin author declared.

## Design

`lib/opencode.ts` gains a validation step applied to each skill before it is copied, driven by the documented constraints: the name pattern and length, the name equalling the destination directory, and a non-empty description within the length limit. A skill that fails is skipped and reported by name and reason, naming the specific rule it violates, so the plugin author can fix it. Skills that pass are copied to `~/.config/opencode/skills/<name>/SKILL.md`, which is a documented global discovery location.

The check is OpenCode-specific and lives in the OpenCode installer. It reads the same normalized skill records the rest of the pipeline uses, so it does not re-parse frontmatter or widen the plugin record shape. A skill carrying a `license` or `compatibility` field keeps it, since both are recognized optional fields.

## Acceptance

A skill with a valid name and non-empty description is copied and loadable. A skill whose name contains uppercase, underscores, dots, or consecutive hyphens, or whose name does not match its directory, is skipped and reported by name with the violated rule. A skill with an empty or over-length description is skipped and reported. One invalid skill does not prevent other skills or other components from installing, and the command still exits successfully while reporting what was skipped.
