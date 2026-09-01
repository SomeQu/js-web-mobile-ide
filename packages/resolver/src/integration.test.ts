import { describe, it, expect, vi, afterEach } from "vitest";
import { MemoryFS } from "@anthropic-ide/vfs";
import { createRegistryClient } from "@anthropic-ide/registry-client";
import { createResolver } from "./installer.js";
import { parseLockFile } from "./lockfile-parser.js";
import * as pako from "pako";

function createTarEntry(name: string, content: string): Uint8Array {
  const encoder = new TextEncoder();
  const contentBytes = encoder.encode(content);
  const nameBytes = encoder.encode(name);

  const header = new Uint8Array(512);
  header.set(nameBytes.slice(0, 100), 0);
  header.set(encoder.encode("0000644\0"), 100);
  header.set(encoder.encode("0000000\0"), 108);
  header.set(encoder.encode("0000000\0"), 116);
  const sizeOctal = contentBytes.length.toString(8).padStart(11, "0") + "\0";
  header.set(encoder.encode(sizeOctal), 124);
  header.set(encoder.encode("00000000000\0"), 136);
  header[156] = 48;
  header.set(encoder.encode("ustar\0"), 257);
  header.set(encoder.encode("        "), 148);
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += header[i];
  const checksumStr = checksum.toString(8).padStart(6, "0") + "\0 ";
  header.set(encoder.encode(checksumStr), 148);

  const dataBlocks = Math.ceil(contentBytes.length / 512) * 512;
  const data = new Uint8Array(dataBlocks);
  data.set(contentBytes, 0);
  const result = new Uint8Array(512 + dataBlocks);
  result.set(header, 0);
  result.set(data, 512);
  return result;
}

function createMockTgz(files: Array<{ name: string; content: string }>): Uint8Array {
  const parts = files.map((f) => createTarEntry(`package/${f.name}`, f.content));
  const totalSize = parts.reduce((sum, p) => sum + p.length, 0) + 1024;
  const tar = new Uint8Array(totalSize);
  let offset = 0;
  for (const part of parts) {
    tar.set(part, offset);
    offset += part.length;
  }
  return new Uint8Array(pako.gzip(tar));
}

describe("Integration: lock file → install → VFS", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("installs packages from a lock file into VFS", async () => {
    const isNumberTgz = createMockTgz([
      { name: "package.json", content: '{"name":"is-number","version":"6.0.0","main":"index.js"}' },
      { name: "index.js", content: "module.exports = function(n) { return typeof n === 'number'; };" },
    ]);
    const isOddTgz = createMockTgz([
      { name: "package.json", content: '{"name":"is-odd","version":"3.0.1","main":"index.js"}' },
      { name: "index.js", content: "var isNumber = require('is-number'); module.exports = function(n) { return isNumber(n) && n % 2 === 1; };" },
    ]);

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("is-number-6.0.0.tgz")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          arrayBuffer: () => Promise.resolve(isNumberTgz.buffer),
        });
      }
      if (url.includes("is-odd-3.0.1.tgz")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          arrayBuffer: () => Promise.resolve(isOddTgz.buffer),
        });
      }
      return Promise.resolve({ ok: false, status: 404, statusText: "Not Found" });
    });

    const lockContent = JSON.stringify({
      name: "test-project",
      lockfileVersion: 3,
      packages: {
        "": { name: "test-project", version: "1.0.0", dependencies: { "is-odd": "^3.0.1" } },
        "node_modules/is-number": {
          version: "6.0.0",
          resolved: "https://registry.npmjs.org/is-number/-/is-number-6.0.0.tgz",
          integrity: "sha512-fake",
        },
        "node_modules/is-odd": {
          version: "3.0.1",
          resolved: "https://registry.npmjs.org/is-odd/-/is-odd-3.0.1.tgz",
          integrity: "sha512-fake2",
          dependencies: { "is-number": "^6.0.0" },
        },
      },
    });

    const vfs = new MemoryFS();
    const client = createRegistryClient();
    const resolver = createResolver();

    const graph = parseLockFile(lockContent);
    expect(graph.dependencies.size).toBe(2);
    expect(graph.root).toEqual(["is-odd"]);

    const progress: Array<{ total: number; downloaded: number; current: string }> = [];
    await resolver.install(graph, vfs, client, (p) => progress.push({ ...p }));

    // Verify files extracted
    expect(await vfs.exists("/node_modules/is-number/package.json")).toBe(true);
    expect(await vfs.exists("/node_modules/is-number/index.js")).toBe(true);
    expect(await vfs.exists("/node_modules/is-odd/package.json")).toBe(true);
    expect(await vfs.exists("/node_modules/is-odd/index.js")).toBe(true);

    // Verify content
    const isNumberPkg = await vfs.readFile("/node_modules/is-number/package.json");
    const parsed = JSON.parse(new TextDecoder().decode(isNumberPkg));
    expect(parsed.name).toBe("is-number");
    expect(parsed.version).toBe("6.0.0");

    // Verify progress
    expect(progress.length).toBe(2);
    expect(progress[0].total).toBe(2);
    expect(progress[1].downloaded).toBe(2);

    // Verify caching: re-install should skip fetch but still report progress
    const client2 = createRegistryClient();
    globalThis.fetch = vi.fn();
    const cachedProgress: Array<{ total: number; downloaded: number; current: string }> = [];
    await resolver.install(graph, vfs, client2, (p) => cachedProgress.push({ ...p }));
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(cachedProgress.length).toBe(2);
    expect(cachedProgress[1].downloaded).toBe(2);
  });
});
