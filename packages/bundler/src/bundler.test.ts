import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { MemoryFS } from "@anthropic-ide/vfs";
import { initBundler } from "./bundler.js";
import type { IBundler } from "./types.js";

// The browser build of esbuild-wasm (used under the hood so this works in
// JavaScriptCore/WKWebView, not just Node) expects a `self` global as in a
// Worker/Window. Vitest's node environment has no such global, so polyfill
// it before initializing, same as vfs-plugin.test.ts.
if (typeof (globalThis as { self?: unknown }).self === "undefined") {
  (globalThis as { self?: unknown }).self = globalThis;
}

let bundler: IBundler;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const wasmPath = require.resolve("esbuild-wasm/esbuild.wasm");
  const wasmBinary = readFileSync(wasmPath).buffer;
  bundler = await initBundler({ wasmBinary });
});

describe("bundle()", () => {
  it("bundles TypeScript, stripping type annotations", async () => {
    const vfs = new MemoryFS();
    await vfs.mkdir("/project/src", { recursive: true });
    await vfs.writeFile("/project/src/index.ts", `
      interface User { name: string; }
      const user: User = { name: "Alice" };
      export default user;
    `);

    const result = await bundler.bundle({ entryPoint: "/project/src/index.ts", vfs });
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain("Alice");
    expect(result.code).not.toContain("interface");
    expect(result.code).not.toContain(": User");
  });

  it("transforms TSX with automatic runtime", async () => {
    const vfs = new MemoryFS();
    await vfs.mkdir("/project/src", { recursive: true });
    await vfs.writeFile("/project/src/index.tsx", `
      export const App = () => <div className="app">Hello</div>;
    `);

    const result = await bundler.bundle({
      entryPoint: "/project/src/index.tsx",
      vfs,
      jsx: "automatic",
      jsxImportSource: "react",
    });
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain("Hello");
    expect(result.code).not.toContain("<div");
  });

  it("transforms JSX with classic transform", async () => {
    const vfs = new MemoryFS();
    await vfs.mkdir("/project/src", { recursive: true });
    await vfs.writeFile("/project/src/index.jsx", `
      export const App = () => <div>Hi</div>;
    `);

    const result = await bundler.bundle({
      entryPoint: "/project/src/index.jsx",
      vfs,
      jsx: "transform",
      jsxFactory: "h",
      jsxFragment: "Fragment",
    });
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain("Hi");
    expect(result.code).toContain("h(");
  });

  it("imports JSON files", async () => {
    const vfs = new MemoryFS();
    await vfs.mkdir("/project/src", { recursive: true });
    await vfs.writeFile("/project/src/config.json", '{"port": 3001}');
    await vfs.writeFile("/project/src/index.ts", `
      import config from "./config.json";
      export const port = config.port;
    `);

    const result = await bundler.bundle({ entryPoint: "/project/src/index.ts", vfs });
    expect(result.errors).toHaveLength(0);
    // esbuild's printer normalizes round numbers like 3000 to exponential
    // form (3e3) regardless of minify, independent of our loader/plugin —
    // use a non-round port so the literal text survives verbatim.
    expect(result.code).toContain("3001");
  });

  it("returns errors for syntax errors instead of throwing", async () => {
    const vfs = new MemoryFS();
    await vfs.mkdir("/project/src", { recursive: true });
    await vfs.writeFile("/project/src/index.ts", `
      export const x = {;
    `);

    const result = await bundler.bundle({ entryPoint: "/project/src/index.ts", vfs });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toBeTruthy();
    expect(result.errors[0].file).toBe("/project/src/index.ts");
    expect(typeof result.errors[0].line).toBe("number");
  });

  it("generates inline source maps when enabled", async () => {
    const vfs = new MemoryFS();
    await vfs.mkdir("/project/src", { recursive: true });
    await vfs.writeFile("/project/src/index.ts", "export const x = 42;");

    const result = await bundler.bundle({
      entryPoint: "/project/src/index.ts",
      vfs,
      sourceMap: true,
    });
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain("//# sourceMappingURL=data:");
  });

  it("minifies output when enabled", async () => {
    const vfs = new MemoryFS();
    await vfs.mkdir("/project/src", { recursive: true });
    await vfs.writeFile("/project/src/index.ts", `
      export const longVariableName = 42;
      export const anotherLongName = longVariableName + 1;
    `);

    const noMinify = await bundler.bundle({
      entryPoint: "/project/src/index.ts",
      vfs,
      minify: false,
    });
    const minified = await bundler.bundle({
      entryPoint: "/project/src/index.ts",
      vfs,
      minify: true,
    });
    expect(minified.code.length).toBeLessThan(noMinify.code.length);
  });

  it("bundles multi-file project with node_modules dependency", async () => {
    const vfs = new MemoryFS();
    await vfs.mkdir("/project/src", { recursive: true });
    await vfs.mkdir("/node_modules/tiny-lib", { recursive: true });
    await vfs.writeFile("/node_modules/tiny-lib/package.json", JSON.stringify({
      name: "tiny-lib",
      main: "./index.js",
    }));
    await vfs.writeFile("/node_modules/tiny-lib/index.js", "export const double = n => n * 2;");
    await vfs.writeFile("/project/src/math.ts", `
      import { double } from "tiny-lib";
      export function quadruple(n: number): number { return double(double(n)); }
    `);
    await vfs.writeFile("/project/src/index.ts", `
      import { quadruple } from "./math";
      export const result = quadruple(5);
    `);

    const result = await bundler.bundle({ entryPoint: "/project/src/index.ts", vfs });
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain("double");
  });
});

describe("createContext() / rebuild()", () => {
  it("rebuilds after file change reflects new content", async () => {
    const vfs = new MemoryFS();
    await vfs.mkdir("/project/src", { recursive: true });
    await vfs.writeFile("/project/src/index.ts", "export const version = 1;");

    const ctx = await bundler.createContext({ entryPoint: "/project/src/index.ts", vfs });
    const first = await ctx.rebuild();
    expect(first.code).toContain("1");

    await vfs.writeFile("/project/src/index.ts", "export const version = 2;");
    const second = await ctx.rebuild();
    expect(second.code).toContain("2");

    ctx.dispose();
  });

  it("dispose does not throw", async () => {
    const vfs = new MemoryFS();
    await vfs.mkdir("/project/src", { recursive: true });
    await vfs.writeFile("/project/src/index.ts", "export const x = 1;");

    const ctx = await bundler.createContext({ entryPoint: "/project/src/index.ts", vfs });
    await ctx.rebuild();
    expect(() => ctx.dispose()).not.toThrow();
  });
});
