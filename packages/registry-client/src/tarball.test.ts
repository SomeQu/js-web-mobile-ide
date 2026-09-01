import { describe, it, expect } from "vitest";
import { MemoryFS } from "@anthropic-ide/vfs";
import { extractTarGzip, parseTar } from "./tarball.js";
import * as pako from "pako";

function createTarEntry(name: string, content: string): Uint8Array {
  const encoder = new TextEncoder();
  const contentBytes = encoder.encode(content);
  const nameBytes = encoder.encode(name);

  const header = new Uint8Array(512);
  header.set(nameBytes.slice(0, 100), 0);

  // File mode: 0000644
  header.set(encoder.encode("0000644\0"), 100);
  // Owner/group ID: 0000000
  header.set(encoder.encode("0000000\0"), 108);
  header.set(encoder.encode("0000000\0"), 116);
  // File size in octal, 11 chars + null
  const sizeOctal = contentBytes.length.toString(8).padStart(11, "0") + "\0";
  header.set(encoder.encode(sizeOctal), 124);
  // Mtime
  header.set(encoder.encode("00000000000\0"), 136);
  // Type flag: '0' = regular file
  header[156] = 48; // ASCII '0'
  // UStar indicator
  header.set(encoder.encode("ustar\0"), 257);

  // Checksum: sum of all header bytes (with checksum field as spaces)
  header.set(encoder.encode("        "), 148);
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += header[i];
  const checksumStr = checksum.toString(8).padStart(6, "0") + "\0 ";
  header.set(encoder.encode(checksumStr), 148);

  // Data blocks: padded to 512-byte boundary
  const dataBlocks = Math.ceil(contentBytes.length / 512) * 512;
  const data = new Uint8Array(dataBlocks);
  data.set(contentBytes, 0);

  const result = new Uint8Array(512 + dataBlocks);
  result.set(header, 0);
  result.set(data, 512);
  return result;
}

function createTar(entries: Array<{ name: string; content: string }>): Uint8Array {
  const parts = entries.map((e) => createTarEntry(e.name, e.content));
  const totalSize = parts.reduce((sum, p) => sum + p.length, 0) + 1024;
  const tar = new Uint8Array(totalSize);
  let offset = 0;
  for (const part of parts) {
    tar.set(part, offset);
    offset += part.length;
  }
  return tar;
}

describe("parseTar", () => {
  it("parses a single file entry", () => {
    const tar = createTar([{ name: "hello.txt", content: "Hello, World!" }]);
    const entries = parseTar(tar);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("hello.txt");
    expect(new TextDecoder().decode(entries[0].data)).toBe("Hello, World!");
  });

  it("parses multiple file entries", () => {
    const tar = createTar([
      { name: "a.txt", content: "AAA" },
      { name: "b.txt", content: "BBB" },
      { name: "dir/c.txt", content: "CCC" },
    ]);
    const entries = parseTar(tar);
    expect(entries).toHaveLength(3);
    expect(entries[0].name).toBe("a.txt");
    expect(entries[1].name).toBe("b.txt");
    expect(entries[2].name).toBe("dir/c.txt");
  });

  it("handles empty files", () => {
    const tar = createTar([{ name: "empty.txt", content: "" }]);
    const entries = parseTar(tar);
    expect(entries).toHaveLength(1);
    expect(entries[0].data.length).toBe(0);
  });
});

describe("extractTarGzip", () => {
  it("decompresses and extracts files to VFS", async () => {
    const tar = createTar([
      { name: "package/index.js", content: "module.exports = 42;" },
      { name: "package/package.json", content: '{"name":"test"}' },
    ]);
    const gzipped = pako.gzip(tar);

    const vfs = new MemoryFS();
    await extractTarGzip(new Uint8Array(gzipped), vfs, "/node_modules/test");

    const indexContent = await vfs.readFile("/node_modules/test/index.js");
    expect(new TextDecoder().decode(indexContent)).toBe("module.exports = 42;");

    const pkgContent = await vfs.readFile("/node_modules/test/package.json");
    expect(new TextDecoder().decode(pkgContent)).toBe('{"name":"test"}');
  });

  it("strips package/ prefix from npm tarballs", async () => {
    const tar = createTar([
      { name: "package/lib/main.js", content: "export default 1;" },
    ]);
    const gzipped = pako.gzip(tar);

    const vfs = new MemoryFS();
    await extractTarGzip(new Uint8Array(gzipped), vfs, "/dest");

    expect(await vfs.exists("/dest/lib/main.js")).toBe(true);
    expect(await vfs.exists("/dest/package/lib/main.js")).toBe(false);
  });

  it("creates intermediate directories", async () => {
    const tar = createTar([
      { name: "package/src/utils/helper.js", content: "export {};" },
    ]);
    const gzipped = pako.gzip(tar);

    const vfs = new MemoryFS();
    await extractTarGzip(new Uint8Array(gzipped), vfs, "/pkg");

    expect(await vfs.exists("/pkg/src/utils/helper.js")).toBe(true);
  });

  it("skips directory entries", async () => {
    const tar = createTar([
      { name: "package/readme.md", content: "# Hello" },
    ]);
    const gzipped = pako.gzip(tar);

    const vfs = new MemoryFS();
    await extractTarGzip(new Uint8Array(gzipped), vfs, "/out");

    const content = await vfs.readFile("/out/readme.md");
    expect(new TextDecoder().decode(content)).toBe("# Hello");
  });
});
