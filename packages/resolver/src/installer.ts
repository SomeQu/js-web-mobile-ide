import type { IVirtualFileSystem } from "@anthropic-ide/vfs";
import type { IRegistryClient } from "@anthropic-ide/registry-client";
import type { DependencyGraph, InstallProgress, IResolver } from "./types.js";
import { parseLockFile } from "./lockfile-parser.js";

export function createResolver(): IResolver {
  return {
    parseLockFile,

    async install(
      graph: DependencyGraph,
      vfs: IVirtualFileSystem,
      client: IRegistryClient,
      onProgress?: (progress: InstallProgress) => void,
    ): Promise<void> {
      const entries = Array.from(graph.dependencies.values());
      const total = entries.length;
      let downloaded = 0;

      for (const dep of entries) {
        const destPath = `/node_modules/${dep.name}`;

        const cached = await vfs.exists(`${destPath}/package.json`);
        if (!cached) {
          await client.downloadAndExtract(dep.tarballUrl, vfs, destPath);
        }
        downloaded++;

        if (onProgress) {
          onProgress({ total, downloaded, current: `${dep.name}@${dep.version}` });
        }
      }
    },
  };
}
