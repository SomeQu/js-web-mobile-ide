// packages/git-client/src/fs-adapter.test.ts

import { describe, it, expect } from "vitest";
import { MemoryFS } from "@anthropic-ide/vfs";
import { createFsAdapter } from "./fs-adapter.js";

function makeFs() {
  const vfs = new MemoryFS();
  return { vfs, fs: createFsAdapter(vfs) };
}

describe("createFsAdapter", () => {
  it("returns { promises } structure", () => {
    const { fs } = makeFs();
    expect(fs).toHaveProperty("promises");
    expect(fs.promises).toHaveProperty("readFile");
    expect(fs.promises).toHaveProperty("writeFile");
    expect(fs.promises).toHaveProperty("mkdir");
    expect(fs.promises).toHaveProperty("stat");
    expect(fs.promises).toHaveProperty("readdir");
    expect(fs.promises).toHaveProperty("unlink");
    expect(fs.promises).toHaveProperty("rename");
    expect(fs.promises).toHaveProperty("lstat");
    expect(fs.promises).toHaveProperty("readlink");
    expect(fs.promises).toHaveProperty("symlink");
    expect(fs.promises).toHaveProperty("rmdir");
  });

  it("writeFile and readFile round-trip with Uint8Array", async () => {
    const { fs, vfs } = makeFs();
    await vfs.mkdir("/repo", { recursive: true });
    const data = new Uint8Array([72, 101, 108, 108, 111]);
    await fs.promises.writeFile("/repo/test.txt", data);
    const result = await fs.promises.readFile("/repo/test.txt");
    expect(result).toEqual(data);
  });

  it("readFile with encoding returns string", async () => {
    const { fs, vfs } = makeFs();
    await vfs.mkdir("/repo", { recursive: true });
    await fs.promises.writeFile("/repo/test.txt", "hello world");
    const result = await fs.promises.readFile("/repo/test.txt", { encoding: "utf8" });
    expect(result).toBe("hello world");
  });

  it("mkdir creates directory", async () => {
    const { fs, vfs } = makeFs();
    await fs.promises.mkdir("/repo");
    const stat = await vfs.stat("/repo");
    expect(stat.type).toBe("directory");
  });

  it("stat returns correct shape", async () => {
    const { fs, vfs } = makeFs();
    await vfs.mkdir("/repo", { recursive: true });
    await vfs.writeFile("/repo/file.txt", "content");
    const stat = await fs.promises.stat("/repo/file.txt");
    expect(stat.isFile()).toBe(true);
    expect(stat.isDirectory()).toBe(false);
    expect(stat.isSymbolicLink()).toBe(false);
    expect(typeof stat.size).toBe("number");
    expect(typeof stat.mtimeMs).toBe("number");
    expect(typeof stat.mode).toBe("number");
  });

  it("stat on directory returns isDirectory true", async () => {
    const { fs } = makeFs();
    await fs.promises.mkdir("/dir");
    const stat = await fs.promises.stat("/dir");
    expect(stat.isDirectory()).toBe(true);
    expect(stat.isFile()).toBe(false);
  });

  it("readdir lists entries", async () => {
    const { fs, vfs } = makeFs();
    await vfs.mkdir("/dir", { recursive: true });
    await vfs.writeFile("/dir/a.txt", "a");
    await vfs.writeFile("/dir/b.txt", "b");
    const entries = await fs.promises.readdir("/dir");
    expect(entries.sort()).toEqual(["a.txt", "b.txt"]);
  });

  it("unlink removes file", async () => {
    const { fs, vfs } = makeFs();
    await vfs.mkdir("/repo", { recursive: true });
    await vfs.writeFile("/repo/file.txt", "x");
    await fs.promises.unlink("/repo/file.txt");
    const exists = await vfs.exists("/repo/file.txt");
    expect(exists).toBe(false);
  });

  it("rename moves file", async () => {
    const { fs, vfs } = makeFs();
    await vfs.mkdir("/repo", { recursive: true });
    await vfs.writeFile("/repo/old.txt", "data");
    await fs.promises.rename("/repo/old.txt", "/repo/new.txt");
    expect(await vfs.exists("/repo/old.txt")).toBe(false);
    expect(await vfs.exists("/repo/new.txt")).toBe(true);
  });

  it("symlink and readlink round-trip", async () => {
    const { fs, vfs } = makeFs();
    await vfs.mkdir("/repo", { recursive: true });
    await vfs.writeFile("/repo/target.txt", "data");
    await fs.promises.symlink("/repo/target.txt", "/repo/link.txt");
    const target = await fs.promises.readlink("/repo/link.txt");
    expect(target).toBe("/repo/target.txt");
  });

  it("lstat on symlink returns isSymbolicLink true", async () => {
    const { fs, vfs } = makeFs();
    await vfs.mkdir("/repo", { recursive: true });
    await vfs.writeFile("/repo/target.txt", "data");
    await vfs.symlink("/repo/target.txt", "/repo/link.txt");
    const stat = await fs.promises.lstat("/repo/link.txt");
    expect(stat.isSymbolicLink()).toBe(true);
  });
});
