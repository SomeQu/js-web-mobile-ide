import { describe, expect, it, beforeEach } from "vitest";
import { MemoryFS } from "@anthropic-ide/vfs";
import {
  readFile, writeFile, readdir, stat, lstat, mkdir, rmdir,
  unlink, rename, exists, symlink, readlink, Stats, constants, promises,
} from "./fs.js";
import { Buffer } from "./buffer.js";

let vfs: MemoryFS;

beforeEach(async () => {
  vfs = new MemoryFS();
  (globalThis as any).__vfs = vfs;
});

describe("fs callback API", () => {
  it("writeFile and readFile roundtrip (Buffer)", (ctx) => {
    return new Promise<void>((resolve, reject) => {
      writeFile("/test.txt", "hello world", (err) => {
        if (err) return reject(err);
        readFile("/test.txt", (err2, data) => {
          if (err2) return reject(err2);
          expect(Buffer.isBuffer(data)).toBe(true);
          expect(data.toString("utf-8")).toBe("hello world");
          resolve();
        });
      });
    });
  });

  it("readFile with encoding returns string", () => {
    return new Promise<void>((resolve, reject) => {
      writeFile("/test.txt", "hello", (err) => {
        if (err) return reject(err);
        readFile("/test.txt", { encoding: "utf-8" }, (err2, data) => {
          if (err2) return reject(err2);
          expect(typeof data).toBe("string");
          expect(data).toBe("hello");
          resolve();
        });
      });
    });
  });

  it("readFile with string encoding returns string", () => {
    return new Promise<void>((resolve, reject) => {
      writeFile("/test.txt", "hello", (err) => {
        if (err) return reject(err);
        readFile("/test.txt", "utf-8", (err2, data) => {
          if (err2) return reject(err2);
          expect(typeof data).toBe("string");
          resolve();
        });
      });
    });
  });

  it("writeFile accepts Buffer", () => {
    return new Promise<void>((resolve, reject) => {
      const buf = Buffer.from("binary data");
      writeFile("/buf.bin", buf, (err) => {
        if (err) return reject(err);
        readFile("/buf.bin", (err2, data) => {
          if (err2) return reject(err2);
          expect(data.toString("utf-8")).toBe("binary data");
          resolve();
        });
      });
    });
  });

  it("readFile on missing file returns ENOENT", () => {
    return new Promise<void>((resolve) => {
      readFile("/nope.txt", (err) => {
        expect(err).toBeTruthy();
        expect(err!.code).toBe("ENOENT");
        expect(err!.path).toBe("/nope.txt");
        resolve();
      });
    });
  });

  it("readdir lists directory contents", () => {
    return new Promise<void>((resolve, reject) => {
      mkdir("/mydir", (err) => {
        if (err) return reject(err);
        writeFile("/mydir/a.txt", "a", (err2) => {
          if (err2) return reject(err2);
          writeFile("/mydir/b.txt", "b", (err3) => {
            if (err3) return reject(err3);
            readdir("/mydir", (err4, files) => {
              if (err4) return reject(err4);
              expect(files.sort()).toEqual(["a.txt", "b.txt"]);
              resolve();
            });
          });
        });
      });
    });
  });

  it("stat returns Stats object", () => {
    return new Promise<void>((resolve, reject) => {
      writeFile("/file.txt", "content", (err) => {
        if (err) return reject(err);
        stat("/file.txt", (err2, stats) => {
          if (err2) return reject(err2);
          expect(stats).toBeInstanceOf(Stats);
          expect(stats.isFile()).toBe(true);
          expect(stats.isDirectory()).toBe(false);
          expect(stats.size).toBe(7); // "content".length
          expect(stats.mtime).toBeInstanceOf(Date);
          expect(typeof stats.mtimeMs).toBe("number");
          expect(stats.mode).toBe(0o644);
          resolve();
        });
      });
    });
  });

  it("stat on directory", () => {
    return new Promise<void>((resolve, reject) => {
      mkdir("/testdir", (err) => {
        if (err) return reject(err);
        stat("/testdir", (err2, stats) => {
          if (err2) return reject(err2);
          expect(stats.isDirectory()).toBe(true);
          expect(stats.mode).toBe(0o755);
          resolve();
        });
      });
    });
  });

  it("mkdir and rmdir", () => {
    return new Promise<void>((resolve, reject) => {
      mkdir("/newdir", (err) => {
        if (err) return reject(err);
        stat("/newdir", (err2, stats) => {
          if (err2) return reject(err2);
          expect(stats.isDirectory()).toBe(true);
          rmdir("/newdir", (err3) => {
            if (err3) return reject(err3);
            exists("/newdir", (e) => {
              expect(e).toBe(false);
              resolve();
            });
          });
        });
      });
    });
  });

  it("mkdir recursive", () => {
    return new Promise<void>((resolve, reject) => {
      mkdir("/a/b/c", { recursive: true }, (err) => {
        if (err) return reject(err);
        stat("/a/b/c", (err2, stats) => {
          if (err2) return reject(err2);
          expect(stats.isDirectory()).toBe(true);
          resolve();
        });
      });
    });
  });

  it("unlink removes file", () => {
    return new Promise<void>((resolve, reject) => {
      writeFile("/del.txt", "x", (err) => {
        if (err) return reject(err);
        unlink("/del.txt", (err2) => {
          if (err2) return reject(err2);
          exists("/del.txt", (e) => {
            expect(e).toBe(false);
            resolve();
          });
        });
      });
    });
  });

  it("rename moves file", () => {
    return new Promise<void>((resolve, reject) => {
      writeFile("/old.txt", "data", (err) => {
        if (err) return reject(err);
        rename("/old.txt", "/new.txt", (err2) => {
          if (err2) return reject(err2);
          readFile("/new.txt", "utf-8", (err3, data) => {
            if (err3) return reject(err3);
            expect(data).toBe("data");
            exists("/old.txt", (e) => {
              expect(e).toBe(false);
              resolve();
            });
          });
        });
      });
    });
  });

  it("exists returns true for existing file", () => {
    return new Promise<void>((resolve, reject) => {
      writeFile("/here.txt", "x", (err) => {
        if (err) return reject(err);
        exists("/here.txt", (e) => {
          expect(e).toBe(true);
          resolve();
        });
      });
    });
  });

  it("exists returns false for missing file", () => {
    return new Promise<void>((resolve) => {
      exists("/not-here.txt", (e) => {
        expect(e).toBe(false);
        resolve();
      });
    });
  });

  it("symlink and readlink", () => {
    return new Promise<void>((resolve, reject) => {
      writeFile("/target.txt", "target data", (err) => {
        if (err) return reject(err);
        symlink("/target.txt", "/link.txt", (err2) => {
          if (err2) return reject(err2);
          readlink("/link.txt", (err3, linkStr) => {
            if (err3) return reject(err3);
            expect(linkStr).toBe("/target.txt");
            resolve();
          });
        });
      });
    });
  });

  it("lstat on symlink returns symlink type", () => {
    return new Promise<void>((resolve, reject) => {
      writeFile("/real.txt", "x", (err) => {
        if (err) return reject(err);
        symlink("/real.txt", "/sym.txt", (err2) => {
          if (err2) return reject(err2);
          lstat("/sym.txt", (err3, stats) => {
            if (err3) return reject(err3);
            expect(stats.isSymbolicLink()).toBe(true);
            resolve();
          });
        });
      });
    });
  });
});

describe("fs.promises API", () => {
  it("readFile and writeFile roundtrip", async () => {
    await promises.writeFile("/p.txt", "promise data");
    const data = await promises.readFile("/p.txt", { encoding: "utf-8" });
    expect(data).toBe("promise data");
  });

  it("readFile returns Buffer by default", async () => {
    await promises.writeFile("/p2.txt", "buf");
    const data = await promises.readFile("/p2.txt");
    expect(Buffer.isBuffer(data)).toBe(true);
  });

  it("readdir", async () => {
    await promises.mkdir("/pdir");
    await promises.writeFile("/pdir/x.txt", "x");
    const files = await promises.readdir("/pdir");
    expect(files).toEqual(["x.txt"]);
  });

  it("stat", async () => {
    await promises.writeFile("/ps.txt", "stat");
    const s = await promises.stat("/ps.txt");
    expect(s).toBeInstanceOf(Stats);
    expect(s.isFile()).toBe(true);
  });

  it("mkdir recursive + rmdir recursive", async () => {
    await promises.mkdir("/pa/pb/pc", { recursive: true });
    const s = await promises.stat("/pa/pb/pc");
    expect(s.isDirectory()).toBe(true);
    await promises.rmdir("/pa", { recursive: true });
    const e = await promises.exists("/pa");
    expect(e).toBe(false);
  });

  it("unlink", async () => {
    await promises.writeFile("/pdel.txt", "x");
    await promises.unlink("/pdel.txt");
    const e = await promises.exists("/pdel.txt");
    expect(e).toBe(false);
  });

  it("rename", async () => {
    await promises.writeFile("/pold.txt", "data");
    await promises.rename("/pold.txt", "/pnew.txt");
    const data = await promises.readFile("/pnew.txt", "utf-8");
    expect(data).toBe("data");
  });

  it("symlink and readlink", async () => {
    await promises.writeFile("/ptarget.txt", "t");
    await promises.symlink("/ptarget.txt", "/plink.txt");
    const link = await promises.readlink("/plink.txt");
    expect(link).toBe("/ptarget.txt");
  });

  it("ENOENT on missing file", async () => {
    await expect(promises.readFile("/missing")).rejects.toThrow();
    try {
      await promises.readFile("/missing");
    } catch (err: any) {
      expect(err.code).toBe("ENOENT");
    }
  });
});

describe("Stats class", () => {
  it("isBlockDevice/isCharacterDevice/isFIFO/isSocket always false", () => {
    return new Promise<void>((resolve, reject) => {
      writeFile("/s.txt", "x", (err) => {
        if (err) return reject(err);
        stat("/s.txt", (err2, stats) => {
          if (err2) return reject(err2);
          expect(stats.isBlockDevice()).toBe(false);
          expect(stats.isCharacterDevice()).toBe(false);
          expect(stats.isFIFO()).toBe(false);
          expect(stats.isSocket()).toBe(false);
          resolve();
        });
      });
    });
  });

  it("has atime/ctime/birthtime equal to mtime", () => {
    return new Promise<void>((resolve, reject) => {
      writeFile("/t.txt", "x", (err) => {
        if (err) return reject(err);
        stat("/t.txt", (err2, stats) => {
          if (err2) return reject(err2);
          expect(stats.atimeMs).toBe(stats.mtimeMs);
          expect(stats.ctimeMs).toBe(stats.mtimeMs);
          expect(stats.birthtimeMs).toBe(stats.mtimeMs);
          resolve();
        });
      });
    });
  });
});

describe("fs constants", () => {
  it("exports F_OK, R_OK, W_OK, X_OK", () => {
    expect(constants.F_OK).toBe(0);
    expect(constants.R_OK).toBe(4);
    expect(constants.W_OK).toBe(2);
    expect(constants.X_OK).toBe(1);
  });
});

describe("VFS not initialized", () => {
  it("throws when __vfs is not set", () => {
    (globalThis as any).__vfs = undefined;
    return new Promise<void>((resolve) => {
      readFile("/x", (err) => {
        expect(err).toBeTruthy();
        expect(err!.message).toContain("VFS not initialized");
        resolve();
      });
    });
  });
});
