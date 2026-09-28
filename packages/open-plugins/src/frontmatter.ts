/** Values a YAML frontmatter block can decode to with the flat parser. */
export type Frontmatter = Record<string, string | boolean>;

/** Parses the flat `key: value` frontmatter block of a markdown file. */
export function parseFrontmatter(content: string): Frontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match?.[1]) return {};

  const result: Frontmatter = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w[\w-]*):\s*(.+)$/);
    if (!kv?.[1] || !kv[2]) continue;

    let val = kv[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }

    if (val === "true") result[kv[1]] = true;
    else if (val === "false") result[kv[1]] = false;
    else result[kv[1]] = val;
  }
  return result;
}

/** Reads a frontmatter value only when it is a non-empty string. */
export function frontmatterString(fm: Frontmatter, key: string): string | undefined {
  const value = fm[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
