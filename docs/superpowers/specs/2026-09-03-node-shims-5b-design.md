# Node Shims Phase 5B — stream, fs, crypto

## Overview

Extends `@anthropic-ide/node-shims` with three modules: `stream` (full Node.js streams with backpressure), `fs` (VFS-backed file system), and `crypto` (WebCrypto-backed hashing/encryption). Continues the Phase 5A architecture: each shim is a self-contained TypeScript file compiled to JS and served from VFS.

## Architecture

### Module Layout

```
packages/node-shims/src/shims/
  stream.ts          — Readable, Writable, Duplex, Transform, PassThrough, pipeline
  fs.ts              — callback + promise API over globalThis.__vfs
  crypto.ts          — WebCrypto wrappers with Node-style API
```

### Cross-Shim Imports

- `stream.ts` imports `EventEmitter` from `./events.js`
- `fs.ts` imports `Buffer` from `./buffer.js` and `path` from `./path.js`
- `crypto.ts` imports `Buffer` from `./buffer.js`

No imports from `@anthropic-ide/vfs` or other workspace packages. The VFS interface is accessed at runtime via `globalThis.__vfs`.

### Constants Update

`NODE_BUILTINS` in `constants.ts` must be extended with `"stream"`, `"fs"`, `"crypto"`.

### Plugin

`createNodeShimsPlugin()` already handles any entry in `NODE_BUILTINS` — no plugin changes needed, only the constants array update.

## Module Specifications

### stream

Full Node.js-compatible stream implementation. Depends on `EventEmitter` from `./events.js`.

#### Base Class

```typescript
class Stream extends EventEmitter {
  pipe<T extends Writable>(destination: T, options?: { end?: boolean }): T;
}
```

#### Readable

```typescript
class Readable extends Stream {
  constructor(options?: ReadableOptions);

  // Subclass protocol
  _read(size: number): void;

  // Public API
  push(chunk: any, encoding?: string): boolean;
  read(size?: number): any;
  unshift(chunk: any, encoding?: string): void;
  pipe<T extends Writable>(destination: T, options?: { end?: boolean }): T;
  unpipe(destination?: Writable): this;
  pause(): this;
  resume(): this;
  isPaused(): boolean;
  setEncoding(encoding: string): this;
  destroy(error?: Error): this;

  // Properties
  readable: boolean;
  readableHighWaterMark: number;
  readableLength: number;
  readableFlowing: boolean | null;
  readableObjectMode: boolean;
  readableEncoded: boolean;
  destroyed: boolean;
}

interface ReadableOptions {
  highWaterMark?: number;    // default 16384 (bytes), 16 (objectMode)
  objectMode?: boolean;      // default false
  encoding?: string;
  autoDestroy?: boolean;     // default true
  read?(this: Readable, size: number): void;
}
```

**Events:** `data`, `end`, `error`, `close`, `readable`, `pause`, `resume`.

**Flowing mode:** starts when `data` listener added or `resume()` called. Stops on `pause()` or `unpipe()`.

**Backpressure:** `push()` returns `false` when internal buffer exceeds `highWaterMark`. `_read()` called when buffer drains below threshold.

#### Writable

```typescript
class Writable extends Stream {
  constructor(options?: WritableOptions);

  // Subclass protocol
  _write(chunk: any, encoding: string, callback: (error?: Error | null) => void): void;
  _final(callback: (error?: Error | null) => void): void;
  _destroy(error: Error | null, callback: (error?: Error | null) => void): void;

  // Public API
  write(chunk: any, encoding?: string, callback?: (error?: Error | null) => void): boolean;
  end(chunk?: any, encoding?: string, callback?: () => void): this;
  cork(): void;
  uncork(): void;
  destroy(error?: Error): this;
  setDefaultEncoding(encoding: string): this;

  // Properties
  writable: boolean;
  writableHighWaterMark: number;
  writableLength: number;
  writableObjectMode: boolean;
  writableFinished: boolean;
  writableCorked: number;
  destroyed: boolean;
}

interface WritableOptions {
  highWaterMark?: number;    // default 16384 (bytes), 16 (objectMode)
  objectMode?: boolean;      // default false
  decodeStrings?: boolean;   // default true
  defaultEncoding?: string;  // default "utf-8"
  autoDestroy?: boolean;     // default true
  write?(this: Writable, chunk: any, encoding: string, callback: (error?: Error | null) => void): void;
  final?(this: Writable, callback: (error?: Error | null) => void): void;
}
```

**Events:** `drain`, `finish`, `error`, `close`, `pipe`, `unpipe`.

**Backpressure:** `write()` returns `false` when internal buffer exceeds `highWaterMark`. Emits `drain` when buffer empties.

**Cork/uncork:** `cork()` buffers writes; `uncork()` flushes. Nesting supported via `writableCorked` counter.

#### Duplex

```typescript
class Duplex extends Readable implements Writable {
  constructor(options?: DuplexOptions);

  // Writable methods mixed in
  write(chunk: any, encoding?: string, callback?: (error?: Error | null) => void): boolean;
  end(chunk?: any, encoding?: string, callback?: () => void): this;
  cork(): void;
  uncork(): void;
  setDefaultEncoding(encoding: string): this;

  // Writable subclass protocol
  _write(chunk: any, encoding: string, callback: (error?: Error | null) => void): void;
  _final(callback: (error?: Error | null) => void): void;

  // Properties (both Readable + Writable)
  writable: boolean;
  writableHighWaterMark: number;
  writableLength: number;
  writableObjectMode: boolean;
  writableFinished: boolean;
  writableCorked: number;
}

interface DuplexOptions extends ReadableOptions, WritableOptions {
  allowHalfOpen?: boolean;   // default true
  readableObjectMode?: boolean;
  writableObjectMode?: boolean;
  readableHighWaterMark?: number;
  writableHighWaterMark?: number;
}
```

**allowHalfOpen:** when `false`, writable side auto-ends when readable side ends.

#### Transform

```typescript
class Transform extends Duplex {
  constructor(options?: TransformOptions);

  // Subclass protocol
  _transform(chunk: any, encoding: string, callback: (error?: Error | null, data?: any) => void): void;
  _flush(callback: (error?: Error | null, data?: any) => void): void;
}

interface TransformOptions extends DuplexOptions {
  transform?(this: Transform, chunk: any, encoding: string, callback: (error?: Error | null, data?: any) => void): void;
  flush?(this: Transform, callback: (error?: Error | null, data?: any) => void): void;
}
```

Transform's `_write` delegates to `_transform`. Transform's readable side gets data from `_transform`'s callback or `this.push()`.

#### PassThrough

```typescript
class PassThrough extends Transform {
  // _transform simply passes chunk through: callback(null, chunk)
}
```

#### pipeline

```typescript
function pipeline(...streams: Stream[], callback: (error?: Error | null) => void): void;
function pipeline(streams: Stream[], callback: (error?: Error | null) => void): void;
```

Pipes streams in sequence. If any stream errors or closes prematurely, all streams in the pipeline are destroyed. Calls `callback` on completion or error.

#### Module Exports

```typescript
export { Stream, Readable, Writable, Duplex, Transform, PassThrough, pipeline };
export default { Stream, Readable, Writable, Duplex, Transform, PassThrough, pipeline };
```

### fs

File system shim backed by `globalThis.__vfs` (conforming to `IVirtualFileSystem` from `@anthropic-ide/vfs`). Provides both callback and promise APIs.

#### VFS Access

```typescript
interface VfsLike {
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

declare const globalThis: { __vfs?: VfsLike };
```

The `VfsLike` interface is declared locally in `fs.ts` — it duck-types against `IVirtualFileSystem` without importing it. If `globalThis.__vfs` is not set, all operations throw `Error("fs: VFS not initialized. Set globalThis.__vfs before using fs.")`.

#### Helper

```typescript
function getVfs(): VfsLike {
  const vfs = (globalThis as any).__vfs;
  if (!vfs) throw new Error("fs: VFS not initialized. Set globalThis.__vfs before using fs.");
  return vfs;
}
```

#### Stats Class

```typescript
class Stats {
  constructor(stat: { type: "file" | "directory" | "symlink"; size: number; mtime: number });

  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  isBlockDevice(): boolean;      // always false
  isCharacterDevice(): boolean;  // always false
  isFIFO(): boolean;             // always false
  isSocket(): boolean;           // always false

  size: number;
  mtime: Date;
  mtimeMs: number;
  atime: Date;      // equals mtime (VFS doesn't track atime)
  atimeMs: number;
  ctime: Date;      // equals mtime
  ctimeMs: number;
  birthtime: Date;  // equals mtime
  birthtimeMs: number;
  mode: number;     // 0o644 for files, 0o755 for directories
  uid: number;      // 0
  gid: number;      // 0
}
```

#### Callback API

All callback functions follow Node convention: `callback(error, result)`. Paths are resolved via `path.resolve()` before passing to VFS.

```typescript
function readFile(path: string, callback: (err: NodeJS.ErrnoException | null, data: Buffer) => void): void;
function readFile(path: string, options: { encoding: string }, callback: (err: NodeJS.ErrnoException | null, data: string) => void): void;
function readFile(path: string, options: string, callback: (err: NodeJS.ErrnoException | null, data: string) => void): void;

function writeFile(path: string, data: string | Buffer | Uint8Array, callback: (err: NodeJS.ErrnoException | null) => void): void;
function writeFile(path: string, data: string | Buffer | Uint8Array, options: { encoding?: string }, callback: (err: NodeJS.ErrnoException | null) => void): void;

function readdir(path: string, callback: (err: NodeJS.ErrnoException | null, files: string[]) => void): void;
function stat(path: string, callback: (err: NodeJS.ErrnoException | null, stats: Stats) => void): void;
function lstat(path: string, callback: (err: NodeJS.ErrnoException | null, stats: Stats) => void): void;
function mkdir(path: string, callback: (err: NodeJS.ErrnoException | null) => void): void;
function mkdir(path: string, options: { recursive?: boolean }, callback: (err: NodeJS.ErrnoException | null) => void): void;
function rmdir(path: string, callback: (err: NodeJS.ErrnoException | null) => void): void;
function rmdir(path: string, options: { recursive?: boolean }, callback: (err: NodeJS.ErrnoException | null) => void): void;
function unlink(path: string, callback: (err: NodeJS.ErrnoException | null) => void): void;
function rename(oldPath: string, newPath: string, callback: (err: NodeJS.ErrnoException | null) => void): void;
function exists(path: string, callback: (exists: boolean) => void): void;
function symlink(target: string, path: string, callback: (err: NodeJS.ErrnoException | null) => void): void;
function readlink(path: string, callback: (err: NodeJS.ErrnoException | null, linkString: string) => void): void;
```

**Error format:** errors include `code` (`"ENOENT"`, `"EEXIST"`, `"EISDIR"`, `"ENOTDIR"`, `"ENOTEMPTY"`) mapped from VFS error messages. The shim wraps VFS rejections into `ErrnoException`-shaped errors with `code`, `message`, `path`, and `syscall` fields.

#### Promise API

```typescript
const promises = {
  readFile(path: string, options?: { encoding?: string } | string): Promise<Buffer | string>;
  writeFile(path: string, data: string | Buffer | Uint8Array, options?: { encoding?: string }): Promise<void>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<Stats>;
  lstat(path: string): Promise<Stats>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rmdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  unlink(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  symlink(target: string, path: string): Promise<void>;
  readlink(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
};
```

#### Constants

```typescript
const constants = {
  F_OK: 0,
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,
};
```

#### Module Exports

```typescript
export {
  readFile, writeFile, readdir, stat, lstat,
  mkdir, rmdir, unlink, rename, exists,
  symlink, readlink, Stats, constants, promises,
};
export default {
  readFile, writeFile, readdir, stat, lstat,
  mkdir, rmdir, unlink, rename, exists,
  symlink, readlink, Stats, constants, promises,
};
```

### crypto

WebCrypto-backed implementation of Node.js `crypto` API subset. Available in WKWebView via `crypto.subtle` and `crypto.getRandomValues`.

#### Ambient Declarations

```typescript
declare const crypto: {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  randomUUID(): string;
  subtle: {
    digest(algorithm: string, data: BufferSource): Promise<ArrayBuffer>;
    sign(algorithm: string | object, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer>;
    importKey(
      format: string, keyData: BufferSource, algorithm: string | object,
      extractable: boolean, keyUsages: string[]
    ): Promise<CryptoKey>;
    deriveBits(algorithm: object, baseKey: CryptoKey, length: number): Promise<ArrayBuffer>;
    encrypt(algorithm: object, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer>;
    decrypt(algorithm: object, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer>;
  };
};
```

#### Algorithm Mapping

```typescript
const HASH_ALGORITHMS: Record<string, string> = {
  "sha1": "SHA-1",
  "sha-1": "SHA-1",
  "sha256": "SHA-256",
  "sha-256": "SHA-256",
  "sha384": "SHA-384",
  "sha-384": "SHA-384",
  "sha512": "SHA-512",
  "sha-512": "SHA-512",
};

const CIPHER_ALGORITHMS: Record<string, string> = {
  "aes-128-cbc": "AES-CBC",
  "aes-192-cbc": "AES-CBC",
  "aes-256-cbc": "AES-CBC",
  "aes-128-gcm": "AES-GCM",
  "aes-192-gcm": "AES-GCM",
  "aes-256-gcm": "AES-GCM",
  "aes-128-ctr": "AES-CTR",
  "aes-192-ctr": "AES-CTR",
  "aes-256-ctr": "AES-CTR",
};
```

**MD5:** not supported by WebCrypto. If `createHash("md5")` is called, throw `Error("md5 is not supported — use sha256 or higher")`. This is a deliberate exclusion: MD5 is cryptographically broken, and implementing it in pure JS would be slow and insecure.

#### Hash

```typescript
class Hash {
  constructor(algorithm: string);

  update(data: string | Buffer | Uint8Array, encoding?: string): this;
  digest(): Promise<Buffer>;
  digest(encoding: "hex" | "base64"): Promise<string>;
}
```

**Usage:**
```typescript
const hash = createHash("sha256");
hash.update("hello");
const result = await hash.digest("hex"); // async!
```

Internal: accumulates data in a buffer array, calls `crypto.subtle.digest()` on `digest()`.

#### Hmac

```typescript
class Hmac {
  constructor(algorithm: string, key: string | Buffer | Uint8Array);

  update(data: string | Buffer | Uint8Array, encoding?: string): this;
  digest(): Promise<Buffer>;
  digest(encoding: "hex" | "base64"): Promise<string>;
}
```

Internal: uses `crypto.subtle.importKey` + `crypto.subtle.sign` with HMAC algorithm.

#### Cipher / Decipher

```typescript
class Cipher {
  constructor(algorithm: string, key: Buffer | Uint8Array, iv: Buffer | Uint8Array);

  update(data: string | Buffer | Uint8Array, inputEncoding?: string, outputEncoding?: string): Promise<Buffer>;
  final(outputEncoding?: string): Promise<Buffer>;
  getAuthTag(): Buffer;        // GCM only, available after final()
}

class Decipher {
  constructor(algorithm: string, key: Buffer | Uint8Array, iv: Buffer | Uint8Array);

  update(data: Buffer | Uint8Array, inputEncoding?: string, outputEncoding?: string): Promise<Buffer>;
  final(outputEncoding?: string): Promise<Buffer>;
  setAuthTag(tag: Buffer | Uint8Array): this;  // GCM only, must call before final()
}
```

Internal: accumulates data, calls `crypto.subtle.encrypt`/`decrypt` on `final()`.

#### Sync Functions

```typescript
function randomBytes(size: number): Buffer;
function randomFillSync(buffer: Buffer | Uint8Array, offset?: number, size?: number): Buffer | Uint8Array;
function randomUUID(): string;
function randomInt(max: number): number;
function randomInt(min: number, max: number): number;
function timingSafeEqual(a: Buffer | Uint8Array, b: Buffer | Uint8Array): boolean;
```

`randomBytes` uses `crypto.getRandomValues` (sync, available in WKWebView).

#### Key Derivation

```typescript
function pbkdf2(
  password: string | Buffer, salt: string | Buffer,
  iterations: number, keylen: number, digest: string,
  callback: (err: Error | null, derivedKey: Buffer) => void
): void;
```

Internal: `crypto.subtle.importKey` → `crypto.subtle.deriveBits` with PBKDF2 params.

`pbkdf2Sync` is not implemented — throws `Error("pbkdf2Sync is not supported. Use pbkdf2 (async) instead.")`.

#### Factory Functions

```typescript
function createHash(algorithm: string): Hash;
function createHmac(algorithm: string, key: string | Buffer | Uint8Array): Hmac;
function createCipheriv(algorithm: string, key: Buffer | Uint8Array, iv: Buffer | Uint8Array): Cipher;
function createDecipheriv(algorithm: string, key: Buffer | Uint8Array, iv: Buffer | Uint8Array): Decipher;
```

#### Module Exports

```typescript
export {
  Hash, Hmac, Cipher, Decipher,
  createHash, createHmac, createCipheriv, createDecipheriv,
  randomBytes, randomFillSync, randomUUID, randomInt,
  timingSafeEqual, pbkdf2,
};
export default {
  Hash, Hmac, Cipher, Decipher,
  createHash, createHmac, createCipheriv, createDecipheriv,
  randomBytes, randomFillSync, randomUUID, randomInt,
  timingSafeEqual, pbkdf2,
};
```

## Constraints

All constraints from Phase 5A apply:

- **ES2020 target** — no top-level await, no `??=`
- **No Node APIs in source** — shim modules cannot import from `node:*`
- **No workspace imports** — shims cannot import from `@anthropic-ide/vfs` or other workspace packages. Cross-shim imports use relative paths only (`./events.js`, `./buffer.js`, `./path.js`).
- **Self-contained compiled output** — each compiled `.js` shim must work in VFS
- **POSIX only** — no Windows path separators
- **Pure JS** — no native bindings, no WASM, no Web Workers
- **fs VFS injection** — `globalThis.__vfs` must be set before `fs` operations. The `fs` shim never imports from `@anthropic-ide/vfs` directly.

## Testing Strategy

Each shim module has its own test file: `shims/stream.test.ts`, `shims/fs.test.ts`, `shims/crypto.test.ts`.

### stream tests

Test Readable (flowing/paused mode, push/read, backpressure, objectMode, encoding), Writable (write/end, drain, cork/uncork, backpressure), Duplex (both sides), Transform (_transform/_flush, PassThrough), pipeline (success, error propagation, multi-stream), destroy/autoDestroy, pipe/unpipe.

### fs tests

Tests require a real VFS instance. Import `MemoryFileSystem` from `@anthropic-ide/vfs` in tests (allowed — test files can use Node/workspace imports). Set `globalThis.__vfs = memfs` before each test.

Test callback API (readFile, writeFile, readdir, stat, mkdir, rmdir, unlink, rename, exists, symlink, readlink), promise API (same operations), Stats class, error mapping (ENOENT, EEXIST, EISDIR, ENOTDIR), encoding parameter (Buffer vs string result), path resolution.

### crypto tests

Test randomBytes (length, type), randomUUID (format), randomInt (range), timingSafeEqual, createHash (sha256 known vectors), createHmac (known vectors), createCipheriv/createDecipheriv (AES-256-CBC roundtrip, AES-256-GCM with authTag), pbkdf2 (known vectors), unsupported algorithm errors, pbkdf2Sync error.

**Note:** `crypto.subtle` is available in Node.js 15+ (vitest runs under Node), so crypto tests work without polyfills. Tests use `/// <reference types="node" />` as in Phase 5A.

### Integration tests

Extend the existing `integration.test.ts` to verify that `stream`, `fs`, and `crypto` resolve through the esbuild plugin and produce working bundles.

## Dependencies

No new dependencies. Phase 5A already has:
- `esbuild-wasm` (dependency)
- `@types/node` (devDependency)
- `@anthropic-ide/vfs` (peerDependency)

The `fs` tests will import `MemoryFileSystem` from `@anthropic-ide/vfs` directly (test files are allowed workspace imports).
