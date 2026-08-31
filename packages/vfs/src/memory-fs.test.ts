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

  describe("symlink + readlink", () => {
    it("creates and reads a symlink", async () => {
      await fs.writeFile("/real.txt", "data");
      await fs.symlink("/real.txt", "/link.txt");
      const target = await fs.readlink("/link.txt");
      expect(target).toBe("/real.txt");
    });

    it("reads file through symlink", async () => {
      await fs.writeFile("/real.txt", "hello");
      await fs.symlink("/real.txt", "/link.txt");
      const content = await fs.readFile("/link.txt");
      expect(new TextDecoder().decode(content)).toBe("hello");
    });

    it("writes file through symlink", async () => {
      await fs.writeFile("/real.txt", "old");
      await fs.symlink("/real.txt", "/link.txt");
      await fs.writeFile("/link.txt", "new");
      const content = await fs.readFile("/real.txt");
      expect(new TextDecoder().decode(content)).toBe("new");
    });

    it("stat follows symlink", async () => {
      await fs.writeFile("/real.txt", "data");
      await fs.symlink("/real.txt", "/link.txt");
      const s = await fs.stat("/link.txt");
      expect(s.type).toBe("file");
      expect(s.size).toBe(4);
    });

    it("lstat returns symlink info", async () => {
      await fs.writeFile("/real.txt", "data");
      await fs.symlink("/real.txt", "/link.txt");
      const s = await fs.lstat("/link.txt");
      expect(s.type).toBe("symlink");
    });

    it("readdir through symlinked directory", async () => {
      await fs.mkdir("/realdir");
      await fs.writeFile("/realdir/a.txt", "a");
      await fs.symlink("/realdir", "/linkdir");
      const entries = await fs.readdir("/linkdir");
      expect(entries).toEqual(["a.txt"]);
    });

    it("creates file inside symlinked directory", async () => {
      await fs.mkdir("/realdir");
      await fs.symlink("/realdir", "/linkdir");
      await fs.writeFile("/linkdir/new.txt", "new");
      const content = await fs.readFile("/realdir/new.txt");
      expect(new TextDecoder().decode(content)).toBe("new");
    });

    it("throws FileNotFoundError for dangling symlink", async () => {
      await fs.symlink("/nonexistent", "/dangling");
      await expect(fs.readFile("/dangling")).rejects.toThrow(FileNotFoundError);
    });

    it("throws FileNotFoundError for readlink on non-symlink", async () => {
      await fs.writeFile("/f", "x");
      await expect(fs.readlink("/f")).rejects.toThrow();
    });

    it("throws FileExistsError when symlink target path exists", async () => {
      await fs.writeFile("/existing", "x");
      await expect(fs.symlink("/target", "/existing")).rejects.toThrow(FileExistsError);
    });

    it("unlink removes symlink without affecting target", async () => {
      await fs.writeFile("/real", "data");
      await fs.symlink("/real", "/link");
      await fs.unlink("/link");
      expect(await fs.exists("/link")).toBe(false);
      expect(await fs.exists("/real")).toBe(true);
    });

    it("detects circular symlinks with max depth", async () => {
      await fs.symlink("/b", "/a");
      await fs.symlink("/a", "/b");
      await expect(fs.readFile("/a")).rejects.toThrow();
    });
  });
});
