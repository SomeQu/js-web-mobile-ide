import { describe, it, expect } from "vitest";
import { normalize, join, dirname, basename, isAbsolute, resolve, segments } from "./path-utils.js";

describe("normalize", () => {
  it("adds leading slash to relative paths", () => {
    expect(normalize("foo/bar")).toBe("/foo/bar");
  });

  it("collapses double slashes", () => {
    expect(normalize("//foo///bar//")).toBe("/foo/bar");
  });

  it("resolves dot segments", () => {
    expect(normalize("/foo/./bar")).toBe("/foo/bar");
  });

  it("resolves double-dot segments", () => {
    expect(normalize("/foo/bar/../baz")).toBe("/foo/baz");
  });

  it("does not go above root", () => {
    expect(normalize("/foo/../../bar")).toBe("/bar");
  });

  it("normalizes root", () => {
    expect(normalize("/")).toBe("/");
  });

  it("strips trailing slash", () => {
    expect(normalize("/foo/bar/")).toBe("/foo/bar");
  });

  it("handles empty string as root", () => {
    expect(normalize("")).toBe("/");
  });
});

describe("join", () => {
  it("joins two segments", () => {
    expect(join("/foo", "bar")).toBe("/foo/bar");
  });

  it("joins multiple segments", () => {
    expect(join("/foo", "bar", "baz")).toBe("/foo/bar/baz");
  });

  it("handles absolute second argument", () => {
    expect(join("/foo", "/bar")).toBe("/foo/bar");
  });
});

describe("dirname", () => {
  it("returns parent directory", () => {
    expect(dirname("/foo/bar")).toBe("/foo");
  });

  it("returns root for top-level path", () => {
    expect(dirname("/foo")).toBe("/");
  });

  it("returns root for root", () => {
    expect(dirname("/")).toBe("/");
  });
});

describe("basename", () => {
  it("returns last segment", () => {
    expect(basename("/foo/bar")).toBe("bar");
  });

  it("returns name for top-level path", () => {
    expect(basename("/foo")).toBe("foo");
  });

  it("returns empty for root", () => {
    expect(basename("/")).toBe("");
  });
});

describe("isAbsolute", () => {
  it("returns true for absolute paths", () => {
    expect(isAbsolute("/foo")).toBe(true);
  });

  it("returns false for relative paths", () => {
    expect(isAbsolute("foo")).toBe(false);
  });
});

describe("resolve", () => {
  it("resolves relative path against base", () => {
    expect(resolve("/foo/bar", "../baz")).toBe("/foo/baz");
  });

  it("returns target if absolute", () => {
    expect(resolve("/foo", "/bar")).toBe("/bar");
  });

  it("resolves relative to directory", () => {
    expect(resolve("/foo/bar", "baz")).toBe("/foo/bar/baz");
  });
});

describe("segments", () => {
  it("splits path into segments", () => {
    expect(segments("/foo/bar/baz")).toEqual(["foo", "bar", "baz"]);
  });

  it("returns empty for root", () => {
    expect(segments("/")).toEqual([]);
  });
});
