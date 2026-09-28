import { describe, expect, it } from "vitest";
import { frontmatterString, parseFrontmatter } from "../src/frontmatter";

describe("parseFrontmatter", () => {
  it("reads flat key/value pairs and strips quotes", () => {
    const fm = parseFrontmatter(
      ["---", "name: my-skill", 'description: "Does a thing"', "---", "body"].join("\n"),
    );
    expect(fm).toEqual({ name: "my-skill", description: "Does a thing" });
  });

  it("coerces bare true/false to booleans", () => {
    const fm = parseFrontmatter(
      ["---", "enabled: true", "disabled: false", "name: x", "---"].join("\n"),
    );
    expect(fm.enabled).toBe(true);
    expect(fm.disabled).toBe(false);
    expect(fm.name).toBe("x");
  });

  it("strips quotes before coercing, so quoted true/false also becomes a boolean", () => {
    expect(parseFrontmatter(["---", 'flag: "true"', "---"].join("\n")).flag).toBe(true);
  });

  it("handles CRLF line endings", () => {
    const fm = parseFrontmatter(["---", "name: crlf", "---", "body"].join("\r\n"));
    expect(fm.name).toBe("crlf");
  });

  it("returns an empty object when there is no frontmatter", () => {
    expect(parseFrontmatter("# Just a heading\n")).toEqual({});
  });
});

describe("frontmatterString", () => {
  it("returns string values", () => {
    expect(frontmatterString({ name: "alpha" }, "name")).toBe("alpha");
  });

  it("treats booleans and empty strings as absent", () => {
    expect(frontmatterString({ description: true }, "description")).toBeUndefined();
    expect(frontmatterString({ description: false }, "description")).toBeUndefined();
    expect(frontmatterString({ description: "" }, "description")).toBeUndefined();
    expect(frontmatterString({}, "description")).toBeUndefined();
  });
});
