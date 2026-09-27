/** Anonymous install telemetry. Disable with DISABLE_TELEMETRY or DO_NOT_TRACK. */

const TELEMETRY_URL = "https://plugins-telemetry.labs.vercel.dev/t";

let cliVersion: string | null = null;

export function setVersion(version: string): void {
  cliVersion = version;
}

function isCI(): boolean {
  return !!(
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.CIRCLECI ||
    process.env.TRAVIS ||
    process.env.BUILDKITE ||
    process.env.JENKINS_URL ||
    process.env.TEAMCITY_VERSION
  );
}

function isEnabled(): boolean {
  return !process.env.DISABLE_TELEMETRY && !process.env.DO_NOT_TRACK;
}

export function track(data: Record<string, string | undefined>): void {
  if (!isEnabled()) return;
  try {
    const params = new URLSearchParams();
    if (cliVersion) params.set("v", cliVersion);
    if (isCI()) params.set("ci", "1");
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null) params.set(key, String(value));
    }
    void fetch(`${TELEMETRY_URL}?${params.toString()}`).catch(() => {});
  } catch {
    /* telemetry must never break a command */
  }
}
