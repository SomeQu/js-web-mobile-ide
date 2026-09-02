/// <reference types="node" />
import { describe, it, expect, beforeAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { createRequire } from "node:module";
// Import the browser build directly: esbuild-wasm's default Node entrypoint
// spawns the WASM binary via a child process and rejects `wasmModule`/
// `worker` options ("only works in the browser"). Our runtime target is
// JavaScriptCore/WKWebView (no Node child_process), so the plugin is
// exercised here against the same browser build it will actually run
// under, with `worker: false` so it runs inline instead of spinning up a
// Web Worker (unavailable in vitest's node environment).
import * as esbuild from "esbuild-wasm/lib/browser.js";
import { MemoryFS } from "@anthropic-ide/vfs";
import { createVfsPlugin } from "@anthropic-ide/bundler";
import { createNodeShimsPlugin } from "./plugin.js";
import { populateShims } from "./populate.js";
import type { ShimSources } from "./types.js";

// The browser build expects a `self` global (as in a Worker/Window). Vitest's
// node environment has no such global, so polyfill it before initializing.
if (typeof (globalThis as { self?: unknown }).self === "undefined") {
  (globalThis as { self?: unknown }).self = globalThis;
}

let initialized = false;

beforeAll(async () => {
  if (!initialized) {
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve("esbuild-wasm/esbuild.wasm");
    const wasmBinary = readFileSync(wasmPath).buffer;
    await esbuild.initialize({
      wasmModule: new WebAssembly.Module(wasmBinary),
      worker: false,
    });
    initialized = true;
  }
});

// Reads the compiled shim JS produced by `pnpm build` (dist/shims/*.js) so
// the integration tests exercise the actual bundled shim output, not the
// TypeScript sources.
function loadShimSources(): ShimSources {
  const require = createRequire(import.meta.url);
  const shimsDir = join(require.resolve("../package.json"), "..", "dist", "shims");
  const shimFiles = readdirSync(shimsDir).filter(
    (f) => f.endsWith(".js") && !f.endsWith(".test.js"),
  );

  const sources: ShimSources = {};
  for (const file of shimFiles) {
    const name = basename(file, ".js").replace(/-/g, "_");
    sources[name] = readFileSync(join(shimsDir, file), "utf-8");
  }
  return sources;
}

async function setupVfs(): Promise<MemoryFS> {
  const vfs = new MemoryFS();
  await populateShims(vfs, loadShimSources());
  return vfs;
}

async function buildWithShims(
  vfs: MemoryFS,
  entryPoint: string,
  entryCode: string,
): Promise<esbuild.BuildResult> {
  await vfs.mkdir("/project/src", { recursive: true });
  await vfs.writeFile(entryPoint, entryCode);

  return esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    format: "esm",
    target: "es2020",
    platform: "browser",
    outdir: "/out",
    plugins: [createNodeShimsPlugin(), createVfsPlugin(vfs)],
  });
}

// Bundles the entry to CommonJS (rather than ESM) so the output has no
// dangling `import`/`export` statements, then evaluates it with `console.log`
// captured — letting tests assert on the shim's actual runtime behavior
// rather than just on the bundled source text.
async function buildAndRun(
  vfs: MemoryFS,
  entryPoint: string,
  entryCode: string,
): Promise<{ result: esbuild.BuildResult; logs: string[] }> {
  await vfs.mkdir("/project/src", { recursive: true });
  await vfs.writeFile(entryPoint, entryCode);

  const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    format: "cjs",
    target: "es2020",
    platform: "browser",
    outdir: "/out",
    plugins: [createNodeShimsPlugin(), createVfsPlugin(vfs)],
  });

  const logs: string[] = [];
  if (result.errors.length === 0) {
    const code = result.outputFiles![0].text;
    const run = new Function(
      "console",
      "module",
      "exports",
      "require",
      code,
    );
    run(
      { log: (...args: unknown[]) => logs.push(args.map(String).join(" ")) },
      { exports: {} },
      {},
      () => {
        throw new Error("unexpected require() in fully bundled output");
      },
    );
  }
  return { result, logs };
}

describe("node-shims integration", () => {
  it("resolves the path shim", async () => {
    const vfs = await setupVfs();
    const { result, logs } = await buildAndRun(
      vfs,
      "/project/src/index.ts",
      `import { join } from "path";\nconsole.log(join("a", "b"));`,
    );
    expect(result.errors).toHaveLength(0);
    expect(logs.join("\n")).toContain("a/b");
  });

  it("resolves the node: prefixed path shim the same as the bare specifier", async () => {
    const vfs = await setupVfs();
    const { result, logs } = await buildAndRun(
      vfs,
      "/project/src/index.ts",
      `import { join } from "node:path";\nconsole.log(join("a", "b"));`,
    );
    expect(result.errors).toHaveLength(0);
    expect(logs.join("\n")).toContain("a/b");
  });

  it("resolves the buffer shim", async () => {
    const vfs = await setupVfs();
    const result = await buildWithShims(
      vfs,
      "/project/src/index.ts",
      `import { Buffer } from "buffer";\nconst b = Buffer.from("hi");\nconsole.log(b);`,
    );
    expect(result.errors).toHaveLength(0);
  });

  it("resolves the events shim", async () => {
    const vfs = await setupVfs();
    const result = await buildWithShims(
      vfs,
      "/project/src/index.ts",
      `import { EventEmitter } from "events";\nconst e = new EventEmitter();\nconsole.log(e);`,
    );
    expect(result.errors).toHaveLength(0);
  });

  it("resolves the process shim", async () => {
    const vfs = await setupVfs();
    const result = await buildWithShims(
      vfs,
      "/project/src/index.ts",
      `import process from "process";\nconsole.log(process.cwd());`,
    );
    expect(result.errors).toHaveLength(0);
  });

  it("bundles multiple shims in one entry with no errors", async () => {
    const vfs = await setupVfs();
    const result = await buildWithShims(
      vfs,
      "/project/src/index.ts",
      `
      import { join } from "path";
      import { Buffer } from "buffer";
      import { EventEmitter } from "events";
      import { format } from "util";
      console.log(join("a", "b"), Buffer.from("hi"), new EventEmitter(), format("%s", "x"));
      `,
    );
    expect(result.errors).toHaveLength(0);
  });

  it("does not intercept an unknown module and reports a resolve error", async () => {
    const vfs = await setupVfs();
    await vfs.mkdir("/project/src", { recursive: true });
    await vfs.writeFile(
      "/project/src/index.ts",
      `import x from "unknown-module";\nconsole.log(x);`,
    );

    const result = await esbuild
      .build({
        entryPoints: ["/project/src/index.ts"],
        bundle: true,
        write: false,
        format: "esm",
        target: "es2020",
        platform: "browser",
        outdir: "/out",
        logLevel: "silent",
        plugins: [createNodeShimsPlugin(), createVfsPlugin(vfs)],
      })
      .catch((e: esbuild.BuildFailure) => e);

    expect((result as esbuild.BuildFailure).errors.length).toBeGreaterThan(0);
  });

  it("resolves cross-shim imports (assert imports from util internally)", async () => {
    const vfs = await setupVfs();
    const result = await buildWithShims(
      vfs,
      "/project/src/index.ts",
      `import { ok } from "assert";\nok(true, "should not throw");`,
    );
    expect(result.errors).toHaveLength(0);
  });

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
});
