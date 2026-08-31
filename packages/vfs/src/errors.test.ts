import { describe, it, expect } from "vitest";
import {
  VfsError,
  FileNotFoundError,
  FileExistsError,
  NotADirectoryError,
  IsADirectoryError,
  DirectoryNotEmptyError,
} from "./errors.js";

describe("VfsError", () => {
  it("has code and path", () => {
    const err = new VfsError("not found", "ENOENT", "/foo");
    expect(err.message).toBe("not found");
    expect(err.code).toBe("ENOENT");
    expect(err.path).toBe("/foo");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("FileNotFoundError", () => {
  it("has ENOENT code", () => {
    const err = new FileNotFoundError("/missing");
    expect(err.code).toBe("ENOENT");
    expect(err.path).toBe("/missing");
    expect(err.message).toContain("/missing");
    expect(err).toBeInstanceOf(VfsError);
  });
});

describe("FileExistsError", () => {
  it("has EEXIST code", () => {
    const err = new FileExistsError("/exists");
    expect(err.code).toBe("EEXIST");
    expect(err.path).toBe("/exists");
    expect(err).toBeInstanceOf(VfsError);
  });
});

describe("NotADirectoryError", () => {
  it("has ENOTDIR code", () => {
    const err = new NotADirectoryError("/file");
    expect(err.code).toBe("ENOTDIR");
    expect(err).toBeInstanceOf(VfsError);
  });
});

describe("IsADirectoryError", () => {
  it("has EISDIR code", () => {
    const err = new IsADirectoryError("/dir");
    expect(err.code).toBe("EISDIR");
    expect(err).toBeInstanceOf(VfsError);
  });
});

describe("DirectoryNotEmptyError", () => {
  it("has ENOTEMPTY code", () => {
    const err = new DirectoryNotEmptyError("/notempty");
    expect(err.code).toBe("ENOTEMPTY");
    expect(err).toBeInstanceOf(VfsError);
  });
});
