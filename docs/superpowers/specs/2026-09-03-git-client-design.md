# Git Client Design Spec

**Package:** `@anthropic-ide/git-client`
**Status:** Draft
**Date:** 2026-09-03

## Purpose

Git client for a mobile JS/TS IDE running on iOS (JavaScriptCore/WKWebView). Wraps `isomorphic-git` with a typed façade providing ergonomic API for all common git operations: local repo management, branching, merging, tagging, stash, and network operations (clone, fetch, pull, push).

The package owns no storage and no credentials — both are injected by the consumer.

## Non-Goals

- Custom git implementation (deferred — isomorphic-git covers the current needs)
- OAuth authentication flows (deferred — PAT-based auth for MVP)
- On-disk `.git/` storage optimization (deferred — in-memory VFS for now)
- Interactive rebase (not supported by isomorphic-git)
- Submodules (not supported by isomorphic-git)
- Git hooks execution (not in scope)
- `.gitattributes` processing (not in scope)

## Architecture

Three layers:

1. **GitClient** — Typed façade. The only public class. Maps every method to an `isomorphic-git` call, converting inputs/outputs to our types.
2. **isomorphic-git** — Pure JS git implementation. Handles object model, refs, index, packfile parsing, smart HTTP protocol.
3. **Injected backends** — `fs` (VFS via fs-shim adapter) and `http` (injectable HTTP client for remote operations).

```
Consumer (Swift app)
  → GitClient.clone(url)
    → isomorphic-git.clone({ fs, http, dir, url, onAuth })
      → fs adapter → VFS (MemoryFS)
      → http adapter → Swift URLSession
```

### Dependencies

- `isomorphic-git` `^1.41.9` — sole runtime dependency. Pure JS, no native bindings.
- `@anthropic-ide/vfs` — NOT a dependency. Consumer creates a VFS instance and passes an fs-compatible adapter. The git-client package defines its own `FsAdapter` interface (duck-typed against isomorphic-git's FS plugin contract).

### Why isomorphic-git

- Pure JS, works in browser/JSC — no Node-specific APIs
- Pluggable fs and http backends — maps directly to our VFS + injectable transport
- Battle-tested (~4.5k GitHub stars), covers clone/fetch/push/pull/merge/diff
- Known gaps (rebase, submodules) are acceptable for MVP; custom implementations can replace specific operations later

## Core Types

### Authentication

```ts
interface GitAuth {
  username?: string;
  password?: string; // Personal Access Token
}

type OnAuth = (url: string) => GitAuth | Promise<GitAuth>;
```

Consumer provides credentials via callback. The package never stores or caches credentials. For GitHub/GitLab, PAT is passed as `password` with any non-empty `username` (convention: `"x-access-token"`).

### HTTP Backend

```ts
interface GitHttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array[];
}

interface GitHttpResponse {
  url: string;
  method: string;
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string>;
  body?: Uint8Array[];
}

interface IGitHttpClient {
  request(config: GitHttpRequest): Promise<GitHttpResponse>;
}
```

This interface matches isomorphic-git's HTTP plugin contract. The adapter maps our `IGitHttpClient` to the `{ request }` object isomorphic-git expects. Swift implements `IGitHttpClient` with `URLSession`, handling the binary packfile bodies.

Key difference from `IHttpTransport` in ai-assistant: git smart HTTP protocol uses binary packfile bodies (`Uint8Array[]`), not SSE text streams.

### FS Adapter

```ts
interface FsAdapter {
  readFile(filepath: string, opts?: { encoding?: string }): Promise<Uint8Array | string>;
  writeFile(filepath: string, data: Uint8Array | string): Promise<void>;
  unlink(filepath: string): Promise<void>;
  readdir(filepath: string): Promise<string[]>;
  mkdir(filepath: string, opts?: { mode?: number }): Promise<void>;
  rmdir(filepath: string): Promise<void>;
  stat(filepath: string): Promise<{ type: string; mode: number; size: number; mtimeMs: number; isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }>;
  lstat(filepath: string): Promise<{ type: string; mode: number; size: number; mtimeMs: number; isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }>;
  rename(oldPath: string, newPath: string): Promise<void>;
  readlink(filepath: string): Promise<string>;
  symlink(target: string, filepath: string): Promise<void>;
}
```

Duck-typed against isomorphic-git's FS plugin. The `createFsAdapter(vfs: IVirtualFileSystem): FsAdapter` factory function maps VFS operations to this interface, wrapping VFS's `Uint8Array` returns and adding missing fields (like `mode`, `mtimeMs`) from VFS's `FileStat`.

isomorphic-git calls `fs.promises.*` — the adapter must be structured as `{ promises: FsAdapter }`.

### Git Data Types

```ts
interface GitAuthor {
  name: string;
  email: string;
}

interface GitCommit {
  oid: string;
  message: string;
  author: GitAuthor & { timestamp: number };
  parent: string[];
}

interface GitLogEntry {
  oid: string;
  commit: GitCommit;
}

interface GitStatusRow {
  filepath: string;
  head: 0 | 1;
  workdir: 0 | 1 | 2;
  stage: 0 | 1 | 2 | 3;
}
```

Status matrix follows isomorphic-git's convention:
- `head`: 0 = absent in HEAD, 1 = present in HEAD
- `workdir`: 0 = absent, 1 = identical to index, 2 = modified vs index
- `stage`: 0 = absent, 1 = identical to HEAD, 2 = modified vs HEAD, 3 = added (not in HEAD)

```ts
interface GitBranch {
  name: string;
  current: boolean;
  oid: string;
}

interface GitRemote {
  name: string;
  url: string;
}

interface GitTag {
  name: string;
  oid: string;
}

interface GitStashEntry {
  index: number;
  message: string;
  oid: string;
}

interface GitProgress {
  phase: string;
  loaded: number;
  total: number;
}

type OnProgress = (progress: GitProgress) => void;
```

## GitClient API

```ts
interface GitClientOptions {
  fs: FsAdapter;
  http: IGitHttpClient;
  dir: string;
  onAuth?: OnAuth;
  author?: GitAuthor;
}

class GitClient {
  constructor(options: GitClientOptions);

  // --- Init & Clone ---
  init(): Promise<void>;
  clone(url: string, opts?: {
    ref?: string;
    depth?: number;
    onProgress?: OnProgress;
  }): Promise<void>;

  // --- Staging ---
  add(filepath: string): Promise<void>;
  remove(filepath: string): Promise<void>;

  // --- Commits ---
  commit(message: string, opts?: { author?: GitAuthor }): Promise<string>;
  log(opts?: { ref?: string; depth?: number }): Promise<GitLogEntry[]>;

  // --- Status ---
  status(filepath: string): Promise<GitStatusRow>;
  statusAll(): Promise<GitStatusRow[]>;

  // --- Branches ---
  branch(name: string): Promise<void>;
  deleteBranch(name: string): Promise<void>;
  listBranches(): Promise<GitBranch[]>;
  checkout(ref: string): Promise<void>;
  currentBranch(): Promise<string | undefined>;

  // --- Merge ---
  merge(theirs: string, opts?: { author?: GitAuthor }): Promise<string>;

  // --- Tags ---
  tag(name: string, opts?: { ref?: string }): Promise<void>;
  deleteTag(name: string): Promise<void>;
  listTags(): Promise<GitTag[]>;

  // --- Remotes ---
  addRemote(name: string, url: string): Promise<void>;
  deleteRemote(name: string): Promise<void>;
  listRemotes(): Promise<GitRemote[]>;

  // --- Network ---
  fetch(opts?: {
    remote?: string;
    ref?: string;
    onProgress?: OnProgress;
  }): Promise<void>;
  pull(opts?: {
    remote?: string;
    ref?: string;
    author?: GitAuthor;
    onProgress?: OnProgress;
  }): Promise<void>;
  push(opts?: {
    remote?: string;
    ref?: string;
    onProgress?: OnProgress;
  }): Promise<void>;

  // --- Stash ---
  stash(opts?: { message?: string }): Promise<void>;
  stashPop(): Promise<void>;
  stashList(): Promise<GitStashEntry[]>;
}
```

### Method Behavior

Each method is a thin wrapper around the corresponding `isomorphic-git` function:

- **init()**: `git.init({ fs, dir })`. Creates `.git/` structure in VFS.
- **clone()**: `git.clone({ fs, http, dir, url, ref, depth, onProgress, onAuth })`. Clones into `dir`.
- **add()**: `git.add({ fs, dir, filepath })`. Stages a file.
- **remove()**: `git.remove({ fs, dir, filepath })`. Unstages/removes a file from index.
- **commit()**: `git.commit({ fs, dir, message, author })`. Uses `options.author` as default, overridable per-call. Returns the commit OID.
- **log()**: `git.log({ fs, dir, ref, depth })`. Maps `ReadCommitResult` to `GitLogEntry`.
- **status()**: `git.status({ fs, dir, filepath })`. Returns status matrix row.
- **statusAll()**: `git.statusMatrix({ fs, dir })`. Maps matrix rows to `GitStatusRow[]`.
- **branch()**: `git.branch({ fs, dir, ref: name })`. Creates a new branch.
- **deleteBranch()**: `git.deleteBranch({ fs, dir, ref: name })`.
- **listBranches()**: `git.listBranches({ fs, dir })` + `git.resolveRef()` for OIDs + `git.currentBranch()` for current flag.
- **checkout()**: `git.checkout({ fs, dir, ref })`. Switches HEAD and updates working tree.
- **currentBranch()**: `git.currentBranch({ fs, dir })`.
- **merge()**: `git.merge({ fs, dir, ours: current, theirs, author })`. Returns merge commit OID. On conflict, throws with conflict details.
- **tag()**: `git.tag({ fs, dir, ref: name, object: opts.ref })`.
- **deleteTag()**: `git.deleteTag({ fs, dir, ref: name })`.
- **listTags()**: `git.listTags({ fs, dir })` + `git.resolveRef()` for OIDs.
- **addRemote()**: `git.addRemote({ fs, dir, remote: name, url })`.
- **deleteRemote()**: `git.deleteRemote({ fs, dir, remote: name })`.
- **listRemotes()**: `git.listRemotes({ fs, dir })`.
- **fetch()**: `git.fetch({ fs, http, dir, remote, ref, onProgress, onAuth })`.
- **pull()**: `git.pull({ fs, http, dir, remote, ref, author, onProgress, onAuth })`.
- **push()**: `git.push({ fs, http, dir, remote, ref, onProgress, onAuth })`.

### Stash Implementation

isomorphic-git has no built-in stash. Manual implementation using refs:

**stash():**
1. Read current working tree changes (via `statusMatrix`)
2. Create a commit with the changes on a detached ref
3. Store the commit OID in `refs/stash` (append to reflog-like list stored as a JSON file at `.git/stash-list.json`)
4. Restore working tree to HEAD state (`checkout` current branch)

**stashPop():**
1. Read the top entry from `.git/stash-list.json`
2. Read the stash commit's tree
3. Apply the changes to the working tree (checkout the stash commit's files)
4. Remove the entry from the stash list
5. Stage the restored files

**stashList():**
1. Read `.git/stash-list.json`
2. Return entries with index, message, and OID

The stash list is a simple JSON array stored in `.git/stash-list.json` — not the standard git reflog format, but functionally equivalent for our use case.

## Error Handling

- **Network errors**: propagated from `IGitHttpClient` as-is.
- **Auth errors**: HTTP 401/403 from remote — thrown as `GitAuthError` with the URL.
- **Merge conflicts**: thrown as `GitMergeConflictError` with list of conflicting files.
- **Ref not found**: thrown as `GitRefNotFoundError`.
- **Generic git errors**: isomorphic-git errors propagated with their original message.

```ts
class GitError extends Error {
  constructor(message: string);
}

class GitAuthError extends GitError {
  readonly url: string;
}

class GitMergeConflictError extends GitError {
  readonly conflicts: string[];
}

class GitRefNotFoundError extends GitError {
  readonly ref: string;
}
```

## File Structure

```
packages/git-client/src/
  types.ts              — GitAuth, GitCommit, GitStatusRow, GitBranch, GitRemote, GitTag, etc.
  errors.ts             — GitError, GitAuthError, GitMergeConflictError, GitRefNotFoundError
  http.ts               — IGitHttpClient, GitHttpRequest, GitHttpResponse, createHttpAdapter()
  fs-adapter.ts         — FsAdapter interface, createFsAdapter() factory
  stash.ts              — stash/stashPop/stashList implementation
  client.ts             — GitClient class
  index.ts              — public exports
```

## Public API (index.ts exports)

Types: `GitAuth`, `OnAuth`, `GitHttpRequest`, `GitHttpResponse`, `GitAuthor`, `GitCommit`, `GitLogEntry`, `GitStatusRow`, `GitBranch`, `GitRemote`, `GitTag`, `GitStashEntry`, `GitProgress`, `OnProgress`, `GitClientOptions`, `FsAdapter`

Interfaces: `IGitHttpClient`

Classes: `GitClient`, `GitError`, `GitAuthError`, `GitMergeConflictError`, `GitRefNotFoundError`

Functions: `createFsAdapter`, `createHttpAdapter`

## Dependencies

- `isomorphic-git` `^1.41.9` — runtime dependency (pure JS, no native bindings)
- No dependency on `@anthropic-ide/vfs` or any other workspace package. Connection to VFS is through `FsAdapter` injection and the `createFsAdapter()` factory, which accepts any object matching the duck-typed `IVirtualFileSystem` interface.

## Global Constraints

- No Node-specific APIs (`node:*`) in source files (only in `*.test.ts`)
- ES2020 target for JavaScriptCore compatibility
- No `Symbol.asyncIterator` / `for await...of` over custom iterables — use callbacks
- Package scope: `@anthropic-ide/*`
- Cross-package communication only through exported interfaces from `index.ts`

## Testing Strategy

All tests run in-memory using `MemoryFS` from `@anthropic-ide/vfs` (dev dependency, used only in tests).

- **FS adapter tests**: verify `createFsAdapter()` correctly maps VFS operations to isomorphic-git's FS plugin interface. Test `readFile`, `writeFile`, `mkdir`, `stat`, `readdir`, `unlink`, `rename`.
- **HTTP adapter tests**: verify `createHttpAdapter()` maps `IGitHttpClient` to isomorphic-git's HTTP plugin. Mock `IGitHttpClient`, verify request/response mapping.
- **GitClient local tests**: init, add, commit, status, statusAll, log, branch, deleteBranch, listBranches, checkout, currentBranch, tag, deleteTag, listTags, merge. All using MemoryFS — no real filesystem.
- **Stash tests**: stash/pop/list with MemoryFS. Test: stash saves changes and restores clean working tree, pop restores changes, list returns entries in order, pop on empty stash throws.
- **GitClient remote tests**: addRemote, deleteRemote, listRemotes — local operations, MemoryFS only.
- **GitClient network tests**: clone, fetch, pull, push — using mock `IGitHttpClient`. Create a "remote" repo in a second MemoryFS, test clone/fetch/push between them. isomorphic-git supports this via its `{ fs, dir }` parametrization.
- **Error tests**: auth failure (mock 401), merge conflict, ref not found.
- **Integration test**: full workflow — init → add → commit → branch → checkout → edit → commit → merge → log. Verifies the complete local git cycle.
