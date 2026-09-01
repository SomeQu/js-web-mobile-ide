import type { DependencyGraph, ResolvedDependency } from "./types.js";

interface LockFilePackageEntry {
  version?: string;
  resolved?: string;
  integrity?: string;
  dependencies?: Record<string, string>;
  link?: boolean;
  name?: string;
}

interface LockFileContent {
  lockfileVersion?: number;
  packages?: Record<string, LockFilePackageEntry>;
}

export function parseLockFile(content: string): DependencyGraph {
  const lock = JSON.parse(content) as LockFileContent;

  if (!lock.packages || typeof lock.packages !== "object") {
    throw new Error(
      "Unsupported lock file format: missing 'packages' field. Only package-lock.json v2/v3 is supported.",
    );
  }

  const dependencies = new Map<string, ResolvedDependency>();
  const rootEntry = lock.packages[""];
  const root: string[] = rootEntry?.dependencies
    ? Object.keys(rootEntry.dependencies)
    : [];

  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path === "") continue;
    if (!entry.version || !entry.resolved) continue;
    if (entry.link) continue;

    const name = extractPackageName(path);
    if (!name) continue;

    const key = `${name}@${entry.version}`;

    if (!dependencies.has(key)) {
      dependencies.set(key, {
        name,
        version: entry.version,
        tarballUrl: entry.resolved,
        integrity: entry.integrity,
        dependencies: entry.dependencies,
      });
    }
  }

  return { dependencies, root };
}

function extractPackageName(nodeModulesPath: string): string | null {
  // "node_modules/@scope/pkg" -> "@scope/pkg"
  // "node_modules/a/node_modules/b" -> "b"
  // Take the last node_modules segment
  const parts = nodeModulesPath.split("node_modules/");
  const last = parts[parts.length - 1];
  return last || null;
}
