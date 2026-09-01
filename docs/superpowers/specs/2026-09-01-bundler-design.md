# Phase 4: Bundler Design Spec

## Overview

`@anthropic-ide/bundler` — thin wrapper around esbuild-wasm that bundles user project code + node_modules into executable JS for on-device execution in JavaScriptCore/WKWebView. All file I/O goes through the VFS interface.

## Package

- Name: `@anthropic-ide/bundler`
- Dependencies: `esbuild-wasm` (runtime), `@anthropic-ide/vfs` (peer)
- No Node-specific APIs in source files

## Public API

### Initialization

```ts
interface InitOptions {
  wasmBinary: ArrayBuffer;
}

async function initBundler(options: InitOptions): Promise<IBundler>;
```

The iOS app loads `esbuild.wasm` from its app bundle and passes the `ArrayBuffer` through the runtime bridge. `initBundler` calls `esbuild.initialize({ wasmModule: new WebAssembly.Module(wasmBinary) })` and returns a ready `IBundler`. Calling `initBundler` more than once throws an error (esbuild supports only one initialization).

### Bundler Interface

```ts
interface IBundler {
  bundle(options: BundleOptions): Promise<BundleResult>;
  createContext(options: BundleOptions): Promise<BundleContext>;
}

interface BundleContext {
  rebuild(): Promise<BundleResult>;
  dispose(): void;
}
```

- `bundle()` — one-shot build. Entry point → bundled output.
- `createContext()` — creates a reusable build context for incremental rebuilds. Call `rebuild()` after file changes for fast re-bundling. Call `dispose()` when done.

### Options and Results

```ts
interface BundleOptions {
  entryPoint: string;
  vfs: IVirtualFileSystem;
  jsx?: "transform" | "automatic";   // default: "automatic"
  jsxFactory?: string;                // only for "transform" mode
  jsxFragment?: string;               // only for "transform" mode
  jsxImportSource?: string;           // default: "react", only for "automatic"
  minify?: boolean;                   // default: false
  sourceMap?: boolean;                // default: false
}

interface BundleResult {
  code: string;              // includes inline source map when sourceMap: true
  errors: BundleError[];
  warnings: BundleError[];
}

interface BundleError {
  message: string;
  file?: string;
  line?: number;
  column?: number;
}
```

## Internal Architecture

### File Structure

- `types.ts` — all interfaces above
- `vfs-plugin.ts` — esbuild plugin wiring VFS as filesystem
- `resolver.ts` — module resolution logic (relative paths, bare specifiers, package.json exports)
- `bundler.ts` — esbuild-wasm initialization + `bundle()`/`createContext()` implementation
- `index.ts` — public exports: `initBundler`, types

### VFS Plugin (`vfs-plugin.ts`)

An esbuild plugin with two hooks:

**`onResolve`** — resolves import specifiers to absolute VFS paths:

1. **Relative paths** (`./utils`, `../Button`) — resolve relative to importer directory. Try extensions in order: exact match, `.ts`, `.tsx`, `.js`, `.jsx`, then as directory with `/index.ts`, `/index.tsx`, `/index.js`, `/index.jsx`.
2. **Bare specifiers** (`react`, `lodash/merge`, `@scope/pkg/sub`) — walk up from importer directory looking for `node_modules/<pkg>`. Read the package's `package.json` and resolve entry point via the resolution chain below.
3. **Absolute paths** (`/project/src/file.ts`) — use directly with extension resolution.

**`onLoad`** — reads resolved file from VFS:
- `vfs.readFile(path)` → decode to string
- Determine esbuild loader from extension: `.ts`/`.tsx` → `"tsx"`, `.js`/`.jsx` → `"jsx"`, `.json` → `"json"`, `.css` → `"css"`, default → `"text"`
- Return `{ contents, loader }`

### Module Resolution (`resolver.ts`)

**Package.json entry point resolution chain:**

1. `exports` field (conditional exports) — priority: `browser` > `import` > `default`
2. `module` field
3. `main` field
4. Fallback: `index.js`

**Conditional exports support:**

- String shorthand: `"exports": "./dist/index.mjs"`
- Subpath exports: `"exports": { ".": "...", "./merge": "..." }`
- Condition objects: `"exports": { ".": { "import": "...", "default": "..." } }`
- Subpath patterns: `"./*.js": "./src/*.js"` — map wildcard patterns
- Nested conditions: objects within objects resolved depth-first

Condition priority order: `browser`, `import`, `default`.

**Caching:** `package.json` contents cached in a `Map<string, object>` per build invocation to avoid redundant VFS reads when resolving multiple imports from the same package.

### Bundler (`bundler.ts`)

**esbuild.build() configuration:**

```ts
{
  entryPoints: [entryPoint],
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
  plugins: [vfsPlugin(options.vfs)],
}
```

- `write: false` — esbuild returns `OutputFile[]` in memory instead of writing to disk
- `format: "esm"` — ES modules for JavaScriptCore
- `target: "es2020"` — matches project-wide target
- `platform: "browser"` — no Node built-in polyfills

**Error handling:** esbuild throws an object with `errors[]` and `warnings[]` on build failure. Each has `text`, `location.file`, `location.line`, `location.column`. Map these to `BundleError`. User syntax errors are returned as `BundleResult.errors`, not exceptions. Only internal/unexpected errors throw.

**Incremental rebuilds:** `createContext()` uses `esbuild.context()` which caches parse results. `rebuild()` re-runs the build reusing cached work. Significantly faster for repeated edit-run cycles.

## Testing Strategy

### Unit Tests

**`vfs-plugin.test.ts`:**
- Resolve relative imports with various extensions (.ts, .tsx, .js, .jsx, /index.ts, /index.tsx)
- Resolve bare specifiers via node_modules (main, module, exports)
- Conditional exports: import/default/browser priority
- Subpath exports: `pkg/sub` → correct file
- Subpath patterns: `pkg/*.js` → mapped path
- Package.json caching: second resolve of same package doesn't re-read
- Missing module: descriptive error

**`bundler.test.ts`:**
- TypeScript → JS (type annotations stripped)
- TSX → JS with automatic runtime
- JSX → JS with classic transform (jsxFactory/jsxFragment)
- JSON import
- CSS import (as text)
- Syntax error → BundleResult.errors (not exception)
- Source map generation
- Minification

### Integration Test

**`integration.test.ts`:**
- Full pipeline: multi-file project in MemoryFS with inter-file imports + npm dependency from node_modules → bundled output contains all content
- Incremental rebuild: createContext(), modify file in VFS, rebuild() → output reflects change
- dispose() releases context

### esbuild-wasm in Tests

`esbuild-wasm` as `devDependency`. Tests initialize esbuild by reading the WASM binary from the `esbuild-wasm` package in `node_modules`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const wasmPath = resolve("node_modules/esbuild-wasm/esbuild.wasm");
const wasmBinary = readFileSync(wasmPath).buffer;
```

This uses Node APIs, which is allowed in `*.test.ts` files per project constraints.

## Constraints

- No `node:*` imports in source files (only in `*.test.ts`)
- ES2020 target
- `esbuild-wasm` is the only new runtime dependency (pure JS + WASM, no native bindings)
- All file I/O through `IVirtualFileSystem` — no direct filesystem access
- Package scope: `@anthropic-ide/bundler`
