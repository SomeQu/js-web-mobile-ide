import type { IVirtualFileSystem } from "@anthropic-ide/vfs";
import type { IRegistryClient, PackageMetadata } from "./types.js";
import { extractTarGzip } from "./tarball.js";

const DEFAULT_REGISTRY = "https://registry.npmjs.org";

export function createRegistryClient(registryUrl?: string): IRegistryClient {
  const baseUrl = (registryUrl ?? DEFAULT_REGISTRY).replace(/\/+$/, "");

  return {
    async getPackageMetadata(name: string): Promise<PackageMetadata> {
      const encodedName = name.startsWith("@")
        ? `@${encodeURIComponent(name.substring(1))}`
        : name;
      const url = `${baseUrl}/${encodedName}`;
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Package not found: ${name}`);
        }
        throw new Error(
          `Registry error for ${name}: ${response.status} ${response.statusText}`,
        );
      }

      return (await response.json()) as PackageMetadata;
    },

    async downloadAndExtract(
      tarballUrl: string,
      vfs: IVirtualFileSystem,
      destPath: string,
    ): Promise<void> {
      const response = await fetch(tarballUrl);

      if (!response.ok) {
        throw new Error(
          `Failed to download tarball: ${response.status} ${response.statusText}`,
        );
      }

      const buffer = await response.arrayBuffer();
      await extractTarGzip(new Uint8Array(buffer), vfs, destPath);
    },
  };
}
