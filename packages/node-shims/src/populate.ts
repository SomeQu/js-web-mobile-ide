import type { IVirtualFileSystem } from "@anthropic-ide/vfs";
import type { ShimSources } from "./types.js";
import { SHIMS_PACKAGE_PATH } from "./constants.js";

/**
 * Writes each shim's compiled JS source (plus a `package.json` describing
 * subpath exports) into the VFS at `SHIMS_PACKAGE_PATH`, so that the VFS
 * bundler plugin can load the paths the node-shims esbuild plugin resolves
 * Node built-ins to.
 */
export async function populateShims(
  vfs: IVirtualFileSystem,
  sources: ShimSources,
): Promise<void> {
  await vfs.mkdir(SHIMS_PACKAGE_PATH, { recursive: true });

  const encoder = new TextEncoder();
  const exportsMap: Record<string, string> = {};
  for (const [name, source] of Object.entries(sources)) {
    const fileName = `${name.replace(/_/g, "-")}.js`;
    await vfs.writeFile(
      `${SHIMS_PACKAGE_PATH}/${fileName}`,
      encoder.encode(source),
    );
    exportsMap[`./${name}`] = `./${fileName}`;
  }

  await vfs.writeFile(
    `${SHIMS_PACKAGE_PATH}/package.json`,
    encoder.encode(
      JSON.stringify({
        name: "@anthropic-ide/node-shims",
        type: "module",
        exports: exportsMap,
      }),
    ),
  );
}
