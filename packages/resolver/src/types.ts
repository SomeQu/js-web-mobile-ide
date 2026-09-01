import type { IVirtualFileSystem } from "@anthropic-ide/vfs";
import type { IRegistryClient } from "@anthropic-ide/registry-client";

export interface ResolvedDependency {
  name: string;
  version: string;
  tarballUrl: string;
  integrity?: string;
  dependencies?: Record<string, string>;
}

export interface DependencyGraph {
  dependencies: Map<string, ResolvedDependency>;
  root: string[];
}

export interface InstallProgress {
  total: number;
  downloaded: number;
  current: string;
}

export interface IResolver {
  parseLockFile(content: string): DependencyGraph;
  install(
    graph: DependencyGraph,
    vfs: IVirtualFileSystem,
    client: IRegistryClient,
    onProgress?: (progress: InstallProgress) => void,
  ): Promise<void>;
}
