# Node Shims Phase 5A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 10 Node.js built-in module shims and an esbuild plugin for seamless bundler integration, enabling npm packages that depend on Node APIs to run in JavaScriptCore/WKWebView.

**Architecture:** Self-contained TypeScript modules in `packages/node-shims/src/shims/`, each implementing a Node.js built-in API using browser-available primitives. An esbuild plugin remaps `path`/`node:path` etc. to VFS-hosted shim files. A `populateShims()` helper writes compiled shim JS into the VFS.

**Tech Stack:** TypeScript 6.0.3, ES2020 target, vitest, esbuild-wasm (for plugin integration tests)

**Spec:** `docs/superpowers/specs/2026-09-01-node-shims-5a-design.md`

## Global Constraints

- ES2020 target — no `??=`, no top-level await
- No `node:*` imports in source files (only in `*.test.ts` via `/// <reference types="node" />`)
- No imports from `@anthropic-ide/vfs` or other workspace packages inside `shims/` files — cross-shim imports use relative paths only
- `@types/node` only in devDependencies, used only via triple-slash in test files
- Package scope: `@anthropic-ide/node-shims`
- POSIX paths only — no Windows support
- Each shim must export a `default` object containing all named exports (for `const path = require("path")` compatibility via esbuild's CJS interop)

---

### Task 1: Package setup + path + events shims

**Files:**
- Modify: `packages/node-shims/package.json` — add dependencies (esbuild-wasm, @types/node devDep, @anthropic-ide/vfs peerDep), add exports map
- Modify: `packages/node-shims/tsconfig.json` — add vfs reference if needed
- Create: `packages/node-shims/src/types.ts`
- Create: `packages/node-shims/src/shims/path.ts`
- Create: `packages/node-shims/src/shims/events.ts`
- Test: `packages/node-shims/src/shims/path.test.ts`
- Test: `packages/node-shims/src/shims/events.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces:
  - `path` shim: `join`, `resolve`, `normalize`, `isAbsolute`, `relative`, `dirname`, `basename`, `extname`, `parse`, `format`, `sep`, `delimiter`, `posix`, `default`
  - `events` shim: `EventEmitter` class with full API, `default` export
  - `ShimSources` type: `Record<string, string>`

**Steps:**

- [ ] **Step 1: Update package.json**

Add to `packages/node-shims/package.json`:

```json
{
  "name": "@anthropic-ide/node-shims",
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
    "@anthropic-ide/vfs": "workspace:*"
  },
  "dependencies": {
    "esbuild-wasm": "0.25.5"
  },
  "devDependencies": {
    "@anthropic-ide/vfs": "workspace:*",
    "@types/node": "^22.16.0"
  }
}
```

Run `pnpm install` from repo root.

- [ ] **Step 2: Create types.ts**

```typescript
// packages/node-shims/src/types.ts
export type ShimSources = Record<string, string>;
```

- [ ] **Step 3: Write path shim tests**

Create `packages/node-shims/src/shims/path.test.ts` with tests covering:
- `join("a", "b")` → `"a/b"`, `join("/a", "b", "c")` → `"/a/b/c"`, `join("/a", "..", "b")` → `"/b"`
- `resolve("/a", "b")` → `"/a/b"`, `resolve("/a", "/b")` → `"/b"`, `resolve("a", "b")` → `"/a/b"` (resolves against `/`)
- `normalize("/a//b/../c")` → `"/a/c"`, `normalize("a/./b")` → `"a/b"`
- `isAbsolute("/a")` → `true`, `isAbsolute("a")` → `false`
- `relative("/a/b", "/a/c")` → `"../c"`, `relative("/a/b/c", "/a/b/c")` → `""`
- `dirname("/a/b/c")` → `"/a/b"`, `dirname("/a")` → `"/"`
- `basename("/a/b/c.txt")` → `"c.txt"`, `basename("/a/b/c.txt", ".txt")` → `"c"`
- `extname("file.txt")` → `".txt"`, `extname("file")` → `""`, `extname(".hidden")` → `""`
- `parse("/home/user/file.txt")` → `{ root: "/", dir: "/home/user", base: "file.txt", ext: ".txt", name: "file" }`
- `format({ root: "/", dir: "/home/user", base: "file.txt" })` → `"/home/user/file.txt"`
- `sep` is `"/"`, `delimiter` is `":"`
- `default` object contains all named exports

- [ ] **Step 4: Run tests — verify they fail**

```bash
pnpm --filter @anthropic-ide/node-shims test
```

- [ ] **Step 5: Implement path shim**

Create `packages/node-shims/src/shims/path.ts`:
- `sep = "/"`, `delimiter = ":"`
- `normalize(p)`: split on `/`, resolve `.` and `..`, handle leading `/`, handle empty
- `join(...parts)`: concatenate with `/`, normalize
- `resolve(...parts)`: process right-to-left, stop at first absolute, prepend `/` if none
- `isAbsolute(p)`: starts with `/`
- `relative(from, to)`: normalize both, split into segments, find common prefix, build `..` path
- `dirname(p)`: everything before last `/`
- `basename(p, ext?)`: last segment, strip ext if provided
- `extname(p)`: last `.` in basename (empty if no `.` or starts with `.`)
- `parse(p)`: decompose into `{ root, dir, base, ext, name }`
- `format(obj)`: reconstruct from parts — dir/base takes precedence, then root/name+ext
- `posix` = self-reference via `Object.assign`
- `export default path` where `path` is an object with all functions

- [ ] **Step 6: Run path tests — verify they pass**

```bash
pnpm --filter @anthropic-ide/node-shims test -- shims/path
```

- [ ] **Step 7: Write events shim tests**

Create `packages/node-shims/src/shims/events.test.ts` with tests covering:
- `on` + `emit` basic flow
- `once` fires only once
- `off` / `removeListener` removes correctly
- `removeAllListeners` with and without event name
- `emit` returns `true` if listeners exist, `false` otherwise
- `listenerCount`, `listeners`, `eventNames`
- `prependListener` adds to front
- `prependOnceListener` adds to front, fires once
- `setMaxListeners` / `getMaxListeners`
- `newListener` event fires before adding
- `removeListener` event fires after removing
- `addListener` is alias for `on`
- `rawListeners` returns wrappers for `once` listeners
- `EventEmitter.defaultMaxListeners` is `10`
- Symbol event names work
- Multiple listeners on same event fire in order
- Removing listener during emit doesn't skip next listener
- `default` export is `EventEmitter`

- [ ] **Step 8: Run events tests — verify they fail**

- [ ] **Step 9: Implement events shim**

Create `packages/node-shims/src/shims/events.ts`:
- `EventEmitter` class with `_events: Map<string | symbol, Function[]>`, `_maxListeners: number`
- `on(event, listener)`: emit `newListener`, push to array, warn if exceeds max
- `once(event, listener)`: wrap in a function that calls `off` after first call; mark wrapper for `rawListeners`
- `off(event, listener)`: find and splice, emit `removeListener`
- `removeAllListeners(event?)`: clear one or all
- `emit(event, ...args)`: call each listener with args, return boolean
- `listenerCount(event)`: array length
- `listeners(event)`: return copy of array (unwrap once wrappers)
- `rawListeners(event)`: return copy including wrappers
- `eventNames()`: keys of events map
- `prependListener(event, listener)`: unshift
- `prependOnceListener(event, listener)`: wrap + unshift
- `setMaxListeners(n)` / `getMaxListeners()`
- `addListener` = `on`
- Static `defaultMaxListeners = 10`
- `export default EventEmitter`

- [ ] **Step 10: Run all tests — verify they pass**

```bash
pnpm --filter @anthropic-ide/node-shims test
```

- [ ] **Step 11: Commit**

```bash
git add packages/node-shims/
git commit -m "feat(node-shims): add path and events shims"
```

---

### Task 2: buffer + process + util shims

**Files:**
- Create: `packages/node-shims/src/shims/buffer.ts`
- Create: `packages/node-shims/src/shims/process.ts`
- Create: `packages/node-shims/src/shims/util.ts`
- Test: `packages/node-shims/src/shims/buffer.test.ts`
- Test: `packages/node-shims/src/shims/process.test.ts`
- Test: `packages/node-shims/src/shims/util.test.ts`

**Interfaces:**
- Consumes: `events.ts` (util.inherits sets up EventEmitter-style prototype chains, but the shim itself doesn't import events — inherits is generic)
- Produces:
  - `Buffer` class: `from`, `alloc`, `allocUnsafe`, `concat`, `isBuffer`, `byteLength`, `isEncoding`, instance methods for read/write/slice/copy/toString
  - `process` object: `env`, `cwd()`, `nextTick()`, `platform`, `version`, `stdout`, `stderr`, `hrtime`
  - `util` module: `promisify`, `callbackify`, `inherits`, `format`, `inspect`, `deprecate`, `types.*`

**Steps:**

- [ ] **Step 1: Write buffer tests**

Create `packages/node-shims/src/shims/buffer.test.ts`:
- `Buffer.from("hello")` → correct UTF-8 bytes, `toString()` roundtrips
- `Buffer.from("aGVsbG8=", "base64")` → "hello"
- `Buffer.from("68656c6c6f", "hex")` → "hello"
- `Buffer.from([0x48, 0x69])` → "Hi"
- `Buffer.from(new ArrayBuffer(4))` → length 4
- `Buffer.alloc(10)` → all zeros, length 10
- `Buffer.alloc(5, 0x41)` → "AAAAA"
- `Buffer.concat([Buffer.from("a"), Buffer.from("b")])` → "ab"
- `Buffer.isBuffer(Buffer.from("x"))` → true, `Buffer.isBuffer(new Uint8Array(1))` → false
- `Buffer.byteLength("hello")` → 5, `Buffer.byteLength("café")` → 5 (UTF-8)
- `Buffer.isEncoding("utf8")` → true, `Buffer.isEncoding("nope")` → false
- `slice` returns Buffer, shares underlying memory
- `copy` copies bytes between buffers
- `equals` and `compare` work correctly
- `readUInt8`, `readUInt16LE`, `readUInt16BE`, `readUInt32LE`, `readUInt32BE`
- `readInt8`, `readInt16LE`, `readInt16BE`, `readInt32LE`, `readInt32BE`
- `writeUInt8`, `writeUInt16LE`, `writeUInt16BE`, `writeUInt32LE`, `writeUInt32BE`
- `readFloatLE`, `readDoubleBE` roundtrip
- `indexOf` finds byte/string
- `fill` fills buffer
- `toJSON` returns `{ type: "Buffer", data: [...] }`
- Iterator yields byte values
- `write(str, offset, length, encoding)` returns bytes written

- [ ] **Step 2: Run buffer tests — verify they fail**

- [ ] **Step 3: Implement buffer shim**

Create `packages/node-shims/src/shims/buffer.ts`:
- Helper functions: `encodingToLabel(enc)` mapping encoding names to TextDecoder labels
- `encodeString(str, encoding)`: uses TextEncoder for utf-8, manual for hex/base64/ascii/latin1
- `decodeBytes(bytes, encoding)`: uses TextDecoder for utf-8, manual for hex/base64/ascii/latin1
- `base64Encode(bytes)` / `base64Decode(str)`: use `btoa`/`atob` with Uint8Array conversion
- `hexEncode(bytes)` / `hexDecode(str)`: byte-to-hex string conversion
- `Buffer` class:
  - Internal `Uint8Array` storage (extend or wrap — extending is tricky in ES2020, so wrap)
  - Actually: use composition with a `_buf: Uint8Array` field. Implement ArrayLike via Proxy or index accessor. Simpler: just extend `Uint8Array` — ES2020 supports class extends of built-ins in modern engines including JavaScriptCore.
  - Mark instances with `_isBuffer = true` for `isBuffer` check
  - Static methods delegate to constructor patterns
  - DataView for typed reads/writes (LE/BE)

- [ ] **Step 4: Run buffer tests — verify they pass**

- [ ] **Step 5: Write process tests**

Create `packages/node-shims/src/shims/process.test.ts`:
- `process.env` is an object, writable: `process.env.FOO = "bar"` → `process.env.FOO === "bar"`
- `process.cwd()` returns `"/"` initially
- `process.chdir("/home")` → `process.cwd()` returns `"/home"`
- `process.nextTick(fn)` calls fn asynchronously (use vitest `vi.fn()` + `await` flush)
- `process.platform` is `"browser"`
- `process.version` matches `/^v\d+/`
- `process.pid` is a number
- `process.exit()` throws
- `process.stdout.write("x")` returns true (calls console.log)
- `process.stderr.write("x")` returns true (calls console.error)
- `process.hrtime()` returns `[seconds, nanoseconds]` tuple
- `process.hrtime.bigint()` returns bigint
- `process.browser` is `true`
- `process.title` is `"browser"`
- Default export is the process object

- [ ] **Step 6: Implement process shim**

Create `packages/node-shims/src/shims/process.ts`:
- Internal `_cwd = "/"`
- `hrtime` implementation using `performance.now()` — available in WKWebView:
  ```
  const ms = performance.now();
  const seconds = Math.floor(ms / 1000);
  const nanos = Math.floor((ms % 1000) * 1e6);
  ```
  With `prev` argument: subtract from current
- `hrtime.bigint`: `BigInt(Math.floor(performance.now() * 1e6))`
- Declare `performance` as ambient if needed (it's available in WKWebView/vitest)

- [ ] **Step 7: Run process tests — verify they pass**

- [ ] **Step 8: Write util tests**

Create `packages/node-shims/src/shims/util.test.ts`:
- `promisify`: wraps `(a, b, cb) => cb(null, a+b)` → `async (a,b) => a+b`; error case
- `callbackify`: wraps `async (a) => a*2` → `(a, cb) => cb(null, a*2)`; rejection → `cb(err)`
- `inherits`: sets up prototype chain, `super_` property
- `format("%s world", "hello")` → `"hello world"`, `format("%d", 42)` → `"42"`, `format("%j", {a:1})` → `'{"a":1}'`
- `format("%% %s", "a")` → `"% a"`
- `format` with excess args appends them space-separated
- `inspect({a: 1})` returns a string containing `a` and `1`
- `inspect` handles circular references without throwing
- `deprecate(fn, msg)` returns a function that behaves like fn
- `types.isDate(new Date())` → true, `types.isDate({})` → false
- `types.isRegExp(/x/)` → true
- `types.isArray([])` → true
- `types.isString("x")` → true, `types.isNumber(1)` → true
- `types.isNull(null)` → true, `types.isUndefined(undefined)` → true
- `types.isFunction(() => {})` → true
- `types.isBuffer` checks `_isBuffer` flag
- Default export is object with all named exports

- [ ] **Step 9: Implement util shim**

Create `packages/node-shims/src/shims/util.ts`:
- `format(fmt, ...args)`: scan for `%s`, `%d`, `%j`, `%o`, `%%`, replace with args. Append remaining args space-separated.
- `inspect(obj, opts?)`: handle null/undefined/primitives directly. For objects, use a `Set` for circular detection, recursively build string representation. Depth limit (default 2). Falls back to `String(obj)` for edge cases.
- `promisify(fn)`: return function that creates Promise, calls fn with `(...args, (err, val) => { err ? reject(err) : resolve(val) })`
- `callbackify(fn)`: return function that calls fn(...args).then(v => cb(null, v), e => cb(e))
- `inherits(ctor, superCtor)`: `Object.setPrototypeOf(ctor.prototype, superCtor.prototype)`, set `ctor.super_ = superCtor`
- `deprecate(fn, msg)`: return fn (no-op in browser)
- `types` object with type-checking functions

- [ ] **Step 10: Run all tests — verify pass**

```bash
pnpm --filter @anthropic-ide/node-shims test
```

- [ ] **Step 11: Commit**

```bash
git add packages/node-shims/src/shims/buffer.ts packages/node-shims/src/shims/buffer.test.ts \
       packages/node-shims/src/shims/process.ts packages/node-shims/src/shims/process.test.ts \
       packages/node-shims/src/shims/util.ts packages/node-shims/src/shims/util.test.ts
git commit -m "feat(node-shims): add buffer, process, and util shims"
```

---

### Task 3: url + querystring + string_decoder + os + assert shims

**Files:**
- Create: `packages/node-shims/src/shims/url.ts`
- Create: `packages/node-shims/src/shims/querystring.ts`
- Create: `packages/node-shims/src/shims/string-decoder.ts`
- Create: `packages/node-shims/src/shims/os.ts`
- Create: `packages/node-shims/src/shims/assert.ts`
- Test: `packages/node-shims/src/shims/url.test.ts`
- Test: `packages/node-shims/src/shims/querystring.test.ts`
- Test: `packages/node-shims/src/shims/string-decoder.test.ts`
- Test: `packages/node-shims/src/shims/os.test.ts`
- Test: `packages/node-shims/src/shims/assert.test.ts`

**Interfaces:**
- Consumes: `./util.js` (assert uses `format` from util for messages)
- Produces:
  - `url`: `parse()`, `format()`, `resolve()`, `URL`, `URLSearchParams`
  - `querystring`: `parse()`, `stringify()`, `escape()`, `unescape()`, `encode`, `decode`
  - `string_decoder`: `StringDecoder` class
  - `os`: all stub functions and constants
  - `assert`: `AssertionError`, all assertion functions, `default` export

**Steps:**

- [ ] **Step 1: Write url tests**

Create `packages/node-shims/src/shims/url.test.ts`:
- `parse("https://example.com:8080/path?q=1#hash")` → correct fields
- `parse("//example.com/path")` → slashes true, hostname set
- `format({ protocol: "https:", hostname: "example.com", pathname: "/path" })` → `"https://example.com/path"`
- `resolve("https://example.com/a/b", "../c")` → `"https://example.com/c"`
- `resolve("https://example.com/a/b", "https://other.com")` → `"https://other.com"`
- `URL` and `URLSearchParams` are re-exported globals
- Default export has all functions

- [ ] **Step 2: Implement url shim**

- [ ] **Step 3: Write querystring tests**

- `parse("a=1&b=2")` → `{ a: "1", b: "2" }`
- `parse("a=1&a=2")` → `{ a: ["1", "2"] }`
- `parse("a=1;b=2", ";")` → custom separator
- `stringify({ a: "1", b: "2" })` → `"a=1&b=2"`
- `stringify({ a: ["1", "2"] })` → `"a=1&a=2"`
- `escape` / `unescape` wrap encodeURIComponent / decodeURIComponent
- `encode` is alias for `stringify`, `decode` is alias for `parse`

- [ ] **Step 4: Implement querystring shim**

- [ ] **Step 5: Write string_decoder tests**

- `new StringDecoder("utf-8")`: `write(Buffer.from("hello"))` → `"hello"`
- Handles incomplete multi-byte UTF-8: write first 2 bytes of 3-byte char, then the third
- `end()` flushes remaining bytes with replacement character
- Works with ascii, latin1 encodings
- Default export is `StringDecoder`

Note: tests for `string_decoder` should import `Buffer` from `../buffer.js` for creating test input (or use `new Uint8Array()`).

- [ ] **Step 6: Implement string_decoder shim**

- [ ] **Step 7: Write os tests**

- `platform()` → `"darwin"`, `arch()` → `"arm64"`, `type()` → `"Darwin"`
- `EOL` → `"\n"`, `tmpdir()` → `"/tmp"`, `homedir()` → `"/home/user"`
- `cpus()` returns array with at least one entry
- `totalmem()` and `freemem()` return positive numbers
- `endianness()` → `"LE"`
- `hostname()` → `"localhost"`
- `userInfo()` returns object with `username`, `uid`, `gid`, `shell`, `homedir`
- `networkInterfaces()` → `{}`
- Default export has all functions and constants

- [ ] **Step 8: Implement os shim**

- [ ] **Step 9: Write assert tests**

- `assert(true)` passes, `assert(false)` throws `AssertionError`
- `assert.ok(1)` passes, `assert.ok(0)` throws
- `assert.equal(1, "1")` passes (loose), `assert.strictEqual(1, 1)` passes, `assert.strictEqual(1, "1")` throws
- `assert.notEqual(1, 2)` passes, `assert.notStrictEqual(1, "1")` passes
- `assert.deepEqual({ a: 1 }, { a: 1 })` passes
- `assert.deepEqual({ a: 1 }, { a: 2 })` throws
- `assert.deepStrictEqual` checks types: `deepStrictEqual(1, "1")` throws
- `assert.deepEqual` with nested objects, arrays, Date, RegExp, Map, Set
- `assert.throws(() => { throw new Error("x") })` passes
- `assert.throws(() => { throw new Error("x") }, /x/)` passes (RegExp match)
- `assert.throws(() => { throw new Error("x") }, Error)` passes (class match)
- `assert.doesNotThrow(() => 1)` passes, `assert.doesNotThrow(() => { throw new Error() })` throws
- `assert.fail("msg")` always throws with message
- `assert.ifError(null)` passes, `assert.ifError(new Error())` throws
- `AssertionError` has `actual`, `expected`, `operator` properties
- Default export is the `assert` function with methods attached

- [ ] **Step 10: Implement assert shim**

The `assert` shim imports `{ format }` from `"./util.js"` for formatting error messages.

`deepEqual` implementation: recursive comparison with a visited Set for already-compared object pairs:
- Primitives: `==` (loose) or `===` (strict)
- Date: compare `getTime()`
- RegExp: compare `source` and `flags`
- Map: compare size, then each key-value pair
- Set: compare size, then check each element
- Array: compare length, then each element
- Plain objects: compare own enumerable keys, then each value
- Buffer: use `equals()` method (check `_isBuffer` flag)

- [ ] **Step 11: Run all tests — verify pass**

```bash
pnpm --filter @anthropic-ide/node-shims test
```

- [ ] **Step 12: Commit**

```bash
git add packages/node-shims/src/shims/
git commit -m "feat(node-shims): add url, querystring, string_decoder, os, and assert shims"
```

---

### Task 4: esbuild plugin + populateShims + public API + integration tests

**Files:**
- Create: `packages/node-shims/src/constants.ts`
- Create: `packages/node-shims/src/plugin.ts`
- Create: `packages/node-shims/src/populate.ts`
- Modify: `packages/node-shims/src/index.ts` — wire up public exports
- Test: `packages/node-shims/src/plugin.test.ts`
- Test: `packages/node-shims/src/integration.test.ts`

**Interfaces:**
- Consumes: all shim modules from Tasks 1-3, `IVirtualFileSystem` from `@anthropic-ide/vfs`, esbuild `Plugin` type
- Produces:
  - `createNodeShimsPlugin(): esbuild.Plugin` — onResolve interceptor for Node built-in names
  - `populateShims(vfs: IVirtualFileSystem, sources: ShimSources): Promise<void>` — writes shims to VFS
  - `NODE_BUILTINS: readonly string[]` — list of supported built-in names
  - `SHIMS_PACKAGE_PATH: string` — `"/node_modules/@anthropic-ide/node-shims"`
  - Public API: re-exports everything from index.ts

**Steps:**

- [ ] **Step 1: Create constants.ts**

```typescript
export const NODE_BUILTINS = [
  "assert", "buffer", "events", "os", "path",
  "process", "querystring", "string_decoder", "url", "util",
] as const;

export type NodeBuiltin = (typeof NODE_BUILTINS)[number];

export const SHIMS_PACKAGE_PATH = "/node_modules/@anthropic-ide/node-shims";
```

- [ ] **Step 2: Create populate.ts**

```typescript
import type { IVirtualFileSystem } from "@anthropic-ide/vfs";
import type { ShimSources } from "./types.js";
import { SHIMS_PACKAGE_PATH } from "./constants.js";

export async function populateShims(
  vfs: IVirtualFileSystem,
  sources: ShimSources,
): Promise<void> {
  await vfs.mkdir(SHIMS_PACKAGE_PATH, { recursive: true });

  const exportsMap: Record<string, string> = {};
  for (const [name, source] of Object.entries(sources)) {
    const fileName = name.replace(/_/g, "-") + ".js";
    const encoder = new TextEncoder();
    await vfs.writeFile(
      `${SHIMS_PACKAGE_PATH}/${fileName}`,
      encoder.encode(source),
    );
    exportsMap[`./${name}`] = `./${fileName}`;
  }

  await vfs.writeFile(
    `${SHIMS_PACKAGE_PATH}/package.json`,
    new TextEncoder().encode(JSON.stringify({
      name: "@anthropic-ide/node-shims",
      type: "module",
      exports: exportsMap,
    })),
  );
}
```

Note: `vfs.writeFile` takes `string | Uint8Array`. Check the VFS interface — if it takes string, use string directly. If Uint8Array, encode.

- [ ] **Step 3: Write plugin tests**

Create `packages/node-shims/src/plugin.test.ts`:
- Test that `createNodeShimsPlugin()` returns an esbuild `Plugin` with name `"node-shims"`
- Test that `NODE_BUILTINS` contains all 10 module names
- Test that `SHIMS_PACKAGE_PATH` is `"/node_modules/@anthropic-ide/node-shims"`

- [ ] **Step 4: Create plugin.ts**

```typescript
import type { Plugin } from "esbuild-wasm/lib/browser.js";
import { NODE_BUILTINS, SHIMS_PACKAGE_PATH } from "./constants.js";

export function createNodeShimsPlugin(): Plugin {
  const builtins = new Set<string>(NODE_BUILTINS);

  return {
    name: "node-shims",
    setup(build) {
      build.onResolve({ filter: /^(node:)?[a-z]/ }, (args) => {
        const name = args.path.replace(/^node:/, "");
        if (builtins.has(name)) {
          const fileName = name.replace(/_/g, "-") + ".js";
          return {
            path: `${SHIMS_PACKAGE_PATH}/${fileName}`,
            namespace: "vfs",
          };
        }
        return undefined;
      });
    },
  };
}
```

- [ ] **Step 5: Run plugin tests — verify pass**

- [ ] **Step 6: Wire up index.ts**

```typescript
export type { ShimSources } from "./types.js";
export { NODE_BUILTINS, SHIMS_PACKAGE_PATH } from "./constants.js";
export type { NodeBuiltin } from "./constants.js";
export { createNodeShimsPlugin } from "./plugin.js";
export { populateShims } from "./populate.js";
```

- [ ] **Step 7: Write integration tests**

Create `packages/node-shims/src/integration.test.ts`:

Setup (same pattern as bundler tests):
- `/// <reference types="node" />`
- Import esbuild-wasm browser build, MemoryFS, createVfsPlugin from bundler, createNodeShimsPlugin, populateShims
- `globalThis.self` polyfill
- `beforeAll`: initialize esbuild-wasm with wasmModule + worker:false
- Helper: read compiled shim `.js` files from `dist/shims/` using `node:fs`, build a `ShimSources` record
- Helper: `populateShims(vfs, sources)` before each test

Test cases:
1. **path shim resolves**: entry `import { join } from "path"; console.log(join("a", "b"));` → bundle contains `"a/b"` logic
2. **node: prefix works**: entry `import { join } from "node:path";` → resolves same as `"path"`
3. **buffer shim resolves**: entry `import { Buffer } from "buffer"; const b = Buffer.from("hi");` → bundles successfully
4. **events shim resolves**: entry `import { EventEmitter } from "events";` → bundles successfully
5. **process shim resolves**: entry `import process from "process"; process.cwd();` → bundles
6. **multiple shims in one bundle**: entry that imports from path, buffer, events, util → bundles with no errors
7. **unknown built-in falls through**: entry `import x from "unknown-module"` → error (not intercepted by plugin)
8. **cross-shim imports work**: entry `import { ok } from "assert"` → bundles (assert imports from util internally)

- [ ] **Step 8: Build the package first** (integration tests need dist/)

```bash
pnpm --filter @anthropic-ide/node-shims build
```

- [ ] **Step 9: Run integration tests**

```bash
pnpm --filter @anthropic-ide/node-shims test
```

- [ ] **Step 10: Run full monorepo tests**

```bash
pnpm test
```

- [ ] **Step 11: Commit**

```bash
git add packages/node-shims/src/
git commit -m "feat(node-shims): add esbuild plugin, populateShims, and integration tests"
```
