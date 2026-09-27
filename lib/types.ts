/** Shared types for discovery, targets, and installation. */

export type SkillEntry = {
  name: string;
  description: string;
};

export type CommandEntry = SkillEntry;
export type AgentEntry = SkillEntry;
export type RuleEntry = SkillEntry;

/** One component of a marketplace entry, as read from marketplace.json. */
export type MarketplaceEntry = {
  name?: string;
  source: string | Record<string, unknown>;
  version?: string;
  description?: string;
  skills?: string[];
  [key: string]: unknown;
};

export type Marketplace = {
  name?: string;
  metadata?: { pluginRoot?: string };
  plugins: MarketplaceEntry[];
};

/** A discovered plugin, with every component the format can carry. */
export type Plugin = {
  name: string;
  version?: string;
  description?: string;
  path: string;
  marketplace?: string;
  skills: SkillEntry[];
  commands: CommandEntry[];
  agents: AgentEntry[];
  rules: RuleEntry[];
  hasHooks: boolean;
  hasMcp: boolean;
  hasLsp: boolean;
  manifest: Record<string, unknown> | null;
  explicitSkillPaths?: string[];
  marketplaceEntry?: MarketplaceEntry;
};

export type Discovered = {
  plugins: Plugin[];
  remotePlugins: { name: string; description?: string; source: unknown }[];
  missingPaths: string[];
};

export type TargetDef = {
  id: string;
  name: string;
  description: string;
  configPath: string;
};

export type Target = TargetDef & { detected: boolean };

export type Scope = "user" | "project" | "local";

export type InstallResult = { succeeded: true } | { succeeded: false; message: string };
