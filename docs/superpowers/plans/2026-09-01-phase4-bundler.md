# Phase 4: Bundler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bundle user project code + installed npm packages into executable JS for on-device JavaScriptCore execution, using esbuild-wasm with a VFS adapter.

**Architecture:** Thin wrapper around esbuild-wasm. A VFS plugin intercepts all file reads, routing them through `IVirtualFileSystem`. A dedicated module resolver handles relative paths, bare specifiers, and `package.json` `exports`/`main`/`module` fields. `initBundler()` initializes the WASM runtime once; `bundle()` and `createContext()` provide one-shot and incremental build modes.

**Tech Stack:** TypeScript (ES2020), esbuild-wasm, `@anthropic-ide/vfs`, Vitest

**Spec:** `docs/superpowers/specs/2026-09-01-bundler-design.md`

## Global Constraints

- No Node-specific APIs (`node:*`) in source files — only in `*.test.ts`
- Target: ES2020 for JavaScriptCore compatibility
- Package scope: `@anthropic-ide/*`
- Cross-package communication only through exported interfaces from `index.ts`
- No npm dependencies with native bindings (node-gyp)
- Commit convention: Conventional Commits (`feat`/`fix`/`chore`/`docs`)
- TDD: test first, then implementation
- `esbuild-wasm` is the only new runtime dependency (pure JS + WASM, no native bindings)
- All file I/O through `IVirtualFileSystem` — no direct filesystem access in source files

---

### Task 1: Types, package setup, and module resolver

**Files:**
- Modify: `packages/bundler/package.json` — add `esbuild-wasm` dependency, `@anthropic-ide/vfs` peer dep
- Create: `packages/bundler/src/types.ts` — all public interfaces
- Create: `packages/bundler/src/resolver.ts` — module resolution logic
- Create: `packages/bundler/src/resolver.test.ts` — resolver tests

**Interfaces:**
- Consumes: `IVirtualFileSystem` from `@anthropic-ide/vfs` (`readFile`, `exists`, `stat`, `readdir`)
- Consumes: `dirname`, `join`, `resolve`, `basename`, `normalize` from `@anthropic-ide/vfs`
- Produces:
  - `InitOptions` — `{ wasmBinary: ArrayBuffer }`
  - `BundleOptions` — `{ entryPoint: string; vfs: IVirtualFileSystem; jsx?: "transform" | "automatic"; jsxFactory?: string; jsxFragment?: string; jsxImportSource?: string; minify?: boolean; sourceMap?: boolean }`
  - `BundleResult` — `{ code: string; errors: BundleError[]; warnings: BundleError[] }`
  - `BundleError` — `{ message: string; file?: string; line?: number; column?: number }`
  - `IBundler` — `{ bundle(options: BundleOptions): Promise<BundleResult>; createContext(options: BundleOptions): Promise<BundleContext> }`
  - `BundleContext` — `{ rebuild(): Promise<BundleResult>; dispose(): void }`
  - `resolveModuleSpecifier(specifier: string, importer: string, vfs: IVirtualFileSystem, cache: Map<string, unknown>): Promise<string>` — resolves any import specifier to an absolute VFS path
  - `resolvePackageExports(exports: unknown, subpath: string, conditions: string[]): string | null` — resolves a subpath through a package.json `exports` field

- [ ] **Step 1: Update package.json**

Update `packages/bundler/package.json`:

```json
{
  "name": "@anthropic-ide/bundler",
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
    "esbuild-wasm": "^0.28.2"
  },
  "peerDependencies": {
    "@anthropic-ide/vfs": "workspace:*"
  }
}
```

Run: `pnpm install`

- [ ] **Step 2: Write types.ts**

Create `packages/bundler/src/types.ts`:

```ts
import type { IVirtualFileSystem } from "@anthropic-ide/vfs";

export interface InitOptions {
  wasmBinary: ArrayBuffer;
}

export interface BundleOptions {
  entryPoint: string;
  vfs: IVirtualFileSystem;
  jsx?: "transform" | "automatic";
  jsxFactory?: string;
  jsxFragment?: string;
  jsxImportSource?: string;
  minify?: boolean;
  sourceMap?: boolean;
}

export interface BundleResult {
  code: string;
  errors: BundleError[];
  warnings: BundleError[];
}

export interface BundleError {
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface IBundler {
  bundle(options: BundleOptions): Promise<BundleResult>;
  createContext(options: BundleOptions): Promise<BundleContext>;
}

export interface BundleContext {
  rebuild(): Promise<BundleResult>;
  dispose(): void;
}
```

- [ ] **Step 3: Write resolver tests**

Create `packages/bundler/src/resolver.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryFS } from "@anthropic-ide/vfs";
import { resolveModuleSpecifier, resolvePackageExports } from "./resolver.js";

describe("resolveModuleSpecifier", () => {
  let vfs: MemoryFS;
  let cache: Map<string, unknown>;

  beforeEach(() => {
    vfs = new MemoryFS();
    cache = new Map();
  });

  describe("relative imports", () => {
    it("resolves exact file path", async () => {
      await vfs.mkdir("/project/src", { recursive: true });
      await vfs.writeFile("/project/src/utils.ts", "export const x = 1;");

      const result = await resolveModuleSpecifier("./utils.ts", "/project/src/index.ts", vfs, cache);
      expect(result).toBe("/project/src/utils.ts");
    });

    it("resolves .ts extension", async () => {
      await vfs.mkdir("/project/src", { recursive: true });
      await vfs.writeFile("/project/src/utils.ts", "export const x = 1;");

      const result = await resolveModuleSpecifier("./utils", "/project/src/index.ts", vfs, cache);
      expect(result).toBe("/project/src/utils.ts");
    });

    it("resolves .tsx extension", async () => {
      await vfs.mkdir("/project/src", { recursive: true });
      await vfs.writeFile("/project/src/Button.tsx", "export default () => <div/>;");

      const result = await resolveModuleSpecifier("./Button", "/project/src/index.ts", vfs, cache);
      expect(result).toBe("/project/src/Button.tsx");
    });

    it("resolves .js extension", async () => {
      await vfs.mkdir("/project/src", { recursive: true });
      await vfs.writeFile("/project/src/helper.js", "export const x = 1;");

      const result = await resolveModuleSpecifier("./helper", "/project/src/index.ts", vfs, cache);
      expect(result).toBe("/project/src/helper.js");
    });

    it("resolves .jsx extension", async () => {
      await vfs.mkdir("/project/src", { recursive: true });
      await vfs.writeFile("/project/src/App.jsx", "export default () => <div/>;");

      const result = await resolveModuleSpecifier("./App", "/project/src/index.ts", vfs, cache);
      expect(result).toBe("/project/src/App.jsx");
    });

    it("resolves directory index.ts", async () => {
      await vfs.mkdir("/project/src/components", { recursive: true });
      await vfs.writeFile("/project/src/components/index.ts", "export {};");

      const result = await resolveModuleSpecifier("./components", "/project/src/index.ts", vfs, cache);
      expect(result).toBe("/project/src/components/index.ts");
    });

    it("resolves directory index.tsx", async () => {
      await vfs.mkdir("/project/src/components", { recursive: true });
      await vfs.writeFile("/project/src/components/index.tsx", "export {};");

      const result = await resolveModuleSpecifier("./components", "/project/src/index.ts", vfs, cache);
      expect(result).toBe("/project/src/components/index.tsx");
    });

    it("resolves parent directory imports", async () => {
      await vfs.mkdir("/project/src/components", { recursive: true });
      await vfs.writeFile("/project/src/utils.ts", "export const x = 1;");

      const result = await resolveModuleSpecifier("../utils", "/project/src/components/Button.tsx", vfs, cache);
      expect(result).toBe("/project/src/utils.ts");
    });

    it("throws on missing relative import", async () => {
      await vfs.mkdir("/project/src", { recursive: true });

      await expect(
        resolveModuleSpecifier("./nonexistent", "/project/src/index.ts", vfs, cache),
      ).rejects.toThrow(/Cannot resolve.*nonexistent/);
    });
  });

  describe("bare specifiers", () => {
    it("resolves package with main field", async () => {
      await vfs.mkdir("/node_modules/lodash", { recursive: true });
      await vfs.writeFile("/node_modules/lodash/package.json", JSON.stringify({
        name: "lodash",
        main: "./lodash.js",
      }));
      await vfs.writeFile("/node_modules/lodash/lodash.js", "module.exports = {};");

      const result = await resolveModuleSpecifier("lodash", "/project/src/index.ts", vfs, cache);
      expect(result).toBe("/node_modules/lodash/lodash.js");
    });

    it("resolves package with module field over main", async () => {
      await vfs.mkdir("/node_modules/my-pkg", { recursive: true });
      await vfs.writeFile("/node_modules/my-pkg/package.json", JSON.stringify({
        name: "my-pkg",
        main: "./dist/index.cjs",
        module: "./dist/index.mjs",
      }));
      await vfs.writeFile("/node_modules/my-pkg/dist/index.mjs", "export default {};");
      await vfs.mkdir("/node_modules/my-pkg/dist", { recursive: true });

      const result = await resolveModuleSpecifier("my-pkg", "/project/src/index.ts", vfs, cache);
      expect(result).toBe("/node_modules/my-pkg/dist/index.mjs");
    });

    it("resolves package with exports field", async () => {
      await vfs.mkdir("/node_modules/my-pkg/dist", { recursive: true });
      await vfs.writeFile("/node_modules/my-pkg/package.json", JSON.stringify({
        name: "my-pkg",
        exports: {
          ".": {
            import: "./dist/index.mjs",
            default: "./dist/index.cjs",
          },
        },
      }));
      await vfs.writeFile("/node_modules/my-pkg/dist/index.mjs", "export default {};");

      const result = await resolveModuleSpecifier("my-pkg", "/project/src/index.ts", vfs, cache);
      expect(result).toBe("/node_modules/my-pkg/dist/index.mjs");
    });

    it("resolves subpath exports", async () => {
      await vfs.mkdir("/node_modules/lodash-es/dist", { recursive: true });
      await vfs.writeFile("/node_modules/lodash-es/package.json", JSON.stringify({
        name: "lodash-es",
        exports: {
          ".": "./dist/index.mjs",
          "./merge": "./dist/merge.mjs",
        },
      }));
      await vfs.writeFile("/node_modules/lodash-es/dist/merge.mjs", "export default function merge() {}");

      const result = await resolveModuleSpecifier("lodash-es/merge", "/project/src/index.ts", vfs, cache);
      expect(result).toBe("/node_modules/lodash-es/dist/merge.mjs");
    });

    it("resolves scoped packages", async () => {
      await vfs.mkdir("/node_modules/@scope/pkg/dist", { recursive: true });
      await vfs.writeFile("/node_modules/@scope/pkg/package.json", JSON.stringify({
        name: "@scope/pkg",
        main: "./dist/index.js",
      }));
      await vfs.writeFile("/node_modules/@scope/pkg/dist/index.js", "export default {};");

      const result = await resolveModuleSpecifier("@scope/pkg", "/project/src/index.ts", vfs, cache);
      expect(result).toBe("/node_modules/@scope/pkg/dist/index.js");
    });

    it("resolves subpath of scoped package", async () => {
      await vfs.mkdir("/node_modules/@scope/pkg/dist", { recursive: true });
      await vfs.writeFile("/node_modules/@scope/pkg/package.json", JSON.stringify({
        name: "@scope/pkg",
        exports: {
          ".": "./dist/index.js",
          "./utils": "./dist/utils.js",
        },
      }));
      await vfs.writeFile("/node_modules/@scope/pkg/dist/utils.js", "export const x = 1;");

      const result = await resolveModuleSpecifier("@scope/pkg/utils", "/project/src/index.ts", vfs, cache);
      expect(result).toBe("/node_modules/@scope/pkg/dist/utils.js");
    });

    it("falls back to index.js when no main/module/exports", async () => {
      await vfs.mkdir("/node_modules/simple-pkg", { recursive: true });
      await vfs.writeFile("/node_modules/simple-pkg/package.json", JSON.stringify({
        name: "simple-pkg",
      }));
      await vfs.writeFile("/node_modules/simple-pkg/index.js", "export default {};");

      const result = await resolveModuleSpecifier("simple-pkg", "/project/src/index.ts", vfs, cache);
      expect(result).toBe("/node_modules/simple-pkg/index.js");
    });

    it("throws on missing package", async () => {
      await expect(
        resolveModuleSpecifier("nonexistent-pkg", "/project/src/index.ts", vfs, cache),
      ).rejects.toThrow(/Cannot resolve.*nonexistent-pkg/);
    });

    it("caches package.json reads", async () => {
      await vfs.mkdir("/node_modules/cached-pkg", { recursive: true });
      await vfs.writeFile("/node_modules/cached-pkg/package.json", JSON.stringify({
        name: "cached-pkg",
        main: "./index.js",
      }));
      await vfs.writeFile("/node_modules/cached-pkg/index.js", "export default {};");

      await resolveModuleSpecifier("cached-pkg", "/project/src/a.ts", vfs, cache);
      await resolveModuleSpecifier("cached-pkg", "/project/src/b.ts", vfs, cache);

      expect(cache.size).toBe(1);
    });
  });

  describe("absolute paths", () => {
    it("resolves absolute path with extension probing", async () => {
      await vfs.mkdir("/project/src", { recursive: true });
      await vfs.writeFile("/project/src/file.ts", "export const x = 1;");

      const result = await resolveModuleSpecifier("/project/src/file", "/ignored.ts", vfs, cache);
      expect(result).toBe("/project/src/file.ts");
    });
  });
});

describe("resolvePackageExports", () => {
  it("resolves string shorthand", () => {
    const result = resolvePackageExports("./dist/index.mjs", ".", ["import", "default"]);
    expect(result).toBe("./dist/index.mjs");
  });

  it("resolves subpath exports", () => {
    const exports = {
      ".": "./dist/index.mjs",
      "./merge": "./dist/merge.mjs",
    };
    expect(resolvePackageExports(exports, "./merge", ["import", "default"])).toBe("./dist/merge.mjs");
  });

  it("resolves conditional exports with priority", () => {
    const exports = {
      ".": {
        browser: "./dist/browser.mjs",
        import: "./dist/index.mjs",
        default: "./dist/index.cjs",
      },
    };
    expect(resolvePackageExports(exports, ".", ["browser", "import", "default"])).toBe("./dist/browser.mjs");
  });

  it("resolves import condition when browser absent", () => {
    const exports = {
      ".": {
        import: "./dist/index.mjs",
        default: "./dist/index.cjs",
      },
    };
    expect(resolvePackageExports(exports, ".", ["browser", "import", "default"])).toBe("./dist/index.mjs");
  });

  it("resolves subpath patterns", () => {
    const exports = {
      "./*.js": "./src/*.js",
    };
    expect(resolvePackageExports(exports, "./utils.js", ["import", "default"])).toBe("./src/utils.js");
  });

  it("resolves nested conditions", () => {
    const exports = {
      ".": {
        browser: {
          import: "./dist/browser.mjs",
          default: "./dist/browser.cjs",
        },
        import: "./dist/node.mjs",
      },
    };
    expect(resolvePackageExports(exports, ".", ["browser", "import", "default"])).toBe("./dist/browser.mjs");
  });

  it("returns null for unmatched subpath", () => {
    const exports = {
      ".": "./dist/index.mjs",
    };
    expect(resolvePackageExports(exports, "./nonexistent", ["import", "default"])).toBeNull();
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm --filter @anthropic-ide/bundler test`
Expected: FAIL — `resolveModuleSpecifier` and `resolvePackageExports` not found

- [ ] **Step 5: Implement resolver.ts**

Create `packages/bundler/src/resolver.ts`:

```ts
import type { IVirtualFileSystem } from "@anthropic-ide/vfs";
import { dirname, join, resolve, normalize } from "@anthropic-ide/vfs";

const EXTENSION_ORDER = [".ts", ".tsx", ".js", ".jsx"];
const INDEX_FILES = ["index.ts", "index.tsx", "index.js", "index.jsx"];
const CONDITIONS = ["browser", "import", "default"];

export async function resolveModuleSpecifier(
  specifier: string,
  importer: string,
  vfs: IVirtualFileSystem,
  cache: Map<string, unknown>,
): Promise<string> {
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    const base = specifier.startsWith("/") ? "/" : dirname(importer);
    const resolved = resolve(base, specifier);
    return resolveFilePath(resolved, vfs);
  }

  return resolveBareSpecifier(specifier, importer, vfs, cache);
}

async function resolveFilePath(path: string, vfs: IVirtualFileSystem): Promise<string> {
  if (await vfs.exists(path)) {
    const st = await vfs.stat(path);
    if (st.type === "file") return path;
    if (st.type === "directory") return resolveIndex(path, vfs);
  }

  for (const ext of EXTENSION_ORDER) {
    const withExt = path + ext;
    if (await vfs.exists(withExt)) return withExt;
  }

  return resolveIndex(path, vfs);
}

async function resolveIndex(dir: string, vfs: IVirtualFileSystem): Promise<string> {
  for (const index of INDEX_FILES) {
    const indexPath = join(dir, index);
    if (await vfs.exists(indexPath)) return indexPath;
  }
  throw new Error(`Cannot resolve module: no index file in ${dir}`);
}

async function resolveBareSpecifier(
  specifier: string,
  importer: string,
  vfs: IVirtualFileSystem,
  cache: Map<string, unknown>,
): Promise<string> {
  const { pkgName, subpath } = parseSpecifier(specifier);

  let dir = dirname(importer);
  while (true) {
    const candidate = join(dir, "node_modules", pkgName);
    if (await vfs.exists(candidate)) {
      return resolvePackageEntry(candidate, subpath, vfs, cache);
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(`Cannot resolve module '${specifier}' from '${importer}'`);
}

function parseSpecifier(specifier: string): { pkgName: string; subpath: string } {
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    const pkgName = parts.slice(0, 2).join("/");
    const subpath = parts.length > 2 ? "./" + parts.slice(2).join("/") : ".";
    return { pkgName, subpath };
  }
  const slashIndex = specifier.indexOf("/");
  if (slashIndex === -1) return { pkgName: specifier, subpath: "." };
  return {
    pkgName: specifier.slice(0, slashIndex),
    subpath: "./" + specifier.slice(slashIndex + 1),
  };
}

async function resolvePackageEntry(
  pkgDir: string,
  subpath: string,
  vfs: IVirtualFileSystem,
  cache: Map<string, unknown>,
): Promise<string> {
  const pkgJsonPath = join(pkgDir, "package.json");
  let pkg: Record<string, unknown>;

  if (cache.has(pkgJsonPath)) {
    pkg = cache.get(pkgJsonPath) as Record<string, unknown>;
  } else {
    const raw = await vfs.readFile(pkgJsonPath);
    pkg = JSON.parse(new TextDecoder().decode(raw));
    cache.set(pkgJsonPath, pkg);
  }

  if (pkg.exports !== undefined) {
    const resolved = resolvePackageExports(pkg.exports, subpath, CONDITIONS);
    if (resolved !== null) {
      return normalize(join(pkgDir, resolved));
    }
  }

  if (subpath !== ".") {
    return resolveFilePath(join(pkgDir, subpath), vfs);
  }

  if (typeof pkg.module === "string") {
    return normalize(join(pkgDir, pkg.module));
  }

  if (typeof pkg.main === "string") {
    return normalize(join(pkgDir, pkg.main));
  }

  return resolveFilePath(join(pkgDir, "index.js"), vfs);
}

export function resolvePackageExports(
  exports: unknown,
  subpath: string,
  conditions: string[],
): string | null {
  if (typeof exports === "string") {
    return subpath === "." ? exports : null;
  }

  if (typeof exports !== "object" || exports === null) return null;

  const exportsObj = exports as Record<string, unknown>;

  if (subpath === "." && !("." in exportsObj)) {
    return resolveCondition(exportsObj, conditions);
  }

  for (const [pattern, target] of Object.entries(exportsObj)) {
    if (pattern === subpath) {
      if (typeof target === "string") return target;
      if (typeof target === "object" && target !== null) {
        return resolveCondition(target as Record<string, unknown>, conditions);
      }
      return null;
    }

    if (pattern.includes("*")) {
      const match = matchPattern(pattern, subpath);
      if (match !== null) {
        if (typeof target === "string") return target.replace(/\*/g, match);
        return null;
      }
    }
  }

  return null;
}

function resolveCondition(
  obj: Record<string, unknown>,
  conditions: string[],
): string | null {
  for (const cond of conditions) {
    if (cond in obj) {
      const val = obj[cond];
      if (typeof val === "string") return val;
      if (typeof val === "object" && val !== null) {
        return resolveCondition(val as Record<string, unknown>, conditions);
      }
    }
  }
  return null;
}

function matchPattern(pattern: string, subpath: string): string | null {
  const starIndex = pattern.indexOf("*");
  if (starIndex === -1) return null;
  const prefix = pattern.slice(0, starIndex);
  const suffix = pattern.slice(starIndex + 1);
  if (subpath.startsWith(prefix) && subpath.endsWith(suffix)) {
    return subpath.slice(prefix.length, subpath.length - suffix.length);
  }
  return null;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @anthropic-ide/bundler test`
Expected: All resolver tests PASS

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @anthropic-ide/bundler typecheck`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add packages/bundler/
pnpm-lock.yaml
git commit -m "feat(bundler): add types and module resolver

Types for IBundler, BundleOptions, BundleResult.
Module resolver handles relative paths, bare specifiers,
package.json exports/module/main with caching."
```

---

### Task 2: VFS plugin for esbuild

**Files:**
- Create: `packages/bundler/src/vfs-plugin.ts` — esbuild plugin with `onResolve`/`onLoad`
- Create: `packages/bundler/src/vfs-plugin.test.ts` — plugin integration tests with real esbuild

**Interfaces:**
- Consumes: `resolveModuleSpecifier(specifier, importer, vfs, cache)` from `./resolver.js`
- Consumes: `IVirtualFileSystem` from `@anthropic-ide/vfs`
- Consumes: `esbuild-wasm` `Plugin`, `OnResolveArgs`, `OnLoadArgs` types
- Produces: `createVfsPlugin(vfs: IVirtualFileSystem): esbuild.Plugin` — factory that returns an esbuild plugin

- [ ] **Step 1: Write vfs-plugin tests**

Create `packages/bundler/src/vfs-plugin.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as esbuild from "esbuild-wasm";
import { MemoryFS } from "@anthropic-ide/vfs";
import { createVfsPlugin } from "./vfs-plugin.js";

let initialized = false;

beforeAll(async () => {
  if (!initialized) {
    const wasmPath = resolve("node_modules/esbuild-wasm/esbuild.wasm");
    const wasmBinary = readFileSync(wasmPath).buffer;
    await esbuild.initialize({ wasmModule: new WebAssembly.Module(wasmBinary) });
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
      jsx: "automatic",
      plugins: [createVfsPlugin(vfs)],
    });
    const code = result.outputFiles![0].text;
    expect(code).toContain("hello");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @anthropic-ide/bundler test`
Expected: FAIL — `createVfsPlugin` not found

- [ ] **Step 3: Implement vfs-plugin.ts**

Create `packages/bundler/src/vfs-plugin.ts`:

```ts
import type { Plugin } from "esbuild-wasm";
import type { IVirtualFileSystem } from "@anthropic-ide/vfs";
import { basename } from "@anthropic-ide/vfs";
import { resolveModuleSpecifier } from "./resolver.js";

const LOADER_MAP: Record<string, string> = {
  ".ts": "tsx",
  ".tsx": "tsx",
  ".js": "jsx",
  ".jsx": "jsx",
  ".json": "json",
  ".css": "css",
  ".txt": "text",
};

function getLoader(filePath: string): string {
  const name = basename(filePath);
  const dotIdx = name.lastIndexOf(".");
  if (dotIdx === -1) return "text";
  const ext = name.slice(dotIdx);
  return LOADER_MAP[ext] ?? "text";
}

export function createVfsPlugin(vfs: IVirtualFileSystem): Plugin {
  const cache = new Map<string, unknown>();

  return {
    name: "vfs",
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        if (args.kind === "entry-point") {
          return { path: args.path, namespace: "vfs" };
        }

        try {
          const resolved = await resolveModuleSpecifier(
            args.path,
            args.importer,
            vfs,
            cache,
          );
          return { path: resolved, namespace: "vfs" };
        } catch (e) {
          return {
            errors: [{ text: (e as Error).message }],
          };
        }
      });

      build.onLoad({ filter: /.*/, namespace: "vfs" }, async (args) => {
        try {
          const contents = await vfs.readFile(args.path);
          return {
            contents: new TextDecoder().decode(contents),
            loader: getLoader(args.path) as
              | "tsx"
              | "jsx"
              | "json"
              | "css"
              | "text",
          };
        } catch (e) {
          return {
            errors: [{ text: `Failed to load ${args.path}: ${(e as Error).message}` }],
          };
        }
      });
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @anthropic-ide/bundler test`
Expected: All tests PASS

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @anthropic-ide/bundler typecheck`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add packages/bundler/src/vfs-plugin.ts packages/bundler/src/vfs-plugin.test.ts
git commit -m "feat(bundler): add VFS plugin for esbuild

esbuild plugin wires onResolve/onLoad to VFS.
Determines loader by file extension.
Tests verify TS, JSX, JSON, CSS loading and error handling."
```

---

### Task 3: Bundler initialization and bundle/context API

**Files:**
- Create: `packages/bundler/src/bundler.ts` — `initBundler()`, `bundle()`, `createContext()`
- Create: `packages/bundler/src/bundler.test.ts` — bundler tests
- Modify: `packages/bundler/src/index.ts` — public API exports

**Interfaces:**
- Consumes: `createVfsPlugin(vfs)` from `./vfs-plugin.js`
- Consumes: `esbuild-wasm` `initialize()`, `build()`, `context()` APIs
- Consumes: `InitOptions`, `BundleOptions`, `BundleResult`, `BundleError`, `IBundler`, `BundleContext` from `./types.js`
- Produces: `initBundler(options: InitOptions): Promise<IBundler>` — the public entry point

- [ ] **Step 1: Write bundler tests**

Create `packages/bundler/src/bundler.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryFS } from "@anthropic-ide/vfs";
import { initBundler } from "./bundler.js";
import type { IBundler } from "./types.js";

let bundler: IBundler;

beforeAll(async () => {
  const wasmPath = resolve("node_modules/esbuild-wasm/esbuild.wasm");
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
    await vfs.writeFile("/project/src/config.json", '{"port": 3000}');
    await vfs.writeFile("/project/src/index.ts", `
      import config from "./config.json";
      export const port = config.port;
    `);

    const result = await bundler.bundle({ entryPoint: "/project/src/index.ts", vfs });
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain("3000");
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @anthropic-ide/bundler test`
Expected: FAIL — `initBundler` not found

- [ ] **Step 3: Implement bundler.ts**

Create `packages/bundler/src/bundler.ts`:

```ts
import * as esbuild from "esbuild-wasm";
import type {
  InitOptions,
  BundleOptions,
  BundleResult,
  BundleError,
  IBundler,
  BundleContext,
} from "./types.js";
import { createVfsPlugin } from "./vfs-plugin.js";

let initialized = false;

function mapErrors(messages: esbuild.Message[]): BundleError[] {
  return messages.map((m) => ({
    message: m.text,
    file: m.location?.file,
    line: m.location?.line,
    column: m.location?.column,
  }));
}

function buildOptions(
  options: BundleOptions,
): esbuild.BuildOptions {
  return {
    entryPoints: [options.entryPoint],
    bundle: true,
    write: false,
    format: "esm",
    target: "es2020",
    platform: "browser",
    minify: options.minify ?? false,
    sourcemap: options.sourceMap ? "inline" : false,
    jsx: options.jsx === "transform" ? "transform" : "automatic",
    jsxFactory: options.jsxFactory,
    jsxFragment: options.jsxFragment,
    jsxImportSource: options.jsxImportSource ?? "react",
    plugins: [createVfsPlugin(options.vfs)],
    logLevel: "silent",
  };
}

function extractResult(result: esbuild.BuildResult): BundleResult {
  const code = result.outputFiles?.[0]?.text ?? "";
  return {
    code,
    errors: mapErrors(result.errors),
    warnings: mapErrors(result.warnings),
  };
}

export async function initBundler(options: InitOptions): Promise<IBundler> {
  if (!initialized) {
    const wasmModule = new WebAssembly.Module(options.wasmBinary);
    await esbuild.initialize({ wasmModule, worker: false });
    initialized = true;
  }

  return {
    async bundle(opts: BundleOptions): Promise<BundleResult> {
      try {
        const result = await esbuild.build(buildOptions(opts));
        return extractResult(result);
      } catch (e: unknown) {
        if (
          typeof e === "object" &&
          e !== null &&
          "errors" in e &&
          Array.isArray((e as esbuild.BuildFailure).errors)
        ) {
          const failure = e as esbuild.BuildFailure;
          return {
            code: "",
            errors: mapErrors(failure.errors),
            warnings: mapErrors(failure.warnings),
          };
        }
        throw e;
      }
    },

    async createContext(opts: BundleOptions): Promise<BundleContext> {
      const ctx = await esbuild.context(buildOptions(opts));

      return {
        async rebuild(): Promise<BundleResult> {
          try {
            const result = await ctx.rebuild();
            return extractResult(result);
          } catch (e: unknown) {
            if (
              typeof e === "object" &&
              e !== null &&
              "errors" in e &&
              Array.isArray((e as esbuild.BuildFailure).errors)
            ) {
              const failure = e as esbuild.BuildFailure;
              return {
                code: "",
                errors: mapErrors(failure.errors),
                warnings: mapErrors(failure.warnings),
              };
            }
            throw e;
          }
        },

        dispose(): void {
          ctx.dispose();
        },
      };
    },
  };
}
```

- [ ] **Step 4: Update index.ts with public exports**

Replace `packages/bundler/src/index.ts`:

```ts
export type {
  InitOptions,
  BundleOptions,
  BundleResult,
  BundleError,
  IBundler,
  BundleContext,
} from "./types.js";
export { initBundler } from "./bundler.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @anthropic-ide/bundler test`
Expected: All tests PASS

- [ ] **Step 6: Typecheck and full test suite**

Run: `pnpm --filter @anthropic-ide/bundler typecheck && pnpm test`
Expected: No type errors, all 137+ tests pass across all packages

- [ ] **Step 7: Commit**

```bash
git add packages/bundler/
git commit -m "feat(bundler): add initBundler, bundle, and createContext

initBundler initializes esbuild-wasm from ArrayBuffer.
bundle() one-shot builds, createContext() supports incremental rebuilds.
Error handling maps esbuild errors to BundleError without throwing.
Public API exports from index.ts."
```

---

Now the self-review against the spec.

**1. Spec coverage:**
- `InitOptions` / `initBundler` — Task 3 ✓
- `IBundler` / `bundle()` / `createContext()` / `BundleContext` — Task 3 ✓
- `BundleOptions` (all fields: entryPoint, vfs, jsx, jsxFactory, jsxFragment, jsxImportSource, minify, sourceMap) — Task 1 types + Task 3 implementation ✓
- `BundleResult` / `BundleError` — Task 1 types + Task 3 mapping ✓
- VFS plugin (`onResolve`/`onLoad`) — Task 2 ✓
- Module resolution (relative, bare, absolute) — Task 1 ✓
- Extension probing (.ts, .tsx, .js, .jsx, /index.*) — Task 1 ✓
- `package.json` `exports` (string, subpath, conditions, patterns, nested) — Task 1 ✓
- `package.json` `module`/`main` fallback chain — Task 1 ✓
- Condition priority: browser > import > default — Task 1 ✓
- Caching package.json per build — Task 1 ✓
- Loader determination by extension — Task 2 ✓
- `write: false`, `format: "esm"`, `target: "es2020"`, `platform: "browser"` — Task 3 ✓
- Error handling (syntax errors → BundleResult.errors, not exceptions) — Task 3 ✓
- Incremental rebuilds via `context()` — Task 3 ✓
- Inline source maps — Task 3 ✓
- Minification — Task 3 ✓
- No `node:*` in source files — verified: only test files import from `node:fs` and `node:path` ✓
- `index.ts` public exports — Task 3 ✓

**2. Placeholder scan:** No TBDs, TODOs, or vague steps. All code blocks complete.

**3. Type consistency:**
- `resolveModuleSpecifier` signature consistent across Task 1 (definition) and Task 2 (usage) ✓
- `resolvePackageExports` signature consistent ✓
- `createVfsPlugin` signature consistent across Task 2 (definition) and Task 3 (usage) ✓
- `initBundler` signature consistent across Task 3 (definition) and index.ts (export) ✓
- `IBundler`, `BundleOptions`, `BundleResult` types consistent across all tasks ✓

Plan is complete and consistent with the spec.

<function_calls>
<invoke name="Bash">
<parameter name="command">git add docs/superpowers/plans/2026-09-01-phase4-bundler.md && git commit -m "$(cat <<'EOF'
docs: add Phase 4 bundler implementation plan

3 tasks: types + module resolver, VFS plugin, bundler init + API.
esbuild-wasm with VFS adapter, incremental rebuilds, full exports resolution.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"