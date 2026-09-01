import { describe, expect, it } from "vitest";
import path, {
  basename,
  delimiter,
  dirname,
  extname,
  format,
  isAbsolute,
  join,
  normalize,
  parse,
  posix,
  relative,
  resolve,
  sep,
} from "./path.js";

describe("path.join", () => {
  it("joins simple segments", () => {
    expect(join("a", "b")).toBe("a/b");
  });

  it("joins absolute segments", () => {
    expect(join("/a", "b", "c")).toBe("/a/b/c");
  });

  it("normalizes .. while joining", () => {
    expect(join("/a", "..", "b")).toBe("/b");
  });
});

describe("path.resolve", () => {
  it("resolves relative onto absolute", () => {
    expect(resolve("/a", "b")).toBe("/a/b");
  });

  it("stops at the last absolute segment", () => {
    expect(resolve("/a", "/b")).toBe("/b");
  });

  it("resolves against / when nothing absolute is given", () => {
    expect(resolve("a", "b")).toBe("/a/b");
  });

  it("resolves with no args to /", () => {
    expect(resolve()).toBe("/");
  });
});

describe("path.normalize", () => {
  it("collapses duplicate slashes and ..", () => {
    expect(normalize("/a//b/../c")).toBe("/a/c");
  });

  it("collapses . segments", () => {
    expect(normalize("a/./b")).toBe("a/b");
  });

  it("normalizes empty string to .", () => {
    expect(normalize("")).toBe(".");
  });
});

describe("path.isAbsolute", () => {
  it("true for leading slash", () => {
    expect(isAbsolute("/a")).toBe(true);
  });

  it("false otherwise", () => {
    expect(isAbsolute("a")).toBe(false);
  });
});

describe("path.relative", () => {
  it("computes sibling relative path", () => {
    expect(relative("/a/b", "/a/c")).toBe("../c");
  });

  it("returns empty string for identical paths", () => {
    expect(relative("/a/b/c", "/a/b/c")).toBe("");
  });
});

describe("path.dirname", () => {
  it("returns everything before the last slash", () => {
    expect(dirname("/a/b/c")).toBe("/a/b");
  });

  it("returns / for top-level paths", () => {
    expect(dirname("/a")).toBe("/");
  });
});

describe("path.basename", () => {
  it("returns the last segment", () => {
    expect(basename("/a/b/c.txt")).toBe("c.txt");
  });

  it("strips a matching extension suffix", () => {
    expect(basename("/a/b/c.txt", ".txt")).toBe("c");
  });
});

describe("path.extname", () => {
  it("returns the extension", () => {
    expect(extname("file.txt")).toBe(".txt");
  });

  it("returns empty string when there is no extension", () => {
    expect(extname("file")).toBe("");
  });

  it("returns empty string for dotfiles", () => {
    expect(extname(".hidden")).toBe("");
  });
});

describe("path.parse", () => {
  it("decomposes a path into parts", () => {
    expect(parse("/home/user/file.txt")).toEqual({
      root: "/",
      dir: "/home/user",
      base: "file.txt",
      ext: ".txt",
      name: "file",
    });
  });
});

describe("path.format", () => {
  it("prefers dir/base when present", () => {
    expect(format({ root: "/", dir: "/home/user", base: "file.txt" })).toBe(
      "/home/user/file.txt",
    );
  });

  it("falls back to root/name+ext when dir/base absent", () => {
    expect(format({ root: "/", name: "file", ext: ".txt" })).toBe("/file.txt");
  });
});

describe("path constants", () => {
  it("sep is /", () => {
    expect(sep).toBe("/");
  });

  it("delimiter is :", () => {
    expect(delimiter).toBe(":");
  });

  it("posix is a self-reference", () => {
    expect(posix).toBe(path);
  });
});

describe("path default export", () => {
  it("contains all named exports", () => {
    expect(path.join).toBe(join);
    expect(path.resolve).toBe(resolve);
    expect(path.normalize).toBe(normalize);
    expect(path.isAbsolute).toBe(isAbsolute);
    expect(path.relative).toBe(relative);
    expect(path.dirname).toBe(dirname);
    expect(path.basename).toBe(basename);
    expect(path.extname).toBe(extname);
    expect(path.parse).toBe(parse);
    expect(path.format).toBe(format);
    expect(path.sep).toBe(sep);
    expect(path.delimiter).toBe(delimiter);
    expect(path.posix).toBe(posix);
  });
});
