# Phase 0: Monorepo Initialization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Initialize a pnpm monorepo with 9 packages, tooling (TypeScript, ESLint, Prettier, Vitest), and project docs — ready for Phase 1 (vfs) implementation.

**Architecture:** Flat monorepo with `packages/*` for library modules and `apps/*` for platform targets. Each package is a self-contained TypeScript library with its own `tsconfig.json` using project references for cross-package type checking. All packages target ES2020 to ensure compatibility with JavaScriptCore/WKWebView.

**Tech Stack:** pnpm 9+, TypeScript 5.5+, ESLint 9 (flat config), Prettier 3, Vitest 2

**Spec:** `docs/claude-code-plan.md` (Phase 0 + Section 9)

## Global Constraints

- No Node-specific APIs (`node:fs`, `node:net`, `node:child_process`, etc.) inside `packages/` source files — only in `*.test.ts` files
- Target: `ES2020`, module: `ES2022` (for top-level await support in bundler/runtime)
- Cross-package imports only through each package's public `index.ts` exports
- Conventional Commits (`feat:` / `fix:` / `chore:` / `docs:`)
- No dependencies with native bindings (`node-gyp`)

---

### Task 1: Install pnpm and initialize git repo

**Files:**

- Create: `.gitignore`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.npmrc`

**Interfaces:**

- Consumes: nothing
- Produces: working pnpm monorepo root that later tasks install into

- [ ] **Step 1: Install pnpm globally**

```bash
npm install -g pnpm
```

Verify: `pnpm --version` prints 9.x+

- [ ] **Step 2: Initialize git repo**

```bash
cd /Users/aidar/Documents/js-web-mobile-ide
git init
```

- [ ] **Step 3: Create `.gitignore`**

```gitignore
node_modules/
dist/
*.tsbuildinfo
.DS_Store
*.log
coverage/
.env
.env.local
```

- [ ] **Step 4: Create root `package.json`**

```json
{
  "name": "js-web-mobile-ide",
  "private": true,
  "packageManager": "pnpm@9.15.9",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "pnpm -r run build",
    "test": "pnpm -r run test",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "tsc -b"
  }
}
```

- [ ] **Step 5: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

- [ ] **Step 6: Create `.npmrc`**

```ini
shamefully-hoist=false
strict-peer-dependencies=true
auto-install-peers=true
```

- [ ] **Step 7: Commit**

```bash
git add .gitignore package.json pnpm-workspace.yaml .npmrc
git commit -m "chore: initialize pnpm monorepo"
```

---

### Task 2: TypeScript base configuration

**Files:**

- Create: `tsconfig.base.json`
- Create: `tsconfig.json`

**Interfaces:**

- Consumes: monorepo root from Task 1
- Produces: `tsconfig.base.json` that every package extends; root `tsconfig.json` with project references that `tsc -b` uses

- [ ] **Step 1: Install TypeScript**

```bash
pnpm add -Dw typescript
```

- [ ] **Step 2: Create `tsconfig.base.json`**

This is the shared config every package extends. ES2020 target for JavaScriptCore compatibility, ES2022 modules for modern import/export.

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2020"],
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "composite": true
  }
}
```

- [ ] **Step 3: Create root `tsconfig.json` with project references**

```json
{
  "files": [],
  "references": [
    { "path": "packages/vfs" },
    { "path": "packages/resolver" },
    { "path": "packages/registry-client" },
    { "path": "packages/bundler" },
    { "path": "packages/node-shims" },
    { "path": "packages/runtime-bridge" },
    { "path": "packages/git-client" },
    { "path": "packages/ai-assistant" },
    { "path": "packages/editor-core" }
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add tsconfig.base.json tsconfig.json pnpm-lock.yaml package.json
git commit -m "chore: add TypeScript base configuration with project references"
```

---

### Task 3: ESLint and Prettier configuration

**Files:**

- Create: `eslint.config.js`
- Create: `.prettierrc`
- Create: `.prettierignore`

**Interfaces:**

- Consumes: TypeScript from Task 2
- Produces: `eslint.config.js` that all packages inherit; Prettier config

- [ ] **Step 1: Install ESLint and plugins**

```bash
pnpm add -Dw eslint @eslint/js typescript-eslint globals
```

- [ ] **Step 2: Install Prettier**

```bash
pnpm add -Dw prettier eslint-config-prettier
```

- [ ] **Step 3: Create `eslint.config.js`**

Flat config format (ESLint 9). Includes a rule banning `node:` imports in package source files.

```js
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      globals: {
        ...globals.es2020,
      },
    },
  },
  {
    files: ["packages/*/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*"],
              message:
                "Node built-in modules are not available in JavaScriptCore. Use platform-agnostic alternatives.",
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ["**/dist/", "**/node_modules/", "**/*.config.js"],
  },
);
```

- [ ] **Step 4: Create `.prettierrc`**

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "tabWidth": 2,
  "printWidth": 80
}
```

- [ ] **Step 5: Create `.prettierignore`**

```
dist
node_modules
pnpm-lock.yaml
*.tsbuildinfo
```

- [ ] **Step 6: Add `"type": "module"` to root `package.json`**

ESLint flat config uses ESM imports, so the root package.json needs `"type": "module"`.

Add `"type": "module"` to the root `package.json` (after `"private": true`).

- [ ] **Step 7: Verify lint runs without errors**

```bash
pnpm lint
```

Expected: no errors (no source files yet).

- [ ] **Step 8: Commit**

```bash
git add eslint.config.js .prettierrc .prettierignore package.json pnpm-lock.yaml
git commit -m "chore: add ESLint flat config and Prettier"
```

---

### Task 4: Vitest configuration

**Files:**

- Create: `vitest.config.ts`

**Interfaces:**

- Consumes: TypeScript from Task 2
- Produces: `vitest.config.ts` that packages use for `pnpm test`

- [ ] **Step 1: Install Vitest**

```bash
pnpm add -Dw vitest
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts", "**/index.ts"],
    },
  },
});
```

- [ ] **Step 3: Verify vitest runs**

```bash
pnpm vitest run
```

Expected: "No test files found" (no tests yet), exit 0.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts package.json pnpm-lock.yaml
git commit -m "chore: add Vitest configuration"
```

---

### Task 5: Scaffold all 9 packages

**Files:**

- Create: `packages/vfs/package.json`, `packages/vfs/tsconfig.json`, `packages/vfs/src/index.ts`
- Create: `packages/resolver/package.json`, `packages/resolver/tsconfig.json`, `packages/resolver/src/index.ts`
- Create: `packages/registry-client/package.json`, `packages/registry-client/tsconfig.json`, `packages/registry-client/src/index.ts`
- Create: `packages/bundler/package.json`, `packages/bundler/tsconfig.json`, `packages/bundler/src/index.ts`
- Create: `packages/node-shims/package.json`, `packages/node-shims/tsconfig.json`, `packages/node-shims/src/index.ts`
- Create: `packages/runtime-bridge/package.json`, `packages/runtime-bridge/tsconfig.json`, `packages/runtime-bridge/src/index.ts`
- Create: `packages/git-client/package.json`, `packages/git-client/tsconfig.json`, `packages/git-client/src/index.ts`
- Create: `packages/ai-assistant/package.json`, `packages/ai-assistant/tsconfig.json`, `packages/ai-assistant/src/index.ts`
- Create: `packages/editor-core/package.json`, `packages/editor-core/tsconfig.json`, `packages/editor-core/src/index.ts`

**Interfaces:**

- Consumes: `tsconfig.base.json` from Task 2, Vitest from Task 4
- Produces: 9 buildable/testable packages with empty exports

Each package follows the same template. Below is the template, then the per-package specifics (name and description only — structure is identical).

**Package template — `package.json`:**

```json
{
  "name": "@anthropic-ide/<PACKAGE_NAME>",
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
    "test": "vitest run --config ../../vitest.config.ts",
    "typecheck": "tsc --noEmit"
  },
  "files": ["dist"]
}
```

**Package template — `tsconfig.json`:**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "references": []
}
```

`references` stays empty for now — cross-package refs are added in later phases when actual dependencies form.

**Package template — `src/index.ts`:**

```ts
export {};
```

- [ ] **Step 1: Create all 9 packages using the template**

Create the following packages, each with the three files above. Only `name` and description change per package:

| Package         | `name` field                     |
| --------------- | -------------------------------- |
| vfs             | `@anthropic-ide/vfs`             |
| resolver        | `@anthropic-ide/resolver`        |
| registry-client | `@anthropic-ide/registry-client` |
| bundler         | `@anthropic-ide/bundler`         |
| node-shims      | `@anthropic-ide/node-shims`      |
| runtime-bridge  | `@anthropic-ide/runtime-bridge`  |
| git-client      | `@anthropic-ide/git-client`      |
| ai-assistant    | `@anthropic-ide/ai-assistant`    |
| editor-core     | `@anthropic-ide/editor-core`     |

- [ ] **Step 2: Install dependencies to generate lockfile**

```bash
pnpm install
```

- [ ] **Step 3: Verify TypeScript build**

```bash
pnpm typecheck
```

Expected: all 9 packages compile with no errors.

- [ ] **Step 4: Verify lint passes**

```bash
pnpm lint
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/ pnpm-lock.yaml
git commit -m "chore: scaffold all 9 packages with TypeScript stubs"
```

---

### Task 6: Apps directory and project docs

**Files:**

- Create: `apps/ios/.gitkeep`
- Create: `docs/claude-code-plan.md`
- Create: `docs/architecture.md`
- Create: `CLAUDE.md`

**Interfaces:**

- Consumes: complete monorepo from Tasks 1–5
- Produces: project documentation and CLAUDE.md rules for future Claude Code sessions

- [ ] **Step 1: Create `apps/ios/.gitkeep`**

```bash
mkdir -p apps/ios
touch apps/ios/.gitkeep
```

- [ ] **Step 2: Copy the plan to `docs/claude-code-plan.md`**

Copy the content of `/Users/aidar/Downloads/claude-code-plan.md` into `docs/claude-code-plan.md`.

- [ ] **Step 3: Create `docs/architecture.md`**

````markdown
# Architecture

## Package Overview

| Package           | Purpose                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `vfs`             | Virtual file system — POSIX-like FS in memory/sandbox, no real symlinks |
| `resolver`        | Dependency resolution — semver resolving, deduplication, module graph   |
| `registry-client` | npm registry HTTP client — metadata, tarball download, unpacking        |
| `bundler`         | JS/TS bundler — esbuild-wasm with vfs integration                       |
| `node-shims`      | Node polyfills — path, process, buffer, events for non-Node runtimes    |
| `runtime-bridge`  | Swift ↔ JS bridge — WKWebView communication layer                       |
| `git-client`      | Git operations — isomorphic-git over vfs                                |
| `ai-assistant`    | AI chat — Anthropic Messages API with tool-use over vfs/editor          |
| `editor-core`     | Code editor — Monaco/CodeMirror wrapper with language services          |

## Key Interfaces

### IVirtualFileSystem (packages/vfs)

```typescript
interface IVirtualFileSystem {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: Uint8Array): Promise<void>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<FileStat>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  unlink(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

interface FileStat {
  type: "file" | "directory" | "symlink";
  size: number;
  mtime: number;
}
```
````

### IEditor (packages/editor-core)

```typescript
interface IEditor {
  open(path: string, content: string): void;
  onChange(callback: (content: string) => void): void;
  setLanguage(languageId: string): void;
  getSelection(): Selection | null;
  getContent(): string;
}
```

## Constraints

- All packages must run in JavaScriptCore/WKWebView — no Node-specific APIs
- Cross-package communication only through exported interfaces
- No native bindings (node-gyp) in dependencies

````

- [ ] **Step 4: Create `CLAUDE.md`**

```markdown
# Rules for Claude Code in this repository

- Monorepo on pnpm workspaces. Each package in /packages must build and test independently.
- No Node-specific APIs (fs, net, child_process from 'node:...') inside /packages source code, except test files (*.test.ts). The runtime target is JavaScriptCore/WKWebView, not Node.
- Cross-package communication only through exported interfaces from index.ts — no direct imports of another package's internal files.
- Every new feature: test first, then implementation (TDD where applicable to pure logic: vfs, resolver, node-shims).
- Before adding an npm dependency to the project itself — verify it doesn't pull native bindings (node-gyp).
- Commit convention: Conventional Commits (feat/fix/chore/docs).
- Target: ES2020 for JavaScriptCore compatibility.
- Package scope: @anthropic-ide/*
````

- [ ] **Step 5: Commit**

```bash
git add apps/ docs/ CLAUDE.md
git commit -m "docs: add architecture docs, project plan, and CLAUDE.md rules"
```

---

### Task 7: Smoke test — full build and test cycle

**Files:** none (verification only)

**Interfaces:**

- Consumes: everything from Tasks 1–6
- Produces: verified working monorepo

- [ ] **Step 1: Clean install**

```bash
rm -rf node_modules packages/*/node_modules
pnpm install
```

- [ ] **Step 2: Run full typecheck**

```bash
pnpm typecheck
```

Expected: exit 0, no errors.

- [ ] **Step 3: Run full lint**

```bash
pnpm lint
```

Expected: exit 0, no errors.

- [ ] **Step 4: Run format check**

```bash
pnpm format:check
```

If there are formatting issues, fix them:

```bash
pnpm format
```

- [ ] **Step 5: Run tests**

```bash
pnpm test
```

Expected: each package reports "No test files found" or exit 0.

- [ ] **Step 6: Build all packages**

```bash
pnpm build
```

Expected: each package compiles to `dist/` with `.js` and `.d.ts` files.

- [ ] **Step 7: Final commit (if format changed anything)**

```bash
git add -A
git status
# Only commit if there are changes
git diff --cached --quiet || git commit -m "chore: format all files"
```

- [ ] **Step 8: Verify git log**

```bash
git log --oneline
```

Expected: 5–6 clean conventional commits.
