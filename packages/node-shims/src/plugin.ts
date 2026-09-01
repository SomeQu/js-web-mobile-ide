import type { Plugin } from "esbuild-wasm/lib/browser.js";
import { NODE_BUILTINS, SHIMS_PACKAGE_PATH } from "./constants.js";

/**
 * esbuild plugin that intercepts imports of Node built-in module names
 * (`path`, `node:path`, etc.) and redirects them to the corresponding shim
 * file inside `SHIMS_PACKAGE_PATH`, in the `"vfs"` namespace so the
 * bundler's VFS plugin `onLoad` hook reads the file's contents.
 */
export function createNodeShimsPlugin(): Plugin {
  const builtins = new Set<string>(NODE_BUILTINS);

  return {
    name: "node-shims",
    setup(build) {
      build.onResolve({ filter: /^(node:)?[a-z]/ }, (args) => {
        const name = args.path.replace(/^node:/, "");
        if (builtins.has(name)) {
          const fileName = `${name.replace(/_/g, "-")}.js`;
          return {
            path: `${SHIMS_PACKAGE_PATH}/${fileName}`,
            namespace: "vfs",
          };
        }
        return undefined;
      });
    },
  };
}
