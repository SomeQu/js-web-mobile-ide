# Phase 3: resolver + registry-client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse `package-lock.json` v2/v3, download npm packages, and extract them into the VFS — enabling the IDE to install dependencies for real projects.

**Architecture:** Two packages with clear separation. `registry-client` handles HTTP + tarball decompression/extraction (pako for gzip, own minimal tar parser). `resolver` handles lock file parsing and installation orchestration. Both consume `@anthropic-ide/vfs` for file storage. Sequential downloads with progress reporting.

**Tech Stack:** TypeScript (ES2020), pako (gzip), fetch API (WKWebView global), Vitest

**Spec:** `docs/superpowers/specs/2026-09-01-resolver-registry-design.md`

## Global Constraints

- No Node-specific APIs (`node:*`) in source files — only in `*.test.ts`
- Target: ES2020 for JavaScriptCore compatibility
- Package scope: `@anthropic-ide/*`
- Cross-package communication only through exported interfaces from `index.ts`
- No npm dependencies with native bindings (node-gyp)
- Commit convention: Conventional Commits (`feat`/`fix`/`chore`/`docs`)
- TDD: test first, then implementation
- `fetch` is available globally in WKWebView/JavaScriptCore — declare in `global.d.ts`
- `pako` is the only new runtime dependency (zero deps, pure JS)

---

### Task 1: registry-client types and tarball extraction

**Files:**
- Modify: `packages/registry-client/package.json` — add `pako` dependency, `@anthropic-ide/vfs` peer dep
- Create: `packages/registry-client/src/global.d.ts` — ambient `fetch`, `Response`, `Headers` declarations
- Create: `packages/registry-client/src/types.ts` — PackageMetadata, VersionMetadata, IRegistryClient
- Create: `packages/registry-client/src/tarball.ts` — gzip decompression + tar parser + VFS extraction
- Create: `packages/registry-client/src/tarball.test.ts` — tests for tar parsing and extraction

**Interfaces:**
- Consumes: `IVirtualFileSystem` from `@anthropic-ide/vfs` (readFile, writeFile, mkdir, exists)
- Produces:
  - `PackageMetadata` type — `{ name: string; versions: Record<string, VersionMetadata>; "dist-tags": Record<string, string> }`
  - `VersionMetadata` type — `{ name: string; version: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; dist: { tarball: string; integrity?: string } }`
  - `IRegistryClient` interface — `{ getPackageMetadata(name: string): Promise<PackageMetadata>; downloadAndExtract(tarballUrl: string, vfs: IVirtualFileSystem, destPath: string): Promise<void> }`
  - `extractTarGzip(data: Uint8Array, vfs: IVirtualFileSystem, destPath: string): Promise<void>` — internal but exported for testing

- [ ] **Step 1: Add dependencies to package.json**

Update `packages/registry-client/package.json`:

```json
{
  "name": "@anthropic-ide/registry-client",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run --config ../../vitest.config.ts --dir src",
    "typecheck": "tsc --noEmit"
  },
  "files": ["dist"],
  "dependencies": {
    "pako": "^3.0.1"
  },
  "peerDependencies": {
    "@anthropic-ide/vfs": "workspace:*"
  }
}
```

Run from repo root: `pnpm install`

- [ ] **Step 2: Create global.d.ts for fetch API**

Create `packages/registry-client/src/global.d.ts`:

```ts
// Ambient declarations for Web-standard fetch API available at runtime
// in JavaScriptCore/WKWebView but not in the ES2020 lib.
// In the test environment (Node/Vitest), fetch is also globally available
// since Node 18+.

declare function fetch(input: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  signal?: AbortSignal;
}): Promise<Response>;

declare class Response {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  json(): Promise<unknown>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

declare class Headers {
  get(name: string): string | null;
  has(name: string): boolean;
}
```

- [ ] **Step 3: Create types.ts**

Create `packages/registry-client/src/types.ts`:

```ts
import type { IVirtualFileSystem } from "@anthropic-ide/vfs";

export interface VersionMetadata {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  dist: {
    tarball: string;
    integrity?: string;
  };
}

export interface PackageMetadata {
  name: string;
  versions: Record<string, VersionMetadata>;
  "dist-tags": Record<string, string>;
}

export interface IRegistryClient {
  getPackageMetadata(name: string): Promise<PackageMetadata>;
  downloadAndExtract(
    tarballUrl: string,
    vfs: IVirtualFileSystem,
    destPath: string,
  ): Promise<void>;
}
```

- [ ] **Step 4: Write failing tarball tests**

Create `packages/registry-client/src/tarball.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { MemoryFS } from "@anthropic-ide/vfs";
import { extractTarGzip, parseTar } from "./tarball.js";
import pako from "pako";

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
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `cd packages/registry-client && pnpm test`
Expected: FAIL — `parseTar` and `extractTarGzip` not found

- [ ] **Step 6: Implement tarball.ts**

Create `packages/registry-client/src/tarball.ts`:

```ts
import pako from "pako";
import type { IVirtualFileSystem } from "@anthropic-ide/vfs";

export interface TarEntry {
  name: string;
  data: Uint8Array;
}

export function parseTar(buffer: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;

  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);

    let allZero = true;
    for (let i = 0; i < 512; i++) {
      if (header[i] !== 0) { allZero = false; break; }
    }
    if (allZero) break;

    let name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    if (prefix) name = prefix + "/" + name;

    const sizeStr = readString(header, 124, 12);
    const size = parseInt(sizeStr, 8) || 0;

    const typeFlag = header[156];
    // '0' or '\0' = regular file, '5' = directory
    const isFile = typeFlag === 0 || typeFlag === 48; // 48 = ASCII '0'

    offset += 512;

    if (isFile && size > 0) {
      const data = buffer.slice(offset, offset + size);
      entries.push({ name, data: new Uint8Array(data) });
    } else if (isFile && size === 0) {
      entries.push({ name, data: new Uint8Array(0) });
    }

    offset += Math.ceil(size / 512) * 512;
  }

  return entries;
}

function readString(buf: Uint8Array, offset: number, length: number): string {
  let end = offset;
  const max = offset + length;
  while (end < max && buf[end] !== 0) end++;
  const decoder = new TextDecoder();
  return decoder.decode(buf.subarray(offset, end));
}

export async function extractTarGzip(
  data: Uint8Array,
  vfs: IVirtualFileSystem,
  destPath: string,
): Promise<void> {
  const tarData = pako.ungzip(data);
  const entries = parseTar(tarData);

  for (const entry of entries) {
    let name = entry.name;

    // Strip "package/" prefix (npm tarball convention)
    const slashIdx = name.indexOf("/");
    if (slashIdx !== -1) {
      name = name.substring(slashIdx + 1);
    }

    if (!name) continue;

    const fullPath = destPath + "/" + name;

    // Ensure parent directory exists
    const lastSlash = fullPath.lastIndexOf("/");
    if (lastSlash > 0) {
      const parentDir = fullPath.substring(0, lastSlash);
      if (!(await vfs.exists(parentDir))) {
        await vfs.mkdir(parentDir, { recursive: true });
      }
    }

    await vfs.writeFile(fullPath, entry.data);
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd packages/registry-client && pnpm test`
Expected: all tarball tests PASS

- [ ] **Step 8: Typecheck**

Run: `cd packages/registry-client && pnpm typecheck`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/registry-client/
git commit -m "feat(registry-client): add types, tar parser, and gzip extraction"
```

---

### Task 2: registry-client HTTP client

**Files:**
- Create: `packages/registry-client/src/client.ts` — createRegistryClient factory
- Create: `packages/registry-client/src/client.test.ts` — tests with mocked fetch
- Modify: `packages/registry-client/src/index.ts` — re-export public API

**Interfaces:**
- Consumes: `IRegistryClient`, `PackageMetadata`, `VersionMetadata` from Task 1's `types.ts`; `extractTarGzip` from Task 1's `tarball.ts`; `IVirtualFileSystem` from `@anthropic-ide/vfs`
- Produces: `createRegistryClient(registryUrl?: string): IRegistryClient` — factory function

- [ ] **Step 1: Write failing client tests**

Create `packages/registry-client/src/client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryFS } from "@anthropic-ide/vfs";
import { createRegistryClient } from "./client.js";
import pako from "pako";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/registry-client && pnpm test`
Expected: FAIL — `createRegistryClient` not found

- [ ] **Step 3: Implement client.ts**

Create `packages/registry-client/src/client.ts`:

```ts
import type { IVirtualFileSystem } from "@anthropic-ide/vfs";
import type { IRegistryClient, PackageMetadata } from "./types.js";
import { extractTarGzip } from "./tarball.js";

const DEFAULT_REGISTRY = "https://registry.npmjs.org";

export function createRegistryClient(registryUrl?: string): IRegistryClient {
  const baseUrl = (registryUrl ?? DEFAULT_REGISTRY).replace(/\/+$/, "");

  return {
    async getPackageMetadata(name: string): Promise<PackageMetadata> {
      const encodedName = name.startsWith("@")
        ? `@${encodeURIComponent(name.substring(1))}`
        : name;
      const url = `${baseUrl}/${encodedName}`;
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Package not found: ${name}`);
        }
        throw new Error(
          `Registry error for ${name}: ${response.status} ${response.statusText}`,
        );
      }

      return (await response.json()) as PackageMetadata;
    },

    async downloadAndExtract(
      tarballUrl: string,
      vfs: IVirtualFileSystem,
      destPath: string,
    ): Promise<void> {
      const response = await fetch(tarballUrl);

      if (!response.ok) {
        throw new Error(
          `Failed to download tarball: ${response.status} ${response.statusText}`,
        );
      }

      const buffer = await response.arrayBuffer();
      await extractTarGzip(new Uint8Array(buffer), vfs, destPath);
    },
  };
}
```

- [ ] **Step 4: Update index.ts**

Update `packages/registry-client/src/index.ts`:

```ts
export type {
  PackageMetadata,
  VersionMetadata,
  IRegistryClient,
} from "./types.js";
export { createRegistryClient } from "./client.js";
export { extractTarGzip, parseTar } from "./tarball.js";
export type { TarEntry } from "./tarball.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/registry-client && pnpm test`
Expected: all tests PASS

- [ ] **Step 6: Typecheck and lint**

Run: `cd packages/registry-client && pnpm typecheck`
Run from repo root: `pnpm lint`
Expected: both PASS

- [ ] **Step 7: Commit**

```bash
git add packages/registry-client/
git commit -m "feat(registry-client): add HTTP client with fetch and VFS extraction"
```

---

### Task 3: resolver lock file parser

**Files:**
- Create: `packages/resolver/src/types.ts` — ResolvedDependency, DependencyGraph, InstallProgress, IResolver
- Create: `packages/resolver/src/lockfile-parser.ts` — parseLockFile function
- Create: `packages/resolver/src/lockfile-parser.test.ts` — tests with real lock file fixtures

**Interfaces:**
- Consumes: nothing from other tasks (pure data types + parsing)
- Produces:
  - `ResolvedDependency` type — `{ name: string; version: string; tarballUrl: string; integrity?: string; dependencies?: Record<string, string> }`
  - `DependencyGraph` type — `{ dependencies: Map<string, ResolvedDependency>; root: string[] }`
  - `InstallProgress` type — `{ total: number; downloaded: number; current: string }`
  - `IResolver` interface — `{ parseLockFile(content: string): DependencyGraph; install(graph: DependencyGraph, vfs: IVirtualFileSystem, client: IRegistryClient, onProgress?: (p: InstallProgress) => void): Promise<void> }`
  - `parseLockFile(content: string): DependencyGraph` — standalone function

- [ ] **Step 1: Create types.ts**

Create `packages/resolver/src/types.ts`:

```ts
import type { IVirtualFileSystem } from "@anthropic-ide/vfs";
import type { IRegistryClient } from "@anthropic-ide/registry-client";

export interface ResolvedDependency {
  name: string;
  version: string;
  tarballUrl: string;
  integrity?: string;
  dependencies?: Record<string, string>;
}

export interface DependencyGraph {
  dependencies: Map<string, ResolvedDependency>;
  root: string[];
}

export interface InstallProgress {
  total: number;
  downloaded: number;
  current: string;
}

export interface IResolver {
  parseLockFile(content: string): DependencyGraph;
  install(
    graph: DependencyGraph,
    vfs: IVirtualFileSystem,
    client: IRegistryClient,
    onProgress?: (progress: InstallProgress) => void,
  ): Promise<void>;
}
```

- [ ] **Step 2: Add peer dependencies to package.json**

Update `packages/resolver/package.json`:

```json
{
  "name": "@anthropic-ide/resolver",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run --config ../../vitest.config.ts --dir src",
    "typecheck": "tsc --noEmit"
  },
  "files": ["dist"],
  "peerDependencies": {
    "@anthropic-ide/vfs": "workspace:*",
    "@anthropic-ide/registry-client": "workspace:*"
  }
}
```

Run from repo root: `pnpm install`

- [ ] **Step 3: Write failing lockfile parser tests**

Create `packages/resolver/src/lockfile-parser.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseLockFile } from "./lockfile-parser.js";

const minimalLockV3 = JSON.stringify({
  name: "test-project",
  version: "1.0.0",
  lockfileVersion: 3,
  packages: {
    "": {
      name: "test-project",
      version: "1.0.0",
      dependencies: {
        "is-odd": "^3.0.1",
      },
    },
    "node_modules/is-number": {
      version: "6.0.0",
      resolved: "https://registry.npmjs.org/is-number/-/is-number-6.0.0.tgz",
      integrity: "sha512-fake",
    },
    "node_modules/is-odd": {
      version: "3.0.1",
      resolved: "https://registry.npmjs.org/is-odd/-/is-odd-3.0.1.tgz",
      integrity: "sha512-fake2",
      dependencies: {
        "is-number": "^6.0.0",
      },
    },
  },
});

const lockV2 = JSON.stringify({
  name: "v2-project",
  version: "1.0.0",
  lockfileVersion: 2,
  packages: {
    "": {
      name: "v2-project",
      version: "1.0.0",
      dependencies: { lodash: "^4.17.21" },
    },
    "node_modules/lodash": {
      version: "4.17.21",
      resolved: "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz",
      integrity: "sha512-abc",
    },
  },
  dependencies: {
    lodash: { version: "4.17.21", resolved: "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz" },
  },
});

describe("parseLockFile", () => {
  it("parses lockfile v3 with transitive deps", () => {
    const graph = parseLockFile(minimalLockV3);
    expect(graph.dependencies.size).toBe(2);
    expect(graph.root).toEqual(["is-odd"]);

    const isOdd = graph.dependencies.get("is-odd@3.0.1");
    expect(isOdd).toBeDefined();
    expect(isOdd!.name).toBe("is-odd");
    expect(isOdd!.version).toBe("3.0.1");
    expect(isOdd!.tarballUrl).toBe("https://registry.npmjs.org/is-odd/-/is-odd-3.0.1.tgz");
    expect(isOdd!.dependencies).toEqual({ "is-number": "^6.0.0" });

    const isNumber = graph.dependencies.get("is-number@6.0.0");
    expect(isNumber).toBeDefined();
    expect(isNumber!.version).toBe("6.0.0");
  });

  it("parses lockfile v2 (uses packages field)", () => {
    const graph = parseLockFile(lockV2);
    expect(graph.dependencies.size).toBe(1);
    expect(graph.root).toEqual(["lodash"]);

    const lodash = graph.dependencies.get("lodash@4.17.21");
    expect(lodash).toBeDefined();
    expect(lodash!.tarballUrl).toBe("https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz");
  });

  it("extracts package name from node_modules path", () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { dependencies: { "@scope/pkg": "^1.0.0" } },
        "node_modules/@scope/pkg": {
          version: "1.2.3",
          resolved: "https://registry.npmjs.org/@scope/pkg/-/pkg-1.2.3.tgz",
        },
      },
    });
    const graph = parseLockFile(lock);
    expect(graph.dependencies.size).toBe(1);

    const pkg = graph.dependencies.get("@scope/pkg@1.2.3");
    expect(pkg).toBeDefined();
    expect(pkg!.name).toBe("@scope/pkg");
  });

  it("handles nested node_modules", () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { dependencies: { a: "^1.0.0" } },
        "node_modules/a": {
          version: "1.0.0",
          resolved: "https://registry.npmjs.org/a/-/a-1.0.0.tgz",
          dependencies: { b: "^2.0.0" },
        },
        "node_modules/a/node_modules/b": {
          version: "2.0.0",
          resolved: "https://registry.npmjs.org/b/-/b-2.0.0.tgz",
        },
      },
    });
    const graph = parseLockFile(lock);
    expect(graph.dependencies.size).toBe(2);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseLockFile("not json")).toThrow();
  });

  it("throws on missing packages field", () => {
    expect(() => parseLockFile(JSON.stringify({ lockfileVersion: 3 }))).toThrow(
      "Unsupported lock file format",
    );
  });

  it("throws on lockfile v1 (no packages field)", () => {
    const v1 = JSON.stringify({
      lockfileVersion: 1,
      dependencies: { lodash: { version: "4.17.21" } },
    });
    expect(() => parseLockFile(v1)).toThrow("Unsupported lock file format");
  });

  it("skips entries without resolved URL", () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { dependencies: { a: "^1.0.0" } },
        "node_modules/a": {
          version: "1.0.0",
          resolved: "https://registry.npmjs.org/a/-/a-1.0.0.tgz",
        },
        "node_modules/a-linked": {
          version: "1.0.0",
          link: true,
        },
      },
    });
    const graph = parseLockFile(lock);
    expect(graph.dependencies.size).toBe(1);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd packages/resolver && pnpm test`
Expected: FAIL — `parseLockFile` not found

- [ ] **Step 5: Implement lockfile-parser.ts**

Create `packages/resolver/src/lockfile-parser.ts`:

```ts
import type { DependencyGraph, ResolvedDependency } from "./types.js";

interface LockFilePackageEntry {
  version?: string;
  resolved?: string;
  integrity?: string;
  dependencies?: Record<string, string>;
  link?: boolean;
  name?: string;
}

interface LockFileContent {
  lockfileVersion?: number;
  packages?: Record<string, LockFilePackageEntry>;
}

export function parseLockFile(content: string): DependencyGraph {
  const lock = JSON.parse(content) as LockFileContent;

  if (!lock.packages || typeof lock.packages !== "object") {
    throw new Error(
      "Unsupported lock file format: missing 'packages' field. Only package-lock.json v2/v3 is supported.",
    );
  }

  const dependencies = new Map<string, ResolvedDependency>();
  const rootEntry = lock.packages[""];
  const root: string[] = rootEntry?.dependencies
    ? Object.keys(rootEntry.dependencies)
    : [];

  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path === "") continue;
    if (!entry.version || !entry.resolved) continue;
    if (entry.link) continue;

    const name = extractPackageName(path);
    if (!name) continue;

    const key = `${name}@${entry.version}`;

    if (!dependencies.has(key)) {
      dependencies.set(key, {
        name,
        version: entry.version,
        tarballUrl: entry.resolved,
        integrity: entry.integrity,
        dependencies: entry.dependencies,
      });
    }
  }

  return { dependencies, root };
}

function extractPackageName(nodeModulesPath: string): string | null {
  // "node_modules/@scope/pkg" -> "@scope/pkg"
  // "node_modules/a/node_modules/b" -> "b"
  // Take the last node_modules segment
  const parts = nodeModulesPath.split("node_modules/");
  const last = parts[parts.length - 1];
  return last || null;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/resolver && pnpm test`
Expected: all lockfile parser tests PASS

- [ ] **Step 7: Typecheck**

Run: `cd packages/resolver && pnpm typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/resolver/
git commit -m "feat(resolver): add lock file parser for package-lock.json v2/v3"
```

---

### Task 4: resolver installer + public API

**Files:**
- Create: `packages/resolver/src/installer.ts` — install function
- Create: `packages/resolver/src/installer.test.ts` — tests with mock client + MemoryFS
- Modify: `packages/resolver/src/index.ts` — re-export public API

**Interfaces:**
- Consumes:
  - `DependencyGraph`, `InstallProgress`, `IResolver` from Task 3's `types.ts`
  - `parseLockFile(content: string): DependencyGraph` from Task 3's `lockfile-parser.ts`
  - `IVirtualFileSystem` from `@anthropic-ide/vfs`
  - `IRegistryClient` from `@anthropic-ide/registry-client`
- Produces:
  - `createResolver(): IResolver` — factory function
  - `install(graph, vfs, client, onProgress?)` — orchestrates downloads

- [ ] **Step 1: Write failing installer tests**

Create `packages/resolver/src/installer.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { MemoryFS } from "@anthropic-ide/vfs";
import type { IRegistryClient } from "@anthropic-ide/registry-client";
import { createResolver } from "./installer.js";
import type { DependencyGraph, InstallProgress } from "./types.js";

function createMockClient(): IRegistryClient {
  return {
    getPackageMetadata: vi.fn(),
    downloadAndExtract: vi.fn().mockResolvedValue(undefined),
  };
}

function createTestGraph(): DependencyGraph {
  const dependencies = new Map();
  dependencies.set("is-odd@3.0.1", {
    name: "is-odd",
    version: "3.0.1",
    tarballUrl: "https://registry.npmjs.org/is-odd/-/is-odd-3.0.1.tgz",
    integrity: "sha512-fake",
    dependencies: { "is-number": "^6.0.0" },
  });
  dependencies.set("is-number@6.0.0", {
    name: "is-number",
    version: "6.0.0",
    tarballUrl: "https://registry.npmjs.org/is-number/-/is-number-6.0.0.tgz",
    integrity: "sha512-fake2",
  });
  return { dependencies, root: ["is-odd"] };
}

describe("createResolver", () => {
  it("returns an object with parseLockFile and install", () => {
    const resolver = createResolver();
    expect(typeof resolver.parseLockFile).toBe("function");
    expect(typeof resolver.install).toBe("function");
  });
});

describe("install", () => {
  it("downloads all packages in the graph", async () => {
    const vfs = new MemoryFS();
    const client = createMockClient();
    const graph = createTestGraph();
    const resolver = createResolver();

    await resolver.install(graph, vfs, client);

    expect(client.downloadAndExtract).toHaveBeenCalledTimes(2);
    expect(client.downloadAndExtract).toHaveBeenCalledWith(
      "https://registry.npmjs.org/is-odd/-/is-odd-3.0.1.tgz",
      vfs,
      "/node_modules/is-odd",
    );
    expect(client.downloadAndExtract).toHaveBeenCalledWith(
      "https://registry.npmjs.org/is-number/-/is-number-6.0.0.tgz",
      vfs,
      "/node_modules/is-number",
    );
  });

  it("skips already-cached packages", async () => {
    const vfs = new MemoryFS();
    // Pre-populate one package in VFS
    await vfs.mkdir("/node_modules/is-number", { recursive: true });
    await vfs.writeFile("/node_modules/is-number/package.json", '{"name":"is-number"}');

    const client = createMockClient();
    const graph = createTestGraph();
    const resolver = createResolver();

    await resolver.install(graph, vfs, client);

    expect(client.downloadAndExtract).toHaveBeenCalledTimes(1);
    expect(client.downloadAndExtract).toHaveBeenCalledWith(
      "https://registry.npmjs.org/is-odd/-/is-odd-3.0.1.tgz",
      vfs,
      "/node_modules/is-odd",
    );
  });

  it("reports progress via callback", async () => {
    const vfs = new MemoryFS();
    const client = createMockClient();
    const graph = createTestGraph();
    const resolver = createResolver();
    const progress: InstallProgress[] = [];

    await resolver.install(graph, vfs, client, (p) => progress.push({ ...p }));

    expect(progress.length).toBe(2);
    expect(progress[0].total).toBe(2);
    expect(progress[0].downloaded).toBe(1);
    expect(progress[1].downloaded).toBe(2);
    expect(progress[1].total).toBe(2);
  });

  it("works with empty graph", async () => {
    const vfs = new MemoryFS();
    const client = createMockClient();
    const graph: DependencyGraph = { dependencies: new Map(), root: [] };
    const resolver = createResolver();

    await resolver.install(graph, vfs, client);

    expect(client.downloadAndExtract).not.toHaveBeenCalled();
  });

  it("handles scoped packages", async () => {
    const vfs = new MemoryFS();
    const client = createMockClient();
    const dependencies = new Map();
    dependencies.set("@scope/pkg@1.0.0", {
      name: "@scope/pkg",
      version: "1.0.0",
      tarballUrl: "https://registry.npmjs.org/@scope/pkg/-/pkg-1.0.0.tgz",
    });
    const graph: DependencyGraph = { dependencies, root: ["@scope/pkg"] };
    const resolver = createResolver();

    await resolver.install(graph, vfs, client);

    expect(client.downloadAndExtract).toHaveBeenCalledWith(
      "https://registry.npmjs.org/@scope/pkg/-/pkg-1.0.0.tgz",
      vfs,
      "/node_modules/@scope/pkg",
    );
  });

  it("propagates download errors", async () => {
    const vfs = new MemoryFS();
    const client = createMockClient();
    (client.downloadAndExtract as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Download failed"),
    );
    const graph = createTestGraph();
    const resolver = createResolver();

    await expect(resolver.install(graph, vfs, client)).rejects.toThrow("Download failed");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/resolver && pnpm test`
Expected: FAIL — `createResolver` not found

- [ ] **Step 3: Implement installer.ts**

Create `packages/resolver/src/installer.ts`:

```ts
import type { IVirtualFileSystem } from "@anthropic-ide/vfs";
import type { IRegistryClient } from "@anthropic-ide/registry-client";
import type { DependencyGraph, InstallProgress, IResolver } from "./types.js";
import { parseLockFile } from "./lockfile-parser.js";

export function createResolver(): IResolver {
  return {
    parseLockFile,

    async install(
      graph: DependencyGraph,
      vfs: IVirtualFileSystem,
      client: IRegistryClient,
      onProgress?: (progress: InstallProgress) => void,
    ): Promise<void> {
      const entries = Array.from(graph.dependencies.values());
      const total = entries.length;
      let downloaded = 0;

      for (const dep of entries) {
        const destPath = `/node_modules/${dep.name}`;

        const cached = await vfs.exists(`${destPath}/package.json`);
        if (cached) {
          downloaded++;
          continue;
        }

        await client.downloadAndExtract(dep.tarballUrl, vfs, destPath);
        downloaded++;

        if (onProgress) {
          onProgress({ total, downloaded, current: `${dep.name}@${dep.version}` });
        }
      }
    },
  };
}
```

- [ ] **Step 4: Update index.ts**

Update `packages/resolver/src/index.ts`:

```ts
export type {
  ResolvedDependency,
  DependencyGraph,
  InstallProgress,
  IResolver,
} from "./types.js";
export { parseLockFile } from "./lockfile-parser.js";
export { createResolver } from "./installer.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/resolver && pnpm test`
Expected: all tests PASS

- [ ] **Step 6: Run all tests from repo root**

Run: `pnpm test`
Expected: all tests pass (VFS + editor-core + registry-client + resolver)

- [ ] **Step 7: Typecheck and lint**

Run from repo root: `pnpm typecheck` (or `cd packages/resolver && pnpm typecheck`)
Run from repo root: `pnpm lint`
Expected: both PASS

- [ ] **Step 8: Commit**

```bash
git add packages/resolver/
git commit -m "feat(resolver): add installer with VFS caching and progress reporting"
```

---

### Task 5: Integration test + build verification

**Files:**
- Create: `packages/resolver/src/integration.test.ts` — end-to-end test with MemoryFS + mock fetch + real lock file
- Verify: all packages build, lint, typecheck

**Interfaces:**
- Consumes: everything from Tasks 1-4
- Produces: verified working system

- [ ] **Step 1: Write integration test**

Create `packages/resolver/src/integration.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { MemoryFS } from "@anthropic-ide/vfs";
import { createRegistryClient } from "@anthropic-ide/registry-client";
import { createResolver } from "./installer.js";
import { parseLockFile } from "./lockfile-parser.js";
import pako from "pako";

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

    // Verify caching: re-install should skip all
    const client2 = createRegistryClient();
    globalThis.fetch = vi.fn();
    await resolver.install(graph, vfs, client2);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Add pako as devDependency to resolver for integration test**

The integration test imports `pako` for creating mock `.tgz` fixtures. Add it as a devDependency:

```bash
cd packages/resolver && pnpm add -D pako @types/pako
```

Note: If pako types are bundled, skip `@types/pako`. Check with `pnpm typecheck` after adding.

- [ ] **Step 3: Run integration test**

Run: `cd packages/resolver && pnpm test`
Expected: all tests pass (lockfile parser + installer + integration)

- [ ] **Step 4: Run all tests from repo root**

Run: `pnpm test`
Expected: all tests pass across all packages

- [ ] **Step 5: Typecheck and build all packages**

Run from repo root:
```bash
pnpm typecheck
pnpm build
pnpm lint
```
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add packages/resolver/
git commit -m "feat(resolver): add integration test for lock file → install → VFS pipeline"
```

