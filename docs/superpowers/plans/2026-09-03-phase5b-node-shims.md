# Node Shims Phase 5B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add stream, fs, and crypto shim modules to `@anthropic-ide/node-shims`, extending the Phase 5A shim set with full Node.js streams (backpressure, objectMode, pipe chains), VFS-backed file system operations, and WebCrypto-backed hashing/encryption.

**Architecture:** Each shim is a self-contained TypeScript file in `packages/node-shims/src/shims/`. Cross-shim imports use relative paths (`./events.js`, `./buffer.js`, `./path.js`). The `fs` shim accesses VFS at runtime via `globalThis.__vfs` (duck-typed, no workspace imports). The `crypto` shim wraps WebCrypto APIs (`crypto.subtle`, `crypto.getRandomValues`). The existing esbuild plugin auto-resolves new modules once `NODE_BUILTINS` is extended.

**Tech Stack:** TypeScript 6.0.3, ES2020 target, vitest, esbuild-wasm ^0.28.2, WebCrypto API

**Spec:** `docs/superpowers/specs/2026-09-03-node-shims-5b-design.md`

## Global Constraints

- ES2020 target — no top-level await, no `??=`, no `using`
- No Node APIs (`node:*` imports) in shim source files — only in `*.test.ts`
- No workspace imports (`@anthropic-ide/vfs`, `@anthropic-ide/bundler`) in shim source files — only relative cross-shim imports (`./events.js`, `./buffer.js`, `./path.js`)
- Self-contained compiled output — each `.js` file must work standalone in VFS
- POSIX only — no Windows path separators or line endings
- Pure JS — no native bindings, no WASM, no Web Workers
- `globalThis.__vfs` must be set before `fs` operations; `fs.ts` never imports VFS types
- Ambient declarations for browser globals (`crypto`, `console`, `performance`, `TextEncoder`, `TextDecoder`) use module-local `declare` statements (no DOM lib)
- Existing test patterns: `import { describe, expect, it, vi } from "vitest"`, import from `./module.js`, `vi.fn()` for spies
- All existing 389 tests must continue to pass

---

### Task 1: stream shim (Readable + Writable + pipe)

**Files:**
- Create: `packages/node-shims/src/shims/stream.ts`
- Create: `packages/node-shims/src/shims/stream.test.ts`
- Modify: `packages/node-shims/src/constants.ts` — add `"stream"` to `NODE_BUILTINS`

**Interfaces:**
- Consumes: `EventEmitter` from `./events.js` (class with `on`, `once`, `off`, `emit`, `removeAllListeners`, `listenerCount`, `listeners`, `eventNames`, `setMaxListeners`, `getMaxListeners`, `addListener`, `removeListener`)
- Produces: `Stream` (base class extending EventEmitter with `pipe`), `Readable` (full streaming read with backpressure), `Writable` (full streaming write with backpressure/cork/uncork), `Duplex` (Readable+Writable), `Transform` (Duplex with `_transform`/`_flush`), `PassThrough` (identity Transform), `pipeline` (multi-stream piping with error propagation). All exported as named exports and as properties of the default export object.

- [ ] **Step 1: Write Stream base class and Readable tests**

In `packages/node-shims/src/shims/stream.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import {
  Stream, Readable, Writable, Duplex, Transform, PassThrough, pipeline,
} from "./stream.js";
import { EventEmitter } from "./events.js";

describe("Stream base class", () => {
  it("extends EventEmitter", () => {
    const s = new Stream();
    expect(s).toBeInstanceOf(EventEmitter);
  });
});

describe("Readable", () => {
  it("extends Stream", () => {
    const r = new Readable({ read() {} });
    expect(r).toBeInstanceOf(Stream);
  });

  it("emits data events in flowing mode", () => {
    const r = new Readable({
      read() {
        this.push("hello");
        this.push(null);
      },
    });
    const chunks: string[] = [];
    r.on("data", (chunk: string) => chunks.push(chunk));
    r.on("end", () => {
      expect(chunks).toEqual(["hello"]);
    });
  });

  it("read() returns chunks in paused mode", (ctx) => {
    return new Promise<void>((resolve) => {
      const r = new Readable({
        read() {
          this.push("chunk1");
          this.push("chunk2");
          this.push(null);
        },
      });
      r.on("readable", () => {
        let chunk;
        const results: string[] = [];
        while ((chunk = r.read()) !== null) {
          results.push(chunk);
        }
        expect(results.length).toBeGreaterThan(0);
        resolve();
      });
    });
  });

  it("push returns false when buffer exceeds highWaterMark", () => {
    const r = new Readable({
      highWaterMark: 5,
      read() {},
    });
    expect(r.push("123")).toBe(true);
    expect(r.push("456")).toBe(false);
  });

  it("supports objectMode", () => {
    const objects = [{ a: 1 }, { b: 2 }];
    let index = 0;
    const r = new Readable({
      objectMode: true,
      read() {
        if (index < objects.length) {
          this.push(objects[index++]);
        } else {
          this.push(null);
        }
      },
    });
    const received: object[] = [];
    r.on("data", (obj: object) => received.push(obj));
    r.on("end", () => {
      expect(received).toEqual(objects);
    });
  });

  it("pause() and resume() control flowing", () => {
    const r = new Readable({
      read() {
        this.push("data");
        this.push(null);
      },
    });
    const fn = vi.fn();
    r.on("data", fn);
    r.pause();
    expect(r.isPaused()).toBe(true);
    expect(fn).not.toHaveBeenCalled();
    r.resume();
  });

  it("unshift pushes data back to front of buffer", () => {
    const r = new Readable({
      read() {
        this.push("world");
        this.push(null);
      },
    });
    r.on("readable", () => {
      const first = r.read();
      if (first) {
        r.unshift("hello ");
        const combined = r.read();
        expect(combined).toBeDefined();
      }
    });
  });

  it("destroy emits close", () => {
    return new Promise<void>((resolve) => {
      const r = new Readable({ read() {} });
      r.on("close", () => {
        expect(r.destroyed).toBe(true);
        resolve();
      });
      r.destroy();
    });
  });

  it("destroy with error emits error then close", () => {
    return new Promise<void>((resolve) => {
      const r = new Readable({ read() {} });
      const events: string[] = [];
      r.on("error", () => events.push("error"));
      r.on("close", () => {
        events.push("close");
        expect(events).toEqual(["error", "close"]);
        resolve();
      });
      r.destroy(new Error("boom"));
    });
  });

  it("setEncoding converts chunks to strings", () => {
    const r = new Readable({
      read() {
        this.push(Buffer.from("hello"));
        this.push(null);
      },
    });
    r.setEncoding("utf-8");
    const chunks: string[] = [];
    r.on("data", (chunk: string) => {
      expect(typeof chunk).toBe("string");
      chunks.push(chunk);
    });
    r.on("end", () => {
      expect(chunks.join("")).toBe("hello");
    });
  });

  it("exposes readable properties", () => {
    const r = new Readable({ highWaterMark: 100, objectMode: true, read() {} });
    expect(r.readableHighWaterMark).toBe(100);
    expect(r.readableObjectMode).toBe(true);
    expect(r.readableFlowing).toBe(null);
    expect(r.readable).toBe(true);
    expect(r.readableLength).toBe(0);
  });
});

describe("Writable", () => {
  it("extends Stream", () => {
    const w = new Writable({ write(chunk, enc, cb) { cb(); } });
    expect(w).toBeInstanceOf(Stream);
  });

  it("calls _write for each write() call", () => {
    return new Promise<void>((resolve) => {
      const chunks: string[] = [];
      const w = new Writable({
        write(chunk, encoding, callback) {
          chunks.push(String(chunk));
          callback();
        },
      });
      w.write("a");
      w.write("b");
      w.end(() => {
        expect(chunks).toEqual(["a", "b"]);
        resolve();
      });
    });
  });

  it("emits finish after end()", () => {
    return new Promise<void>((resolve) => {
      const w = new Writable({
        write(chunk, enc, cb) { cb(); },
      });
      w.on("finish", () => resolve());
      w.end();
    });
  });

  it("emits close after finish", () => {
    return new Promise<void>((resolve) => {
      const w = new Writable({
        write(chunk, enc, cb) { cb(); },
      });
      const events: string[] = [];
      w.on("finish", () => events.push("finish"));
      w.on("close", () => {
        events.push("close");
        expect(events).toEqual(["finish", "close"]);
        resolve();
      });
      w.end();
    });
  });

  it("write returns false when buffer exceeds highWaterMark", () => {
    const w = new Writable({
      highWaterMark: 2,
      write(chunk, enc, cb) {
        setTimeout(cb, 10);
      },
    });
    const first = w.write("a");
    const second = w.write("b");
    const third = w.write("c");
    expect(first).toBe(true);
    // Once buffer fills, returns false
    expect(third).toBe(false);
    w.end();
  });

  it("emits drain when buffer empties after backpressure", () => {
    return new Promise<void>((resolve) => {
      let callback: (() => void) | null = null;
      const w = new Writable({
        highWaterMark: 1,
        write(chunk, enc, cb) {
          callback = cb;
        },
      });
      w.write("x");
      w.write("y"); // should return false (backpressure)
      w.on("drain", () => {
        resolve();
      });
      // Flush the first write
      if (callback) (callback as () => void)();
    });
  });

  it("cork and uncork batch writes", () => {
    return new Promise<void>((resolve) => {
      const chunks: string[] = [];
      const w = new Writable({
        write(chunk, enc, cb) {
          chunks.push(String(chunk));
          cb();
        },
      });
      w.cork();
      w.write("a");
      w.write("b");
      expect(chunks).toEqual([]);
      w.uncork();
      // After microtask, writes should flush
      queueMicrotask(() => {
        expect(chunks).toEqual(["a", "b"]);
        w.end(() => resolve());
      });
    });
  });

  it("_final is called before finish", () => {
    return new Promise<void>((resolve) => {
      let finalCalled = false;
      const w = new Writable({
        write(chunk, enc, cb) { cb(); },
        final(cb) {
          finalCalled = true;
          cb();
        },
      });
      w.on("finish", () => {
        expect(finalCalled).toBe(true);
        resolve();
      });
      w.end();
    });
  });

  it("destroy emits error and close", () => {
    return new Promise<void>((resolve) => {
      const w = new Writable({ write(chunk, enc, cb) { cb(); } });
      const events: string[] = [];
      w.on("error", () => events.push("error"));
      w.on("close", () => {
        events.push("close");
        expect(events).toEqual(["error", "close"]);
        resolve();
      });
      w.destroy(new Error("boom"));
    });
  });

  it("supports objectMode", () => {
    return new Promise<void>((resolve) => {
      const received: object[] = [];
      const w = new Writable({
        objectMode: true,
        write(chunk, enc, cb) {
          received.push(chunk);
          cb();
        },
      });
      w.write({ a: 1 });
      w.write({ b: 2 });
      w.end(() => {
        expect(received).toEqual([{ a: 1 }, { b: 2 }]);
        resolve();
      });
    });
  });

  it("exposes writable properties", () => {
    const w = new Writable({ highWaterMark: 200, objectMode: true, write(c, e, cb) { cb(); } });
    expect(w.writableHighWaterMark).toBe(200);
    expect(w.writableObjectMode).toBe(true);
    expect(w.writable).toBe(true);
    expect(w.writableLength).toBe(0);
    expect(w.writableCorked).toBe(0);
    expect(w.writableFinished).toBe(false);
  });
});

describe("pipe", () => {
  it("pipes readable to writable", () => {
    return new Promise<void>((resolve) => {
      const chunks: string[] = [];
      const r = new Readable({
        read() {
          this.push("hello");
          this.push(null);
        },
      });
      const w = new Writable({
        write(chunk, enc, cb) {
          chunks.push(String(chunk));
          cb();
        },
      });
      w.on("finish", () => {
        expect(chunks).toEqual(["hello"]);
        resolve();
      });
      r.pipe(w);
    });
  });

  it("respects backpressure in pipe", () => {
    return new Promise<void>((resolve) => {
      let pushCount = 0;
      const r = new Readable({
        highWaterMark: 1,
        read() {
          pushCount++;
          if (pushCount <= 5) {
            this.push("x");
          } else {
            this.push(null);
          }
        },
      });
      const received: string[] = [];
      const w = new Writable({
        highWaterMark: 1,
        write(chunk, enc, cb) {
          received.push(String(chunk));
          setTimeout(cb, 1);
        },
      });
      w.on("finish", () => {
        expect(received.length).toBe(5);
        resolve();
      });
      r.pipe(w);
    });
  });

  it("unpipe stops data flow", () => {
    const r = new Readable({
      read() {
        this.push("data");
        this.push(null);
      },
    });
    const fn = vi.fn();
    const w = new Writable({
      write(chunk, enc, cb) { fn(); cb(); },
    });
    r.pipe(w);
    r.unpipe(w);
    // The writable should not receive data after unpipe
  });

  it("pipe with { end: false } does not end writable", () => {
    return new Promise<void>((resolve) => {
      const r = new Readable({
        read() {
          this.push("hello");
          this.push(null);
        },
      });
      const w = new Writable({
        write(chunk, enc, cb) { cb(); },
      });
      r.pipe(w, { end: false });
      r.on("end", () => {
        expect(w.writable).toBe(true);
        w.end(() => resolve());
      });
    });
  });
});

describe("Duplex", () => {
  it("extends Readable and has Writable methods", () => {
    const d = new Duplex({
      read() {},
      write(chunk, enc, cb) { cb(); },
    });
    expect(d).toBeInstanceOf(Readable);
    expect(typeof d.write).toBe("function");
    expect(typeof d.end).toBe("function");
    expect(typeof d.cork).toBe("function");
    expect(typeof d.uncork).toBe("function");
  });

  it("readable and writable sides work independently", () => {
    return new Promise<void>((resolve) => {
      const written: string[] = [];
      const d = new Duplex({
        read() {
          this.push("from-read");
          this.push(null);
        },
        write(chunk, enc, cb) {
          written.push(String(chunk));
          cb();
        },
      });
      const readData: string[] = [];
      d.on("data", (chunk: string) => readData.push(chunk));
      d.write("to-write");
      d.end(() => {
        expect(written).toEqual(["to-write"]);
        expect(readData).toContain("from-read");
        resolve();
      });
    });
  });

  it("allowHalfOpen false auto-ends writable when readable ends", () => {
    return new Promise<void>((resolve) => {
      const d = new Duplex({
        allowHalfOpen: false,
        read() { this.push(null); },
        write(chunk, enc, cb) { cb(); },
      });
      d.on("finish", () => resolve());
      d.resume();
    });
  });
});

describe("Transform", () => {
  it("transforms data from writable to readable side", () => {
    return new Promise<void>((resolve) => {
      const t = new Transform({
        transform(chunk, encoding, callback) {
          callback(null, String(chunk).toUpperCase());
        },
      });
      const output: string[] = [];
      t.on("data", (chunk: string) => output.push(chunk));
      t.on("end", () => {
        expect(output).toEqual(["HELLO", "WORLD"]);
        resolve();
      });
      t.write("hello");
      t.write("world");
      t.end();
    });
  });

  it("_flush is called before end", () => {
    return new Promise<void>((resolve) => {
      const t = new Transform({
        transform(chunk, enc, cb) { cb(null, chunk); },
        flush(cb) {
          this.push("flushed");
          cb();
        },
      });
      const output: string[] = [];
      t.on("data", (chunk: string) => output.push(chunk));
      t.on("end", () => {
        expect(output[output.length - 1]).toBe("flushed");
        resolve();
      });
      t.write("data");
      t.end();
    });
  });

  it("transform error propagates", () => {
    return new Promise<void>((resolve) => {
      const t = new Transform({
        transform(chunk, enc, cb) {
          cb(new Error("transform-error"));
        },
      });
      t.on("error", (err: Error) => {
        expect(err.message).toBe("transform-error");
        resolve();
      });
      t.write("data");
    });
  });
});

describe("PassThrough", () => {
  it("passes data through unchanged", () => {
    return new Promise<void>((resolve) => {
      const pt = new PassThrough();
      const output: string[] = [];
      pt.on("data", (chunk: string) => output.push(String(chunk)));
      pt.on("end", () => {
        expect(output).toEqual(["hello"]);
        resolve();
      });
      pt.write("hello");
      pt.end();
    });
  });
});

describe("pipeline", () => {
  it("pipes multiple streams and calls callback on finish", () => {
    return new Promise<void>((resolve) => {
      const r = new Readable({
        read() {
          this.push("hello");
          this.push(null);
        },
      });
      const t = new Transform({
        transform(chunk, enc, cb) {
          cb(null, String(chunk).toUpperCase());
        },
      });
      const output: string[] = [];
      const w = new Writable({
        write(chunk, enc, cb) {
          output.push(String(chunk));
          cb();
        },
      });
      pipeline(r, t, w, (err) => {
        expect(err).toBeFalsy();
        expect(output).toEqual(["HELLO"]);
        resolve();
      });
    });
  });

  it("destroys all streams on error", () => {
    return new Promise<void>((resolve) => {
      const r = new Readable({
        read() {
          this.push("data");
        },
      });
      const t = new Transform({
        transform(chunk, enc, cb) {
          cb(new Error("pipeline-fail"));
        },
      });
      const w = new Writable({
        write(chunk, enc, cb) { cb(); },
      });
      pipeline(r, t, w, (err) => {
        expect(err).toBeTruthy();
        expect(err!.message).toBe("pipeline-fail");
        expect(r.destroyed).toBe(true);
        expect(w.destroyed).toBe(true);
        resolve();
      });
    });
  });

  it("accepts an array of streams", () => {
    return new Promise<void>((resolve) => {
      const r = new Readable({
        read() { this.push("data"); this.push(null); },
      });
      const pt = new PassThrough();
      const output: string[] = [];
      const w = new Writable({
        write(chunk, enc, cb) { output.push(String(chunk)); cb(); },
      });
      pipeline([r, pt, w], (err) => {
        expect(err).toBeFalsy();
        expect(output).toEqual(["data"]);
        resolve();
      });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/node-shims && pnpm test -- --reporter=verbose 2>&1 | head -30`
Expected: FAIL — `./stream.js` module does not exist.

- [ ] **Step 3: Add "stream" to NODE_BUILTINS**

In `packages/node-shims/src/constants.ts`, add `"stream"` to the array (keep sorted):

```typescript
export const NODE_BUILTINS = [
  "assert",
  "buffer",
  "crypto",
  "events",
  "fs",
  "os",
  "path",
  "process",
  "querystring",
  "stream",
  "string_decoder",
  "url",
  "util",
] as const;
```

Wait — `"crypto"` and `"fs"` should NOT be added yet (they come in Tasks 2 and 3). Only add `"stream"` in this task. Add all three at once would break the plugin if the shim files don't exist yet. Instead:

```typescript
export const NODE_BUILTINS = [
  "assert",
  "buffer",
  "events",
  "os",
  "path",
  "process",
  "querystring",
  "stream",
  "string_decoder",
  "url",
  "util",
] as const;
```

- [ ] **Step 4: Implement stream.ts**

Create `packages/node-shims/src/shims/stream.ts` with:

1. Import `{ EventEmitter }` from `./events.js`
2. Ambient `declare` for `queueMicrotask`, `TextDecoder` (ES2020 lib doesn't include them)
3. `Stream` base class extending `EventEmitter` with `pipe()` method
4. `Readable` class:
   - Constructor takes `ReadableOptions` (highWaterMark, objectMode, encoding, autoDestroy, read fn)
   - Internal buffer array, flowing state (`null` | `true` | `false`), ended/destroyed flags
   - `push(chunk, encoding)`: adds to buffer, triggers flow if flowing. Returns `false` if buffer length >= highWaterMark
   - `read(size)`: pulls from buffer. In non-objectMode, concatenates/slices to requested size
   - `unshift(chunk)`: pushes to front of buffer
   - `_read(size)`: no-op default, called when buffer needs data
   - `pipe(dest, opts)`: enters flowing mode, forwards data to writable, handles backpressure (pauses on `write()===false`, resumes on `drain`), auto-ends dest unless `{end:false}`. Emits `pipe` on dest.
   - `unpipe(dest)`: removes pipe destination, emits `unpipe` on dest
   - `pause()` / `resume()` / `isPaused()`: control flowing state
   - `setEncoding(enc)`: stores encoding, decodes future chunks via TextDecoder
   - `destroy(err)`: sets destroyed=true, emits error (if err), emits close. Uses `_destroy` if overridden.
   - Properties: `readable`, `readableHighWaterMark`, `readableLength`, `readableFlowing`, `readableObjectMode`, `readableEncoded`, `destroyed`
   - Flowing mode triggers: adding `data` listener calls `resume()`. `readable` event fires in paused mode when data available.

5. `Writable` class:
   - Constructor takes `WritableOptions` (highWaterMark, objectMode, decodeStrings, defaultEncoding, autoDestroy, write fn, final fn)
   - Internal write queue, corked counter, ending/finished/destroyed flags
   - `write(chunk, encoding, cb)`: if not corked, calls `_write`. If corked, queues. Returns `false` if buffered length >= highWaterMark. Encodes string chunks to Buffer if `decodeStrings` is true.
   - `end(chunk, encoding, cb)`: writes final chunk (if any), calls `_final`, emits `finish` then `close`
   - `cork()` / `uncork()`: increment/decrement corked counter. On uncork to 0, flush queued writes.
   - `_write(chunk, encoding, cb)`: default throws (must override or pass in options)
   - `_final(cb)`: default calls `cb()` immediately
   - `_destroy(err, cb)`: default calls `cb(err)`
   - `destroy(err)`: sets destroyed, emits error/close
   - `setDefaultEncoding(enc)`: stores default encoding
   - Properties: `writable`, `writableHighWaterMark`, `writableLength`, `writableObjectMode`, `writableFinished`, `writableCorked`, `destroyed`
   - `drain` event: emitted when buffer empties after `write()` returned `false`

6. `Duplex` class extends `Readable`:
   - Mixes in Writable methods and state in constructor
   - Copies `_write`, `_final`, `_destroy` from Writable.prototype
   - `allowHalfOpen` option: if false, auto-ends writable side when readable ends
   - Separate highWaterMark for read/write sides via `readableHighWaterMark`/`writableHighWaterMark`

7. `Transform` class extends `Duplex`:
   - Overrides `_write` to call `_transform`
   - `_transform(chunk, encoding, cb)`: default is pass-through
   - `_flush(cb)`: called before final, default calls `cb()`
   - Connects transform output to readable side via `this.push()`

8. `PassThrough` extends `Transform`:
   - `_transform(chunk, enc, cb)`: `cb(null, chunk)`

9. `pipeline(...streams, cb)` / `pipeline(streams[], cb)`:
   - Pipes streams in sequence
   - On any stream error, destroys all streams and calls callback with error
   - On final stream finish, calls callback with null

10. Default export: object with all named exports

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/node-shims && pnpm test -- --reporter=verbose 2>&1 | tail -20`
Expected: All stream tests pass, plus all 389 existing tests still pass.

Run: `pnpm test 2>&1 | tail -5`
Expected: All tests pass across monorepo.

- [ ] **Step 6: Build and verify**

Run: `cd packages/node-shims && pnpm build`
Expected: Compiles without errors. `dist/shims/stream.js` exists.

- [ ] **Step 7: Commit**

```bash
git add packages/node-shims/src/shims/stream.ts packages/node-shims/src/shims/stream.test.ts packages/node-shims/src/constants.ts
git commit -m "feat(node-shims): add stream shim (Readable, Writable, Duplex, Transform, PassThrough, pipeline)"
```

---

### Task 2: fs shim (callback + promise API over VFS)

**Files:**
- Create: `packages/node-shims/src/shims/fs.ts`
- Create: `packages/node-shims/src/shims/fs.test.ts`
- Modify: `packages/node-shims/src/constants.ts` — add `"fs"` to `NODE_BUILTINS`

**Interfaces:**
- Consumes: `Buffer` from `./buffer.js` (class with static `from(Uint8Array)`, `_isBuffer`, `_buf`), `path` default export from `./path.js` (object with `resolve(...paths: string[]): string`)
- Produces: `readFile`, `writeFile`, `readdir`, `stat`, `lstat`, `mkdir`, `rmdir`, `unlink`, `rename`, `exists`, `symlink`, `readlink` (callback API), `Stats` class, `constants` object, `promises` object (promise API). All exported as named exports and as properties of the default export.

- [ ] **Step 1: Write fs tests**

In `packages/node-shims/src/shims/fs.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/node-shims && pnpm test -- --reporter=verbose 2>&1 | head -30`
Expected: FAIL — `./fs.js` module does not exist.

- [ ] **Step 3: Add "fs" to NODE_BUILTINS**

In `packages/node-shims/src/constants.ts`, add `"fs"` (keep sorted):

```typescript
export const NODE_BUILTINS = [
  "assert",
  "buffer",
  "events",
  "fs",
  "os",
  "path",
  "process",
  "querystring",
  "stream",
  "string_decoder",
  "url",
  "util",
] as const;
```

- [ ] **Step 4: Implement fs.ts**

Create `packages/node-shims/src/shims/fs.ts` with:

1. Import `{ Buffer }` from `./buffer.js` and `pathMod` (default) from `./path.js`
2. Declare local `VfsLike` interface (duck-typing `IVirtualFileSystem` — see spec)
3. `getVfs()` helper: reads `(globalThis as any).__vfs`, throws if undefined
4. Error code mapping helper: `mapError(err: unknown, syscall: string, path: string)` — parses VFS error messages to extract codes (`ENOENT`, `EEXIST`, `EISDIR`, `ENOTDIR`, `ENOTEMPTY`). Returns `{ code, message, path, syscall, name: "Error" }` shaped error. Default code: `"EIO"` if no pattern matches.
5. `resolvePath(p: string): string` — `pathMod.resolve(p)` to normalize paths
6. `Stats` class per spec: constructor from `{ type, size, mtime }`, `isFile()`/`isDirectory()`/`isSymbolicLink()` check type, stub methods always false, computed Date/number properties, mode 0o644/0o755 based on type, uid/gid 0
7. Callback wrappers: each callback function calls `getVfs()`, resolves path, calls VFS async method, converts result, calls callback. On VFS rejection, calls callback with mapped error.
8. `promises` object: same operations but return Promise directly. `readFile` checks encoding param, returns Buffer or string.
9. `constants` object: `{ F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 }`
10. Default export: object with all named exports

Key implementation details:
- `readFile` without encoding: wraps VFS `Uint8Array` result in `Buffer.from()`
- `readFile` with encoding: wraps then calls `.toString(encoding)`
- `writeFile` with string data: passes string directly to VFS (VFS accepts `string | Uint8Array`)
- `writeFile` with Buffer: passes `buf._buf` (the internal `Uint8Array`)
- `exists` callback: Node convention — `callback(exists: boolean)`, NO error param
- Overload parsing: check if second-to-last arg is function (callback) or options object

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/node-shims && pnpm test -- --reporter=verbose 2>&1 | tail -20`
Expected: All fs tests pass.

Run: `pnpm test 2>&1 | tail -5`
Expected: All tests pass across monorepo.

- [ ] **Step 6: Build and verify**

Run: `cd packages/node-shims && pnpm build`
Expected: Compiles without errors. `dist/shims/fs.js` exists.

- [ ] **Step 7: Commit**

```bash
git add packages/node-shims/src/shims/fs.ts packages/node-shims/src/shims/fs.test.ts packages/node-shims/src/constants.ts
git commit -m "feat(node-shims): add fs shim (callback + promise API over VFS)"
```

---

### Task 3: crypto shim (WebCrypto wrappers)

**Files:**
- Create: `packages/node-shims/src/shims/crypto.ts`
- Create: `packages/node-shims/src/shims/crypto.test.ts`
- Modify: `packages/node-shims/src/constants.ts` — add `"crypto"` to `NODE_BUILTINS`

**Interfaces:**
- Consumes: `Buffer` from `./buffer.js` (class with static `from(Uint8Array)`, `from(string, encoding?)`, static `alloc(size)`, `_buf: Uint8Array`, `toString(encoding)`)
- Produces: `Hash`, `Hmac`, `Cipher`, `Decipher` classes, `createHash(algorithm): Hash`, `createHmac(algorithm, key): Hmac`, `createCipheriv(algorithm, key, iv): Cipher`, `createDecipheriv(algorithm, key, iv): Decipher`, `randomBytes(size): Buffer`, `randomFillSync(buf, offset?, size?): Buffer|Uint8Array`, `randomUUID(): string`, `randomInt(min?, max): number`, `timingSafeEqual(a, b): boolean`, `pbkdf2(password, salt, iterations, keylen, digest, cb): void`. All exported as named exports and as properties of the default export.

- [ ] **Step 1: Write crypto tests**

In `packages/node-shims/src/shims/crypto.test.ts`:

```typescript
/// <reference types="node" />
import { describe, expect, it } from "vitest";
import {
  randomBytes, randomFillSync, randomUUID, randomInt, timingSafeEqual,
  createHash, createHmac, createCipheriv, createDecipheriv, pbkdf2,
} from "./crypto.js";
import { Buffer } from "./buffer.js";

describe("randomBytes", () => {
  it("returns Buffer of requested size", () => {
    const buf = randomBytes(32);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBe(32);
  });

  it("returns different values on each call", () => {
    const a = randomBytes(16);
    const b = randomBytes(16);
    expect(a.equals(b)).toBe(false);
  });
});

describe("randomFillSync", () => {
  it("fills a Buffer with random bytes", () => {
    const buf = Buffer.alloc(16);
    const result = randomFillSync(buf);
    expect(result).toBe(buf);
    // Check that at least some bytes are non-zero
    let hasNonZero = false;
    for (const b of buf) {
      if (b !== 0) { hasNonZero = true; break; }
    }
    expect(hasNonZero).toBe(true);
  });

  it("fills a Uint8Array", () => {
    const arr = new Uint8Array(16);
    const result = randomFillSync(arr);
    expect(result).toBe(arr);
  });

  it("respects offset and size", () => {
    const buf = Buffer.alloc(16);
    randomFillSync(buf, 4, 8);
    // First 4 bytes should still be zero
    expect(buf.readUInt32LE(0)).toBe(0);
  });
});

describe("randomUUID", () => {
  it("returns a v4 UUID string", () => {
    const uuid = randomUUID();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });
});

describe("randomInt", () => {
  it("returns integer in range [0, max)", () => {
    for (let i = 0; i < 20; i++) {
      const val = randomInt(10);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(10);
      expect(Number.isInteger(val)).toBe(true);
    }
  });

  it("returns integer in range [min, max)", () => {
    for (let i = 0; i < 20; i++) {
      const val = randomInt(5, 15);
      expect(val).toBeGreaterThanOrEqual(5);
      expect(val).toBeLessThan(15);
    }
  });
});

describe("timingSafeEqual", () => {
  it("returns true for equal buffers", () => {
    const a = Buffer.from("hello");
    const b = Buffer.from("hello");
    expect(timingSafeEqual(a, b)).toBe(true);
  });

  it("returns false for different buffers", () => {
    const a = Buffer.from("hello");
    const b = Buffer.from("world");
    expect(timingSafeEqual(a, b)).toBe(false);
  });

  it("throws for different lengths", () => {
    const a = Buffer.from("hi");
    const b = Buffer.from("hello");
    expect(() => timingSafeEqual(a, b)).toThrow();
  });

  it("works with Uint8Array", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3]);
    expect(timingSafeEqual(a, b)).toBe(true);
  });
});

describe("createHash", () => {
  it("computes SHA-256 of a string", async () => {
    const hash = createHash("sha256");
    hash.update("hello");
    const hex = await hash.digest("hex");
    expect(hex).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("computes SHA-256 with multiple updates", async () => {
    const hash = createHash("sha256");
    hash.update("hel");
    hash.update("lo");
    const hex = await hash.digest("hex");
    expect(hex).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("computes SHA-512", async () => {
    const hash = createHash("sha512");
    hash.update("hello");
    const hex = await hash.digest("hex");
    expect(hex).toHaveLength(128); // SHA-512 = 64 bytes = 128 hex chars
  });

  it("computes SHA-1", async () => {
    const hash = createHash("sha1");
    hash.update("hello");
    const hex = await hash.digest("hex");
    expect(hex).toBe("aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d");
  });

  it("digest returns Buffer by default", async () => {
    const hash = createHash("sha256");
    hash.update("hello");
    const buf = await hash.digest();
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBe(32);
  });

  it("digest base64", async () => {
    const hash = createHash("sha256");
    hash.update("hello");
    const b64 = await hash.digest("base64");
    expect(typeof b64).toBe("string");
    expect(b64.length).toBeGreaterThan(0);
  });

  it("accepts Buffer input", async () => {
    const hash = createHash("sha256");
    hash.update(Buffer.from("hello"));
    const hex = await hash.digest("hex");
    expect(hex).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("throws on unsupported algorithm", () => {
    expect(() => createHash("md5")).toThrow("not supported");
  });

  it("update returns this for chaining", () => {
    const hash = createHash("sha256");
    const result = hash.update("hello");
    expect(result).toBe(hash);
  });
});

describe("createHmac", () => {
  it("computes HMAC-SHA256", async () => {
    const hmac = createHmac("sha256", "secret");
    hmac.update("hello");
    const hex = await hmac.digest("hex");
    expect(typeof hex).toBe("string");
    expect(hex.length).toBe(64); // SHA-256 = 32 bytes = 64 hex chars
  });

  it("known HMAC-SHA256 vector", async () => {
    const hmac = createHmac("sha256", "key");
    hmac.update("The quick brown fox jumps over the lazy dog");
    const hex = await hmac.digest("hex");
    expect(hex).toBe("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  });

  it("accepts Buffer key", async () => {
    const hmac = createHmac("sha256", Buffer.from("key"));
    hmac.update("data");
    const hex = await hmac.digest("hex");
    expect(typeof hex).toBe("string");
  });
});

describe("createCipheriv / createDecipheriv", () => {
  it("AES-256-CBC roundtrip", async () => {
    const key = randomBytes(32);
    const iv = randomBytes(16);
    const plaintext = "hello world, this is a test";

    const cipher = createCipheriv("aes-256-cbc", key, iv);
    const enc1 = await cipher.update(plaintext);
    const enc2 = await cipher.final();
    const encrypted = Buffer.concat([enc1, enc2]);

    const decipher = createDecipheriv("aes-256-cbc", key, iv);
    const dec1 = await decipher.update(encrypted);
    const dec2 = await decipher.final();
    const decrypted = Buffer.concat([dec1, dec2]);

    expect(decrypted.toString("utf-8")).toBe(plaintext);
  });

  it("AES-256-GCM roundtrip with authTag", async () => {
    const key = randomBytes(32);
    const iv = randomBytes(12);
    const plaintext = "secret message";

    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const enc1 = await cipher.update(plaintext);
    const enc2 = await cipher.final();
    const encrypted = Buffer.concat([enc1, enc2]);
    const authTag = cipher.getAuthTag();

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const dec1 = await decipher.update(encrypted);
    const dec2 = await decipher.final();
    const decrypted = Buffer.concat([dec1, dec2]);

    expect(decrypted.toString("utf-8")).toBe(plaintext);
  });

  it("AES-256-CTR roundtrip", async () => {
    const key = randomBytes(32);
    const iv = randomBytes(16);
    const plaintext = "ctr mode test";

    const cipher = createCipheriv("aes-256-ctr", key, iv);
    const enc1 = await cipher.update(plaintext);
    const enc2 = await cipher.final();
    const encrypted = Buffer.concat([enc1, enc2]);

    const decipher = createDecipheriv("aes-256-ctr", key, iv);
    const dec1 = await decipher.update(encrypted);
    const dec2 = await decipher.final();
    const decrypted = Buffer.concat([dec1, dec2]);

    expect(decrypted.toString("utf-8")).toBe(plaintext);
  });

  it("throws on unsupported cipher algorithm", () => {
    expect(() => createCipheriv("des-cbc", randomBytes(8), randomBytes(8))).toThrow();
  });
});

describe("pbkdf2", () => {
  it("derives key with known vector", () => {
    return new Promise<void>((resolve, reject) => {
      pbkdf2("password", "salt", 1, 32, "sha256", (err, key) => {
        if (err) return reject(err);
        expect(Buffer.isBuffer(key)).toBe(true);
        expect(key.length).toBe(32);
        const hex = key.toString("hex");
        expect(hex).toBe("120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b");
        resolve();
      });
    });
  });

  it("accepts Buffer password and salt", () => {
    return new Promise<void>((resolve, reject) => {
      pbkdf2(Buffer.from("password"), Buffer.from("salt"), 1, 20, "sha256", (err, key) => {
        if (err) return reject(err);
        expect(key.length).toBe(20);
        resolve();
      });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/node-shims && pnpm test -- --reporter=verbose 2>&1 | head -30`
Expected: FAIL — `./crypto.js` module does not exist.

- [ ] **Step 3: Add "crypto" to NODE_BUILTINS**

In `packages/node-shims/src/constants.ts`, add `"crypto"` (keep sorted). Final state:

```typescript
export const NODE_BUILTINS = [
  "assert",
  "buffer",
  "crypto",
  "events",
  "fs",
  "os",
  "path",
  "process",
  "querystring",
  "stream",
  "string_decoder",
  "url",
  "util",
] as const;
```

- [ ] **Step 4: Implement crypto.ts**

Create `packages/node-shims/src/shims/crypto.ts` with:

1. Import `{ Buffer }` from `./buffer.js`
2. Ambient `declare const crypto: { ... }` with `getRandomValues`, `randomUUID`, `subtle` (digest, sign, importKey, deriveBits, encrypt, decrypt) — see spec
3. `HASH_ALGORITHMS` and `CIPHER_ALGORITHMS` mapping objects — see spec
4. Helper `resolveHashAlgorithm(name: string): string` — looks up in `HASH_ALGORITHMS`, throws `Error("md5 is not supported — use sha256 or higher")` for md5, throws `Error("Unsupported hash algorithm: ${name}")` for unknown
5. Helper `resolveCipherAlgorithm(name: string): { webcrypto: string; keyLength: number }` — parses `aes-256-cbc` etc. Returns `{ webcrypto: "AES-CBC", keyLength: 32 }`. Key length from algorithm name (128→16, 192→24, 256→32). Throws for unknown.
6. Helper `toUint8Array(data: string | Buffer | Uint8Array, encoding?: string): Uint8Array` — converts input to `Uint8Array` for WebCrypto
7. `Hash` class:
   - `_algorithm: string` (WebCrypto name), `_data: Uint8Array[]` (accumulated chunks)
   - `update(data, encoding?)`: converts to Uint8Array, pushes to `_data`, returns `this`
   - `digest(encoding?)`: concatenates `_data`, calls `crypto.subtle.digest()`, returns `Promise<Buffer>` or `Promise<string>` based on encoding
8. `Hmac` class:
   - `_algorithm: string`, `_key: Uint8Array`, `_data: Uint8Array[]`
   - `update(data, encoding?)`: same as Hash
   - `digest(encoding?)`: imports key via `crypto.subtle.importKey("raw", key, {name:"HMAC", hash: algorithm}, false, ["sign"])`, then `crypto.subtle.sign("HMAC", cryptoKey, data)`. Returns Promise.
9. `Cipher` class:
   - `_algorithm: string` (WebCrypto name e.g. "AES-CBC"), `_key: Uint8Array`, `_iv: Uint8Array`, `_data: Uint8Array[]`, `_authTag: Buffer | null`
   - `update(data, inputEncoding?)`: converts, pushes to `_data`, returns `Promise<Buffer>` (empty buffer — actual encryption deferred to `final()`)
   - `final()`: concatenates `_data`, imports key, calls `crypto.subtle.encrypt(params, key, data)`. For GCM: extracts last 16 bytes as authTag. Returns `Promise<Buffer>` with ciphertext.
   - `getAuthTag()`: returns `_authTag` (throws if not GCM or not finalized)
10. `Decipher` class:
    - Same structure as Cipher, but uses `crypto.subtle.decrypt`
    - `setAuthTag(tag)`: stores tag for GCM. For GCM decrypt, appends authTag to ciphertext (WebCrypto GCM expects tag appended).
11. Sync functions:
    - `randomBytes(size)`: `const arr = new Uint8Array(size); crypto.getRandomValues(arr); return Buffer.from(arr);`
    - `randomFillSync(buf, offset?, size?)`: fills appropriate slice with `crypto.getRandomValues`, returns `buf`
    - `randomUUID()`: `crypto.randomUUID()`
    - `randomInt(min_or_max, max?)`: uses `crypto.getRandomValues(new Uint32Array(1))` for randomness, maps to range
    - `timingSafeEqual(a, b)`: XOR loop, throws if lengths differ
12. `pbkdf2(password, salt, iterations, keylen, digest, cb)`: converts inputs to Uint8Array, imports key via `importKey("raw", password, "PBKDF2", ...)`, calls `deriveBits({name:"PBKDF2", salt, iterations, hash: resolvedDigest}, key, keylen*8)`, wraps result in Buffer, calls `cb(null, result)`. On error calls `cb(err)`.
13. Factory functions: `createHash`, `createHmac`, `createCipheriv`, `createDecipheriv` — simple constructors
14. Default export: object with all named exports

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/node-shims && pnpm test -- --reporter=verbose 2>&1 | tail -20`
Expected: All crypto tests pass.

Run: `pnpm test 2>&1 | tail -5`
Expected: All tests pass across monorepo.

- [ ] **Step 6: Build and verify**

Run: `cd packages/node-shims && pnpm build`
Expected: Compiles without errors. `dist/shims/crypto.js` exists.

- [ ] **Step 7: Commit**

```bash
git add packages/node-shims/src/shims/crypto.ts packages/node-shims/src/shims/crypto.test.ts packages/node-shims/src/constants.ts
git commit -m "feat(node-shims): add crypto shim (WebCrypto-backed hash, hmac, cipher, random)"
```

---

### Task 4: Integration tests for stream, fs, crypto

**Files:**
- Modify: `packages/node-shims/src/integration.test.ts` — add integration tests for new shims

**Interfaces:**
- Consumes: `Stream`, `Readable`, `Writable`, `PassThrough`, `pipeline` from stream shim; `readFile`, `writeFile`, `promises` from fs shim; `createHash`, `randomBytes` from crypto shim. `createNodeShimsPlugin()`, `populateShims()`, `createVfsPlugin()`, `MemoryFS` from existing packages.
- Produces: No new interfaces — this is a test-only task.

- [ ] **Step 1: Add integration tests for stream, fs, crypto**

Append the following tests to the existing `describe("node-shims integration", ...)` block in `packages/node-shims/src/integration.test.ts`:

```typescript
  it("resolves the stream shim and constructs PassThrough", async () => {
    const vfs = await setupVfs();
    const { result, logs } = await buildAndRun(
      vfs,
      "/project/src/index.ts",
      `
      import { PassThrough } from "stream";
      const pt = new PassThrough();
      pt.on("data", (chunk) => console.log(String(chunk)));
      pt.write("stream-ok");
      pt.end();
      `,
    );
    expect(result.errors).toHaveLength(0);
    expect(logs.join("\n")).toContain("stream-ok");
  });

  it("resolves the stream shim with node: prefix", async () => {
    const vfs = await setupVfs();
    const result = await buildWithShims(
      vfs,
      "/project/src/index.ts",
      `import { Readable, Writable, Transform } from "node:stream";\nconsole.log(typeof Readable, typeof Writable, typeof Transform);`,
    );
    expect(result.errors).toHaveLength(0);
  });

  it("resolves the fs shim", async () => {
    const vfs = await setupVfs();
    const result = await buildWithShims(
      vfs,
      "/project/src/index.ts",
      `import { readFile, writeFile, promises } from "fs";\nconsole.log(typeof readFile, typeof writeFile, typeof promises);`,
    );
    expect(result.errors).toHaveLength(0);
  });

  it("resolves the crypto shim and runs randomBytes", async () => {
    const vfs = await setupVfs();
    const { result, logs } = await buildAndRun(
      vfs,
      "/project/src/index.ts",
      `
      import { randomBytes } from "crypto";
      const buf = randomBytes(4);
      console.log(buf.length);
      `,
    );
    expect(result.errors).toHaveLength(0);
    expect(logs.join("\n")).toContain("4");
  });

  it("bundles all Phase 5B shims together with Phase 5A shims", async () => {
    const vfs = await setupVfs();
    const result = await buildWithShims(
      vfs,
      "/project/src/index.ts",
      `
      import { join } from "path";
      import { Buffer } from "buffer";
      import { EventEmitter } from "events";
      import { Readable } from "stream";
      import { readFile } from "fs";
      import { randomBytes } from "crypto";
      console.log(join("a","b"), Buffer.from("x"), new EventEmitter(), Readable, readFile, randomBytes(1));
      `,
    );
    expect(result.errors).toHaveLength(0);
  });

  it("resolves cross-shim imports in stream (stream imports events)", async () => {
    const vfs = await setupVfs();
    const { result, logs } = await buildAndRun(
      vfs,
      "/project/src/index.ts",
      `
      import { Readable } from "stream";
      const r = new Readable({ read() { this.push("cross-ok"); this.push(null); } });
      r.on("data", (c) => console.log(String(c)));
      `,
    );
    expect(result.errors).toHaveLength(0);
    expect(logs.join("\n")).toContain("cross-ok");
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd packages/node-shims && pnpm build && pnpm test -- --reporter=verbose 2>&1 | tail -30`
Expected: All integration tests pass, including new stream/fs/crypto tests.

Run: `pnpm test 2>&1 | tail -5`
Expected: All tests pass across monorepo.

- [ ] **Step 3: Commit**

```bash
git add packages/node-shims/src/integration.test.ts
git commit -m "test(node-shims): add integration tests for stream, fs, and crypto shims"
```
