# Node Shims Phase 5A — Core Modules Design

## Overview

Package `@anthropic-ide/node-shims` provides pure-JS implementations of Node.js built-in modules for JavaScriptCore/WKWebView. This phase covers 10 core modules and an esbuild plugin that redirects `path` / `node:path` (and equivalents) to the shim implementations.

## Architecture

### Module Layout

```
packages/node-shims/src/
  index.ts              — public API: re-exports plugin + types + populateShims
  types.ts              — ShimSources type
  plugin.ts             — createNodeShimsPlugin(): esbuild.Plugin
  populate.ts           — populateShims(vfs, sources): writes shims into VFS
  shims/
    path.ts
    buffer.ts
    events.ts
    process.ts
    util.ts
    url.ts
    querystring.ts
    string-decoder.ts
    os.ts
    assert.ts
```

Each shim module is a self-contained TypeScript file. Shims may import from sibling shims via relative paths (`import { format } from "./util.js"`). No imports from other workspace packages (`@anthropic-ide/vfs`, etc.) — the compiled shim JS must work standalone inside the VFS.

### Bundler Integration

The esbuild plugin `createNodeShimsPlugin()` intercepts Node built-in bare specifiers:

1. **onResolve**: matches `path`, `node:path`, `buffer`, `node:buffer`, etc.
2. Returns `{ path: "/node_modules/@anthropic-ide/node-shims/<name>.js", namespace: "vfs" }`
3. The existing VFS plugin's `onLoad` (namespace `"vfs"`) reads the file from VFS

The plugin must be listed **before** the VFS plugin and **after** the externals plugin in the esbuild plugins array.

### Shim Delivery to VFS

`populateShims(vfs: IVirtualFileSystem, sources: Record<string, string>)` writes each shim's compiled JS source and a `package.json` into the VFS at `/node_modules/@anthropic-ide/node-shims/`.

In tests: shim sources are read from `dist/shims/*.js` using `node:fs`.
In production: the app provides shim sources from bundled resources (future concern — runtime-bridge phase).

### Constants

```typescript
export const NODE_BUILTINS = [
  "path", "buffer", "events", "process", "util",
  "url", "querystring", "string_decoder", "os", "assert",
] as const;

export const SHIMS_PACKAGE_PATH = "/node_modules/@anthropic-ide/node-shims";
```

## Module Specifications

### path

POSIX-only (iOS runtime). No Windows path support.

**Exports:**
- `sep` = `"/"`
- `delimiter` = `":"`
- `posix` — self-reference (the module itself)
- `join(...paths: string[]): string`
- `resolve(...paths: string[]): string` — resolves against `/` as root (no real cwd)
- `normalize(path: string): string`
- `isAbsolute(path: string): boolean`
- `relative(from: string, to: string): string`
- `dirname(path: string): string`
- `basename(path: string, ext?: string): string`
- `extname(path: string): string`
- `parse(path: string): { root, dir, base, ext, name }`
- `format(pathObject: { root?, dir?, base?, ext?, name? }): string`
- `default` — object with all named exports

### buffer

`Buffer` class backed by `Uint8Array`. Uses `TextEncoder`/`TextDecoder` (available in WKWebView).

**Supported encodings:** `utf-8` (alias `utf8`), `ascii`, `latin1` (alias `binary`), `base64`, `hex`.

**Static methods:**
- `Buffer.from(str, encoding?)` / `Buffer.from(array)` / `Buffer.from(arrayBuffer, offset?, length?)`
- `Buffer.alloc(size, fill?, encoding?)`
- `Buffer.allocUnsafe(size)` — same as `alloc` (no uninitialized memory in JS)
- `Buffer.concat(list, totalLength?)`
- `Buffer.isBuffer(obj): boolean`
- `Buffer.byteLength(str, encoding?): number`
- `Buffer.isEncoding(encoding): boolean`

**Instance methods:**
- `toString(encoding?, start?, end?)`
- `write(str, offset?, length?, encoding?): number`
- `slice(start?, end?)` — returns new Buffer (wraps `subarray`)
- `copy(target, targetStart?, sourceStart?, sourceEnd?): number`
- `equals(other): boolean`
- `compare(other): number`
- `indexOf(value, byteOffset?, encoding?): number`
- `fill(value, offset?, end?, encoding?): this`
- `readUInt8(offset)`, `readUInt16LE(offset)`, `readUInt16BE(offset)`, `readUInt32LE(offset)`, `readUInt32BE(offset)`
- `readInt8(offset)`, `readInt16LE(offset)`, `readInt16BE(offset)`, `readInt32LE(offset)`, `readInt32BE(offset)`
- `writeUInt8(value, offset)`, `writeUInt16LE(value, offset)`, `writeUInt16BE(value, offset)`, `writeUInt32LE(value, offset)`, `writeUInt32BE(value, offset)`
- `writeInt8(value, offset)`, `writeInt16LE(value, offset)`, `writeInt16BE(value, offset)`, `writeInt32LE(value, offset)`, `writeInt32BE(value, offset)`
- `readFloatLE(offset)`, `readFloatBE(offset)`, `readDoubleLE(offset)`, `readDoubleBE(offset)`
- `writeFloatLE(value, offset)`, `writeFloatBE(value, offset)`, `writeDoubleLE(value, offset)`, `writeDoubleBE(value, offset)`
- `toJSON(): { type: "Buffer", data: number[] }`
- `[Symbol.iterator]`, `entries()`, `keys()`, `values()`

**Global integration:** The buffer module exports `Buffer` as a named export and as default. The shim does NOT modify `globalThis` — that is the consumer's choice.

### events

**EventEmitter class:**
- `on(event, listener): this`
- `once(event, listener): this`
- `off(event, listener): this` / `removeListener(event, listener): this`
- `removeAllListeners(event?): this`
- `emit(event, ...args): boolean`
- `listenerCount(event): number`
- `listeners(event): Function[]`
- `rawListeners(event): Function[]`
- `eventNames(): (string | symbol)[]`
- `prependListener(event, listener): this`
- `prependOnceListener(event, listener): this`
- `setMaxListeners(n): this`
- `getMaxListeners(): number`
- `addListener(event, listener): this` — alias for `on`

**Static:**
- `EventEmitter.defaultMaxListeners` = 10

**Events:** emits `newListener` before adding, `removeListener` after removing.

### process

A plain object (not a class). Exports `process` as default and as named export.

- `process.env: Record<string, string | undefined>` — empty `{}`, mutable
- `process.cwd(): string` — returns `"/"`
- `process.chdir(dir): void` — updates internal cwd
- `process.nextTick(fn, ...args): void` — `queueMicrotask(() => fn(...args))`
- `process.platform: string` — `"browser"`
- `process.arch: string` — `"arm64"`
- `process.version: string` — `"v20.0.0"`
- `process.versions: Record<string, string>` — `{ node: "20.0.0" }`
- `process.pid: number` — `1`
- `process.exit(code?): void` — throws `Error("process.exit is not supported")`
- `process.stdout: { write(s: string): boolean }` — `console.log`, returns `true`
- `process.stderr: { write(s: string): boolean }` — `console.error`, returns `true`
- `process.hrtime(prev?): [number, number]` — uses `performance.now()`
- `process.hrtime.bigint(): bigint` — uses `performance.now()`
- `process.title: string` — `"browser"`
- `process.browser: true` — convention flag

### util

- `promisify(fn): (...args) => Promise` — wraps Node-style callback fn
- `callbackify(fn): (...args, cb) => void` — wraps promise-returning fn
- `inherits(ctor, superCtor): void` — sets prototype chain
- `deprecate(fn, msg): fn` — returns fn unchanged (no runtime warning in this environment)
- `format(fmt, ...args): string` — `%s`, `%d`, `%j`, `%o`, `%%` formatting
- `inspect(obj, options?): string` — basic object inspection (JSON.stringify fallback with circular ref handling)
- `types.isDate(v): boolean`
- `types.isRegExp(v): boolean`
- `types.isArray(v): boolean` — `Array.isArray`
- `types.isBoolean(v): boolean`
- `types.isNull(v): boolean`
- `types.isNumber(v): boolean`
- `types.isString(v): boolean`
- `types.isUndefined(v): boolean`
- `types.isFunction(v): boolean`
- `types.isBuffer(v): boolean` — checks `_isBuffer` flag
- `TextEncoder`, `TextDecoder` — re-export from globalThis

### url

Wraps the global `URL` and `URLSearchParams` (available in WKWebView).

- `parse(urlStr, parseQueryString?, slashesDenoteHost?): UrlObject` — parses URL string into components
- `format(urlObj): string` — serializes UrlObject to string
- `resolve(from, to): string` — resolves URL relative to base
- `URL` — re-export of global `URL`
- `URLSearchParams` — re-export of global `URLSearchParams`

`UrlObject` type: `{ protocol, slashes, auth, host, port, hostname, hash, search, query, pathname, path, href }`

### querystring

- `parse(str, sep?, eq?, options?): Record<string, string | string[]>` — default sep `&`, eq `=`
- `stringify(obj, sep?, eq?): string`
- `escape(str): string` — `encodeURIComponent`
- `unescape(str): string` — `decodeURIComponent`
- `encode` — alias for `stringify`
- `decode` — alias for `parse`

### string_decoder

Uses `TextDecoder` (available in WKWebView).

**StringDecoder class:**
- `constructor(encoding?: string)` — defaults to `"utf-8"`
- `write(buffer: Uint8Array): string` — decodes buffer, handles incomplete multibyte sequences
- `end(buffer?: Uint8Array): string` — flushes remaining bytes

Supported encodings: `utf-8`, `ascii`, `latin1`, `base64`, `hex`.

### os

All values are stubs appropriate for an iOS/browser environment.

- `platform(): string` — `"darwin"`
- `arch(): string` — `"arm64"`
- `type(): string` — `"Darwin"`
- `release(): string` — `"0.0.0"`
- `EOL: string` — `"\n"`
- `tmpdir(): string` — `"/tmp"`
- `homedir(): string` — `"/home/user"`
- `hostname(): string` — `"localhost"`
- `cpus(): CpuInfo[]` — single entry with unknown model
- `totalmem(): number` — `4 * 1024 * 1024 * 1024` (4 GB estimate)
- `freemem(): number` — `2 * 1024 * 1024 * 1024` (2 GB estimate)
- `endianness(): string` — `"LE"`
- `userInfo(): { username, uid, gid, shell, homedir }` — stubs
- `networkInterfaces(): {}` — empty
- `uptime(): number` — `0`

### assert

**AssertionError class** extends `Error`:
- `constructor({ message, actual, expected, operator })`
- Properties: `actual`, `expected`, `operator`, `generatedMessage`

**Functions:**
- `assert(value, message?)` / `assert.ok(value, message?)` — throws if falsy
- `assert.equal(actual, expected, message?)` — `==`
- `assert.notEqual(actual, expected, message?)` — `!=`
- `assert.strictEqual(actual, expected, message?)` — `===`
- `assert.notStrictEqual(actual, expected, message?)` — `!==`
- `assert.deepEqual(actual, expected, message?)` — recursive structural equality (loose)
- `assert.deepStrictEqual(actual, expected, message?)` — recursive structural equality (strict)
- `assert.notDeepEqual(actual, expected, message?)`
- `assert.notDeepStrictEqual(actual, expected, message?)`
- `assert.throws(fn, expected?, message?)` — expected can be RegExp, Error class, or validator fn
- `assert.doesNotThrow(fn, expected?, message?)`
- `assert.fail(message?)` — always throws
- `assert.ifError(value)` — throws if value is truthy

`deepEqual` / `deepStrictEqual` handle: primitives, plain objects, arrays, Date, RegExp, Map, Set, Buffer (via `equals`). No circular reference detection (throws on circular).

## Constraints

- **ES2020 target** — no top-level await, no `??=` (already restricted by tsconfig)
- **No Node APIs in source** — shim modules cannot import from `node:*`
- **No workspace imports** — shims cannot import from `@anthropic-ide/vfs` or other workspace packages. Cross-shim imports use relative paths only.
- **Self-contained compiled output** — each compiled `.js` shim file must work when copied into a VFS and resolved by esbuild
- **POSIX only** — no Windows path separators or line endings
- **Pure JS** — no native bindings, no WASM, no Web Workers

## Testing Strategy

Each shim module has its own test file: `shims/path.test.ts`, `shims/buffer.test.ts`, etc.

Tests import from the shim module directly (standard vitest imports), verifying API compatibility with Node.js built-in behavior.

Integration tests for the esbuild plugin:
1. Read compiled shim JS from `dist/shims/` using `node:fs`
2. Call `populateShims(vfs, sources)` to write them into VFS
3. Bundle a test entry that `import { join } from "path"` or `import { Buffer } from "buffer"`
4. Verify the bundle output contains the expected shim behavior

Plugin integration tests require esbuild-wasm (same setup as bundler tests: `/// <reference types="node" />`, browser build, `worker: false`, `globalThis.self` polyfill).

## Dependencies

**package.json additions:**
- `devDependencies`: `@types/node` (for test files only — triple-slash reference)
- `peerDependencies`: `@anthropic-ide/vfs` (for `populateShims` and plugin — IVirtualFileSystem type)
- `dependencies`: `esbuild-wasm` (for Plugin type in `plugin.ts`)

No runtime dependencies beyond what's already in the monorepo.
