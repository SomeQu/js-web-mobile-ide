# resolver + registry-client Design Spec

## Decision: Lock-file first

Full semver resolution deferred. The resolver reads an existing `package-lock.json` (v2/v3) and downloads exactly what it lists. Fresh resolution (no lock file) is a future phase.

## Two Packages

### `@anthropic-ide/registry-client`

HTTP client to npm registry + .tgz download/extraction. No knowledge of dependency graphs or lock files.

### `@anthropic-ide/resolver`

Parses lock files into a dependency graph, orchestrates installation by calling registry-client.

---

## registry-client

### Purpose

Fetch package metadata from the npm registry and download/extract tarballs into a VFS. Uses `fetch()` (available in WKWebView/JavaScriptCore). No Node APIs.

### Interface

```ts
interface PackageMetadata {
  name: string;
  versions: Record<string, VersionMetadata>;
  "dist-tags": Record<string, string>;
}

interface VersionMetadata {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  dist: { tarball: string; integrity?: string };
}

interface IRegistryClient {
  getPackageMetadata(name: string): Promise<PackageMetadata>;
  downloadAndExtract(
    tarballUrl: string,
    vfs: IVirtualFileSystem,
    destPath: string,
  ): Promise<void>;
}

function createRegistryClient(registryUrl?: string): IRegistryClient;
```

Default registry URL: `https://registry.npmjs.org`.

### Files

- `types.ts` — PackageMetadata, VersionMetadata, IRegistryClient
- `client.ts` — `createRegistryClient(registryUrl?)` factory
- `tarball.ts` — gzip decompression (pako) + minimal read-only tar parser (~100 lines), writes extracted files to VFS. npm tarballs have a `package/` prefix in every entry — strip it before writing.
- `index.ts` — re-exports

### Tar Parser

Own minimal implementation (~100 lines). The tar format is 512-byte header blocks:
- Bytes 0-99: filename
- Bytes 100-107: file mode
- Bytes 124-135: file size (octal)
- Bytes 156: type flag ('0' or '\0' = file, '5' = directory)
- Bytes 345-499: filename prefix (for long names, concatenated as `prefix/name`)

Read header, extract size, read ceil(size/512)*512 bytes of data, write to VFS. Skip directories (VFS mkdir is handled by writeFile's parent creation). Stop when header is all zeros.

### Dependencies

- `pako` — gzip decompression (zero deps, pure JS, no native bindings)
- `@anthropic-ide/vfs` — peer dependency (IVirtualFileSystem type only)

### Testing

- Tar parser: crafted binary fixtures (a few files in a tar archive), verify correct extraction to MemoryFS
- Client: mock `globalThis.fetch` with recorded npm registry responses
- Integration: mock fetch returning a real `.tgz` of a small package, verify files land in VFS correctly

---

## resolver

### Purpose

Parse `package-lock.json` v2/v3, build a flat dependency map, orchestrate download+extraction via registry-client.

### Interface

```ts
interface ResolvedDependency {
  name: string;
  version: string;
  tarballUrl: string;
  integrity?: string;
  dependencies?: Record<string, string>;
}

interface DependencyGraph {
  dependencies: Map<string, ResolvedDependency>; // key: "name@version"
  root: string[]; // top-level package names
}

interface InstallProgress {
  total: number;
  downloaded: number;
  current: string;
}

interface IResolver {
  parseLockFile(content: string): DependencyGraph;
  install(
    graph: DependencyGraph,
    vfs: IVirtualFileSystem,
    client: IRegistryClient,
    onProgress?: (progress: InstallProgress) => void,
  ): Promise<void>;
}

function createResolver(): IResolver;
```

### Lock File Format (package-lock.json v2/v3)

v2/v3 uses a flat `packages` field where keys are `node_modules/...` paths:

```json
{
  "packages": {
    "": { "name": "my-app", "dependencies": { "lodash": "^4.17.21" } },
    "node_modules/lodash": {
      "version": "4.17.21",
      "resolved": "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz",
      "integrity": "sha512-..."
    }
  }
}
```

The key directly tells us where to write in VFS. The `resolved` field is the tarball URL. This makes the parser straightforward — iterate `packages`, skip the root entry (`""`), build the dependency map.

### Files

- `types.ts` — ResolvedDependency, DependencyGraph, InstallProgress, IResolver
- `lockfile-parser.ts` — parses `package-lock.json` v2/v3 JSON into DependencyGraph
- `installer.ts` — `install()` walks the graph, checks VFS cache (`exists(destPath + "/package.json")`), calls `client.downloadAndExtract()` for missing packages. Sequential downloads. Reports progress via callback.
- `index.ts` — re-exports

### Dependencies

- `@anthropic-ide/vfs` — peer dependency
- `@anthropic-ide/registry-client` — peer dependency

### Testing

- Lock file parser: real `package-lock.json` fixtures from small projects (3-5 deps)
- Installer: mock IRegistryClient, verify correct download calls and VFS paths
- Integration: MemoryFS + mock-fetch registry-client + real lock file, verify all packages extracted to correct paths

---

## What's NOT in Scope

- Full semver resolution from scratch (no lock file)
- `yarn.lock` / `pnpm-lock.yaml` parsing
- Parallel downloads (sequential first, optimization later)
- Hoisting or deduplication beyond what the lock file specifies
- Scoped package special handling beyond what npm registry provides
- Integrity verification (sha512 checking — deferred)

## Acceptance Criteria

- `createRegistryClient()` fetches metadata and downloads/extracts tarballs into VFS
- Own tar parser correctly extracts npm tarballs (strips `package/` prefix)
- `parseLockFile(content)` parses `package-lock.json` v2/v3 into a DependencyGraph
- `install(graph, vfs, client)` downloads all packages to correct `node_modules/` paths in VFS
- Cached packages (already in VFS) are skipped
- Progress callback fires with download status
- No `node:*` imports in source files
- All tests pass with mocked fetch (no live network in CI)

## TypeScript Config

Both packages use `lib: ["ES2020"]` — no DOM needed. `fetch` is available globally in WKWebView/JavaScriptCore; declare it in a `global.d.ts` if not in the lib.
