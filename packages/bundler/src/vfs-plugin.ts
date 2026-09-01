import type { Plugin } from "esbuild-wasm";
import type { IVirtualFileSystem } from "@anthropic-ide/vfs";
import { basename } from "@anthropic-ide/vfs";
import { resolveModuleSpecifier } from "./resolver.js";

const LOADER_MAP: Record<string, string> = {
  ".ts": "tsx",
  ".tsx": "tsx",
  ".js": "jsx",
  ".jsx": "jsx",
  ".json": "json",
  ".css": "css",
  ".txt": "text",
};

function getLoader(filePath: string): string {
  const name = basename(filePath);
  const dotIdx = name.lastIndexOf(".");
  if (dotIdx === -1) return "text";
  const ext = name.slice(dotIdx);
  return LOADER_MAP[ext] ?? "text";
}

export function createVfsPlugin(vfs: IVirtualFileSystem): Plugin {
  const cache = new Map<string, unknown>();

  return {
    name: "vfs",
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        if (args.kind === "entry-point") {
          return { path: args.path, namespace: "vfs" };
        }

        try {
          const resolved = await resolveModuleSpecifier(
            args.path,
            args.importer,
            vfs,
            cache,
          );
          return { path: resolved, namespace: "vfs" };
        } catch (e) {
          return {
            errors: [{ text: (e as Error).message }],
          };
        }
      });

      build.onLoad({ filter: /.*/, namespace: "vfs" }, async (args) => {
        try {
          const contents = await vfs.readFile(args.path);
          return {
            contents: new TextDecoder().decode(contents),
            loader: getLoader(args.path) as
              | "tsx"
              | "jsx"
              | "json"
              | "css"
              | "text",
          };
        } catch (e) {
          return {
            errors: [{ text: `Failed to load ${args.path}: ${(e as Error).message}` }],
          };
        }
      });
    },
  };
}
