import type { IVirtualFileSystem } from "@anthropic-ide/vfs";

export interface VersionMetadata {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  dist: {
    tarball: string;
    integrity?: string;
  };
}

export interface PackageMetadata {
  name: string;
  versions: Record<string, VersionMetadata>;
  "dist-tags": Record<string, string>;
}

export interface IRegistryClient {
  getPackageMetadata(name: string): Promise<PackageMetadata>;
  downloadAndExtract(
    tarballUrl: string,
    vfs: IVirtualFileSystem,
    destPath: string,
  ): Promise<void>;
}
