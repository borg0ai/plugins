/** Shared shapes for discovery, target detection and installation. */
import type { NamedEntry, PluginManifest } from "@borg0ai/open-plugins";

export type { NamedEntry, PluginManifest };

/** One entry of a `marketplace.json` plugins array. */
export interface MarketplaceEntry {
  name?: string;
  description?: string;
  version?: string;
  /** A local path, or a remote descriptor such as `{ source: "github" }`. */
  source: string | Record<string, unknown>;
  skills?: string[];
  [key: string]: unknown;
}

/** Parsed `marketplace.json`, as read from disk. */
export interface Marketplace {
  name?: string;
  metadata?: { pluginRoot?: string };
  plugins: MarketplaceEntry[];
}

/** A plugin resolved on disk, with its components discovered. */
export interface Plugin {
  name: string;
  version?: string;
  description?: string;
  path: string;
  marketplace?: string;
  skills: NamedEntry[];
  commands: NamedEntry[];
  agents: NamedEntry[];
  rules: NamedEntry[];
  hasHooks: boolean;
  hasMcp: boolean;
  hasLsp: boolean;
  manifest: PluginManifest | null;
  explicitSkillPaths?: string[];
  marketplaceEntry?: MarketplaceEntry;
}

/** A marketplace entry whose source is not a path inside this repo. */
export interface RemotePlugin {
  name: string;
  description?: string;
  source: Record<string, unknown>;
}

/** Result of scanning a repository for plugins. */
export interface DiscoverResult {
  plugins: Plugin[];
  remotePlugins: RemotePlugin[];
  missingPaths: string[];
}

/** A supported agent tool, before detection. */
export interface TargetDef {
  id: string;
  name: string;
  description: string;
  configPath: string;
}

/** A supported agent tool, with the result of probing the machine. */
export interface Target extends TargetDef {
  detected: boolean;
}

/** Where a plugin gets installed for a given tool. */
export type Scope = "user" | "project" | "local";

/** Outcome of installing into one target. */
export interface InstallResult {
  succeeded: boolean;
  message?: string;
}

/** A plugin whose path was rewritten into a staging copy of the repo. */
export interface StagedWorkspace {
  repoPath: string;
  plugins: Plugin[];
}

/** One option in the interactive multi-select prompt. */
export interface SelectOption {
  label: string;
  value: string;
  hint?: string;
}

/** A flattened Kimi hook record. */
export interface KimiHook {
  event: string;
  command: string;
  matcher?: string;
  timeout?: number;
}
