import { describe, it, expect, vi, afterEach } from "vitest";
import { MemoryFS } from "@anthropic-ide/vfs";
import { createRegistryClient } from "./client.js";
import * as pako from "pako";

// Helper to create a minimal tar + gzip (reuse logic from tarball.test.ts)
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

function createMockTgz(): Uint8Array {
  const entry = createTarEntry("package/package.json", '{"name":"test-pkg","version":"1.0.0"}');
  const tar = new Uint8Array(entry.length + 1024);
  tar.set(entry, 0);
  return new Uint8Array(pako.gzip(tar));
}

const mockMetadata = {
  name: "test-pkg",
  versions: {
    "1.0.0": {
      name: "test-pkg",
      version: "1.0.0",
      dependencies: {},
      dist: {
        tarball: "https://registry.npmjs.org/test-pkg/-/test-pkg-1.0.0.tgz",
        integrity: "sha512-abc123",
      },
    },
  },
  "dist-tags": { latest: "1.0.0" },
};

describe("createRegistryClient", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches package metadata", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockMetadata),
    });

    const client = createRegistryClient();
    const meta = await client.getPackageMetadata("test-pkg");

    expect(meta.name).toBe("test-pkg");
    expect(meta.versions["1.0.0"].version).toBe("1.0.0");
    expect(meta["dist-tags"].latest).toBe("1.0.0");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://registry.npmjs.org/test-pkg",
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
  });

  it("fetches scoped package metadata", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ...mockMetadata, name: "@scope/pkg" }),
    });

    const client = createRegistryClient();
    await client.getPackageMetadata("@scope/pkg");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://registry.npmjs.org/@scope%2Fpkg",
      expect.anything(),
    );
  });

  it("throws on 404", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const client = createRegistryClient();
    await expect(client.getPackageMetadata("nonexistent")).rejects.toThrow(
      "Package not found: nonexistent",
    );
  });

  it("throws on network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const client = createRegistryClient();
    await expect(client.getPackageMetadata("test-pkg")).rejects.toThrow("Network error");
  });

  it("uses custom registry URL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockMetadata),
    });

    const client = createRegistryClient("https://custom.registry.com");
    await client.getPackageMetadata("test-pkg");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://custom.registry.com/test-pkg",
      expect.anything(),
    );
  });

  it("downloads and extracts tarball to VFS", async () => {
    const tgz = createMockTgz();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(tgz.buffer),
    });

    const vfs = new MemoryFS();
    const client = createRegistryClient();
    await client.downloadAndExtract(
      "https://registry.npmjs.org/test-pkg/-/test-pkg-1.0.0.tgz",
      vfs,
      "/node_modules/test-pkg",
    );

    expect(await vfs.exists("/node_modules/test-pkg/package.json")).toBe(true);
    const content = await vfs.readFile("/node_modules/test-pkg/package.json");
    expect(new TextDecoder().decode(content)).toBe('{"name":"test-pkg","version":"1.0.0"}');
  });

  it("throws on failed tarball download", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const vfs = new MemoryFS();
    const client = createRegistryClient();
    await expect(
      client.downloadAndExtract("https://example.com/fail.tgz", vfs, "/dest"),
    ).rejects.toThrow("Failed to download tarball");
  });
});
