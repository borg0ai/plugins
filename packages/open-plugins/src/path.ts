/** Last path segment of a path, tolerating a trailing slash. */
export function dirName(p: string): string {
  const parts = p.replace(/\/$/, "").split("/");
  return parts[parts.length - 1] ?? "unknown";
}
