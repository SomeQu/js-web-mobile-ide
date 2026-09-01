// Import the browser build directly: esbuild-wasm's default Node entrypoint
// spawns the WASM binary via a child process and rejects `wasmModule`/`worker`
// options ("only works in the browser"). Our runtime target is JavaScriptCore/
// WKWebView (no Node child_process), so we initialize and drive esbuild
// through the same browser build it will actually run under, with
// `worker: false` so it runs inline instead of spinning up a Web Worker
// (unavailable in our runtime and in vitest's node environment).
import * as esbuild from "esbuild-wasm/lib/browser.js";
import type {
  InitOptions,
  BundleOptions,
  BundleResult,
  BundleError,
  IBundler,
  BundleContext,
} from "./types.js";
import { createVfsPlugin } from "./vfs-plugin.js";

// esbuild-wasm can only be initialized once per process. Vitest runs all
// test files in the same process, and other test files in this package
// (and consumers of this module) may have already called
// `esbuild.initialize()` directly, so guard with a module-level flag rather
// than calling initialize() unconditionally.
let initialized = false;

// The VFS plugin resolves everything into the "vfs" namespace, so esbuild
// reports error locations with a "vfs:" prefix on the file path (e.g.
// "vfs:/project/src/index.ts"). Strip it so BundleError.file matches the
// plain VFS path callers passed in.
function stripNamespacePrefix(file: string): string {
  const idx = file.indexOf(":");
  return idx !== -1 && file.slice(idx + 1).startsWith("/") ? file.slice(idx + 1) : file;
}

function mapErrors(messages: esbuild.Message[]): BundleError[] {
  return messages.map((m) => ({
    message: m.text,
    file: m.location?.file ? stripNamespacePrefix(m.location.file) : undefined,
    line: m.location?.line,
    column: m.location?.column,
  }));
}

// The VFS plugin's onResolve has a catch-all `/.*/` filter, so it would try
// (and fail) to resolve external specifiers like "react/jsx-runtime" through
// the VFS before esbuild's own `external` option gets a chance to apply.
// This plugin runs first and marks exact matches external immediately, so
// the VFS plugin never sees them.
function createExternalsPlugin(specifiers: string[]): esbuild.Plugin {
  const externalSet = new Set(specifiers);
  return {
    name: "externals",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (externalSet.has(args.path)) {
          return { path: args.path, external: true };
        }
        return undefined;
      });
    },
  };
}

function buildOptions(options: BundleOptions): esbuild.BuildOptions {
  const jsx = options.jsx === "transform" ? "transform" : "automatic";
  const jsxImportSource = options.jsxImportSource ?? "react";
  return {
    entryPoints: [options.entryPoint],
    bundle: true,
    write: false,
    format: "esm",
    target: "es2020",
    platform: "browser",
    outdir: "/out",
    minify: options.minify ?? false,
    sourcemap: options.sourceMap ? "inline" : false,
    jsx,
    jsxFactory: options.jsxFactory,
    jsxFragment: options.jsxFragment,
    jsxImportSource,
    // The automatic JSX runtime imports `${jsxImportSource}/jsx-runtime`
    // (and `/jsx-dev-runtime` in dev mode). Projects typically provide React
    // as a host global rather than a bundled VFS package, so treat it (and
    // its runtime entry points) as external rather than failing resolution
    // when no such package exists in the VFS.
    plugins:
      jsx === "automatic"
        ? [
            createExternalsPlugin([
              jsxImportSource,
              `${jsxImportSource}/jsx-runtime`,
              `${jsxImportSource}/jsx-dev-runtime`,
            ]),
            createVfsPlugin(options.vfs),
          ]
        : [createVfsPlugin(options.vfs)],
    logLevel: "silent",
  };
}

function extractResult(result: esbuild.BuildResult): BundleResult {
  const code = result.outputFiles?.[0]?.text ?? "";
  return {
    code,
    errors: mapErrors(result.errors),
    warnings: mapErrors(result.warnings),
  };
}

function isBuildFailure(e: unknown): e is esbuild.BuildFailure {
  return (
    typeof e === "object" &&
    e !== null &&
    "errors" in e &&
    Array.isArray((e as esbuild.BuildFailure).errors)
  );
}

export async function initBundler(options: InitOptions): Promise<IBundler> {
  if (!initialized) {
    const wasmModule = new WebAssembly.Module(options.wasmBinary);
    await esbuild.initialize({ wasmModule, worker: false });
    initialized = true;
  }

  return {
    async bundle(opts: BundleOptions): Promise<BundleResult> {
      try {
        const result = await esbuild.build(buildOptions(opts));
        return extractResult(result);
      } catch (e: unknown) {
        if (isBuildFailure(e)) {
          return {
            code: "",
            errors: mapErrors(e.errors),
            warnings: mapErrors(e.warnings),
          };
        }
        throw e;
      }
    },

    async createContext(opts: BundleOptions): Promise<BundleContext> {
      const ctx = await esbuild.context(buildOptions(opts));

      return {
        async rebuild(): Promise<BundleResult> {
          try {
            const result = await ctx.rebuild();
            return extractResult(result);
          } catch (e: unknown) {
            if (isBuildFailure(e)) {
              return {
                code: "",
                errors: mapErrors(e.errors),
                warnings: mapErrors(e.warnings),
              };
            }
            throw e;
          }
        },

        dispose(): void {
          ctx.dispose();
        },
      };
    },
  };
}
