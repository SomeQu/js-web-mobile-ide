import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
// Import the browser build directly: esbuild-wasm's default Node entrypoint
// spawns the WASM binary via a child process and rejects `wasmModule`/`worker`
// options ("only works in the browser"). Our runtime target is JavaScriptCore/
// WKWebView (no Node child_process), so the plugin is exercised here against
// the same browser build it will actually run under, with `worker: false` so
// it runs inline instead of spinning up a Web Worker (unavailable in vitest's
// node environment).
import * as esbuild from "esbuild-wasm/lib/browser.js";
import { MemoryFS } from "@anthropic-ide/vfs";
import { createVfsPlugin } from "./vfs-plugin.js";

// The browser build expects a `self` global (as in a Worker/Window). Vitest's
// node environment has no such global, so polyfill it before initializing.
if (typeof (globalThis as { self?: unknown }).self === "undefined") {
  (globalThis as { self?: unknown }).self = globalThis;
}

let initialized = false;

beforeAll(async () => {
  if (!initialized) {
    // Resolve via Node's module resolution (from this file's location) rather
    // than a cwd-relative path, so this works whether tests are run from this
    // package's own directory (`pnpm --filter ... test`) or from the repo
    // root (`pnpm test`).
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

async function buildWithVfs(
  vfs: MemoryFS,
  entryPoint: string,
): Promise<esbuild.BuildResult> {
  return esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    format: "esm",
    target: "es2020",
    platform: "browser",
    // Needed so esbuild has a place to name any additional output chunks
    // (e.g. the CSS file split out from a `import "./style.css"`).
    outdir: "/out",
    plugins: [createVfsPlugin(vfs)],
  });
}

describe("VFS Plugin", () => {
  it("resolves and loads a single TS file", async () => {
    const vfs = new MemoryFS();
    await vfs.mkdir("/project/src", { recursive: true });
    await vfs.writeFile("/project/src/index.ts", "export const x: number = 42;");

    const result = await buildWithVfs(vfs, "/project/src/index.ts");
    expect(result.outputFiles).toHaveLength(1);
    const code = result.outputFiles![0].text;
    expect(code).toContain("42");
    expect(code).not.toContain(": number");
  });

  it("resolves relative imports between files", async () => {
    const vfs = new MemoryFS();
    await vfs.mkdir("/project/src", { recursive: true });
    await vfs.writeFile("/project/src/utils.ts", "export const greeting = 'hello';");
    await vfs.writeFile("/project/src/index.ts", `
      import { greeting } from "./utils";
      export const msg = greeting;
    `);

    const result = await buildWithVfs(vfs, "/project/src/index.ts");
    const code = result.outputFiles![0].text;
    expect(code).toContain("hello");
  });

  it("resolves bare specifiers from node_modules", async () => {
    const vfs = new MemoryFS();
    await vfs.mkdir("/project/src", { recursive: true });
    await vfs.mkdir("/node_modules/my-lib", { recursive: true });
    await vfs.writeFile("/node_modules/my-lib/package.json", JSON.stringify({
      name: "my-lib",
      main: "./index.js",
    }));
    await vfs.writeFile("/node_modules/my-lib/index.js", "export const value = 99;");
    await vfs.writeFile("/project/src/index.ts", `
      import { value } from "my-lib";
      export const result = value;
    `);

    const result = await buildWithVfs(vfs, "/project/src/index.ts");
    const code = result.outputFiles![0].text;
    expect(code).toContain("99");
  });

  it("loads JSON files", async () => {
    const vfs = new MemoryFS();
    await vfs.mkdir("/project/src", { recursive: true });
    await vfs.writeFile("/project/src/data.json", '{"key": "value"}');
    await vfs.writeFile("/project/src/index.ts", `
      import data from "./data.json";
      export const key = data.key;
    `);

    const result = await buildWithVfs(vfs, "/project/src/index.ts");
    const code = result.outputFiles![0].text;
    expect(code).toContain("value");
  });

  it("loads CSS as text", async () => {
    const vfs = new MemoryFS();
    await vfs.mkdir("/project/src", { recursive: true });
    await vfs.writeFile("/project/src/style.css", ".red { color: red; }");
    await vfs.writeFile("/project/src/index.ts", `
      import "./style.css";
      export const x = 1;
    `);

    const result = await buildWithVfs(vfs, "/project/src/index.ts");
    expect(result.errors).toHaveLength(0);
  });

  it("reports error for missing file", async () => {
    const vfs = new MemoryFS();
    await vfs.mkdir("/project/src", { recursive: true });
    await vfs.writeFile("/project/src/index.ts", `
      import { x } from "./missing";
      export const y = x;
    `);

    const result = await esbuild.build({
      entryPoints: ["/project/src/index.ts"],
      bundle: true,
      write: false,
      format: "esm",
      target: "es2020",
      platform: "browser",
      plugins: [createVfsPlugin(vfs)],
      logLevel: "silent",
    }).catch((e: esbuild.BuildFailure) => e);

    expect((result as esbuild.BuildFailure).errors.length).toBeGreaterThan(0);
  });

  it("determines correct loader by extension", async () => {
    const vfs = new MemoryFS();
    await vfs.mkdir("/project/src", { recursive: true });
    await vfs.writeFile("/project/src/app.tsx", `
      const App = () => <div>hello</div>;
      export default App;
    `);
    await vfs.writeFile("/project/src/index.ts", `
      import App from "./app";
      export { App };
    `);

    const result = await esbuild.build({
      entryPoints: ["/project/src/index.ts"],
      bundle: true,
      write: false,
      format: "esm",
      target: "es2020",
      platform: "browser",
      // Classic transform (React.createElement) avoids needing to resolve
      // "react/jsx-runtime" through the VFS, which this test's fixture does
      // not provide — the point here is verifying the .tsx loader is picked
      // correctly, not exercising the automatic JSX runtime import.
      jsx: "transform",
      plugins: [createVfsPlugin(vfs)],
    });
    const code = result.outputFiles![0].text;
    expect(code).toContain("hello");
  });
});
