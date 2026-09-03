# Git Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Git client façade over isomorphic-git with injectable VFS and HTTP backends, covering local operations, branching, merging, tagging, stash, and network (clone/fetch/pull/push).

**Architecture:** Thin typed wrapper around isomorphic-git. Consumer injects fs (VFS adapter) and http (network backend). No direct dependency on `@anthropic-ide/vfs` — connection via duck-typed `FsAdapter`. Stash implemented manually over `refs/stash` + `.git/stash-list.json`.

**Tech Stack:** TypeScript, isomorphic-git ^1.41.9, vitest, ES2020 target

**Spec:** `docs/superpowers/specs/2026-09-03-git-client-design.md`

## Global Constraints

- No Node-specific APIs (`node:*`) in source files — only in `*.test.ts`
- ES2020 target for JavaScriptCore compatibility
- No `Symbol.asyncIterator` / `for await...of` over custom iterables — use callbacks
- Package scope: `@anthropic-ide/*`
- Cross-package communication only through exported interfaces from `index.ts`
- Only allowed runtime dependency: `isomorphic-git` `^1.41.9`
- `@anthropic-ide/vfs` is a devDependency only (used in tests)
- isomorphic-git expects fs as `{ promises: { readFile, writeFile, ... } }` structure
- `GitClient` constructor receives a ready `FsAdapter` — the consumer is responsible for creating it (using `createFsAdapter()` or their own)

---

## File Map

```
packages/git-client/src/
  types.ts              — GitAuth, OnAuth, GitAuthor, GitCommit, GitLogEntry, GitStatusRow, GitBranch, GitRemote, GitTag, GitStashEntry, GitProgress, OnProgress, GitClientOptions
  errors.ts             — GitError, GitAuthError, GitMergeConflictError, GitRefNotFoundError
  http.ts               — IGitHttpClient, GitHttpRequest, GitHttpResponse, createHttpAdapter()
  fs-adapter.ts         — FsAdapter interface, VfsLike interface, createFsAdapter()
  stash.ts              — saveStash(), popStash(), listStash() — standalone functions taking fs/dir
  client.ts             — GitClient class
  index.ts              — public exports

  fs-adapter.test.ts    — FsAdapter tests
  http.test.ts          — HTTP adapter tests
  client.test.ts        — GitClient local operations tests
  stash.test.ts         — Stash tests
  network.test.ts       — GitClient network operations tests (clone/fetch/push/pull)
  integration.test.ts   — Full workflow integration test
```

---

### Task 1: Types, Errors, and Package Setup

**Files:**
- Create: `packages/git-client/src/types.ts`
- Create: `packages/git-client/src/errors.ts`
- Modify: `packages/git-client/src/index.ts`
- Modify: `packages/git-client/package.json`
- Modify: `packages/git-client/tsconfig.json`

**Interfaces:**
- Consumes: nothing
- Produces: All type interfaces (`GitAuth`, `OnAuth`, `GitAuthor`, `GitCommit`, `GitLogEntry`, `GitStatusRow`, `GitBranch`, `GitRemote`, `GitTag`, `GitStashEntry`, `GitProgress`, `OnProgress`, `GitClientOptions`), all error classes (`GitError`, `GitAuthError`, `GitMergeConflictError`, `GitRefNotFoundError`), `IGitHttpClient`, `GitHttpRequest`, `GitHttpResponse`, `FsAdapter`, `VfsLike`

- [ ] **Step 1: Install isomorphic-git and add vfs as devDependency**

```bash
pnpm add isomorphic-git --filter @anthropic-ide/git-client
pnpm add -D @anthropic-ide/vfs --filter @anthropic-ide/git-client
```

- [ ] **Step 2: Update tsconfig.json to add DOM lib (for Uint8Array)**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "lib": ["ES2020", "DOM"]
  },
  "include": ["src"],
  "references": []
}
```

- [ ] **Step 3: Write types.ts**

```ts
// packages/git-client/src/types.ts

export interface GitAuth {
  username?: string;
  password?: string;
}

export type OnAuth = (url: string) => GitAuth | Promise<GitAuth>;

export interface GitAuthor {
  name: string;
  email: string;
}

export interface GitCommit {
  oid: string;
  message: string;
  author: GitAuthor & { timestamp: number };
  parent: string[];
}

export interface GitLogEntry {
  oid: string;
  commit: GitCommit;
}

export interface GitStatusRow {
  filepath: string;
  head: 0 | 1;
  workdir: 0 | 1 | 2;
  stage: 0 | 1 | 2 | 3;
}

export interface GitBranch {
  name: string;
  current: boolean;
  oid: string;
}

export interface GitRemote {
  name: string;
  url: string;
}

export interface GitTag {
  name: string;
  oid: string;
}

export interface GitStashEntry {
  index: number;
  message: string;
  oid: string;
}

export interface GitProgress {
  phase: string;
  loaded: number;
  total: number;
}

export type OnProgress = (progress: GitProgress) => void;

export interface GitHttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array[];
}

export interface GitHttpResponse {
  url: string;
  method: string;
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string>;
  body?: Uint8Array[];
}

export interface IGitHttpClient {
  request(config: GitHttpRequest): Promise<GitHttpResponse>;
}

export interface FsAdapterStats {
  type: string;
  mode: number;
  size: number;
  mtimeMs: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export interface FsAdapter {
  readFile(filepath: string, opts?: { encoding?: string }): Promise<Uint8Array | string>;
  writeFile(filepath: string, data: Uint8Array | string): Promise<void>;
  unlink(filepath: string): Promise<void>;
  readdir(filepath: string): Promise<string[]>;
  mkdir(filepath: string, opts?: { mode?: number }): Promise<void>;
  rmdir(filepath: string): Promise<void>;
  stat(filepath: string): Promise<FsAdapterStats>;
  lstat(filepath: string): Promise<FsAdapterStats>;
  rename(oldPath: string, newPath: string): Promise<void>;
  readlink(filepath: string): Promise<string>;
  symlink(target: string, filepath: string): Promise<void>;
}

export interface VfsLike {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: Uint8Array | string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<{ type: "file" | "directory" | "symlink"; size: number; mtime: number }>;
  lstat(path: string): Promise<{ type: "file" | "directory" | "symlink"; size: number; mtime: number }>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rmdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  unlink(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  symlink(target: string, path: string): Promise<void>;
  readlink(path: string): Promise<string>;
}

export interface GitClientOptions {
  fs: FsAdapter;
  http: IGitHttpClient;
  dir: string;
  onAuth?: OnAuth;
  author?: GitAuthor;
}
```

- [ ] **Step 4: Write errors.ts**

```ts
// packages/git-client/src/errors.ts

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitError";
  }
}

export class GitAuthError extends GitError {
  readonly url: string;
  constructor(url: string) {
    super(`Authentication failed for ${url}`);
    this.name = "GitAuthError";
    this.url = url;
  }
}

export class GitMergeConflictError extends GitError {
  readonly conflicts: string[];
  constructor(conflicts: string[]) {
    super(`Merge conflict in: ${conflicts.join(", ")}`);
    this.name = "GitMergeConflictError";
    this.conflicts = conflicts;
  }
}

export class GitRefNotFoundError extends GitError {
  readonly ref: string;
  constructor(ref: string) {
    super(`Ref not found: ${ref}`);
    this.name = "GitRefNotFoundError";
    this.ref = ref;
  }
}
```

- [ ] **Step 5: Write index.ts with types and errors exports**

```ts
// packages/git-client/src/index.ts

export type {
  GitAuth,
  OnAuth,
  GitAuthor,
  GitCommit,
  GitLogEntry,
  GitStatusRow,
  GitBranch,
  GitRemote,
  GitTag,
  GitStashEntry,
  GitProgress,
  OnProgress,
  GitHttpRequest,
  GitHttpResponse,
  IGitHttpClient,
  FsAdapter,
  FsAdapterStats,
  VfsLike,
  GitClientOptions,
} from "./types.js";

export {
  GitError,
  GitAuthError,
  GitMergeConflictError,
  GitRefNotFoundError,
} from "./errors.js";
```

- [ ] **Step 6: Verify build**

Run: `pnpm --filter @anthropic-ide/git-client run build`
Expected: PASS — compiles with no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/git-client/
git commit -m "feat(git-client): add types, errors, and package setup with isomorphic-git"
```

---

### Task 2: FS Adapter

**Files:**
- Create: `packages/git-client/src/fs-adapter.ts`
- Create: `packages/git-client/src/fs-adapter.test.ts`
- Modify: `packages/git-client/src/index.ts` — add `createFsAdapter` export

**Interfaces:**
- Consumes: `FsAdapter`, `FsAdapterStats`, `VfsLike` from `types.ts`
- Produces: `createFsAdapter(vfs: VfsLike): { promises: FsAdapter }` — factory function returning the `{ promises: ... }` structure isomorphic-git expects

- [ ] **Step 1: Write failing tests for createFsAdapter**

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @anthropic-ide/git-client run test`
Expected: FAIL — `createFsAdapter` not found

- [ ] **Step 3: Implement createFsAdapter**

```ts
// packages/git-client/src/fs-adapter.ts

import type { FsAdapter, FsAdapterStats, VfsLike } from "./types.js";

function makeStat(vfsStat: { type: "file" | "directory" | "symlink"; size: number; mtime: number }): FsAdapterStats {
  const t = vfsStat.type;
  return {
    type: t,
    mode: t === "directory" ? 0o755 : 0o644,
    size: vfsStat.size,
    mtimeMs: vfsStat.mtime,
    isFile: () => t === "file",
    isDirectory: () => t === "directory",
    isSymbolicLink: () => t === "symlink",
  };
}

function createAdapter(vfs: VfsLike): FsAdapter {
  return {
    async readFile(filepath: string, opts?: { encoding?: string }): Promise<Uint8Array | string> {
      const data = await vfs.readFile(filepath);
      if (opts?.encoding) {
        return new TextDecoder().decode(data);
      }
      return data;
    },
    async writeFile(filepath: string, data: Uint8Array | string): Promise<void> {
      await vfs.writeFile(filepath, data);
    },
    async unlink(filepath: string): Promise<void> {
      await vfs.unlink(filepath);
    },
    async readdir(filepath: string): Promise<string[]> {
      return vfs.readdir(filepath);
    },
    async mkdir(filepath: string): Promise<void> {
      await vfs.mkdir(filepath);
    },
    async rmdir(filepath: string): Promise<void> {
      await vfs.rmdir(filepath);
    },
    async stat(filepath: string): Promise<FsAdapterStats> {
      return makeStat(await vfs.stat(filepath));
    },
    async lstat(filepath: string): Promise<FsAdapterStats> {
      return makeStat(await vfs.lstat(filepath));
    },
    async rename(oldPath: string, newPath: string): Promise<void> {
      await vfs.rename(oldPath, newPath);
    },
    async readlink(filepath: string): Promise<string> {
      return vfs.readlink(filepath);
    },
    async symlink(target: string, filepath: string): Promise<void> {
      await vfs.symlink(target, filepath);
    },
  };
}

export function createFsAdapter(vfs: VfsLike): { promises: FsAdapter } {
  return { promises: createAdapter(vfs) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @anthropic-ide/git-client run test`
Expected: PASS

- [ ] **Step 5: Add createFsAdapter to index.ts**

Add to `packages/git-client/src/index.ts`:
```ts
export { createFsAdapter } from "./fs-adapter.js";
```

- [ ] **Step 6: Verify build**

Run: `pnpm --filter @anthropic-ide/git-client run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/git-client/src/fs-adapter.ts packages/git-client/src/fs-adapter.test.ts packages/git-client/src/index.ts
git commit -m "feat(git-client): add VFS-to-isomorphic-git FS adapter with tests"
```

---

### Task 3: HTTP Adapter

**Files:**
- Create: `packages/git-client/src/http.ts`
- Create: `packages/git-client/src/http.test.ts`
- Modify: `packages/git-client/src/index.ts` — add `createHttpAdapter` export

**Interfaces:**
- Consumes: `IGitHttpClient`, `GitHttpRequest`, `GitHttpResponse` from `types.ts`
- Produces: `createHttpAdapter(client: IGitHttpClient): { request: (config: IsomorphicGitHttpRequest) => Promise<IsomorphicGitHttpResponse> }` — maps our interface to isomorphic-git's HTTP plugin

- [ ] **Step 1: Write failing tests for createHttpAdapter**

```ts
// packages/git-client/src/http.test.ts

import { describe, it, expect, vi } from "vitest";
import { createHttpAdapter } from "./http.js";
import type { IGitHttpClient } from "./types.js";

function mockClient(response: {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string>;
  body?: Uint8Array[];
}): IGitHttpClient {
  return {
    request: vi.fn().mockResolvedValue({
      url: "https://example.com/repo.git/info/refs",
      method: "GET",
      ...response,
    }),
  };
}

describe("createHttpAdapter", () => {
  it("returns object with request method", () => {
    const client = mockClient({ statusCode: 200, statusMessage: "OK", headers: {} });
    const adapter = createHttpAdapter(client);
    expect(adapter).toHaveProperty("request");
    expect(typeof adapter.request).toBe("function");
  });

  it("maps isomorphic-git request to IGitHttpClient.request", async () => {
    const client = mockClient({
      statusCode: 200,
      statusMessage: "OK",
      headers: { "content-type": "application/x-git-upload-pack-advertisement" },
      body: [new Uint8Array([1, 2, 3])],
    });
    const adapter = createHttpAdapter(client);

    const result = await adapter.request({
      url: "https://example.com/repo.git/info/refs?service=git-upload-pack",
      method: "GET",
      headers: { "accept": "application/x-git-upload-pack-advertisement" },
    });

    expect(client.request).toHaveBeenCalledWith({
      url: "https://example.com/repo.git/info/refs?service=git-upload-pack",
      method: "GET",
      headers: { "accept": "application/x-git-upload-pack-advertisement" },
      body: undefined,
    });

    expect(result.statusCode).toBe(200);
    expect(result.headers).toEqual({ "content-type": "application/x-git-upload-pack-advertisement" });
  });

  it("passes body as Uint8Array array", async () => {
    const client = mockClient({
      statusCode: 200,
      statusMessage: "OK",
      headers: {},
      body: [new Uint8Array([10, 20])],
    });
    const adapter = createHttpAdapter(client);

    const bodyChunk = new Uint8Array([5, 6, 7]);
    await adapter.request({
      url: "https://example.com/repo.git/git-upload-pack",
      method: "POST",
      headers: { "content-type": "application/x-git-upload-pack-request" },
      body: [bodyChunk],
    });

    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({ body: [bodyChunk] }),
    );
  });

  it("returns body as iterable of Uint8Array", async () => {
    const chunk1 = new Uint8Array([1, 2]);
    const chunk2 = new Uint8Array([3, 4]);
    const client = mockClient({
      statusCode: 200,
      statusMessage: "OK",
      headers: {},
      body: [chunk1, chunk2],
    });
    const adapter = createHttpAdapter(client);

    const result = await adapter.request({
      url: "https://example.com/repo.git/info/refs",
      method: "GET",
      headers: {},
    });

    const chunks: Uint8Array[] = [];
    for (const chunk of result.body) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([chunk1, chunk2]);
  });

  it("handles empty body response", async () => {
    const client = mockClient({
      statusCode: 204,
      statusMessage: "No Content",
      headers: {},
    });
    const adapter = createHttpAdapter(client);

    const result = await adapter.request({
      url: "https://example.com/repo.git/info/refs",
      method: "GET",
      headers: {},
    });

    expect(result.statusCode).toBe(204);
    const chunks: Uint8Array[] = [];
    for (const chunk of result.body) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @anthropic-ide/git-client run test`
Expected: FAIL — `createHttpAdapter` not found

- [ ] **Step 3: Implement createHttpAdapter**

isomorphic-git's HTTP plugin expects `request(config)` where config has `{ url, method, headers, body }` and returns `{ url, method, statusCode, statusMessage, headers, body }` where `body` is an iterable of `Uint8Array`.

```ts
// packages/git-client/src/http.ts

import type { IGitHttpClient } from "./types.js";

interface IsomorphicGitHttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array[];
}

interface IsomorphicGitHttpResponse {
  url: string;
  method: string;
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string>;
  body: Iterable<Uint8Array>;
}

export function createHttpAdapter(
  client: IGitHttpClient,
): { request: (config: IsomorphicGitHttpRequest) => Promise<IsomorphicGitHttpResponse> } {
  return {
    async request(config: IsomorphicGitHttpRequest): Promise<IsomorphicGitHttpResponse> {
      const response = await client.request({
        url: config.url,
        method: config.method,
        headers: config.headers,
        body: config.body,
      });

      return {
        url: response.url,
        method: response.method,
        statusCode: response.statusCode,
        statusMessage: response.statusMessage,
        headers: response.headers,
        body: response.body ?? [],
      };
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @anthropic-ide/git-client run test`
Expected: PASS

- [ ] **Step 5: Add createHttpAdapter to index.ts**

Add to `packages/git-client/src/index.ts`:
```ts
export { createHttpAdapter } from "./http.js";
```

- [ ] **Step 6: Verify build**

Run: `pnpm --filter @anthropic-ide/git-client run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/git-client/src/http.ts packages/git-client/src/http.test.ts packages/git-client/src/index.ts
git commit -m "feat(git-client): add HTTP adapter bridging IGitHttpClient to isomorphic-git"
```

---

### Task 4: GitClient — Local Operations

**Files:**
- Create: `packages/git-client/src/client.ts`
- Create: `packages/git-client/src/client.test.ts`
- Modify: `packages/git-client/src/index.ts` — add `GitClient` export

**Interfaces:**
- Consumes: `GitClientOptions`, `GitAuthor`, `GitLogEntry`, `GitCommit`, `GitStatusRow`, `GitBranch`, `GitTag`, `GitRemote`, `FsAdapter` from `types.ts`; `GitError`, `GitRefNotFoundError`, `GitMergeConflictError` from `errors.ts`; `createFsAdapter` from `fs-adapter.ts` (in tests only)
- Produces: `GitClient` class with methods: `init()`, `add()`, `remove()`, `commit()`, `log()`, `status()`, `statusAll()`, `branch()`, `deleteBranch()`, `listBranches()`, `checkout()`, `currentBranch()`, `merge()`, `tag()`, `deleteTag()`, `listTags()`, `addRemote()`, `deleteRemote()`, `listRemotes()`

- [ ] **Step 1: Write failing tests for GitClient local operations**

```ts
// packages/git-client/src/client.test.ts

import { describe, it, expect, beforeEach } from "vitest";
import { MemoryFS } from "@anthropic-ide/vfs";
import { createFsAdapter } from "./fs-adapter.js";
import { GitClient } from "./client.js";
import type { IGitHttpClient } from "./types.js";

const dummyHttp: IGitHttpClient = {
  request: () => Promise.reject(new Error("no network in local tests")),
};

const testAuthor = { name: "Test User", email: "test@example.com" };

describe("GitClient local operations", () => {
  let vfs: InstanceType<typeof MemoryFS>;
  let client: GitClient;

  beforeEach(async () => {
    vfs = new MemoryFS();
    await vfs.mkdir("/repo", { recursive: true });
    const fs = createFsAdapter(vfs);
    client = new GitClient({ fs: fs.promises, http: dummyHttp, dir: "/repo", author: testAuthor });
  });

  describe("init", () => {
    it("creates .git directory", async () => {
      await client.init();
      const stat = await vfs.stat("/repo/.git");
      expect(stat.type).toBe("directory");
    });
  });

  describe("add + commit + log", () => {
    it("commits a file and returns oid", async () => {
      await client.init();
      await vfs.writeFile("/repo/hello.txt", "hello world");
      await client.add("hello.txt");
      const oid = await client.commit("initial commit");
      expect(typeof oid).toBe("string");
      expect(oid.length).toBe(40);
    });

    it("log returns commit history", async () => {
      await client.init();
      await vfs.writeFile("/repo/file.txt", "v1");
      await client.add("file.txt");
      await client.commit("first");

      await vfs.writeFile("/repo/file.txt", "v2");
      await client.add("file.txt");
      await client.commit("second");

      const entries = await client.log();
      expect(entries.length).toBe(2);
      expect(entries[0].commit.message).toBe("second\n");
      expect(entries[1].commit.message).toBe("first\n");
    });

    it("log with depth limits results", async () => {
      await client.init();
      await vfs.writeFile("/repo/file.txt", "v1");
      await client.add("file.txt");
      await client.commit("first");

      await vfs.writeFile("/repo/file.txt", "v2");
      await client.add("file.txt");
      await client.commit("second");

      const entries = await client.log({ depth: 1 });
      expect(entries.length).toBe(1);
    });
  });

  describe("status", () => {
    it("reports new untracked file", async () => {
      await client.init();
      await vfs.writeFile("/repo/new.txt", "content");
      const row = await client.status("new.txt");
      expect(row.filepath).toBe("new.txt");
      expect(row.head).toBe(0);
      expect(row.workdir).toBe(2);
      expect(row.stage).toBe(0);
    });

    it("statusAll returns all files", async () => {
      await client.init();
      await vfs.writeFile("/repo/a.txt", "a");
      await vfs.writeFile("/repo/b.txt", "b");
      const rows = await client.statusAll();
      expect(rows.length).toBe(2);
      expect(rows.map(r => r.filepath).sort()).toEqual(["a.txt", "b.txt"]);
    });
  });

  describe("remove", () => {
    it("unstages a file", async () => {
      await client.init();
      await vfs.writeFile("/repo/file.txt", "content");
      await client.add("file.txt");
      await client.remove("file.txt");
      const row = await client.status("file.txt");
      expect(row.stage).toBe(0);
    });
  });

  describe("branches", () => {
    it("creates and lists branches", async () => {
      await client.init();
      await vfs.writeFile("/repo/file.txt", "content");
      await client.add("file.txt");
      await client.commit("initial");

      await client.branch("feature");
      const branches = await client.listBranches();
      const names = branches.map(b => b.name).sort();
      expect(names).toContain("main");
      expect(names).toContain("feature");
    });

    it("currentBranch returns current branch name", async () => {
      await client.init();
      await vfs.writeFile("/repo/file.txt", "content");
      await client.add("file.txt");
      await client.commit("initial");

      const current = await client.currentBranch();
      expect(current).toBe("main");
    });

    it("checkout switches branch", async () => {
      await client.init();
      await vfs.writeFile("/repo/file.txt", "content");
      await client.add("file.txt");
      await client.commit("initial");

      await client.branch("feature");
      await client.checkout("feature");
      expect(await client.currentBranch()).toBe("feature");
    });

    it("deleteBranch removes branch", async () => {
      await client.init();
      await vfs.writeFile("/repo/file.txt", "content");
      await client.add("file.txt");
      await client.commit("initial");

      await client.branch("feature");
      await client.deleteBranch("feature");
      const branches = await client.listBranches();
      expect(branches.map(b => b.name)).not.toContain("feature");
    });
  });

  describe("tags", () => {
    it("creates and lists tags", async () => {
      await client.init();
      await vfs.writeFile("/repo/file.txt", "content");
      await client.add("file.txt");
      const oid = await client.commit("initial");

      await client.tag("v1.0.0");
      const tags = await client.listTags();
      expect(tags.length).toBe(1);
      expect(tags[0].name).toBe("v1.0.0");
      expect(tags[0].oid).toBe(oid);
    });

    it("deleteTag removes tag", async () => {
      await client.init();
      await vfs.writeFile("/repo/file.txt", "content");
      await client.add("file.txt");
      await client.commit("initial");

      await client.tag("v1.0.0");
      await client.deleteTag("v1.0.0");
      const tags = await client.listTags();
      expect(tags.length).toBe(0);
    });
  });

  describe("merge", () => {
    it("merges a branch", async () => {
      await client.init();
      await vfs.writeFile("/repo/file.txt", "base");
      await client.add("file.txt");
      await client.commit("base commit");

      await client.branch("feature");
      await client.checkout("feature");
      await vfs.writeFile("/repo/feature.txt", "feature work");
      await client.add("feature.txt");
      await client.commit("feature commit");

      await client.checkout("main");
      const mergeOid = await client.merge("feature");
      expect(typeof mergeOid).toBe("string");

      const entries = await client.log();
      expect(entries.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("remotes", () => {
    it("adds and lists remotes", async () => {
      await client.init();
      await client.addRemote("origin", "https://github.com/user/repo.git");
      const remotes = await client.listRemotes();
      expect(remotes.length).toBe(1);
      expect(remotes[0].name).toBe("origin");
      expect(remotes[0].url).toBe("https://github.com/user/repo.git");
    });

    it("deletes remote", async () => {
      await client.init();
      await client.addRemote("origin", "https://github.com/user/repo.git");
      await client.deleteRemote("origin");
      const remotes = await client.listRemotes();
      expect(remotes.length).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @anthropic-ide/git-client run test`
Expected: FAIL — `GitClient` not found

- [ ] **Step 3: Implement GitClient class**

```ts
// packages/git-client/src/client.ts

import git from "isomorphic-git";
import type {
  GitClientOptions,
  GitAuthor,
  GitLogEntry,
  GitStatusRow,
  GitBranch,
  GitTag,
  GitRemote,
  GitStashEntry,
  FsAdapter,
  OnProgress,
  OnAuth,
  IGitHttpClient,
} from "./types.js";
import { GitMergeConflictError } from "./errors.js";
import { createHttpAdapter } from "./http.js";

export class GitClient {
  private readonly _fs: { promises: FsAdapter };
  private readonly _http: { request: (config: any) => Promise<any> };
  private readonly _dir: string;
  private readonly _onAuth?: OnAuth;
  private readonly _author?: GitAuthor;

  constructor(options: GitClientOptions) {
    this._fs = { promises: options.fs };
    this._http = createHttpAdapter(options.http);
    this._dir = options.dir;
    this._onAuth = options.onAuth;
    this._author = options.author;
  }

  private _getAuthor(override?: GitAuthor): { name: string; email: string } {
    const author = override ?? this._author;
    if (!author) {
      throw new Error("No author specified. Provide author in constructor options or per-method call.");
    }
    return author;
  }

  async init(): Promise<void> {
    await git.init({ fs: this._fs, dir: this._dir, defaultBranch: "main" });
  }

  async clone(url: string, opts?: { ref?: string; depth?: number; onProgress?: OnProgress }): Promise<void> {
    await git.clone({
      fs: this._fs,
      http: this._http,
      dir: this._dir,
      url,
      ref: opts?.ref,
      depth: opts?.depth,
      onProgress: opts?.onProgress,
      onAuth: this._onAuth ? () => this._onAuth!(url) : undefined,
    });
  }

  async add(filepath: string): Promise<void> {
    await git.add({ fs: this._fs, dir: this._dir, filepath });
  }

  async remove(filepath: string): Promise<void> {
    await git.remove({ fs: this._fs, dir: this._dir, filepath });
  }

  async commit(message: string, opts?: { author?: GitAuthor }): Promise<string> {
    const author = this._getAuthor(opts?.author);
    return git.commit({ fs: this._fs, dir: this._dir, message, author });
  }

  async log(opts?: { ref?: string; depth?: number }): Promise<GitLogEntry[]> {
    const commits = await git.log({
      fs: this._fs,
      dir: this._dir,
      ref: opts?.ref,
      depth: opts?.depth,
    });
    return commits.map((c) => ({
      oid: c.oid,
      commit: {
        oid: c.oid,
        message: c.commit.message,
        author: {
          name: c.commit.author.name,
          email: c.commit.author.email,
          timestamp: c.commit.author.timestamp,
        },
        parent: c.commit.parent,
      },
    }));
  }

  async status(filepath: string): Promise<GitStatusRow> {
    const status = await git.status({ fs: this._fs, dir: this._dir, filepath });
    const matrix = await git.statusMatrix({ fs: this._fs, dir: this._dir, filepaths: [filepath] });
    if (matrix.length === 0) {
      return { filepath, head: 0, workdir: 0, stage: 0 } as GitStatusRow;
    }
    const [, head, workdir, stage] = matrix[0];
    return { filepath, head, workdir, stage } as GitStatusRow;
  }

  async statusAll(): Promise<GitStatusRow[]> {
    const matrix = await git.statusMatrix({ fs: this._fs, dir: this._dir });
    return matrix.map(([filepath, head, workdir, stage]) => ({
      filepath,
      head,
      workdir,
      stage,
    })) as GitStatusRow[];
  }

  async branch(name: string): Promise<void> {
    await git.branch({ fs: this._fs, dir: this._dir, ref: name });
  }

  async deleteBranch(name: string): Promise<void> {
    await git.deleteBranch({ fs: this._fs, dir: this._dir, ref: name });
  }

  async listBranches(): Promise<GitBranch[]> {
    const names = await git.listBranches({ fs: this._fs, dir: this._dir });
    const current = await this.currentBranch();
    const branches: GitBranch[] = [];
    for (const name of names) {
      const oid = await git.resolveRef({ fs: this._fs, dir: this._dir, ref: name });
      branches.push({ name, current: name === current, oid });
    }
    return branches;
  }

  async checkout(ref: string): Promise<void> {
    await git.checkout({ fs: this._fs, dir: this._dir, ref });
  }

  async currentBranch(): Promise<string | undefined> {
    const branch = await git.currentBranch({ fs: this._fs, dir: this._dir });
    return branch ?? undefined;
  }

  async merge(theirs: string, opts?: { author?: GitAuthor }): Promise<string> {
    const author = this._getAuthor(opts?.author);
    try {
      const result = await git.merge({
        fs: this._fs,
        dir: this._dir,
        theirs,
        author,
      });
      return result.oid ?? "";
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("CONFLICT")) {
        throw new GitMergeConflictError([theirs]);
      }
      throw err;
    }
  }

  async tag(name: string, opts?: { ref?: string }): Promise<void> {
    await git.tag({
      fs: this._fs,
      dir: this._dir,
      ref: name,
      object: opts?.ref,
    });
  }

  async deleteTag(name: string): Promise<void> {
    await git.deleteTag({ fs: this._fs, dir: this._dir, ref: name });
  }

  async listTags(): Promise<GitTag[]> {
    const names = await git.listTags({ fs: this._fs, dir: this._dir });
    const tags: GitTag[] = [];
    for (const name of names) {
      const oid = await git.resolveRef({ fs: this._fs, dir: this._dir, ref: `refs/tags/${name}` });
      tags.push({ name, oid });
    }
    return tags;
  }

  async addRemote(name: string, url: string): Promise<void> {
    await git.addRemote({ fs: this._fs, dir: this._dir, remote: name, url });
  }

  async deleteRemote(name: string): Promise<void> {
    await git.deleteRemote({ fs: this._fs, dir: this._dir, remote: name });
  }

  async listRemotes(): Promise<GitRemote[]> {
    const remotes = await git.listRemotes({ fs: this._fs, dir: this._dir });
    return remotes.map((r) => ({ name: r.remote, url: r.url }));
  }

  async fetch(opts?: { remote?: string; ref?: string; onProgress?: OnProgress }): Promise<void> {
    await git.fetch({
      fs: this._fs,
      http: this._http,
      dir: this._dir,
      remote: opts?.remote,
      ref: opts?.ref,
      onProgress: opts?.onProgress,
      onAuth: this._onAuth ? (url: string) => this._onAuth!(url) : undefined,
    });
  }

  async pull(opts?: { remote?: string; ref?: string; author?: GitAuthor; onProgress?: OnProgress }): Promise<void> {
    const author = this._getAuthor(opts?.author);
    await git.pull({
      fs: this._fs,
      http: this._http,
      dir: this._dir,
      remote: opts?.remote,
      ref: opts?.ref,
      author,
      onProgress: opts?.onProgress,
      onAuth: this._onAuth ? (url: string) => this._onAuth!(url) : undefined,
    });
  }

  async push(opts?: { remote?: string; ref?: string; onProgress?: OnProgress }): Promise<void> {
    await git.push({
      fs: this._fs,
      http: this._http,
      dir: this._dir,
      remote: opts?.remote,
      ref: opts?.ref,
      onProgress: opts?.onProgress,
      onAuth: this._onAuth ? (url: string) => this._onAuth!(url) : undefined,
    });
  }

  async stash(_opts?: { message?: string }): Promise<void> {
    throw new Error("Not implemented — see Task 5");
  }

  async stashPop(): Promise<void> {
    throw new Error("Not implemented — see Task 5");
  }

  async stashList(): Promise<GitStashEntry[]> {
    throw new Error("Not implemented — see Task 5");
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @anthropic-ide/git-client run test`
Expected: PASS

- [ ] **Step 5: Add GitClient to index.ts**

Add to `packages/git-client/src/index.ts`:
```ts
export { GitClient } from "./client.js";
```

- [ ] **Step 6: Verify build**

Run: `pnpm --filter @anthropic-ide/git-client run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/git-client/src/client.ts packages/git-client/src/client.test.ts packages/git-client/src/index.ts
git commit -m "feat(git-client): add GitClient with local git operations"
```

---

### Task 5: Stash Implementation

**Files:**
- Create: `packages/git-client/src/stash.ts`
- Create: `packages/git-client/src/stash.test.ts`
- Modify: `packages/git-client/src/client.ts` — replace stash stubs with real implementation

**Interfaces:**
- Consumes: `FsAdapter`, `GitStashEntry` from `types.ts`; `GitClient` from `client.ts`; `createFsAdapter` from `fs-adapter.ts` (in tests)
- Produces: `saveStash(fs, dir, message?)`, `popStash(fs, dir)`, `listStash(fs, dir)` — standalone functions; `GitClient.stash()`, `GitClient.stashPop()`, `GitClient.stashList()` now delegate to these functions

- [ ] **Step 1: Write failing tests for stash**

```ts
// packages/git-client/src/stash.test.ts

import { describe, it, expect, beforeEach } from "vitest";
import { MemoryFS } from "@anthropic-ide/vfs";
import { createFsAdapter } from "./fs-adapter.js";
import { GitClient } from "./client.js";
import type { IGitHttpClient } from "./types.js";

const dummyHttp: IGitHttpClient = {
  request: () => Promise.reject(new Error("no network")),
};

const testAuthor = { name: "Test", email: "test@test.com" };

describe("stash", () => {
  let vfs: InstanceType<typeof MemoryFS>;
  let client: GitClient;

  beforeEach(async () => {
    vfs = new MemoryFS();
    await vfs.mkdir("/repo", { recursive: true });
    const fs = createFsAdapter(vfs);
    client = new GitClient({ fs: fs.promises, http: dummyHttp, dir: "/repo", author: testAuthor });
    await client.init();
    await vfs.writeFile("/repo/base.txt", "base content");
    await client.add("base.txt");
    await client.commit("initial commit");
  });

  it("stash saves working directory changes", async () => {
    await vfs.writeFile("/repo/base.txt", "modified content");
    await client.add("base.txt");
    await client.stash({ message: "wip changes" });

    const content = await vfs.readFile("/repo/base.txt");
    const text = new TextDecoder().decode(content);
    expect(text).toBe("base content");
  });

  it("stashList returns stash entries", async () => {
    await vfs.writeFile("/repo/base.txt", "modified");
    await client.add("base.txt");
    await client.stash({ message: "first stash" });

    const list = await client.stashList();
    expect(list.length).toBe(1);
    expect(list[0].index).toBe(0);
    expect(list[0].message).toBe("first stash");
    expect(typeof list[0].oid).toBe("string");
  });

  it("stashPop restores changes", async () => {
    await vfs.writeFile("/repo/base.txt", "modified for stash");
    await client.add("base.txt");
    await client.stash({ message: "my stash" });

    await client.stashPop();

    const content = await vfs.readFile("/repo/base.txt");
    const text = new TextDecoder().decode(content);
    expect(text).toBe("modified for stash");
  });

  it("stashPop removes entry from list", async () => {
    await vfs.writeFile("/repo/base.txt", "mod");
    await client.add("base.txt");
    await client.stash({ message: "temp" });

    await client.stashPop();

    const list = await client.stashList();
    expect(list.length).toBe(0);
  });

  it("stashPop on empty stash throws", async () => {
    await expect(client.stashPop()).rejects.toThrow();
  });

  it("multiple stashes stack correctly", async () => {
    await vfs.writeFile("/repo/base.txt", "first change");
    await client.add("base.txt");
    await client.stash({ message: "first" });

    await vfs.writeFile("/repo/base.txt", "second change");
    await client.add("base.txt");
    await client.stash({ message: "second" });

    const list = await client.stashList();
    expect(list.length).toBe(2);
    expect(list[0].message).toBe("second");
    expect(list[1].message).toBe("first");
  });

  it("stash with default message", async () => {
    await vfs.writeFile("/repo/base.txt", "changed");
    await client.add("base.txt");
    await client.stash();

    const list = await client.stashList();
    expect(list[0].message).toBe("WIP");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @anthropic-ide/git-client run test`
Expected: FAIL — stash throws "Not implemented"

- [ ] **Step 3: Implement stash.ts**

```ts
// packages/git-client/src/stash.ts

import git from "isomorphic-git";
import type { FsAdapter, GitStashEntry } from "./types.js";

const STASH_LIST_PATH = ".git/stash-list.json";

interface StashRecord {
  oid: string;
  message: string;
}

async function readStashList(fs: { promises: FsAdapter }, dir: string): Promise<StashRecord[]> {
  try {
    const data = await fs.promises.readFile(`${dir}/${STASH_LIST_PATH}`, { encoding: "utf8" });
    return JSON.parse(data as string) as StashRecord[];
  } catch {
    return [];
  }
}

async function writeStashList(fs: { promises: FsAdapter }, dir: string, list: StashRecord[]): Promise<void> {
  await fs.promises.writeFile(`${dir}/${STASH_LIST_PATH}`, JSON.stringify(list));
}

export async function saveStash(
  fs: { promises: FsAdapter },
  dir: string,
  author: { name: string; email: string },
  message?: string,
): Promise<void> {
  const msg = message ?? "WIP";

  const statusMatrix = await git.statusMatrix({ fs, dir });
  const changedFiles = statusMatrix.filter(
    ([, head, workdir, stage]) => head !== workdir || head !== stage,
  );

  if (changedFiles.length === 0) {
    throw new Error("No changes to stash");
  }

  for (const [filepath, , , stage] of changedFiles) {
    if (stage !== 0) {
      await git.add({ fs, dir, filepath });
    }
  }

  const stashOid = await git.commit({
    fs,
    dir,
    message: `stash: ${msg}`,
    author,
  });

  const list = await readStashList(fs, dir);
  list.unshift({ oid: stashOid, message: msg });
  await writeStashList(fs, dir, list);

  const currentBranch = await git.currentBranch({ fs, dir });
  if (currentBranch) {
    const parentCommit = await git.log({ fs, dir, depth: 2 });
    if (parentCommit.length >= 2) {
      const parentOid = parentCommit[1].oid;
      await git.checkout({ fs, dir, ref: currentBranch, force: true });
      await fs.promises.writeFile(
        `${dir}/.git/refs/heads/${currentBranch}`,
        parentOid + "\n",
      );
    }
  }
}

export async function popStash(
  fs: { promises: FsAdapter },
  dir: string,
): Promise<void> {
  const list = await readStashList(fs, dir);
  if (list.length === 0) {
    throw new Error("No stash entries to pop");
  }

  const entry = list[0];
  const stashCommit = await git.readCommit({ fs, dir, oid: entry.oid });
  const stashTree = stashCommit.commit.tree;

  const currentTree = await git.statusMatrix({ fs, dir });
  const stashFiles = await git.listFiles({ fs, dir, ref: entry.oid });

  for (const filepath of stashFiles) {
    const { blob } = await git.readBlob({ fs, dir, oid: stashTree, filepath });
    await fs.promises.writeFile(`${dir}/${filepath}`, blob);
    await git.add({ fs, dir, filepath });
  }

  list.shift();
  await writeStashList(fs, dir, list);
}

export async function listStash(
  fs: { promises: FsAdapter },
  dir: string,
): Promise<GitStashEntry[]> {
  const list = await readStashList(fs, dir);
  return list.map((entry, index) => ({
    index,
    message: entry.message,
    oid: entry.oid,
  }));
}
```

- [ ] **Step 4: Wire stash methods in client.ts**

Replace the three stash stubs in `client.ts`:

```ts
// Replace the stash stubs with:
import { saveStash, popStash, listStash } from "./stash.js";

// In the GitClient class, replace the three stash methods:
  async stash(opts?: { message?: string }): Promise<void> {
    const author = this._getAuthor();
    await saveStash(this._fs, this._dir, author, opts?.message);
  }

  async stashPop(): Promise<void> {
    await popStash(this._fs, this._dir);
  }

  async stashList(): Promise<GitStashEntry[]> {
    return listStash(this._fs, this._dir);
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @anthropic-ide/git-client run test`
Expected: PASS

- [ ] **Step 6: Verify build**

Run: `pnpm --filter @anthropic-ide/git-client run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/git-client/src/stash.ts packages/git-client/src/stash.test.ts packages/git-client/src/client.ts
git commit -m "feat(git-client): add stash implementation over refs and JSON list"
```

---

### Task 6: Network Operations and Integration Tests

**Files:**
- Create: `packages/git-client/src/network.test.ts`
- Create: `packages/git-client/src/integration.test.ts`
- Modify: `packages/git-client/src/index.ts` — finalize all exports

**Interfaces:**
- Consumes: `GitClient` from `client.ts`; `createFsAdapter` from `fs-adapter.ts`; `createHttpAdapter` from `http.ts`; all types from `types.ts`; `MemoryFS` from `@anthropic-ide/vfs`
- Produces: Complete test suite for network operations and full integration workflow

- [ ] **Step 1: Write network tests (clone/fetch/push between in-memory repos)**

isomorphic-git can clone/push between two in-memory repos using the same fs but different directories. No mock HTTP needed for basic in-memory network simulation — we create a bare repo, push to it, and clone from it, all in the same VFS.

```ts
// packages/git-client/src/network.test.ts

import { describe, it, expect, beforeEach } from "vitest";
import git from "isomorphic-git";
import { MemoryFS } from "@anthropic-ide/vfs";
import { createFsAdapter } from "./fs-adapter.js";
import { GitClient } from "./client.js";
import type { IGitHttpClient } from "./types.js";

const dummyHttp: IGitHttpClient = {
  request: () => Promise.reject(new Error("no network")),
};

const testAuthor = { name: "Test", email: "test@test.com" };

describe("GitClient network operations (in-memory)", () => {
  let vfs: InstanceType<typeof MemoryFS>;
  let fs: ReturnType<typeof createFsAdapter>;

  beforeEach(async () => {
    vfs = new MemoryFS();
    fs = createFsAdapter(vfs);
  });

  it("push to bare repo and clone from it", async () => {
    await vfs.mkdir("/origin", { recursive: true });
    await git.init({ fs, dir: "/origin", bare: true });

    await vfs.mkdir("/work", { recursive: true });
    const client = new GitClient({ fs: fs.promises, http: dummyHttp, dir: "/work", author: testAuthor });
    await client.init();
    await vfs.writeFile("/work/readme.txt", "hello");
    await client.add("readme.txt");
    await client.commit("first commit");
    await client.addRemote("origin", "/origin");

    await git.push({
      fs,
      dir: "/work",
      remote: "origin",
    });

    await vfs.mkdir("/clone", { recursive: true });
    const cloneClient = new GitClient({ fs: fs.promises, http: dummyHttp, dir: "/clone", author: testAuthor });

    await git.clone({
      fs,
      dir: "/clone",
      url: "/origin",
    });

    const entries = await cloneClient.log();
    expect(entries.length).toBe(1);
    expect(entries[0].commit.message).toBe("first commit\n");

    const content = await vfs.readFile("/clone/readme.txt");
    expect(new TextDecoder().decode(content)).toBe("hello");
  });

  it("fetch pulls new commits from bare remote", async () => {
    await vfs.mkdir("/origin", { recursive: true });
    await git.init({ fs, dir: "/origin", bare: true });

    await vfs.mkdir("/work", { recursive: true });
    const workClient = new GitClient({ fs: fs.promises, http: dummyHttp, dir: "/work", author: testAuthor });
    await workClient.init();
    await vfs.writeFile("/work/file.txt", "v1");
    await workClient.add("file.txt");
    await workClient.commit("v1");
    await workClient.addRemote("origin", "/origin");
    await git.push({ fs, dir: "/work" , remote: "origin" });

    await vfs.mkdir("/clone", { recursive: true });
    await git.clone({ fs, dir: "/clone", url: "/origin" });
    const cloneClient = new GitClient({ fs: fs.promises, http: dummyHttp, dir: "/clone", author: testAuthor });

    await vfs.writeFile("/work/file.txt", "v2");
    await workClient.add("file.txt");
    await workClient.commit("v2");
    await git.push({ fs, dir: "/work", remote: "origin" });

    await git.fetch({ fs, dir: "/clone", remote: "origin" });
    const entries = await git.log({ fs, dir: "/clone", ref: "origin/main" });
    expect(entries.length).toBe(2);
  });

  it("remotes CRUD", async () => {
    await vfs.mkdir("/repo", { recursive: true });
    const client = new GitClient({ fs: fs.promises, http: dummyHttp, dir: "/repo", author: testAuthor });
    await client.init();

    await client.addRemote("origin", "https://github.com/user/repo.git");
    await client.addRemote("upstream", "https://github.com/org/repo.git");

    let remotes = await client.listRemotes();
    expect(remotes.length).toBe(2);

    await client.deleteRemote("upstream");
    remotes = await client.listRemotes();
    expect(remotes.length).toBe(1);
    expect(remotes[0].name).toBe("origin");
  });
});
```

- [ ] **Step 2: Write integration test**

```ts
// packages/git-client/src/integration.test.ts

import { describe, it, expect } from "vitest";
import { MemoryFS } from "@anthropic-ide/vfs";
import { createFsAdapter } from "./fs-adapter.js";
import { GitClient } from "./client.js";
import type { IGitHttpClient } from "./types.js";

const dummyHttp: IGitHttpClient = {
  request: () => Promise.reject(new Error("no network")),
};

describe("GitClient integration", () => {
  it("full local workflow: init → add → commit → branch → checkout → edit → commit → merge → log → tag → stash", async () => {
    const vfs = new MemoryFS();
    await vfs.mkdir("/repo", { recursive: true });
    const fs = createFsAdapter(vfs);
    const author = { name: "Dev", email: "dev@example.com" };
    const client = new GitClient({ fs: fs.promises, http: dummyHttp, dir: "/repo", author });

    // Init
    await client.init();
    expect(await client.currentBranch()).toBe("main");

    // First commit
    await vfs.writeFile("/repo/index.ts", "export const version = 1;");
    await client.add("index.ts");
    const firstOid = await client.commit("initial commit");
    expect(firstOid.length).toBe(40);

    // Create and switch to feature branch
    await client.branch("feature");
    await client.checkout("feature");
    expect(await client.currentBranch()).toBe("feature");

    // Feature work
    await vfs.writeFile("/repo/feature.ts", "export function hello() { return 'hi'; }");
    await client.add("feature.ts");
    await client.commit("add feature");

    // Back to main
    await client.checkout("main");
    const mainContent = await vfs.readdir("/repo");
    expect(mainContent).not.toContain("feature.ts");

    // Merge feature into main
    const mergeOid = await client.merge("feature");
    expect(typeof mergeOid).toBe("string");

    // Verify merged content
    const files = await vfs.readdir("/repo");
    expect(files).toContain("feature.ts");
    expect(files).toContain("index.ts");

    // Log shows merge history
    const log = await client.log();
    expect(log.length).toBeGreaterThanOrEqual(3);

    // Tag the release
    await client.tag("v1.0.0");
    const tags = await client.listTags();
    expect(tags[0].name).toBe("v1.0.0");

    // Branch list
    const branches = await client.listBranches();
    expect(branches.map(b => b.name).sort()).toEqual(["feature", "main"]);

    // Stash workflow
    await vfs.writeFile("/repo/index.ts", "export const version = 2;");
    await client.add("index.ts");
    await client.stash({ message: "bump version" });

    const stashContent = await vfs.readFile("/repo/index.ts");
    expect(new TextDecoder().decode(stashContent)).toBe("export const version = 1;");

    const stashList = await client.stashList();
    expect(stashList.length).toBe(1);
    expect(stashList[0].message).toBe("bump version");

    await client.stashPop();
    const restoredContent = await vfs.readFile("/repo/index.ts");
    expect(new TextDecoder().decode(restoredContent)).toBe("export const version = 2;");

    // Status check — clean after pop and add
    await client.add("index.ts");
    await client.commit("bump version");
    const status = await client.statusAll();
    const dirty = status.filter(
      r => r.head !== r.workdir || r.head !== r.stage
    );
    expect(dirty.length).toBe(0);

    // Cleanup branch
    await client.deleteBranch("feature");
    const finalBranches = await client.listBranches();
    expect(finalBranches.map(b => b.name)).toEqual(["main"]);
  });
});
```

- [ ] **Step 3: Finalize index.ts exports**

```ts
// packages/git-client/src/index.ts

export type {
  GitAuth,
  OnAuth,
  GitAuthor,
  GitCommit,
  GitLogEntry,
  GitStatusRow,
  GitBranch,
  GitRemote,
  GitTag,
  GitStashEntry,
  GitProgress,
  OnProgress,
  GitHttpRequest,
  GitHttpResponse,
  IGitHttpClient,
  FsAdapter,
  FsAdapterStats,
  VfsLike,
  GitClientOptions,
} from "./types.js";

export {
  GitError,
  GitAuthError,
  GitMergeConflictError,
  GitRefNotFoundError,
} from "./errors.js";

export { createFsAdapter } from "./fs-adapter.js";
export { createHttpAdapter } from "./http.js";
export { GitClient } from "./client.js";
```

- [ ] **Step 4: Run all tests**

Run: `pnpm --filter @anthropic-ide/git-client run test`
Expected: PASS — all test files pass

- [ ] **Step 5: Verify build**

Run: `pnpm --filter @anthropic-ide/git-client run build`
Expected: PASS

- [ ] **Step 6: Run full monorepo tests**

Run: `pnpm -r run test`
Expected: PASS — no regressions in other packages

- [ ] **Step 7: Commit**

```bash
git add packages/git-client/src/
git commit -m "feat(git-client): add network tests and full integration test suite"
```
