import { describe, it, expect, beforeEach } from "vitest";
import { MemoryFS } from "./memory-fs.js";
import {
  FileNotFoundError,
  FileExistsError,
  IsADirectoryError,
  NotADirectoryError,
} from "./errors.js";

describe("MemoryFS", () => {
  let fs: MemoryFS;

  beforeEach(() => {
    fs = new MemoryFS();
  });

  describe("writeFile + readFile", () => {
    it("writes and reads a file at root", async () => {
      await fs.writeFile("/hello.txt", "hello world");
      const content = await fs.readFile("/hello.txt");
      expect(new TextDecoder().decode(content)).toBe("hello world");
    });

    it("writes Uint8Array content", async () => {
      const data = new Uint8Array([1, 2, 3]);
      await fs.writeFile("/bin", data);
      const content = await fs.readFile("/bin");
      expect(content).toEqual(new Uint8Array([1, 2, 3]));
    });

    it("overwrites existing file", async () => {
      await fs.writeFile("/f.txt", "first");
      await fs.writeFile("/f.txt", "second");
      const content = await fs.readFile("/f.txt");
      expect(new TextDecoder().decode(content)).toBe("second");
    });

    it("creates parent directories automatically", async () => {
      await fs.writeFile("/a/b/c.txt", "deep");
      const content = await fs.readFile("/a/b/c.txt");
      expect(new TextDecoder().decode(content)).toBe("deep");
    });

    it("throws FileNotFoundError for missing file", async () => {
      await expect(fs.readFile("/nope")).rejects.toThrow(FileNotFoundError);
    });

    it("throws IsADirectoryError when reading a directory", async () => {
      await fs.mkdir("/dir");
      await expect(fs.readFile("/dir")).rejects.toThrow(IsADirectoryError);
    });

    it("throws NotADirectoryError when parent is a file", async () => {
      await fs.writeFile("/f", "x");
      await expect(fs.writeFile("/f/child", "y")).rejects.toThrow(NotADirectoryError);
    });
  });

  describe("mkdir", () => {
    it("creates a directory", async () => {
      await fs.mkdir("/mydir");
      const stat = await fs.stat("/mydir");
      expect(stat.type).toBe("directory");
    });

    it("throws FileExistsError if directory exists", async () => {
      await fs.mkdir("/mydir");
      await expect(fs.mkdir("/mydir")).rejects.toThrow(FileExistsError);
    });

    it("creates nested directories with recursive option", async () => {
      await fs.mkdir("/a/b/c", { recursive: true });
      const stat = await fs.stat("/a/b/c");
      expect(stat.type).toBe("directory");
    });

    it("does not throw on existing dir with recursive", async () => {
      await fs.mkdir("/a/b", { recursive: true });
      await fs.mkdir("/a/b", { recursive: true });
      const stat = await fs.stat("/a/b");
      expect(stat.type).toBe("directory");
    });

    it("throws FileNotFoundError for non-recursive nested path", async () => {
      await expect(fs.mkdir("/x/y")).rejects.toThrow(FileNotFoundError);
    });
  });

  describe("readdir", () => {
    it("lists entries in a directory", async () => {
      await fs.writeFile("/dir/a.txt", "a");
      await fs.writeFile("/dir/b.txt", "b");
      const entries = await fs.readdir("/dir");
      expect(entries.sort()).toEqual(["a.txt", "b.txt"]);
    });

    it("lists root entries", async () => {
      await fs.writeFile("/x.txt", "x");
      await fs.mkdir("/subdir");
      const entries = await fs.readdir("/");
      expect(entries.sort()).toEqual(["subdir", "x.txt"]);
    });

    it("throws FileNotFoundError for missing directory", async () => {
      await expect(fs.readdir("/nope")).rejects.toThrow(FileNotFoundError);
    });

    it("throws NotADirectoryError for a file", async () => {
      await fs.writeFile("/f", "x");
      await expect(fs.readdir("/f")).rejects.toThrow(NotADirectoryError);
    });
  });

  describe("stat", () => {
    it("returns file stat", async () => {
      await fs.writeFile("/f.txt", "hello");
      const s = await fs.stat("/f.txt");
      expect(s.type).toBe("file");
      expect(s.size).toBe(5);
      expect(s.mtime).toBeGreaterThan(0);
    });

    it("returns directory stat", async () => {
      await fs.mkdir("/d");
      const s = await fs.stat("/d");
      expect(s.type).toBe("directory");
      expect(s.size).toBe(0);
    });

    it("throws FileNotFoundError for missing path", async () => {
      await expect(fs.stat("/nope")).rejects.toThrow(FileNotFoundError);
    });
  });

  describe("lstat", () => {
    it("returns file stat like stat for a regular file", async () => {
      await fs.writeFile("/f.txt", "hello");
      const s = await fs.lstat("/f.txt");
      expect(s.type).toBe("file");
      expect(s.size).toBe(5);
    });

    it("throws FileNotFoundError for missing path", async () => {
      await expect(fs.lstat("/nope")).rejects.toThrow(FileNotFoundError);
    });
  });

  describe("exists", () => {
    it("returns true for existing file", async () => {
      await fs.writeFile("/f", "x");
      expect(await fs.exists("/f")).toBe(true);
    });

    it("returns true for existing directory", async () => {
      await fs.mkdir("/d");
      expect(await fs.exists("/d")).toBe(true);
    });

    it("returns false for missing path", async () => {
      expect(await fs.exists("/nope")).toBe(false);
    });
  });

  describe("unlink", () => {
    it("removes a file", async () => {
      await fs.writeFile("/f", "x");
      await fs.unlink("/f");
      expect(await fs.exists("/f")).toBe(false);
    });

    it("throws FileNotFoundError for missing file", async () => {
      await expect(fs.unlink("/nope")).rejects.toThrow(FileNotFoundError);
    });

    it("throws IsADirectoryError for a directory", async () => {
      await fs.mkdir("/d");
      await expect(fs.unlink("/d")).rejects.toThrow(IsADirectoryError);
    });
  });

  describe("rename", () => {
    it("renames a file", async () => {
      await fs.writeFile("/old.txt", "data");
      await fs.rename("/old.txt", "/new.txt");
      expect(await fs.exists("/old.txt")).toBe(false);
      const content = await fs.readFile("/new.txt");
      expect(new TextDecoder().decode(content)).toBe("data");
    });

    it("renames a directory", async () => {
      await fs.mkdir("/olddir");
      await fs.writeFile("/olddir/f.txt", "inside");
      await fs.rename("/olddir", "/newdir");
      expect(await fs.exists("/olddir")).toBe(false);
      const content = await fs.readFile("/newdir/f.txt");
      expect(new TextDecoder().decode(content)).toBe("inside");
    });

    it("throws FileNotFoundError for missing source", async () => {
      await expect(fs.rename("/nope", "/dest")).rejects.toThrow(FileNotFoundError);
    });
  });

  describe("stubs", () => {
    it("symlink throws not implemented", async () => {
      await expect(fs.symlink("/target", "/link")).rejects.toThrow();
    });

    it("readlink throws not implemented", async () => {
      await expect(fs.readlink("/link")).rejects.toThrow();
    });
  });
});
