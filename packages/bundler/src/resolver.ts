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
